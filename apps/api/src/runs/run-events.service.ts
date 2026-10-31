import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type Valkey from 'iovalkey';
import { and, eq, workflowRunSteps, workflowRuns, type DatabaseClient } from '@cognitive-dag/db';
import {
  RunLiveEventSchema,
  runChannel,
  type RunLiveEvent,
  type RunStreamEvent,
} from '@cognitive-dag/contracts';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import {
  ResourceNotFoundException,
  ServiceUnavailableException,
} from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { VALKEY } from '../valkey/valkey.module';
import { isFinal, toRun, toStep, userNames } from './run-mappers';
import type { RunActor } from './runs.service';

/** Tells the browser how long to wait before reconnecting (milliseconds). */
const RECONNECT_MS = 3_000;

/**
 * Live view of one run over Server-Sent Events (research R4). The caller has already passed the
 * organization guard; here the run is looked up inside the organization (404 otherwise), the
 * Valkey channel is subscribed to, and only then is the state read, so no change can fall between
 * the snapshot and the first event. Events can repeat; every one carries the state after the
 * change, so applying it twice is harmless.
 *
 * `Last-Event-ID` needs no replay buffer: a reconnection always starts with a fresh snapshot that
 * already holds everything the client missed.
 */
@Injectable()
export class RunEventsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(VALKEY) private readonly valkey: Valkey,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async stream(actor: RunActor, runId: string, response: Response): Promise<void> {
    await this.readRun(actor, runId); // 404 before anything is subscribed or sent

    const channel = runChannel(runId);
    const subscriber = this.valkey.duplicate();
    subscriber.on('error', () => undefined);
    const early: string[] = [];
    const handlers: { live?: (message: string) => void; heartbeat?: NodeJS.Timeout } = {};
    subscriber.on('message', (_channel: string, message: string) => {
      if (handlers.live) handlers.live(message);
      else early.push(message);
    });

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (handlers.heartbeat) clearInterval(handlers.heartbeat);
      subscriber.removeAllListeners('message');
      subscriber.unsubscribe(channel).catch(() => undefined);
      subscriber.disconnect();
      if (!response.writableEnded) response.end();
    };

    let snapshot;
    try {
      await subscriber.subscribe(channel);
      snapshot = await this.readSnapshot(actor, runId);
    } catch (error) {
      close();
      throw error instanceof ResourceNotFoundException ? error : new ServiceUnavailableException();
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    response.on('close', close);

    const send = (id: number, event: RunStreamEvent, extra = ''): void => {
      if (closed) return;
      response.write(`${extra}id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    send(Date.now(), { type: 'snapshot', ...snapshot }, `retry: ${RECONNECT_MS}\n`);
    if (isFinal(snapshot.run.status)) {
      close();
      return;
    }

    handlers.heartbeat = setInterval(() => {
      if (!closed) response.write(': heartbeat\n\n');
    }, this.config.SSE_HEARTBEAT_MS);

    // Serial: events go out in the order they were published.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (message: string): void => {
      queue = queue
        .then(() => this.forward(actor, runId, message, send, close))
        .catch(() => undefined);
    };
    handlers.live = enqueue;
    for (const message of early.splice(0)) enqueue(message);
  }

  private async forward(
    actor: RunActor,
    runId: string,
    message: string,
    send: (id: number, event: RunStreamEvent) => void,
    close: () => void,
  ): Promise<void> {
    let event: RunLiveEvent;
    try {
      event = RunLiveEventSchema.parse(JSON.parse(message));
    } catch {
      return; // Not an event of ours: ignore it.
    }
    if (event.runId !== runId) return;
    const id = Date.parse(event.at);

    if (event.nodeId !== undefined) {
      const step = await this.readStep(actor, runId, event.nodeId);
      if (step) send(id, { type: 'step', step });
      return;
    }
    const { run } = await this.readSnapshot(actor, runId, false);
    send(id, { type: 'run', run });
    if (isFinal(run.status)) close();
  }

  private readRun(actor: RunActor, runId: string) {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(eq(workflowRuns.id, runId), eq(workflowRuns.organizationId, actor.organizationId)),
          );
        if (!row) throw new ResourceNotFoundException();
        return { row, names: await userNames(tx, [row.triggeredBy]) };
      },
    );
  }

  private async readSnapshot(actor: RunActor, runId: string, withSteps = true) {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(eq(workflowRuns.id, runId), eq(workflowRuns.organizationId, actor.organizationId)),
          );
        if (!row) throw new ResourceNotFoundException();
        const names = await userNames(tx, [row.triggeredBy]);
        const steps = withSteps
          ? await tx
              .select()
              .from(workflowRunSteps)
              .where(eq(workflowRunSteps.runId, runId))
              .orderBy(workflowRunSteps.createdAt, workflowRunSteps.nodeId)
          : [];
        return { run: toRun(row, names), steps: steps.map(toStep) };
      },
    );
  }

  private readStep(actor: RunActor, runId: string, nodeId: string) {
    return this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(workflowRunSteps)
          .where(and(eq(workflowRunSteps.runId, runId), eq(workflowRunSteps.nodeId, nodeId)));
        return row ? toStep(row) : undefined;
      },
    );
  }
}

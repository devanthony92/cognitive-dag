import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema, RunStreamEventSchema, RunSchema } from '@cognitive-dag/contracts';
import { waitFor } from './ping-helpers';
import { startTestApp } from './helpers';
import {
  amountDefinition,
  closeRunsEnv,
  listen,
  openSse,
  publishedWorkflow,
  RUN_FLAGS,
  runPath,
  setupRunsEnv,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

describe('live run events over SSE (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;
  let baseUrl: string;
  let fast: INestApplication;
  let fastUrl: string;

  beforeAll(async () => {
    env = await setupRunsEnv();
    baseUrl = await listen(env.app);
    fast = await startTestApp({
      FEATURE_FLAGS: RUN_FLAGS,
      TEMPORAL_TASK_QUEUE: env.taskQueue,
      SSE_HEARTBEAT_MS: 200,
    });
    fastUrl = await listen(fast);
  });

  afterAll(async () => {
    await fast.close();
    await closeRunsEnv(env);
  });

  const eventsPath = (runId: string) => `${runPath(env.organization.id, runId)}/events`;
  const cookie = () => ({ Cookie: env.viewer.cookie });

  async function newRun(latencyMs: number): Promise<string> {
    const workflowId = await publishedWorkflow(env, amountDefinition(latencyMs));
    const response = await startRun(env, env.owner, workflowId).expect(202);
    return RunSchema.parse(response.body).id;
  }

  it('sends a snapshot, then one event per state change, and closes after the terminal state', async () => {
    const runId = await newRun(1_500);
    const stream = await openSse(baseUrl, eventsPath(runId), cookie());
    expect(stream.status).toBe(200);
    expect(stream.contentType).toContain('text/event-stream');
    await stream.closed;

    const events = stream.messages
      .filter((message) => message.data !== undefined)
      .map((message) => RunStreamEventSchema.parse(message.data));
    expect(events[0]?.type).toBe('snapshot');
    expect(stream.messages[0]?.event).toBe('snapshot');
    expect(stream.messages.every((message) => message.id !== undefined)).toBe(true);

    const stepEvents = events.filter((event) => event.type === 'step');
    expect(
      stepEvents.some((event) => event.step.nodeId === 'work' && event.step.status === 'running'),
    ).toBe(true);
    expect(
      stepEvents.some((event) => event.step.nodeId === 'work' && event.step.status === 'succeeded'),
    ).toBe(true);
    const last = events.at(-1);
    expect(last?.type).toBe('run');
    expect(last?.type === 'run' && last.run.status).toBe('succeeded');
  });

  it('on a finished run it sends the snapshot and closes', async () => {
    const runId = await newRun(100);
    await waitForTerminal(env, env.owner, runId);
    const stream = await openSse(baseUrl, eventsPath(runId), cookie());
    await stream.closed;
    expect(stream.messages).toHaveLength(1);
    const snapshot = RunStreamEventSchema.parse(stream.messages[0]?.data);
    expect(snapshot).toMatchObject({ type: 'snapshot', run: { id: runId, status: 'succeeded' } });
    expect(snapshot.type === 'snapshot' && snapshot.steps).toHaveLength(2);
  });

  it('Last-Event-ID resumes with a snapshot that already holds what was missed', async () => {
    const runId = await newRun(1_500);
    const first = await openSse(baseUrl, eventsPath(runId), cookie());
    await waitFor(() => Promise.resolve(first.messages.length >= 1 ? true : undefined));
    const lastId = first.messages.at(-1)?.id;
    expect(lastId).toBeTruthy();
    first.close();

    const resumed = await openSse(baseUrl, eventsPath(runId), {
      ...cookie(),
      'Last-Event-ID': lastId!,
    });
    await resumed.closed;
    expect(resumed.messages[0]?.event).toBe('snapshot');
    const last = RunStreamEventSchema.parse(resumed.messages.at(-1)?.data);
    expect(last.type === 'run' && last.run.status).toBe('succeeded');
  });

  it('sends a heartbeat comment while the run is quiet', async () => {
    const runId = await newRun(2_000);
    const stream = await openSse(fastUrl, eventsPath(runId), cookie());
    await waitFor(() =>
      Promise.resolve(
        stream.messages.filter((message) => message.comment === 'heartbeat').length >= 2
          ? true
          : undefined,
      ),
    );
    stream.close();
  });

  it('a member of another organization gets 404 problem+json, not a stream', async () => {
    const runId = await newRun(100);
    const outsider = await fetch(`${baseUrl}${eventsPath(runId)}`, {
      headers: { Cookie: env.outsider.cookie },
    });
    expect(outsider.status).toBe(404);
    expect(outsider.headers.get('content-type')).toContain('application/problem+json');
    expect(ProblemDetailsSchema.parse(await outsider.json()).code).toBe('NOT_FOUND');

    // Their own organization in the path does not reveal the run either.
    const own = await fetch(
      `${baseUrl}/api/v1/organizations/${env.outsiderOrganization.id}/runs/${runId}/events`,
      { headers: { Cookie: env.outsider.cookie } },
    );
    expect(own.status).toBe(404);
  });

  it('releases the Valkey subscription when the client disconnects', async () => {
    const runId = await newRun(5_000);
    const channel = `run:${runId}`;
    const subscribers = async () => {
      const reply = (await env.valkey.pubsub('NUMSUB', channel)) as [string, number];
      return Number(reply[1]);
    };
    const stream = await openSse(baseUrl, eventsPath(runId), cookie());
    await waitFor(async () => ((await subscribers()) === 1 ? true : undefined));
    stream.close();
    await waitFor(async () => ((await subscribers()) === 0 ? true : undefined));
  });
});

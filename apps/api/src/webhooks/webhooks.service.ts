import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import {
  eq,
  startRun,
  webhookTriggers,
  workflowRuns,
  type DatabaseClient,
  type StartRunRefusal,
} from '@cognitive-dag/db';
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  WEBHOOK_EVENT_ID_PATTERN,
  resolveCorrelationId,
  type ExecuteDagInput,
  type WebhookAccepted,
} from '@cognitive-dag/contracts';
import {
  DagDefinitionSchema,
  findUnsupportedNodes,
  validateTriggerInput,
  type FieldSpec,
} from '@cognitive-dag/dag-schema';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DomainException, RateLimitedException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import { RunLauncher } from '../runs/run-launcher';
import { SecurityEventLogger, type SecurityEvent } from '../security-events/security-event.logger';
import { readWebhookBody } from './webhook-body';
import { webhookTokenMatches } from './webhook-token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = z.iso.datetime({ offset: true });
const RUN_LIMIT_RETRY_AFTER_SECONDS = 10;
const BODY_FIELD_ERROR = 'El cuerpo no coincide con los campos del disparador.';

export interface FireWebhookParams {
  triggerId: string;
  token: string;
  ip: string;
  req: Request;
}

export type FireWebhookResult = WebhookAccepted;

/** The same 401 for a trigger that does not exist, a wrong token and a regenerated one (US2). */
const tokenInvalid = () =>
  new DomainException(401, 'WEBHOOK_TOKEN_INVALID', 'El enlace del webhook no es válido.');

const notActive = () =>
  new DomainException(
    409,
    'WEBHOOK_NOT_ACTIVE',
    'El workflow no tiene una versión activa con un disparador por webhook.',
  );

/**
 * The public endpoint of a webhook (F7, decisions 2B, 3B, 4A, 5A). Checks run in a fixed order, from
 * the cheapest and least informative to the most: the budget of failed attempts of the address, the
 * token, the rate of the trigger, the shape of the request, and only then the workflow. Nothing about
 * the workflow is revealed before the token is accepted, and the token never reaches a log.
 */
@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly rateLimit: RateLimitService,
    private readonly launcher: RunLauncher,
    private readonly events: SecurityEventLogger,
    private readonly cls: ClsService,
  ) {}

  async fire(params: FireWebhookParams): Promise<FireWebhookResult> {
    const { triggerId, ip, req } = params;
    const reject = (reason: NonNullable<SecurityEvent['reason']>) =>
      this.events.emit({ event: 'webhook.rejected', outcome: 'failure', ip, reason });

    // 1. Addresses that keep failing wait before anything else is looked at.
    const wait = await this.rateLimit.secondsUntilAvailable(RATE_RULES.webhookBadAttempts, ip);
    if (wait > 0) {
      reject('rate_limit');
      throw this.rateLimited(wait);
    }

    // 2. The token. A failure spends one of the attempts of the address.
    const trigger = await this.findTrigger(triggerId);
    if (!webhookTokenMatches(params.token, trigger?.tokenHash) || !trigger) {
      await this.spendBadAttempt(ip);
      reject('token');
      throw tokenInvalid();
    }

    // 3. The rate of the trigger survives regenerating the token (it is keyed by the id).
    try {
      await this.rateLimit.consume(RATE_RULES.webhookTrigger, triggerId);
    } catch (error) {
      if (error instanceof RateLimitedException) {
        reject('rate_limit');
        throw this.rateLimited(error.options.retryAfterSeconds ?? 1);
      }
      throw error;
    }

    // 4. Shape of the request.
    const body = await readWebhookBody(req, this.config.WEBHOOK_MAX_BODY_BYTES);
    const eventId = req.headers['x-event-id'];
    if (typeof eventId !== 'string' || !WEBHOOK_EVENT_ID_PATTERN.test(eventId)) {
      reject('event_id');
      throw new DomainException(
        400,
        'WEBHOOK_EVENT_ID_INVALID',
        'Falta la cabecera X-Event-Id o no es válida (1 a 128 caracteres: letras, números, . _ : -).',
      );
    }
    this.checkTimestamp(req.headers['x-event-timestamp'], reject);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      reject('body');
      throw new DomainException(
        422,
        'VALIDATION_FAILED',
        'La solicitud contiene datos inválidos.',
        { errors: [{ field: '(body)', message: 'El cuerpo debe ser un objeto JSON.' }] },
      );
    }
    const triggerInput = body as Record<string, unknown>;

    // 5. The workflow, with the version that is active right now (decision 5A).
    const correlationId = resolveCorrelationId(this.cls.getId());
    const phases = this.launcher.executablePhases();
    const context = { organizationId: trigger.organizationId };
    const outcome = await this.database.withContext(context, async (tx) => {
      const started = await startRun(tx, {
        organizationId: trigger.organizationId,
        workflowId: trigger.workflowId,
        correlationId,
        trigger: { kind: 'webhook', eventId },
        defaultMaxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
        temporalWorkflowId: () => `hook-${trigger.workflowId}-${eventId}`,
      });
      if (!started.ok) {
        if (started.reason === 'duplicate_event') {
          const [existing] = await tx
            .select({ id: workflowRuns.id, status: workflowRuns.status })
            .from(workflowRuns)
            .where(eq(workflowRuns.id, started.runId));
          return { duplicate: true as const, runId: started.runId, status: existing?.status };
        }
        throw this.refusalOf(started);
      }

      // Anything thrown from here rolls the insert back: a refused event leaves no run.
      const parsed = DagDefinitionSchema.safeParse(started.version.definition);
      if (!parsed.success) throw new Error('A published version does not match the DAG schema');
      const node = parsed.data.nodes.find((candidate) => candidate.type === 'trigger.webhook');
      if (!node) throw notActive();
      if (findUnsupportedNodes(parsed.data, phases).length > 0) {
        throw new DomainException(
          409,
          'WORKFLOW_NOT_RUNNABLE',
          'La versión activa tiene nodos que todavía no se pueden ejecutar.',
          { reason: 'unsupported_nodes' },
        );
      }
      const fields = (node.config as { bodySchema?: FieldSpec[] }).bodySchema ?? [];
      const problems = validateTriggerInput(fields, triggerInput);
      if (problems.length > 0) {
        reject('body');
        throw new DomainException(422, 'VALIDATION_FAILED', BODY_FIELD_ERROR, {
          errors: problems.map(({ field, message }) => ({ field: `body.${field}`, message })),
        });
      }
      const workflowInput: ExecuteDagInput = {
        organizationId: trigger.organizationId,
        workflowId: trigger.workflowId,
        versionId: started.version.id,
        versionNumber: started.version.versionNumber,
        runId: started.run.id,
        correlationId,
        definition: started.version.definition,
        triggerInput,
        triggerKind: 'webhook',
        ...this.launcher.inputExtras(phases, parsed.data),
      };
      return { duplicate: false as const, run: started.run, workflowInput };
    });

    if (outcome.duplicate) {
      return {
        runId: outcome.runId,
        status: outcome.status ?? 'queued',
        duplicate: true,
      };
    }
    await this.launcher.launch(context, outcome.run, outcome.workflowInput, {
      rejectDuplicate: true,
    });
    this.events.emit({
      event: 'webhook.accepted',
      outcome: 'success',
      organizationId: trigger.organizationId,
      ip,
      resourceId: trigger.id,
    });
    return { runId: outcome.run.id, status: outcome.run.status, duplicate: false };
  }

  /** The row of the trigger, read with the lookup key: that key opens one row and writes nothing. */
  private async findTrigger(triggerId: string) {
    if (!UUID.test(triggerId)) return undefined;
    return this.database.withContext({ lookupWebhookTriggerId: triggerId }, async (tx) => {
      const [row] = await tx
        .select({
          id: webhookTriggers.id,
          organizationId: webhookTriggers.organizationId,
          workflowId: webhookTriggers.workflowId,
          tokenHash: webhookTriggers.tokenHash,
        })
        .from(webhookTriggers)
        .where(eq(webhookTriggers.id, triggerId));
      return row;
    });
  }

  private async spendBadAttempt(ip: string): Promise<void> {
    try {
      await this.rateLimit.consume(RATE_RULES.webhookBadAttempts, ip);
    } catch (error) {
      // An exhausted budget is answered by the next request; this one still gets its 401.
      if (!(error instanceof RateLimitedException)) throw error;
    }
  }

  private checkTimestamp(
    header: string | string[] | undefined,
    reject: (reason: NonNullable<SecurityEvent['reason']>) => void,
  ): void {
    const invalid = () => {
      reject('timestamp');
      return new DomainException(
        400,
        'WEBHOOK_TIMESTAMP_INVALID',
        `X-Event-Timestamp falta, no es una fecha ISO 8601 o está a más de ${this.config.WEBHOOK_TIMESTAMP_WINDOW_SECONDS} segundos del reloj del servidor.`,
      );
    };
    if (typeof header !== 'string' || !TIMESTAMP.safeParse(header).success) throw invalid();
    const skewMs = Math.abs(Date.now() - Date.parse(header));
    if (skewMs > this.config.WEBHOOK_TIMESTAMP_WINDOW_SECONDS * 1000) throw invalid();
  }

  private rateLimited(retryAfterSeconds: number): DomainException {
    return new DomainException(
      429,
      'WEBHOOK_RATE_LIMITED',
      'Demasiadas solicitudes al webhook. Espera antes de volver a intentarlo.',
      { retryAfterSeconds },
    );
  }

  private refusalOf(refusal: Exclude<StartRunRefusal, { reason: 'duplicate_event' }>): Error {
    if (refusal.reason === 'run_limit_reached') {
      return new DomainException(
        429,
        'RUN_LIMIT_REACHED',
        `La organización ya tiene ${refusal.inProgress} ejecuciones en curso y el máximo es ${refusal.limit}. Espera a que termine alguna.`,
        { retryAfterSeconds: RUN_LIMIT_RETRY_AFTER_SECONDS },
      );
    }
    // An archived workflow, a missing one and one without an active version are all "not active".
    return notActive();
  }
}

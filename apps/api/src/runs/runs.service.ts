import { Inject, Injectable } from '@nestjs/common';
import { WorkflowNotFoundError } from '@temporalio/common';
import { ClsService } from 'nestjs-cls';
import {
  SearchAttributeType,
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from '@temporalio/common';
import {
  active,
  and,
  desc,
  eq,
  lt,
  newId,
  sql,
  archived,
  workflowActiveVersions,
  workflowRunSteps,
  workflowRuns,
  workflowVersions,
  workflows,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import {
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  EXECUTE_DAG_WORKFLOW_NAME,
  RUN_EXECUTION_TIMEOUT,
  resolveCorrelationId,
  temporalWorkflowIdFor,
  type ExecuteDagInput,
  type Run,
  type RunDetail,
  type RunList,
  type StepIo,
} from '@cognitive-dag/contracts';
import {
  DagDefinitionSchema,
  findUnsupportedNodes,
  validateTriggerInput,
  type FieldSpec,
} from '@cognitive-dag/dag-schema';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DomainException, ResourceNotFoundException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { LimitsService } from '../workflows/limits.service';
import { RunTemporalService } from './run-history.service';
import { stepContentOf, toStepIo, triggerInputOf } from './run-content';
import { isFinal, toRun, toStep, userNames } from './run-mappers';

/** Who acts, on which organization, from where. The organization guard already vouched for it. */
export interface RunActor {
  userId: string;
  organizationId: string;
  ip: string;
}

const CORRELATION_ID_KEY = defineSearchAttributeKey(
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  SearchAttributeType.KEYWORD,
);

/** How long a client waits before asking again when the run limit is reached. */
const LIMIT_RETRY_AFTER_SECONDS = 10;

/** After asking Temporal to cancel, how long the API waits to record who cancelled. */
const CANCEL_RECORD_WAIT_MS = 5_000;
const CANCEL_RECORD_POLL_MS = 100;

const notRunnable = (
  reason: 'no_active_version' | 'archived' | 'unsupported_nodes',
  detail: string,
  nodes?: { nodeId: string; type: string; executableFrom: string }[],
) =>
  new DomainException(409, 'WORKFLOW_NOT_RUNNABLE', detail, {
    reason,
    ...(nodes ? { nodes } : {}),
  });

type RunRow = typeof workflowRuns.$inferSelect;

@Injectable()
export class RunsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly temporal: RunTemporalService,
    private readonly limits: LimitsService,
    private readonly events: SecurityEventLogger,
    private readonly cls: ClsService,
  ) {}

  private context(actor: RunActor) {
    return { userId: actor.userId, organizationId: actor.organizationId };
  }

  /**
   * Starts a run of the active version (research R5, R6). One transaction validates, counts the
   * runs in progress under an advisory lock of the organization and inserts the row; only then
   * is Temporal asked to start, so a failure leaves a `failed` run, never a `running` one.
   */
  async start(
    actor: RunActor,
    workflowId: string,
    triggerInput: Record<string, unknown>,
    rerunOf?: string,
  ): Promise<Run> {
    const correlationId = resolveCorrelationId(this.cls.getId());
    const { row, names, workflowInput } = await this.database.withContext(
      this.context(actor),
      async (tx) => {
        const prepared = await this.prepare(tx, actor, workflowId, triggerInput);

        // The lock is held until this transaction commits, so the count below sees every run
        // inserted by a start that went first (SC-005).
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId}, 0))`,
        );
        const limits = await this.limits.effectiveIn(tx, actor.organizationId);
        const [{ n } = { n: 0 }] = (
          await tx.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM workflow_runs
                WHERE organization_id = ${actor.organizationId}
                  AND status IN ('queued', 'running')`,
          )
        ).rows;
        if (n >= limits.maxConcurrentRuns) {
          throw new DomainException(
            429,
            'RUN_LIMIT_REACHED',
            `La organización ya tiene ${n} ejecuciones en curso y el máximo es ${limits.maxConcurrentRuns}. Espera a que termine alguna.`,
            { retryAfterSeconds: LIMIT_RETRY_AFTER_SECONDS },
          );
        }

        const runId = await newId(tx);
        const [inserted] = await tx
          .insert(workflowRuns)
          .values({
            id: runId,
            organizationId: actor.organizationId,
            workflowId,
            versionId: prepared.versionId,
            versionNumber: prepared.versionNumber,
            triggeredBy: actor.userId,
            rerunOf: rerunOf ?? null,
            correlationId,
            temporalWorkflowId: temporalWorkflowIdFor(runId),
          })
          .returning();
        if (!inserted) throw new Error('INSERT INTO workflow_runs returned no row');
        const names = await userNames(tx, [actor.userId]);
        const workflowInput: ExecuteDagInput = {
          organizationId: actor.organizationId,
          workflowId,
          versionId: prepared.versionId,
          versionNumber: prepared.versionNumber,
          runId,
          correlationId,
          definition: prepared.definition,
          triggerInput,
        };
        return { row: inserted, names, workflowInput };
      },
    );

    await this.launch(actor, row, workflowInput);
    this.events.emit({
      event: rerunOf === undefined ? 'run.started' : 'run.rerun',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    return toRun(row, names);
  }

  /** Everything that can refuse a start before the limit is looked at. */
  private async prepare(
    tx: Tx,
    actor: RunActor,
    workflowId: string,
    triggerInput: Record<string, unknown>,
  ) {
    const [workflow] = await active.workflows(
      tx,
      and(eq(workflows.id, workflowId), eq(workflows.organizationId, actor.organizationId)),
    );
    if (!workflow) {
      const [gone] = await archived.workflows(
        tx,
        and(eq(workflows.id, workflowId), eq(workflows.organizationId, actor.organizationId)),
      );
      if (gone) throw notRunnable('archived', 'El workflow está archivado y no se puede ejecutar.');
      throw new ResourceNotFoundException();
    }

    const [bridge] = await tx
      .select()
      .from(workflowActiveVersions)
      .where(eq(workflowActiveVersions.workflowId, workflowId));
    const [version] = bridge?.versionId
      ? await tx.select().from(workflowVersions).where(eq(workflowVersions.id, bridge.versionId))
      : [];
    if (!version) {
      throw notRunnable(
        'no_active_version',
        'El workflow no tiene una versión activa. Publica y activa una versión primero.',
      );
    }

    const parsed = DagDefinitionSchema.safeParse(version.definition);
    if (!parsed.success) throw new Error('A published version does not match the DAG schema');
    const unsupported = findUnsupportedNodes(parsed.data);
    if (unsupported.length > 0) {
      throw notRunnable(
        'unsupported_nodes',
        'La versión activa tiene nodos que todavía no se pueden ejecutar.',
        unsupported,
      );
    }

    const trigger = parsed.data.nodes.find((node) => node.type === 'trigger.manual');
    const fields =
      (trigger?.config as { inputSchema?: FieldSpec[] } | undefined)?.inputSchema ?? [];
    const problems = validateTriggerInput(fields, triggerInput);
    if (problems.length > 0) {
      throw new DomainException(
        422,
        'RUN_INPUT_INVALID',
        'Los datos de entrada no coinciden con los campos del disparador manual.',
        { errors: problems.map(({ field, message }) => ({ field: `input.${field}`, message })) },
      );
    }
    return {
      versionId: version.id,
      versionNumber: version.versionNumber,
      definition: version.definition as Record<string, unknown>,
    };
  }

  /** Asks Temporal to start; on failure the run ends `failed` and the caller gets 503. */
  private async launch(actor: RunActor, row: RunRow, input: ExecuteDagInput): Promise<void> {
    try {
      await this.temporal.withDeadline(() =>
        this.temporal.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
          taskQueue: this.config.TEMPORAL_TASK_QUEUE,
          workflowId: row.temporalWorkflowId,
          args: [input],
          workflowExecutionTimeout: RUN_EXECUTION_TIMEOUT,
          typedSearchAttributes: new TypedSearchAttributes([
            { key: CORRELATION_ID_KEY, value: row.correlationId },
          ]),
        }),
      );
    } catch (error) {
      await this.database.withContext(this.context(actor), (tx) =>
        tx
          .update(workflowRuns)
          .set({
            status: 'failed',
            errorCode: 'SERVICE_UNAVAILABLE',
            errorMessage: 'No se pudo iniciar la ejecución en el motor.',
            finishedAt: new Date(),
          })
          .where(and(eq(workflowRuns.id, row.id), eq(workflowRuns.status, 'queued'))),
      );
      // The request may have reached Temporal before the deadline: do not leave a run nobody records.
      await this.temporal
        .withDeadline(() =>
          this.temporal.client.workflow.getHandle(row.temporalWorkflowId).terminate('start failed'),
        )
        .catch(() => undefined);
      throw this.temporal.translate(error);
    }
  }

  async list(
    actor: RunActor,
    workflowId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<RunList> {
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    return this.database.withContext(this.context(actor), async (tx) => {
      const [workflow] = await active.workflows(
        tx,
        and(eq(workflows.id, workflowId), eq(workflows.organizationId, actor.organizationId)),
      );
      if (!workflow) throw new ResourceNotFoundException();

      const rows = await tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workflowId, workflowId),
            eq(workflowRuns.organizationId, actor.organizationId),
            after === undefined ? undefined : lt(workflowRuns.id, after),
          ),
        )
        // UUID v7: the id order is the creation order.
        .orderBy(desc(workflowRuns.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const names = await userNames(
        tx,
        page.map((row) => row.triggeredBy),
      );
      const last = page.at(-1);
      return {
        items: page.map((row) => toRun(row, names)),
        nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
      };
    });
  }

  async get(actor: RunActor, runId: string): Promise<RunDetail> {
    return this.database.withContext(this.context(actor), async (tx) => {
      const row = await this.findRun(tx, actor, runId);
      const steps = await tx
        .select()
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.runId, runId))
        .orderBy(workflowRunSteps.createdAt, workflowRunSteps.nodeId);
      const [version] = await tx
        .select({ definition: workflowVersions.definition })
        .from(workflowVersions)
        .where(eq(workflowVersions.id, row.versionId));
      const names = await userNames(tx, [row.triggeredBy]);
      return {
        ...toRun(row, names),
        steps: steps.map(toStep),
        definition: (version?.definition ?? {}) as Record<string, unknown>,
      };
    });
  }

  async stepIo(actor: RunActor, runId: string, nodeId: string): Promise<StepIo> {
    const { row, node } = await this.database.withContext(this.context(actor), async (tx) => {
      const found = await this.findRun(tx, actor, runId);
      const [version] = await tx
        .select({ definition: workflowVersions.definition })
        .from(workflowVersions)
        .where(eq(workflowVersions.id, found.versionId));
      const definition = DagDefinitionSchema.safeParse(version?.definition);
      const target = definition.success
        ? definition.data.nodes.find((candidate) => candidate.id === nodeId)
        : undefined;
      if (!target) throw new ResourceNotFoundException();
      return { row: found, node: { id: target.id, type: target.type } };
    });

    const history = await this.temporal.history(row.temporalWorkflowId);
    if (history === undefined) {
      throw new DomainException(
        410,
        'STEP_IO_EXPIRED',
        'El contenido de este paso ya no está disponible: el historial del motor venció.',
      );
    }
    return toStepIo(stepContentOf(history, node));
  }

  /**
   * Requests the cancellation (research R6). A run nobody took yet is cancelled right here; one
   * in progress is cancelled by Temporal and recorded by the interpreter, and the API then notes
   * who asked for it.
   */
  async cancel(actor: RunActor, runId: string): Promise<Run> {
    const notCancellable = () =>
      new DomainException(
        409,
        'RUN_NOT_CANCELLABLE',
        'La ejecución ya terminó y no se puede cancelar.',
      );

    const row = await this.database.withContext(this.context(actor), async (tx) => {
      const found = await this.findRun(tx, actor, runId);
      if (isFinal(found.status)) throw notCancellable();
      return found;
    });

    if (row.status === 'queued') {
      const cancelled = await this.database.withContext(this.context(actor), (tx) =>
        tx
          .update(workflowRuns)
          .set({ status: 'cancelled', cancelledBy: actor.userId, finishedAt: new Date() })
          .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, 'queued')))
          .returning({ id: workflowRuns.id }),
      );
      if (cancelled.length > 0) {
        // Stop the workflow too, so it does not run for nobody. Best effort: the row is the record.
        await this.temporal
          .withDeadline(() =>
            this.temporal.client.workflow.getHandle(row.temporalWorkflowId).cancel(),
          )
          .catch(() => undefined);
        return this.finishCancel(actor, runId);
      }
    }

    try {
      await this.temporal.withDeadline(() =>
        this.temporal.client.workflow.getHandle(row.temporalWorkflowId).cancel(),
      );
    } catch (error) {
      // The workflow already closed: the run finished while the request was on its way.
      if (error instanceof WorkflowNotFoundError) throw notCancellable();
      throw this.temporal.translate(error);
    }

    const deadline = Date.now() + CANCEL_RECORD_WAIT_MS;
    for (;;) {
      const marked = await this.database.withContext(this.context(actor), (tx) =>
        tx
          .update(workflowRuns)
          .set({ cancelledBy: actor.userId })
          .where(
            and(
              eq(workflowRuns.id, runId),
              eq(workflowRuns.status, 'cancelled'),
              sql`${workflowRuns.cancelledBy} IS NULL`,
            ),
          )
          .returning({ id: workflowRuns.id }),
      );
      if (marked.length > 0 || Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, CANCEL_RECORD_POLL_MS));
    }
    return this.finishCancel(actor, runId);
  }

  private async finishCancel(actor: RunActor, runId: string): Promise<Run> {
    this.events.emit({
      event: 'run.cancelled',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
    });
    const detail = await this.get(actor, runId);
    const { steps: _steps, definition: _definition, ...run } = detail;
    return run;
  }

  /** A new run with the input of an earlier one, on the version that is active now (FR-017). */
  async rerun(actor: RunActor, runId: string): Promise<Run> {
    const original = await this.database.withContext(this.context(actor), (tx) =>
      this.findRun(tx, actor, runId),
    );
    const history = await this.temporal.history(original.temporalWorkflowId);
    const input = history === undefined ? undefined : triggerInputOf(history);
    if (input === undefined) {
      throw new DomainException(
        410,
        'RUN_INPUT_EXPIRED',
        'Los datos de entrada de esta ejecución ya no están disponibles: el historial del motor venció.',
      );
    }
    return this.start(actor, original.workflowId, input, original.id);
  }

  private async findRun(tx: Tx, actor: RunActor, runId: string): Promise<RunRow> {
    const [row] = await tx
      .select()
      .from(workflowRuns)
      .where(
        and(eq(workflowRuns.id, runId), eq(workflowRuns.organizationId, actor.organizationId)),
      );
    if (!row) throw new ResourceNotFoundException();
    return row;
  }
}

const encodeCursor = (id: string): string => Buffer.from(id, 'utf8').toString('base64url');

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new DomainException(422, 'VALIDATION_FAILED', 'La solicitud contiene datos inválidos.', {
      errors: [{ field: 'cursor', message: 'El cursor no es válido.' }],
    });
  }
  return id;
}

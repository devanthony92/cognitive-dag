import { Inject, Injectable } from '@nestjs/common';
import { WorkflowNotFoundError } from '@temporalio/common';
import { ClsService } from 'nestjs-cls';
import {
  active,
  and,
  desc,
  eq,
  inArray,
  lt,
  sql,
  startRun,
  named as withName,
  workflowRunSteps,
  workflowRuns,
  workflowVersions,
  workflows,
  type DatabaseClient,
  type StartRunRefusal,
  type Tx,
} from '@cognitive-dag/db';
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  FEATURE_FLAGS,
  resolveCorrelationId,
  temporalWorkflowIdFor,
  type ExecuteDagInput,
  type OrganizationRunList,
  type Run,
  type RunDetail,
  type RunList,
  type StepIo,
} from '@cognitive-dag/contracts';
import {
  DagDefinitionSchema,
  computeReusable,
  findUnsupportedNodes,
  validateTriggerInput,
  type FieldSpec,
  type StepState,
} from '@cognitive-dag/dag-schema';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import {
  DomainException,
  FeatureNotAvailableException,
  ResourceNotFoundException,
} from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { FlagsService } from '../flags/flags.service';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { loadRunLlmUsage } from '../llm-usage/llm-usage.service';
import { RunLauncher, type ExecutablePhases } from './run-launcher';
import { RunTemporalService } from './run-history.service';
import { memoizedOf, stepContentOf, toStepIo, triggerInputOf } from './run-content';
import { isFinal, toRun, toStep, userNames } from './run-mappers';

/** Who acts, on which organization, from where. The organization guard already vouched for it. */
export interface RunActor {
  userId: string;
  organizationId: string;
  ip: string;
}

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

/** What links a run to the one it repeats; with `versionId` it runs on that version (F4). */
interface RerunSource {
  of: string;
  versionId?: string;
  fromNodeId?: string;
  memoized?: Record<string, unknown>;
}

@Injectable()
export class RunsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly temporal: RunTemporalService,
    private readonly launcher: RunLauncher,
    private readonly events: SecurityEventLogger,
    private readonly flags: FlagsService,
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
    rerun?: RerunSource,
  ): Promise<Run> {
    const correlationId = resolveCorrelationId(this.cls.getId());
    const phases = await this.launcher.executablePhases();
    const { row, names, workflowInput } = await this.database.withContext(
      this.context(actor),
      async (tx) => {
        const started = await startRun(tx, {
          organizationId: actor.organizationId,
          workflowId,
          correlationId,
          trigger: {
            kind: 'manual',
            userId: actor.userId,
            ...(rerun ? { rerunOf: rerun.of } : {}),
            ...(rerun?.fromNodeId ? { rerunFromNodeId: rerun.fromNodeId } : {}),
          },
          ...(rerun?.versionId ? { pinnedVersionId: rerun.versionId } : {}),
          defaultMaxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
          temporalWorkflowId: temporalWorkflowIdFor,
        });
        if (!started.ok) throw refusalOf(started);

        // Anything thrown from here rolls the insert back: a run that cannot run leaves no row.
        const definition = this.checkRunnable(started.version.definition, phases, triggerInput);
        const names = await userNames(tx, [actor.userId]);
        const workflowInput: ExecuteDagInput = {
          organizationId: actor.organizationId,
          workflowId,
          versionId: started.version.id,
          versionNumber: started.version.versionNumber,
          runId: started.run.id,
          correlationId,
          definition: started.version.definition,
          triggerInput,
          ...this.launcher.inputExtras(phases, definition),
          ...(rerun?.memoized ? { memoized: rerun.memoized } : {}),
        };
        return { row: started.run, names, workflowInput };
      },
    );

    await this.launcher.launch(this.context(actor), row, workflowInput);
    this.events.emit({
      event: rerun === undefined ? 'run.started' : 'run.rerun',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
      ...(rerun?.fromNodeId === undefined ? {} : { nodeId: rerun.fromNodeId }),
    });
    return toRun(row, names);
  }

  /** What can still refuse a manual start once the version is known: nodes and input. */
  private checkRunnable(
    raw: Record<string, unknown>,
    phases: ExecutablePhases,
    triggerInput: Record<string, unknown>,
  ) {
    const parsed = DagDefinitionSchema.safeParse(raw);
    if (!parsed.success) throw new Error('A published version does not match the DAG schema');
    const unsupported = findUnsupportedNodes(parsed.data, phases);
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
    return parsed.data;
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
      // Without the flag no indicator of consumption exists (R13): fields stay null.
      const usage = (await this.flags.isEnabled(FEATURE_FLAGS.llmNodesEnabled))
        ? await loadRunLlmUsage(tx, runId)
        : undefined;
      return {
        ...toRun(row, names),
        llmUsage: usage?.total ?? null,
        steps: steps.map((step) => ({
          ...toStep(step),
          llmUsage: usage?.byNode.get(step.nodeId) ?? null,
        })),
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

  /**
   * A new run with the input of an earlier one (FR-017). Without `fromNodeId` it uses the version
   * active now; with it, the version of the original, reusing the outputs of the nodes with an
   * effect that do not depend on the chosen node (research R6).
   */
  async rerun(actor: RunActor, runId: string, fromNodeId?: string): Promise<Run> {
    if (
      fromNodeId !== undefined &&
      !(await this.flags.isEnabled(FEATURE_FLAGS.resilienceEnabled))
    ) {
      throw new FeatureNotAvailableException();
    }
    const found = await this.database.withContext(this.context(actor), async (tx) => {
      const original = await this.findRun(tx, actor, runId);
      if (fromNodeId === undefined) return { original, reusable: [], nodes: [] };
      if (!isFinal(original.status)) {
        throw new DomainException(
          409,
          'RUN_NOT_FINISHED',
          'La ejecución todavía no terminó: espera a que termine para reejecutar desde un nodo.',
        );
      }
      const [version] = await tx
        .select({ definition: workflowVersions.definition })
        .from(workflowVersions)
        .where(eq(workflowVersions.id, original.versionId));
      const definition = DagDefinitionSchema.safeParse(version?.definition);
      if (!definition.success) throw new Error('A published version does not match the DAG schema');
      const steps = await tx
        .select({ nodeId: workflowRunSteps.nodeId, status: workflowRunSteps.status })
        .from(workflowRunSteps)
        .where(eq(workflowRunSteps.runId, original.id));
      // A step reused by an earlier rerun succeeded in the run it came from.
      const statuses = new Map<string, StepState>(
        steps.map((step) => [step.nodeId, step.status === 'reused' ? 'succeeded' : step.status]),
      );
      const plan = computeReusable(definition.data, statuses, fromNodeId);
      if (!plan.ok) {
        throw new DomainException(
          422,
          'RERUN_NODE_INVALID',
          'El nodo elegido no existe en la versión de esta ejecución.',
        );
      }
      return {
        original,
        reusable: plan.reusable,
        nodes: definition.data.nodes.map((node) => ({ id: node.id, type: node.type })),
      };
    });
    const { original } = found;

    const history = await this.temporal.history(original.temporalWorkflowId);
    const input = history === undefined ? undefined : triggerInputOf(history);
    if (history === undefined || input === undefined) throw inputExpired();
    if (fromNodeId === undefined) {
      return this.start(actor, original.workflowId, input, { of: original.id });
    }

    // Outputs live only in the Temporal history (decision 5C): read them from there.
    const earlier = memoizedOf(history);
    const memoized: Record<string, unknown> = {};
    for (const nodeId of found.reusable) {
      const node = found.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) continue;
      const content = stepContentOf(history, node);
      if ('output' in content) memoized[nodeId] = content.output;
      else if (Object.hasOwn(earlier, nodeId)) memoized[nodeId] = earlier[nodeId];
      else throw inputExpired();
    }
    return this.start(actor, original.workflowId, input, {
      of: original.id,
      versionId: original.versionId,
      fromNodeId,
      memoized,
    });
  }

  /** Runs of the whole organization, most recent first (F4, research R7). */
  async listOrganization(
    actor: RunActor,
    filters: { status?: Run['status']; workflowId?: string; cursor?: string; limit: number },
  ): Promise<OrganizationRunList> {
    const after = filters.cursor === undefined ? undefined : decodeCursor(filters.cursor);
    return this.database.withContext(this.context(actor), async (tx) => {
      const rows = await tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.organizationId, actor.organizationId),
            filters.status === undefined ? undefined : eq(workflowRuns.status, filters.status),
            filters.workflowId === undefined
              ? undefined
              : eq(workflowRuns.workflowId, filters.workflowId),
            after === undefined ? undefined : lt(workflowRuns.id, after),
          ),
        )
        // UUID v7: the id order is the creation order.
        .orderBy(desc(workflowRuns.id))
        .limit(filters.limit + 1);
      const page = rows.slice(0, filters.limit);
      const names = await userNames(
        tx,
        page.map((row) => row.triggeredBy),
      );
      // Archived workflows keep their runs: the name is read without the soft-delete filter.
      const workflowNames = new Map<string, string>();
      const failedNodes = new Map<string, string>();
      if (page.length > 0) {
        const named = await withName.workflows(
          tx,
          inArray(
            workflows.id,
            page.map((row) => row.workflowId),
          ),
        );
        for (const workflow of named) workflowNames.set(workflow.id, workflow.name);
        const failed = await tx
          .select({ runId: workflowRunSteps.runId, nodeId: workflowRunSteps.nodeId })
          .from(workflowRunSteps)
          .where(
            and(
              inArray(
                workflowRunSteps.runId,
                page.map((row) => row.id),
              ),
              eq(workflowRunSteps.status, 'failed'),
            ),
          )
          .orderBy(workflowRunSteps.finishedAt);
        for (const step of failed) {
          if (!failedNodes.has(step.runId)) failedNodes.set(step.runId, step.nodeId);
        }
      }
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          ...toRun(row, names),
          workflowName: workflowNames.get(row.workflowId) ?? '',
          failedNodeId: failedNodes.get(row.id) ?? null,
        })),
        nextCursor: rows.length > filters.limit && last ? encodeCursor(last.id) : null,
      };
    });
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

const inputExpired = () =>
  new DomainException(
    410,
    'RUN_INPUT_EXPIRED',
    'Los datos de entrada de esta ejecución ya no están disponibles: el historial del motor venció.',
  );

/** The API error for a start that `startRun` refused. */
function refusalOf(refusal: StartRunRefusal): Error {
  switch (refusal.reason) {
    case 'workflow_not_found':
      return new ResourceNotFoundException();
    case 'workflow_archived':
      return notRunnable('archived', 'El workflow está archivado y no se puede ejecutar.');
    case 'no_active_version':
      return notRunnable(
        'no_active_version',
        'El workflow no tiene una versión activa. Publica y activa una versión primero.',
      );
    case 'run_limit_reached':
      return new DomainException(
        429,
        'RUN_LIMIT_REACHED',
        `La organización ya tiene ${refusal.inProgress} ejecuciones en curso y el máximo es ${refusal.limit}. Espera a que termine alguna.`,
        { retryAfterSeconds: LIMIT_RETRY_AFTER_SECONDS },
      );
    case 'duplicate_event':
      // Only a webhook repeats an event id; a person never reaches this.
      return new Error('A manual start cannot repeat a webhook event');
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

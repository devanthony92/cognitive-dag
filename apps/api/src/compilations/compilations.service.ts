import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  SearchAttributeType,
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from '@temporalio/common';
import { allowedNodeTypes } from '@cognitive-dag/compiler';
import {
  COMPILER_INTENT_MAX_CHARS,
  COMPILE_INTENT_WORKFLOW_NAME,
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  FEATURE_FLAGS,
  resolveCorrelationId,
  type Compilation,
  type CompilationList,
  type CompilationResult,
  type CompileIntentInput,
} from '@cognitive-dag/contracts';
import {
  active,
  and,
  compilations,
  desc,
  eq,
  newId,
  sql,
  workflows,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DomainException, ResourceNotFoundException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { FlagsService } from '../flags/flags.service';
import { RunTemporalService } from '../runs/run-history.service';
import { outcomeOf } from './compilation-history';
import { toCompilation } from './compilation-mappers';
import { CompilerRateLimiter } from './compiler-rate-limiter';

/** Who acts, on which organization. The organization guard already vouched for it. */
export interface CompilationActor {
  userId: string;
  organizationId: string;
}

const CORRELATION_ID_KEY = defineSearchAttributeKey(
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  SearchAttributeType.KEYWORD,
);

/** Most compilations the list returns. */
const LIST_LIMIT = 20;

/** The whole compilation, retries included, must end before this (the workflow allows 10 min). */
const COMPILE_EXECUTION_TIMEOUT = '15 minutes';

/** How long a final row waits for its workflow to complete: up to 10 reads, 200 ms apart. */
const COMPLETION_POLLS = 10;
const COMPLETION_POLL_MS = 200;

/** Id of the Temporal workflow of a compilation. */
export const compileWorkflowIdFor = (compilationId: string): string => `compile-${compilationId}`;

type Row = typeof compilations.$inferSelect;

@Injectable()
export class CompilationsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly temporal: RunTemporalService,
    private readonly limiter: CompilerRateLimiter,
    private readonly flags: FlagsService,
    private readonly cls: ClsService,
  ) {}

  private context(actor: CompilationActor) {
    return { userId: actor.userId, organizationId: actor.organizationId };
  }

  /** The intent without its margins, or the 400 that says what is wrong with it. */
  private checkIntent(raw: string): string {
    const intent = raw.trim();
    if (intent.length === 0) {
      throw new DomainException(400, 'VALIDATION_FAILED', 'Describe qué quieres automatizar.', {
        errors: [{ field: 'intent', message: 'Describe qué quieres automatizar.' }],
      });
    }
    if (intent.length > COMPILER_INTENT_MAX_CHARS) {
      throw new DomainException(
        400,
        'COMPILER_INTENT_TOO_LONG',
        `La descripción tiene ${intent.length} caracteres y el máximo es ${COMPILER_INTENT_MAX_CHARS}.`,
      );
    }
    return intent;
  }

  /**
   * Accepts a compilation (research R2, R10, R13). One transaction checks the workflow, the day's
   * count of the organization (under an advisory lock, so concurrent requests count each other),
   * takes the person's token and inserts the row `queued`; only then is Temporal asked to start,
   * so a failure leaves a `failed` row, never a `queued` one nobody runs.
   */
  async create(
    actor: CompilationActor,
    body: { intent: string; workflowId?: string | undefined },
  ): Promise<Compilation> {
    const intent = this.checkIntent(body.intent);
    const correlationId = resolveCorrelationId(this.cls.getId());
    const llmNodesEnabled = await this.flags.isEnabled(FEATURE_FLAGS.llmNodesEnabled);
    const allowedTypes = allowedNodeTypes({ llmNodesEnabled });

    const row = await this.database.withContext(this.context(actor), async (tx) => {
      let baseDraftRevision: number | null = null;
      if (body.workflowId !== undefined) {
        const [workflow] = await active.workflows(
          tx,
          and(
            eq(workflows.id, body.workflowId),
            eq(workflows.organizationId, actor.organizationId),
          ),
        );
        if (!workflow) throw new ResourceNotFoundException();
        baseDraftRevision = workflow.draftRevision;
      }

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`compiler:${actor.organizationId}`}, 0))`,
      );
      // The day is checked before the person's bucket: a refusal here spends no token.
      const [{ n } = { n: 0 }] = (
        await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM compilations
              WHERE organization_id = ${actor.organizationId}
                AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
        )
      ).rows;
      if (n >= this.config.COMPILER_MAX_PER_ORG_DAY) {
        throw new DomainException(
          429,
          'COMPILER_DAILY_LIMIT',
          `La organización llegó al máximo de ${this.config.COMPILER_MAX_PER_ORG_DAY} compilaciones por día (UTC). Vuelve a intentarlo mañana.`,
        );
      }
      await this.limiter.consume(actor.userId, this.config.COMPILER_MAX_PER_USER_HOUR);

      const id = await newId(tx);
      const [inserted] = await tx
        .insert(compilations)
        .values({
          id,
          organizationId: actor.organizationId,
          workflowId: body.workflowId ?? null,
          requestedBy: actor.userId,
          mode: body.workflowId === undefined ? 'create' : 'regenerate',
          baseDraftRevision,
          intentChars: intent.length,
          model: this.config.LLM_MODEL_COMPILER,
          correlationId,
        })
        .returning();
      if (!inserted) throw new Error('INSERT INTO compilations returned no row');
      return inserted;
    });

    await this.launch(actor, row, {
      compilationId: row.id,
      organizationId: actor.organizationId,
      correlationId,
      intent,
      allowedTypes,
      llmTaskQueue: this.config.TEMPORAL_LLM_TASK_QUEUE,
    });
    return toCompilation(row);
  }

  /** Asks Temporal to start; on failure the row ends `failed` and the caller gets 503. */
  private async launch(
    actor: CompilationActor,
    row: Row,
    input: CompileIntentInput,
  ): Promise<void> {
    const workflowId = compileWorkflowIdFor(row.id);
    try {
      await this.temporal.withDeadline(() =>
        this.temporal.client.workflow.start(COMPILE_INTENT_WORKFLOW_NAME, {
          taskQueue: this.config.TEMPORAL_TASK_QUEUE,
          workflowId,
          args: [input],
          workflowExecutionTimeout: COMPILE_EXECUTION_TIMEOUT,
          typedSearchAttributes: new TypedSearchAttributes([
            { key: CORRELATION_ID_KEY, value: row.correlationId },
          ]),
        }),
      );
    } catch (error) {
      await this.database.withContext(this.context(actor), (tx) =>
        tx
          .update(compilations)
          .set({
            status: 'failed',
            errorClass: 'transient',
            errorCode: 'SERVICE_UNAVAILABLE',
            finishedAt: new Date(),
          })
          .where(and(eq(compilations.id, row.id), eq(compilations.status, 'queued'))),
      );
      // The request may have reached Temporal before the deadline: do not leave a run nobody records.
      await this.temporal
        .withDeadline(() =>
          this.temporal.client.workflow.getHandle(workflowId).terminate('start failed'),
        )
        .catch(() => undefined);
      throw this.temporal.translate(error);
    }
  }

  async list(actor: CompilationActor, workflowId: string | undefined): Promise<CompilationList> {
    const rows = await this.database.withContext(this.context(actor), (tx) =>
      tx
        .select()
        .from(compilations)
        .where(
          and(
            eq(compilations.organizationId, actor.organizationId),
            workflowId === undefined ? undefined : eq(compilations.workflowId, workflowId),
          ),
        )
        .orderBy(desc(compilations.createdAt), desc(compilations.id))
        .limit(LIST_LIMIT),
    );
    return { items: rows.map(toCompilation) };
  }

  private async find(tx: Tx, actor: CompilationActor, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(compilations)
      .where(and(eq(compilations.id, id), eq(compilations.organizationId, actor.organizationId)));
    if (!row) throw new ResourceNotFoundException();
    return row;
  }

  async get(actor: CompilationActor, id: string): Promise<Compilation> {
    const row = await this.database.withContext(this.context(actor), (tx) =>
      this.find(tx, actor, id),
    );
    return toCompilation(row);
  }

  /**
   * The DAG (or the last attempt) from the Temporal history (research R2, R3, R9). The row says
   * first whether there can be one: a compilation in progress is `COMPILER_NOT_FINISHED` and a
   * failure without fallback is `COMPILER_NO_RESULT`, with no call to Temporal.
   */
  async result(actor: CompilationActor, id: string): Promise<CompilationResult> {
    const row = await this.database.withContext(this.context(actor), (tx) =>
      this.find(tx, actor, id),
    );
    const notFinished = () =>
      new DomainException(
        409,
        'COMPILER_NOT_FINISHED',
        'La compilación todavía no termina. Vuelve a consultar en unos segundos.',
      );
    const noResult = () =>
      new DomainException(409, 'COMPILER_NO_RESULT', 'La compilación falló y no dejó un borrador.');

    if (row.status === 'queued' || row.status === 'running') throw notFinished();
    if (row.status === 'failed' && !row.hasFallback) throw noResult();

    // The activity writes the row just before the workflow completes: give it a moment.
    let outcome: ReturnType<typeof outcomeOf> = { kind: 'running' };
    for (let attempt = 0; attempt < COMPLETION_POLLS && outcome.kind === 'running'; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, COMPLETION_POLL_MS));
      const history = await this.temporal.history(compileWorkflowIdFor(row.id));
      if (history === undefined) {
        throw new DomainException(
          410,
          'COMPILER_RESULT_EXPIRED',
          'El resultado ya no está disponible: el historial del motor venció. Vuelve a compilar.',
        );
      }
      outcome = outcomeOf(history);
    }
    if (outcome.kind === 'running') throw notFinished();
    if (outcome.kind === 'unreadable' || outcome.value.result === null) throw noResult();
    return outcome.value.result;
  }
}

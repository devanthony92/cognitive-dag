import {
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  CancelledFailure,
  TimeoutFailure,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import {
  DEFAULT_RUN_MAX_DURATION_MS,
  ExecuteDagInputSchema,
  RUN_ERROR_CODES,
  RUN_ERROR_CODE_MAX,
  RUN_ERROR_MESSAGE_MAX,
  type ExecuteDagInput,
  type ExecuteDagResult,
  type FinalRunStatus,
  type RunEvent,
} from '@cognitive-dag/contracts';
import {
  DagDefinitionSchema,
  RuntimeEvaluationError,
  buildExecutionGraph,
  evaluateCondition,
  findUnsupportedNodes,
  planNext,
  resolveNodeConfig,
  type Condition,
  type DagDefinition,
  type StepState,
} from '@cognitive-dag/dag-schema';
import type { RunEventActivities } from '../activities/record-run-event';
import type { MockServiceActivities, MockServiceInput } from '../activities/mock-service';

// Workflow code must stay deterministic: no I/O, clock, randomness or flag reads here. Everything
// with an effect runs in an activity; only types are imported from the activity modules so the
// workflow bundle stays free of them. Versioning of the interpreter: use patched() for any change
// to the order of commands, and keep the replay histories in test/histories up to date.

/** Policy of a `mock.service` node (research R2). */
const MOCK_SERVICE_MAX_ATTEMPTS = 3;
const { mockService } = proxyActivities<MockServiceActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: MOCK_SERVICE_MAX_ATTEMPTS,
  },
});

/** Recording is not a node: it is retried for longer, and it never retries what cannot succeed. */
const { recordRunEvent } = proxyActivities<RunEventActivities>({
  startToCloseTimeout: '15 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 10,
    nonRetryableErrorTypes: ['RUN_NOT_FOUND', 'ZodError'],
  },
});

interface FailureInfo {
  code: string;
  message: string;
  attempts?: number;
}

type NodeOutcome =
  | { id: string; kind: 'succeeded' }
  | { id: string; kind: 'cancelled' }
  | { id: string; kind: 'failed'; failure: FailureInfo };

type LoopOutcome =
  { kind: 'completed' } | { kind: 'failed'; failure: FailureInfo } | { kind: 'cancelled' };

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Summarizes an error without data from the run: a stable code and a short message. */
function describeFailure(error: unknown): FailureInfo {
  if (error instanceof RuntimeEvaluationError) {
    return { code: error.code, message: truncate(error.message, RUN_ERROR_MESSAGE_MAX) };
  }
  if (error instanceof ActivityFailure) {
    const cause = error.cause;
    if (cause instanceof ApplicationFailure) {
      const detail = cause.details?.[0];
      const attempt =
        typeof detail === 'object' && detail !== null && 'attempt' in detail
          ? Number(detail.attempt)
          : undefined;
      return {
        code: truncate(cause.type ?? RUN_ERROR_CODES.internal, RUN_ERROR_CODE_MAX),
        message: truncate(cause.message, RUN_ERROR_MESSAGE_MAX),
        ...(attempt === undefined || Number.isNaN(attempt) ? {} : { attempts: attempt }),
      };
    }
    if (cause instanceof TimeoutFailure) {
      return {
        code: 'ACTIVITY_TIMED_OUT',
        message: 'The node exceeded its time limit.',
        attempts: MOCK_SERVICE_MAX_ATTEMPTS,
      };
    }
  }
  return { code: RUN_ERROR_CODES.internal, message: 'The node failed unexpectedly.' };
}

export async function executeDag(rawInput: unknown): Promise<ExecuteDagResult> {
  const parsed = ExecuteDagInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw ApplicationFailure.create({
      type: 'INVALID_INPUT',
      message: 'The workflow input does not match the contract.',
      nonRetryable: true,
    });
  }
  const input: ExecuteDagInput = parsed.data;
  const { organizationId, runId, correlationId } = input;

  const now = (): string => new Date().toISOString();
  /** Recording completes even while the run is being cancelled: the record must stay true. */
  const record = (event: RunEvent): Promise<void> =>
    CancellationScope.nonCancellable(() => recordRunEvent(event));
  const base = () => ({ organizationId, runId, correlationId, at: now() });

  async function finish(
    status: FinalRunStatus,
    failure?: { code: string; message: string },
  ): Promise<void> {
    await record({
      ...base(),
      transition: 'run.finished',
      status,
      ...(failure ? { errorCode: failure.code, errorMessage: failure.message } : {}),
    });
  }

  const failRun = async (code: string, message: string): Promise<never> => {
    await finish('failed', { code, message });
    throw ApplicationFailure.create({ type: code, message, nonRetryable: true });
  };

  const parsedDefinition = DagDefinitionSchema.safeParse(input.definition);
  const definition = parsedDefinition.success ? parsedDefinition.data : undefined;

  await record({
    ...base(),
    transition: 'run.started',
    nodes: (definition?.nodes ?? []).map((n) => ({ nodeId: n.id, nodeType: n.type })),
  });

  if (!definition) {
    return failRun(RUN_ERROR_CODES.invalidDefinition, 'The version definition is not valid.');
  }
  const unsupported = findUnsupportedNodes(definition);
  if (unsupported.length > 0) {
    return failRun(
      RUN_ERROR_CODES.unsupportedNodes,
      truncate(
        `The version has nodes that cannot run yet: ${unsupported.map((n) => n.type).join(', ')}.`,
        RUN_ERROR_MESSAGE_MAX,
      ),
    );
  }

  const graph = buildExecutionGraph(definition);
  const statuses = new Map<string, StepState>(graph.order.map((id) => [id, 'pending']));
  const selections = new Map<string, string>();
  const outputs: Record<string, unknown> = {};

  async function runNode(id: string): Promise<NodeOutcome> {
    const node = graph.nodes.get(id) as DagDefinition['nodes'][number];
    const ref = { nodeId: id, nodeType: node.type };
    const startedAt = Date.now();
    try {
      let attempts: number | undefined;
      switch (node.type) {
        case 'trigger.manual':
          outputs[id] = input.triggerInput;
          break;
        case 'logic.condition': {
          const { condition } = node.config as { condition: Condition };
          selections.set(id, evaluateCondition(condition, outputs) ? 'true' : 'false');
          break;
        }
        case 'logic.merge':
          break;
        case 'mock.service': {
          await record({ ...base(), transition: 'step.running', ...ref });
          const result = await mockService({
            runId,
            nodeId: id,
            correlationId,
            config: resolveNodeConfig(
              node.type,
              node.config,
              outputs,
            ) as MockServiceInput['config'],
          });
          outputs[id] = result.output;
          attempts = result.attempts;
          break;
        }
        default:
          // Unreachable: findUnsupportedNodes refused the version before the first node ran.
          throw new RuntimeEvaluationError('REFERENCE_MALFORMED', `Unsupported node ${node.type}.`);
      }
      statuses.set(id, 'succeeded');
      await record({
        ...base(),
        transition: 'step.succeeded',
        ...ref,
        ...(attempts === undefined ? {} : { attempts }),
        durationMs: Date.now() - startedAt,
      });
      return { id, kind: 'succeeded' };
    } catch (error) {
      if (isCancellation(error)) {
        statuses.set(id, 'cancelled');
        await record({
          ...base(),
          transition: 'step.cancelled',
          ...ref,
          durationMs: Date.now() - startedAt,
        });
        return { id, kind: 'cancelled' };
      }
      const failure = describeFailure(error);
      statuses.set(id, 'failed');
      await record({
        ...base(),
        transition: 'step.failed',
        ...ref,
        ...(failure.attempts === undefined ? {} : { attempts: failure.attempts }),
        durationMs: Date.now() - startedAt,
        errorCode: failure.code,
        errorMessage: failure.message,
      });
      return { id, kind: 'failed', failure };
    }
  }

  const runScope = new CancellationScope();

  /**
   * Launches what is ready, in parallel, and reacts to each node as it finishes (research R1).
   * The first failure cancels the branches still running (fail fast, FR-007).
   */
  async function execute(): Promise<LoopOutcome> {
    const inflight = new Map<string, Promise<NodeOutcome>>();
    let failure: FailureInfo | undefined;
    let cancelled = false;
    for (;;) {
      if (runScope.consideredCancelled) cancelled = true;
      if (failure === undefined && !cancelled) {
        const plan = planNext(graph, { statuses, selections });
        for (const id of plan.skip) {
          statuses.set(id, 'skipped');
          await record({
            ...base(),
            transition: 'step.skipped',
            nodeId: id,
            nodeType: (graph.nodes.get(id) as DagDefinition['nodes'][number]).type,
          });
        }
        for (const id of plan.ready) {
          statuses.set(id, 'running');
          inflight.set(id, runNode(id));
        }
      }
      if (inflight.size === 0) break;
      const settled = await Promise.race(inflight.values());
      inflight.delete(settled.id);
      if (settled.kind === 'failed' && failure === undefined) {
        failure = settled.failure;
        runScope.cancel();
      } else if (settled.kind === 'cancelled') {
        cancelled = true;
      }
    }
    if (failure) return { kind: 'failed', failure };
    return cancelled ? { kind: 'cancelled' } : { kind: 'completed' };
  }

  // The run enforces its own maximum duration so it can record `timed_out`: Temporal's execution
  // timeout would stop the workflow without letting it write anything.
  const maxDurationMs = input.maxDurationMs ?? DEFAULT_RUN_MAX_DURATION_MS;
  const timerScope = new CancellationScope();
  const timer = timerScope
    .run(() => sleep(maxDurationMs))
    .then(
      () => 'timeout' as const,
      // A cancelled run must not look like a timeout: the timer simply never fires.
      () => new Promise<never>(() => undefined),
    );
  const loop = runScope.run(execute);
  const first = await Promise.race([loop.then(() => 'done' as const), timer]);
  if (first === 'timeout') runScope.cancel();
  const outcome = await loop;
  timerScope.cancel();

  if (first === 'timeout') {
    const failure = {
      code: RUN_ERROR_CODES.timedOut,
      message: truncate(
        `The run exceeded its maximum duration of ${maxDurationMs} ms.`,
        RUN_ERROR_MESSAGE_MAX,
      ),
    };
    await finish('timed_out', failure);
    throw ApplicationFailure.create({ ...failure, type: failure.code, nonRetryable: true });
  }
  if (outcome.kind === 'failed') {
    return failRun(outcome.failure.code, outcome.failure.message);
  }
  if (outcome.kind === 'cancelled') {
    await finish('cancelled');
    throw new CancelledFailure('The run was cancelled.');
  }
  await finish('succeeded');
  return { status: 'succeeded', outputs };
}

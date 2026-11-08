import {
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  CancelledFailure,
  TimeoutFailure,
  condition,
  defineUpdate,
  isCancellation,
  patched,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import {
  DECIDE_APPROVAL_UPDATE_NAME,
  DEFAULT_HTTP_TASK_QUEUE,
  DEFAULT_LLM_TASK_QUEUE,
  DEFAULT_RUN_MAX_DURATION_MS,
  DecideApprovalUpdateInputSchema,
  ExecuteDagInputSchema,
  RUN_ERROR_CODES,
  RUN_ERROR_CODE_MAX,
  RUN_ERROR_MESSAGE_MAX,
  type ExecuteDagInput,
  type ErrorClass,
  type DecideApprovalUpdateInput,
  type DecideApprovalUpdateResult,
  type ExecuteDagResult,
  type FinalRunStatus,
  type RunEvent,
} from '@cognitive-dag/contracts';
import {
  DagDefinitionSchema,
  RuntimeEvaluationError,
  buildExecutionGraph,
  classify,
  evaluateCondition,
  findUnsupportedNodes,
  planNext,
  resolveNodeConfig,
  resolveRetryPolicy,
  type Condition,
  type DagDefinition,
  type RetryPolicy,
  type StepState,
} from '@cognitive-dag/dag-schema';
import type { RunEventActivities } from '../activities/record-run-event';
import type { MockServiceActivities, MockServiceInput } from '../activities/mock-service';
import type { LlmActivities, LlmNodeInput } from '../llm/activities';
import type { HttpActivities, HttpRequestInput } from '../http/activities';
import type { ApprovalActivities } from '../approvals/activities';

// Workflow code must stay deterministic: no I/O, clock, randomness or flag reads here. Everything
// with an effect runs in an activity; only types are imported from the activity modules so the
// workflow bundle stays free of them. Versioning of the interpreter: use patched() for any change
// to the order of commands, and keep the replay histories in test/histories up to date.

/**
 * Policy of a `mock.service` node before F4: runs that started with it replay with this proxy
 * (`patched`, see `PER_NODE_POLICIES`).
 */
const MOCK_SERVICE_MAX_ATTEMPTS = 3;
const { mockService: legacyMockService } = proxyActivities<MockServiceActivities>({
  startToCloseTimeout: '30 seconds',
  // The activity heartbeats: a dead worker is noticed in seconds, not after the whole 30 s.
  heartbeatTimeout: '10 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: MOCK_SERVICE_MAX_ATTEMPTS,
  },
});

/** Marker of the runs that apply the policy of each node (F4, research R2). */
const PER_NODE_POLICIES = 'f4-per-node-policies';

/** Margin on top of attempts x time per attempt for waits and the rate limit (FR-007). */
const TOTAL_TIME_MARGIN_SECONDS = 300;

/** Longest wait between attempts that Temporal itself schedules (timeouts). */
const MAX_TEMPORAL_BACKOFF = '30 seconds';

const policyProxies = new Map<string, MockServiceActivities>();

/**
 * One proxy per effective policy. Temporal retries without limit because the activity counts its
 * own attempts (a wait for the rate limit must not spend them); the total time bounds the node.
 */
function mockServiceFor(policy: RetryPolicy): MockServiceActivities {
  const key = `${policy.maxAttempts}/${policy.timeoutSeconds}/${policy.initialIntervalMs}`;
  let proxy = policyProxies.get(key);
  if (!proxy) {
    proxy = proxyActivities<MockServiceActivities>({
      startToCloseTimeout: `${policy.timeoutSeconds} seconds`,
      scheduleToCloseTimeout: `${policy.maxAttempts * policy.timeoutSeconds + TOTAL_TIME_MARGIN_SECONDS} seconds`,
      heartbeatTimeout: '10 seconds',
      retry: {
        initialInterval: policy.initialIntervalMs,
        backoffCoefficient: 2,
        maximumInterval: MAX_TEMPORAL_BACKOFF,
        maximumAttempts: 0,
      },
    });
    policyProxies.set(key, proxy);
  }
  return proxy;
}

const llmProxies = new Map<string, LlmActivities>();

/**
 * Proxy of the LLM activities on their own task queue (bulkhead, research R6). As with
 * `mockServiceFor`, Temporal retries without limit and the activity applies the node policy.
 */
function llmFor(taskQueue: string, policy: RetryPolicy): LlmActivities {
  const key = `${taskQueue}/${policy.maxAttempts}/${policy.timeoutSeconds}/${policy.initialIntervalMs}`;
  let proxy = llmProxies.get(key);
  if (!proxy) {
    proxy = proxyActivities<LlmActivities>({
      taskQueue,
      startToCloseTimeout: `${policy.timeoutSeconds} seconds`,
      scheduleToCloseTimeout: `${policy.maxAttempts * policy.timeoutSeconds + TOTAL_TIME_MARGIN_SECONDS} seconds`,
      retry: {
        initialInterval: policy.initialIntervalMs,
        backoffCoefficient: 2,
        maximumInterval: MAX_TEMPORAL_BACKOFF,
        maximumAttempts: 0,
      },
    });
    llmProxies.set(key, proxy);
  }
  return proxy;
}

const httpProxies = new Map<string, HttpActivities>();

/** Time on top of the per-attempt limit of the client for the work around the call. */
const HTTP_ATTEMPT_MARGIN_SECONDS = 5;
/** An open circuit may make a node wait up to its maximum wait (120 s) before it counts attempts. */
const HTTP_TOTAL_TIME_MARGIN_SECONDS = TOTAL_TIME_MARGIN_SECONDS + 120;

/**
 * Proxy of the HTTP activities on their own task queue (bulkhead, F7 research R12). Temporal retries
 * without limit and the activity applies the node policy, as with the LLM. The start-to-close time
 * leaves a margin over the time per attempt the client enforces itself.
 */
function httpFor(taskQueue: string, policy: RetryPolicy): HttpActivities {
  const key = `${taskQueue}/${policy.maxAttempts}/${policy.timeoutSeconds}/${policy.initialIntervalMs}`;
  let proxy = httpProxies.get(key);
  if (!proxy) {
    proxy = proxyActivities<HttpActivities>({
      taskQueue,
      startToCloseTimeout: `${policy.timeoutSeconds + HTTP_ATTEMPT_MARGIN_SECONDS} seconds`,
      scheduleToCloseTimeout: `${policy.maxAttempts * policy.timeoutSeconds + HTTP_TOTAL_TIME_MARGIN_SECONDS} seconds`,
      retry: {
        initialInterval: policy.initialIntervalMs,
        backoffCoefficient: 2,
        maximumInterval: MAX_TEMPORAL_BACKOFF,
        maximumAttempts: 0,
      },
    });
    httpProxies.set(key, proxy);
  }
  return proxy;
}

/** The email is best effort: its failure never fails the run (research R8). */
const { notifyApprovers } = proxyActivities<ApprovalActivities>({
  startToCloseTimeout: '60 seconds',
  retry: { initialInterval: '2 seconds', backoffCoefficient: 2, maximumAttempts: 3 },
});

const decideApprovalUpdate = defineUpdate<DecideApprovalUpdateResult, [DecideApprovalUpdateInput]>(
  DECIDE_APPROVAL_UPDATE_NAME,
);

/** What the workflow knows about the approval of one node (F7, research R7). */
interface ApprovalSlot {
  /** The first accepted decision; later ones are refused. */
  decision?: { decision: 'approved' | 'rejected'; decidedBy: string; hasComment: boolean };
  /** The wait is over (decided, timed out or cancelled): nothing else is accepted. */
  resolved: boolean;
}

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
  errorClass?: ErrorClass;
}

type NodeOutcome =
  | { id: string; kind: 'succeeded' }
  | { id: string; kind: 'cancelled' }
  | { id: string; kind: 'failed'; failure: FailureInfo };

type LoopOutcome =
  { kind: 'completed' } | { kind: 'failed'; failure: FailureInfo } | { kind: 'cancelled' };

/** Set by `executeDag`: whether this run applies the policy of each node. */
let patchedPolicies = false;

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Class a node declared in the details of its failure, if any. */
function declaredClass(failure: ApplicationFailure): unknown {
  const detail = failure.details?.[0];
  return typeof detail === 'object' && detail !== null && 'errorClass' in detail
    ? detail.errorClass
    : undefined;
}

/** Summarizes an error without data from the run: a stable code, a class and a short message. */
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
        errorClass: classify({
          errorClass: declaredClass(cause),
          nonRetryable: cause.nonRetryable,
        }),
        ...(attempt === undefined || Number.isNaN(attempt) ? {} : { attempts: attempt }),
      };
    }
    if (cause instanceof TimeoutFailure) {
      // The total time ran out: a node that kept waiting for the limit fails as limited.
      const last = cause.cause;
      if (last instanceof ApplicationFailure && declaredClass(last) === 'rate_limited') {
        return {
          code: truncate(last.type ?? RUN_ERROR_CODES.internal, RUN_ERROR_CODE_MAX),
          message: truncate(last.message, RUN_ERROR_MESSAGE_MAX),
          errorClass: 'rate_limited',
        };
      }
      return {
        code: 'ACTIVITY_TIMED_OUT',
        message: 'The node exceeded its time limit.',
        errorClass: 'timeout',
        ...(patchedPolicies ? {} : { attempts: MOCK_SERVICE_MAX_ATTEMPTS }),
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
  // Runs recorded before F4 replay with the old policy; new ones apply the policy of each node.
  patchedPolicies = patched(PER_NODE_POLICIES);

  const now = (): string => new Date().toISOString();
  /** Recording completes even while the run is being cancelled: the record must stay true. */
  const record = (event: RunEvent): Promise<void> =>
    CancellationScope.nonCancellable(() => recordRunEvent(event));
  const base = () => ({ organizationId, runId, correlationId, at: now() });

  async function finish(
    status: FinalRunStatus,
    failure?: { code: string; message: string; errorClass?: ErrorClass },
  ): Promise<void> {
    await record({
      ...base(),
      transition: 'run.finished',
      status,
      ...(failure
        ? {
            errorCode: failure.code,
            errorMessage: failure.message,
            ...(failure.errorClass ? { errorClass: failure.errorClass } : {}),
          }
        : {}),
    });
  }

  const failRun = async (
    code: string,
    message: string,
    errorClass?: ErrorClass,
  ): Promise<never> => {
    await finish('failed', { code, message, ...(errorClass ? { errorClass } : {}) });
    throw ApplicationFailure.create({ type: code, message, nonRetryable: true });
  };

  const parsedDefinition = DagDefinitionSchema.safeParse(input.definition);
  const definition = parsedDefinition.success ? parsedDefinition.data : undefined;

  // Registered before the first await so no decision arrives without a handler. The first decision
  // to reach a waiting node wins; the comment is not kept: it stays in the history of the Update.
  const approvalSlots = new Map<string, ApprovalSlot>();
  setHandler(
    decideApprovalUpdate,
    (update) => {
      const node = definition?.nodes.find((candidate) => candidate.id === update.nodeId);
      if (node?.type !== 'human.approval') return { accepted: false, reason: 'unknown_node' };
      const slot = approvalSlots.get(update.nodeId);
      if (!slot) return { accepted: false, reason: 'not_waiting' };
      if (slot.resolved || slot.decision) return { accepted: false, reason: 'already_resolved' };
      slot.decision = {
        decision: update.decision,
        decidedBy: update.decidedBy,
        hasComment: update.comment !== undefined && update.comment !== '',
      };
      return { accepted: true };
    },
    {
      validator: (update) => {
        if (!DecideApprovalUpdateInputSchema.safeParse(update).success) {
          throw ApplicationFailure.create({
            type: 'INVALID_INPUT',
            message: 'The decision does not match the contract.',
            nonRetryable: true,
          });
        }
      },
    },
  );

  await record({
    ...base(),
    transition: 'run.started',
    nodes: (definition?.nodes ?? []).map((n) => ({ nodeId: n.id, nodeType: n.type })),
  });

  if (!definition) {
    return failRun(RUN_ERROR_CODES.invalidDefinition, 'The version definition is not valid.');
  }
  const unsupported = findUnsupportedNodes(definition, input.executablePhases);
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
    // A rerun from a node: what the original run already did is not done again. Runs without
    // `memoized` issue the same commands as before, so no patch marker is needed.
    if (input.memoized && Object.hasOwn(input.memoized, id)) {
      outputs[id] = input.memoized[id];
      statuses.set(id, 'succeeded');
      await record({ ...base(), transition: 'step.reused', ...ref, attempts: 0, durationMs: 0 });
      return { id, kind: 'succeeded' };
    }
    try {
      let attempts: number | undefined;
      switch (node.type) {
        case 'trigger.manual':
          outputs[id] = input.triggerInput;
          break;
        case 'trigger.webhook':
          // The API validated the body against `bodySchema` before starting the run (F7).
          outputs[id] = input.triggerInput;
          break;
        case 'trigger.schedule':
          outputs[id] = { firedAt: input.scheduledAt ?? now() };
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
          const policy = resolveRetryPolicy(node.type, node.retry);
          const activities =
            patchedPolicies && policy ? mockServiceFor(policy) : { mockService: legacyMockService };
          const result = await activities.mockService({
            runId,
            nodeId: id,
            correlationId,
            ...(patchedPolicies && policy ? { organizationId, policy } : {}),
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
        case 'llm.classify':
        case 'llm.extract':
        case 'llm.generate': {
          await record({ ...base(), transition: 'step.running', ...ref });
          const policy = resolveRetryPolicy(node.type, node.retry) as RetryPolicy;
          const activities = llmFor(input.llmTaskQueue ?? DEFAULT_LLM_TASK_QUEUE, policy);
          const call: LlmNodeInput = {
            runId,
            nodeId: id,
            correlationId,
            organizationId,
            policy,
            config: resolveNodeConfig(node.type, node.config, outputs) as Record<string, unknown>,
          };
          const result = await (node.type === 'llm.classify'
            ? activities.llmClassify(call)
            : node.type === 'llm.extract'
              ? activities.llmExtract(call)
              : activities.llmGenerate(call));
          outputs[id] = result.output;
          attempts = result.attempts;
          break;
        }
        case 'http.request': {
          await record({ ...base(), transition: 'step.running', ...ref });
          const policy = resolveRetryPolicy(node.type, node.retry) as RetryPolicy;
          const activities = httpFor(input.httpTaskQueue ?? DEFAULT_HTTP_TASK_QUEUE, policy);
          const result = await activities.httpRequest({
            runId,
            nodeId: id,
            correlationId,
            organizationId,
            policy,
            config: resolveNodeConfig(
              node.type,
              node.config,
              outputs,
            ) as HttpRequestInput['config'],
          });
          outputs[id] = result.output;
          attempts = result.attempts;
          break;
        }
        case 'human.approval': {
          const config = resolveNodeConfig(node.type, node.config, outputs) as {
            message: string;
            timeoutSeconds: number;
          };
          const timeoutMs = config.timeoutSeconds * 1000;
          await record({
            ...base(),
            transition: 'step.running',
            ...ref,
            waitingReason: 'approval',
          });
          const slot: ApprovalSlot = { resolved: false };
          approvalSlots.set(id, slot);
          await record({
            ...base(),
            transition: 'approval.requested',
            ...ref,
            nodeLabel: node.label,
            expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
          });
          // The message travels only as an input of this activity, so it lives in the Temporal
          // history and nowhere else (decision 5C); the email does not include it.
          void notifyApprovers({
            organizationId,
            runId,
            nodeId: id,
            correlationId,
            message: config.message,
          }).catch(() => undefined);

          let decided: boolean;
          try {
            // No worker is held while waiting: this is a durable timer plus the Update.
            decided = await condition(() => slot.decision !== undefined, timeoutMs);
          } catch (error) {
            slot.resolved = true;
            if (isCancellation(error)) {
              await record({
                ...base(),
                transition: 'approval.resolved',
                ...ref,
                outcome: 'cancelled',
                hasComment: false,
              });
            }
            throw error;
          }
          slot.resolved = true;
          const decision = decided ? slot.decision : undefined;
          if (decision) {
            await record({
              ...base(),
              transition: 'approval.resolved',
              ...ref,
              outcome: decision.decision,
              decidedBy: decision.decidedBy,
              hasComment: decision.hasComment,
            });
            selections.set(id, decision.decision);
            outputs[id] = { decision: decision.decision, approvedBy: decision.decidedBy };
          } else {
            await record({
              ...base(),
              transition: 'approval.resolved',
              ...ref,
              outcome: 'timed_out',
              hasComment: false,
            });
            selections.set(id, 'timeout');
            outputs[id] = { decision: 'timeout', approvedBy: '' };
          }
          break;
        }
        default:
          // Unreachable: findUnsupportedNodes refused the version before the first node ran.
          throw new RuntimeEvaluationError(
            'REFERENCE_MALFORMED',
            `Unsupported node ${(node as { type: string }).type}.`,
          );
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
        ...(failure.errorClass ? { errorClass: failure.errorClass } : {}),
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
      errorClass: 'timeout' as const,
      message: truncate(
        `The run exceeded its maximum duration of ${maxDurationMs} ms.`,
        RUN_ERROR_MESSAGE_MAX,
      ),
    };
    await finish('timed_out', failure);
    throw ApplicationFailure.create({ ...failure, type: failure.code, nonRetryable: true });
  }
  if (outcome.kind === 'failed') {
    return failRun(outcome.failure.code, outcome.failure.message, outcome.failure.errorClass);
  }
  if (outcome.kind === 'cancelled') {
    await finish('cancelled');
    throw new CancelledFailure('The run was cancelled.');
  }
  await finish('succeeded');
  return { status: 'succeeded', outputs };
}

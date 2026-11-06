import {
  ActivityFailure,
  ApplicationFailure,
  TimeoutFailure,
  isCancellation,
  proxyActivities,
} from '@temporalio/workflow';
import {
  CompileIntentInputSchema,
  type CompileIntentInput,
  type CompileIntentResult,
} from '@cognitive-dag/contracts';
import { classify, type ErrorClass } from '@cognitive-dag/dag-schema';
import type { CompilerActivities } from '../compiler/activities';

// Workflow code must stay deterministic: no I/O, clock, randomness or flag reads here. Everything
// with an effect runs in an activity; only types are imported from the activity modules so the
// workflow bundle stays free of them. The nonce and the canary of the prompt are generated in the
// activity. The intent enters as the argument of the workflow and the DAG leaves as its value: the
// content lives only in the Temporal history (ADR-0050 for F3, research R2 and R3 for F6).

/** Calls, repairs and the waits for the provider all fit here; a stuck call is cut after this. */
const COMPILE_START_TO_CLOSE = '120 seconds';

/** Attempts of the activity: transient and limited failures retry, the rest end the compilation. */
const COMPILE_MAX_ATTEMPTS = 4;

/** Total time of the compilation, waits between attempts included. */
const COMPILE_SCHEDULE_TO_CLOSE = '10 minutes';

const proxies = new Map<string, CompilerActivities>();

/** Proxy of the compiler activities on the LLM task queue (bulkhead, F5 research R6). */
function compilerFor(taskQueue: string): CompilerActivities {
  let proxy = proxies.get(taskQueue);
  if (!proxy) {
    proxy = proxyActivities<CompilerActivities>({
      taskQueue,
      startToCloseTimeout: COMPILE_START_TO_CLOSE,
      scheduleToCloseTimeout: COMPILE_SCHEDULE_TO_CLOSE,
      retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '30 seconds',
        maximumAttempts: COMPILE_MAX_ATTEMPTS,
      },
    });
    proxies.set(taskQueue, proxy);
  }
  return proxy;
}

/** Recording the end of a compilation is not a model call: it is retried for longer. */
function recorderFor(taskQueue: string): Pick<CompilerActivities, 'failCompilationActivity'> {
  return proxyActivities<Pick<CompilerActivities, 'failCompilationActivity'>>({
    taskQueue,
    startToCloseTimeout: '15 seconds',
    retry: {
      initialInterval: '1 second',
      backoffCoefficient: 2,
      maximumInterval: '30 seconds',
      maximumAttempts: 10,
    },
  });
}

interface FailureInfo {
  code: string;
  errorClass: ErrorClass;
}

/** Class a failure declared in its details, if any. */
function declaredClass(failure: ApplicationFailure): unknown {
  const detail = failure.details?.[0];
  return typeof detail === 'object' && detail !== null && 'errorClass' in detail
    ? detail.errorClass
    : undefined;
}

/** Summarizes an error without content: a stable code and a class of the taxonomy. */
function describeFailure(error: unknown): FailureInfo {
  if (error instanceof ActivityFailure) {
    const cause = error.cause;
    if (cause instanceof ApplicationFailure) {
      return {
        code: (cause.type ?? 'COMPILER_UNEXPECTED').slice(0, 64),
        errorClass: classify({
          errorClass: declaredClass(cause),
          nonRetryable: cause.nonRetryable,
        }),
      };
    }
    if (cause instanceof TimeoutFailure) {
      // The attempts ran out of time: report the last failure when there was one.
      const last = cause.cause;
      if (last instanceof ApplicationFailure) {
        return {
          code: (last.type ?? 'COMPILER_UNEXPECTED').slice(0, 64),
          errorClass: classify({ errorClass: declaredClass(last), nonRetryable: false }),
        };
      }
      return { code: 'ACTIVITY_TIMED_OUT', errorClass: 'timeout' };
    }
  }
  return { code: 'COMPILER_UNEXPECTED', errorClass: 'transient' };
}

/**
 * Compiles an intent into a DAG (F6). Workflow id: `compile-<compilationId>`. The activity writes
 * the states `running` and `succeeded | failed` and returns the result; when its attempts run
 * out, this workflow records the failure so the row never stays `running`.
 */
export async function compileIntent(rawInput: unknown): Promise<CompileIntentResult> {
  const parsed = CompileIntentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw ApplicationFailure.create({
      type: 'INVALID_INPUT',
      message: 'The input of the compilation is not valid.',
      nonRetryable: true,
    });
  }
  const input: CompileIntentInput = parsed.data;
  try {
    return await compilerFor(input.llmTaskQueue).compileIntentActivity(input);
  } catch (error) {
    if (isCancellation(error)) throw error;
    const failure = describeFailure(error);
    await recorderFor(input.llmTaskQueue).failCompilationActivity({
      organizationId: input.organizationId,
      compilationId: input.compilationId,
      correlationId: input.correlationId,
      errorCode: failure.code,
      errorClass: failure.errorClass,
    });
    return {
      status: 'failed',
      result: null,
      errorCode: failure.code,
      errorClass: failure.errorClass,
    };
  }
}

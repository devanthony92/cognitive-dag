import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ErrorClassSchema,
  ProblemCodeSchema,
  RunEventSchema,
  RunLiveEventSchema,
  RunStepSchema,
  StepStatusSchema,
} from '../src/index.js';

const base = {
  organizationId: randomUUID(),
  runId: randomUUID(),
  correlationId: randomUUID(),
  at: '2026-10-31T12:00:00.000Z',
};
const node = { nodeId: 'svc_a', nodeType: 'mock.service' };

describe('F4 run contracts', () => {
  it('knows the four error classes and nothing else', () => {
    expect(ErrorClassSchema.options).toEqual(['transient', 'rate_limited', 'timeout', 'permanent']);
    expect(ErrorClassSchema.safeParse('invalid_output').success).toBe(false);
  });

  it('adds reused to the step statuses', () => {
    expect(StepStatusSchema.safeParse('reused').success).toBe(true);
  });

  it('adds the problem codes of the rerun from a node', () => {
    expect(ProblemCodeSchema.safeParse('RERUN_NODE_INVALID').success).toBe(true);
    expect(ProblemCodeSchema.safeParse('RUN_NOT_FINISHED').success).toBe(true);
  });

  it('carries the class on a failed step and on a finished run', () => {
    const step = RunEventSchema.safeParse({
      ...base,
      ...node,
      transition: 'step.failed',
      errorCode: 'MOCK_SERVICE_PERMANENT',
      errorClass: 'permanent',
    });
    const run = RunEventSchema.safeParse({
      ...base,
      transition: 'run.finished',
      status: 'failed',
      errorCode: 'MOCK_SERVICE_PERMANENT',
      errorClass: 'permanent',
    });
    expect(step.success).toBe(true);
    expect(run.success).toBe(true);
    expect(
      RunEventSchema.safeParse({ ...base, ...node, transition: 'step.failed', errorClass: 'oops' })
        .success,
    ).toBe(false);
  });

  it('marks a running step as waiting for the rate limit', () => {
    const waiting = RunEventSchema.safeParse({
      ...base,
      ...node,
      transition: 'step.running',
      waitingReason: 'rate_limited',
    });
    expect(waiting.success).toBe(true);
    expect(
      RunEventSchema.safeParse({
        ...base,
        ...node,
        transition: 'step.running',
        waitingReason: 'sleeping',
      }).success,
    ).toBe(false);
  });

  it('publishes the class and the waiting reason to the live view', () => {
    const live = RunLiveEventSchema.parse({
      runId: base.runId,
      correlationId: base.correlationId,
      transition: 'step.running',
      at: base.at,
      nodeId: 'svc_a',
      stepStatus: 'running',
      waitingReason: 'rate_limited',
    });
    expect(live.waitingReason).toBe('rate_limited');
  });

  it('shows the class inside the error of a step', () => {
    const step = RunStepSchema.parse({
      nodeId: 'svc_a',
      nodeType: 'mock.service',
      status: 'failed',
      attempts: 3,
      startedAt: base.at,
      finishedAt: base.at,
      durationMs: 10,
      error: { code: 'MOCK_SERVICE_TRANSIENT', message: 'x', class: 'transient' },
      waitingReason: null,
    });
    expect(step.error?.class).toBe('transient');
  });
});

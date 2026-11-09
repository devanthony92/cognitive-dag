import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ExecuteDagInputSchema,
  FEATURE_FLAGS,
  LLM_ERROR_CODES,
  LlmDailyUsageSchema,
  LlmUsageSchema,
  RunDetailSchema,
  RunStepSchema,
} from '../src/index.js';

const usage = { calls: 2, inputTokens: 120, outputTokens: 40, costMicroUsd: 15, repairs: 1 };

const step = {
  nodeId: 'ask',
  nodeType: 'llm.generate',
  status: 'succeeded',
  attempts: 1,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  error: null,
  waitingReason: null,
};

describe('product flags', () => {
  it('has none since F8: the catalog is empty', () => {
    expect(Object.keys(FEATURE_FLAGS)).toEqual([]);
  });
});

describe('LlmUsage', () => {
  it('accepts the usage of a step with its model', () => {
    expect(LlmUsageSchema.safeParse({ ...usage, model: 'm' }).success).toBe(true);
    expect(LlmUsageSchema.safeParse({ ...usage, model: null }).success).toBe(true);
  });

  it('accepts the usage of a run without a model', () => {
    expect(LlmUsageSchema.safeParse(usage).success).toBe(true);
  });

  it.each([
    ['negative calls', { ...usage, calls: -1 }],
    ['fractional tokens', { ...usage, inputTokens: 1.5 }],
    ['negative cost', { ...usage, costMicroUsd: -1 }],
    ['a missing field', { calls: 1, inputTokens: 1, outputTokens: 1, costMicroUsd: 1 }],
    ['an unknown field', { ...usage, prompt: 'x' }],
  ])('rejects %s', (_name, value) => {
    expect(LlmUsageSchema.safeParse(value).success).toBe(false);
  });

  it('is nullable and optional on a step (flag off, or a step without LLM calls)', () => {
    expect(RunStepSchema.safeParse(step).success).toBe(true);
    expect(RunStepSchema.safeParse({ ...step, llmUsage: null }).success).toBe(true);
    expect(RunStepSchema.safeParse({ ...step, llmUsage: { ...usage, model: 'm' } }).success).toBe(
      true,
    );
  });

  it('rides on the run detail', () => {
    const detail = {
      id: randomUUID(),
      workflowId: randomUUID(),
      versionNumber: 1,
      status: 'succeeded',
      triggeredBy: { id: randomUUID(), name: 'Ana' },
      trigger: { kind: 'manual', eventId: null, scheduledAt: null },
      rerunOf: null,
      rerunFromNodeId: null,
      correlationId: randomUUID(),
      error: null,
      createdAt: '2026-11-05T10:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      steps: [],
      definition: {},
    };
    expect(RunDetailSchema.parse({ ...detail, llmUsage: usage }).llmUsage).toEqual(usage);
    expect(RunDetailSchema.parse({ ...detail, llmUsage: null }).llmUsage).toBeNull();
  });
});

describe('LlmDailyUsage', () => {
  const daily = { date: '2026-11-05', tokensUsed: 10, tokensLimit: 500_000, costMicroUsd: 3 };

  it('accepts the usage of a UTC day', () => {
    expect(LlmDailyUsageSchema.safeParse(daily).success).toBe(true);
    expect(
      LlmDailyUsageSchema.safeParse({ ...daily, tokensUsed: 0, costMicroUsd: 0 }).success,
    ).toBe(true);
  });

  it.each([
    ['a date with a time', { ...daily, date: '2026-11-05T00:00:00Z' }],
    ['a zero limit', { ...daily, tokensLimit: 0 }],
    ['negative tokens', { ...daily, tokensUsed: -1 }],
    ['an unknown field', { ...daily, organizationId: randomUUID() }],
  ])('rejects %s', (_name, value) => {
    expect(LlmDailyUsageSchema.safeParse(value).success).toBe(false);
  });
});

describe('LLM error codes (research R15)', () => {
  it('maps each code to its class', () => {
    expect(LLM_ERROR_CODES).toEqual({
      LLM_INVALID_OUTPUT: 'invalid_output',
      LLM_CONTENT_BLOCKED: 'invalid_output',
      LLM_CANARY_LEAK: 'invalid_output',
      LLM_RUN_BUDGET_EXHAUSTED: 'budget_exhausted',
      LLM_DAILY_BUDGET_EXHAUSTED: 'budget_exhausted',
      LLM_INPUT_TOO_LARGE: 'permanent',
      LLM_EMPTY_INPUT: 'permanent',
      LLM_DISABLED: 'permanent',
      LLM_PROVIDER_REJECTED: 'permanent',
      LLM_PROVIDER_UNAVAILABLE: 'transient',
      LLM_PROVIDER_RATE_LIMITED: 'rate_limited',
    });
  });

  it('fits the error code column of the database', () => {
    for (const code of Object.keys(LLM_ERROR_CODES)) expect(code.length).toBeLessThanOrEqual(64);
  });
});

describe('executablePhases in the input of executeDag (research R13)', () => {
  const input = {
    organizationId: randomUUID(),
    workflowId: randomUUID(),
    versionId: randomUUID(),
    versionNumber: 1,
    runId: randomUUID(),
    correlationId: randomUUID(),
    definition: {},
    triggerInput: {},
  };

  it('is optional: histories and callers of F4 do not send it', () => {
    expect(ExecuteDagInputSchema.safeParse(input).success).toBe(true);
  });

  it('accepts the phases the API allows', () => {
    expect(ExecuteDagInputSchema.parse({ ...input, executablePhases: ['F3', 'F5'] })).toMatchObject(
      {
        executablePhases: ['F3', 'F5'],
      },
    );
  });

  it.each([[[]], [['F9']], [['F3', 'F3']]])('rejects %j', (phases) => {
    expect(ExecuteDagInputSchema.safeParse({ ...input, executablePhases: phases }).success).toBe(
      false,
    );
  });
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COMPILER_ERROR_CODES,
  COMPILER_INTENT_MAX_CHARS,
  CompilationListSchema,
  CompilationResultSchema,
  CompilationSchema,
  CompileIntentInputSchema,
  CreateCompilationRequestSchema,
} from '../src/index.js';

const compilation = {
  id: randomUUID(),
  workflowId: null,
  mode: 'create',
  baseDraftRevision: null,
  status: 'queued',
  model: 'gemini-3.5-flash-lite',
  calls: 0,
  repairs: 0,
  tokensUsed: 0,
  costMicroUsd: 0,
  nodeCount: null,
  hasFallback: false,
  errorClass: null,
  errorCode: null,
  requestedBy: randomUUID(),
  createdAt: '2026-11-06T10:00:00.000Z',
  finishedAt: null,
};

describe('CreateCompilationRequest (research R1, R13)', () => {
  it('trims the intent and accepts an optional workflow', () => {
    const workflowId = randomUUID();
    expect(CreateCompilationRequestSchema.parse({ intent: '  hola  ', workflowId })).toEqual({
      intent: 'hola',
      workflowId,
    });
  });

  it.each(['', '   '])('rejects an empty intent %j', (intent) => {
    expect(CreateCompilationRequestSchema.safeParse({ intent }).success).toBe(false);
  });

  it('accepts 2000 characters and rejects 2001', () => {
    expect(COMPILER_INTENT_MAX_CHARS).toBe(2000);
    expect(CreateCompilationRequestSchema.safeParse({ intent: 'a'.repeat(2000) }).success).toBe(
      true,
    );
    expect(CreateCompilationRequestSchema.safeParse({ intent: 'a'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('is strict', () => {
    expect(CreateCompilationRequestSchema.safeParse({ intent: 'x', model: 'pro' }).success).toBe(
      false,
    );
  });
});

describe('Compilation (contracts/api.openapi.yaml)', () => {
  it('accepts a queued compilation and a list of them', () => {
    expect(CompilationSchema.parse(compilation)).toEqual(compilation);
    expect(CompilationListSchema.parse({ items: [compilation] }).items).toHaveLength(1);
  });

  it('bounds calls and repairs', () => {
    expect(CompilationSchema.safeParse({ ...compilation, calls: 4 }).success).toBe(false);
    expect(CompilationSchema.safeParse({ ...compilation, repairs: 3 }).success).toBe(false);
  });

  it('accepts a failed compilation with its class and code', () => {
    const failed = {
      ...compilation,
      status: 'failed',
      errorClass: 'invalid_output',
      errorCode: 'COMPILER_INVALID_DAG',
      hasFallback: true,
      finishedAt: '2026-11-06T10:00:09.000Z',
    };
    expect(CompilationSchema.parse(failed).errorCode).toBe('COMPILER_INVALID_DAG');
  });
});

describe('CompilationResult', () => {
  it('accepts a result with its validation and the omitted sensitive fields', () => {
    const result = {
      kind: 'result',
      title: 'Clasificar correos',
      definition: { schemaVersion: 1, nodes: [], edges: [] },
      validation: { valid: false, errors: [] },
      omittedSensitiveFields: [{ nodeId: 'call', field: 'url' }],
    };
    expect(CompilationResultSchema.parse(result)).toEqual(result);
  });

  it('rejects an unknown kind', () => {
    expect(
      CompilationResultSchema.safeParse({
        kind: 'draft',
        title: 't',
        definition: {},
        validation: { valid: true, errors: [] },
        omittedSensitiveFields: [],
      }).success,
    ).toBe(false);
  });
});

describe('CompileIntentInput (workflow compile-<id>)', () => {
  it('carries the intent, the allowed types and the context of the compilation', () => {
    const input = {
      compilationId: randomUUID(),
      organizationId: randomUUID(),
      correlationId: randomUUID(),
      intent: 'clasifica los correos',
      allowedTypes: ['trigger.manual', 'logic.condition'],
      llmTaskQueue: 'cognitive-dag-llm',
    };
    expect(CompileIntentInputSchema.parse(input)).toEqual(input);
    expect(CompileIntentInputSchema.safeParse({ ...input, allowedTypes: [] }).success).toBe(false);
  });
});

describe('compiler error codes (research R13)', () => {
  it('classifies every code of the compiler', () => {
    expect(COMPILER_ERROR_CODES).toEqual({
      COMPILER_INVALID_DAG: 'invalid_output',
      COMPILER_BUDGET_EXHAUSTED: 'budget_exhausted',
      COMPILER_EMPTY_INTENT: 'permanent',
      COMPILER_INTENT_TOO_LONG: 'permanent',
    });
  });
});

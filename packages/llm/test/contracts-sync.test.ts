import { ERROR_CLASSES } from '@cognitive-dag/dag-schema';
import { ErrorClassSchema, LLM_ERROR_CODES } from '@cognitive-dag/contracts';
import { describe, expect, it } from 'vitest';
import { LLM_ERROR_CLASSES } from '../src/index.js';

// The wire format (contracts) and the rules (dag-schema, llm) are written apart: this keeps them
// saying the same thing.
describe('contracts and the engine agree', () => {
  it('lists the same error classes', () => {
    expect([...ErrorClassSchema.options]).toEqual([...ERROR_CLASSES]);
  });

  it('lists the same LLM error codes with the same classes', () => {
    expect(LLM_ERROR_CODES).toEqual(LLM_ERROR_CLASSES);
  });
});

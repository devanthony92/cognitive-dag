import {
  COMPILER_ERROR_CODES,
  COMPILER_INTENT_MAX_CHARS as CONTRACT_MAX,
} from '@cognitive-dag/contracts';
import { describe, expect, it } from 'vitest';
import { COMPILER_ERROR_CLASSES, COMPILER_INTENT_MAX_CHARS } from '../src/index.js';

describe('compiler and contracts agree', () => {
  it('on the error codes and their classes', () => {
    expect(COMPILER_ERROR_CLASSES).toEqual(COMPILER_ERROR_CODES);
  });

  it('on the longest intent', () => {
    expect(COMPILER_INTENT_MAX_CHARS).toBe(CONTRACT_MAX);
  });
});

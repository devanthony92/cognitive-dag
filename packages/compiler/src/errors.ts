import type { ErrorClass } from '@cognitive-dag/dag-schema';

/** Longest intent the compiler accepts (research R13); kept in sync with the contracts. */
export const COMPILER_INTENT_MAX_CHARS = 2000;

/** Codes of the compiler besides the LLM ones, and the class of each (research R13). */
export const COMPILER_ERROR_CLASSES = {
  COMPILER_INVALID_DAG: 'invalid_output',
  COMPILER_BUDGET_EXHAUSTED: 'budget_exhausted',
  COMPILER_EMPTY_INTENT: 'permanent',
  COMPILER_INTENT_TOO_LONG: 'permanent',
} as const satisfies Record<string, ErrorClass>;

export type CompilerErrorCode = keyof typeof COMPILER_ERROR_CLASSES;

/** A failure of the compiler outside the model's answer. Its message never carries the intent. */
export class CompilerError extends Error {
  readonly errorClass: ErrorClass;
  readonly code: CompilerErrorCode;

  constructor(code: CompilerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CompilerError';
    this.errorClass = COMPILER_ERROR_CLASSES[code];
  }
}

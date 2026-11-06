import type { DagType } from '@cognitive-dag/dag-schema';
import type { z } from 'zod';
import { LlmError, translateProviderError, type LlmErrorCode, type LlmUsage } from './errors.js';
import type { LlmProvider, LlmResponse } from './provider.js';
import { toJsonSchema, toZodSchema, type JsonSchema } from './schema.js';

/** Reparations after the first answer (research R7): at most three answers in total. */
export const MAX_REPAIRS = 2;

export interface GuardOptions {
  provider: LlmProvider;
  model: string;
  system: string;
  user: string;
  /** Type of the output; the schema sent and the validator are derived from it. */
  outputType?: DagType;
  /**
   * Explicit schema, for outputs a `DagType` cannot say (the compiler's intermediate DAG, F6).
   * Exactly one of `outputType` and `schema` is given.
   */
  schema?: { validator: z.ZodType<unknown>; jsonSchema: JsonSchema };
  maxOutputTokens: number;
  /** Marker planted in the instructions of this call. */
  canary: string;
  /** Extra rules the type cannot say (a generation's `maxLength`): returns the issues found. */
  check?: (value: unknown) => readonly string[];
  /**
   * Runs before each call to the provider, the first and every repair, with the call number
   * (0-based). The engine reserves budget here; throwing stops the guard without calling.
   */
  beforeCall?: (call: number) => void | Promise<void>;
  maxRepairs?: number;
}

export interface GuardResult extends LlmUsage {
  value: unknown;
  repairs: number;
  /** Calls made to the provider: 1 + repairs. */
  calls: number;
}

const MAX_SUMMARY_ISSUES = 10;

/**
 * Summary of Zod issues for the repair turn. It is built from the issue code and the path only:
 * messages and unknown keys can echo what the user wrote, and the repair must never carry it.
 */
export function summarizeIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.slice(0, MAX_SUMMARY_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'output';
    switch (issue.code) {
      case 'invalid_type':
        return `${path}: wrong type, expected ${issue.expected}`;
      case 'invalid_value':
        return `${path}: value is not one of the allowed values`;
      case 'unrecognized_keys':
        return `${path}: contains fields that are not part of the schema`;
      case 'too_small':
        return `${path}: value is too small`;
      case 'too_big':
        return `${path}: value is too big`;
      case 'invalid_format':
        return `${path}: wrong format`;
      default:
        return `${path}: invalid value`;
    }
  });
}

function addUsage(total: LlmUsage, response: Pick<LlmResponse, 'inputTokens' | 'outputTokens'>) {
  total.inputTokens += response.inputTokens;
  total.outputTokens += response.outputTokens;
}

/**
 * Calls the model and only lets out what passes the schema (research R7, R8). A bad answer is
 * repaired up to twice with a summary of its errors; a blocked answer or one that leaks the canary
 * is never repaired. Failures are `LlmError` with the tokens spent so far, so the budget settles.
 */
export async function runGuarded(options: GuardOptions): Promise<GuardResult> {
  const { validator, responseJsonSchema } = schemaOf(options);
  const maxRepairs = options.maxRepairs ?? MAX_REPAIRS;
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let repair: { previousOutput: string; errors: string[] } | undefined;

  /** Answers received from the provider; the first one is not a repair. */
  let answered = 0;
  /** Last answer that passed the schema but not the check (F6, research R9). */
  let lastValue: unknown;
  const fail = (code: LlmErrorCode, message: string) => {
    const error = new LlmError(code, message);
    if (code === 'LLM_INVALID_OUTPUT' && lastValue !== undefined) error.lastValue = lastValue;
    error.usage = { ...usage };
    error.repairs = Math.max(0, answered - 1);
    return error;
  };

  for (let call = 0; ; call++) {
    let response: LlmResponse;
    try {
      await options.beforeCall?.(call);
      response = await options.provider.generate({
        model: options.model,
        system: options.system,
        user: options.user,
        responseJsonSchema,
        maxOutputTokens: options.maxOutputTokens,
        ...(repair ? { repair } : {}),
      });
    } catch (cause) {
      const error = translateProviderError(cause);
      error.usage ??= { ...usage };
      error.repairs ??= Math.max(0, answered - 1);
      throw error;
    }
    addUsage(usage, response);
    answered++;

    if (response.blocked || response.finishReason === 'safety') {
      throw fail('LLM_CONTENT_BLOCKED', 'El proveedor bloqueó el contenido.');
    }
    if (response.text.includes(options.canary)) {
      throw fail('LLM_CANARY_LEAK', 'La salida reveló las instrucciones internas.');
    }

    const { issues, parsed } = validate(response, validator, options.check);
    lastValue = issues.length > 0 ? parsed : undefined;
    if (issues.length === 0) {
      return {
        value: parsed,
        repairs: call,
        calls: answered,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    }
    if (call >= maxRepairs) {
      throw fail('LLM_INVALID_OUTPUT', 'La salida del modelo no cumple el esquema.');
    }
    repair = { previousOutput: response.text, errors: issues };
  }
}

function schemaOf(options: GuardOptions): {
  validator: z.ZodType<unknown>;
  responseJsonSchema: JsonSchema;
} {
  if (options.schema) {
    return { validator: options.schema.validator, responseJsonSchema: options.schema.jsonSchema };
  }
  if (!options.outputType) throw new TypeError('runGuarded needs an outputType or a schema');
  return {
    validator: toZodSchema(options.outputType),
    responseJsonSchema: toJsonSchema(options.outputType),
  };
}

/** Issues of one answer; `parsed` is the value when it passed the schema. */
function validate(
  response: LlmResponse,
  validator: z.ZodType<unknown>,
  check: GuardOptions['check'],
): { issues: string[]; parsed?: unknown } {
  if (response.finishReason === 'max_tokens') {
    return { issues: ['output: truncated by the token limit, answer with a shorter result'] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(response.text);
  } catch {
    return { issues: ['output: the response is not valid JSON'] };
  }
  const result = validator.safeParse(raw);
  if (!result.success) return { issues: summarizeIssues(result.error.issues) };
  return { issues: [...(check?.(result.data) ?? [])], parsed: result.data };
}

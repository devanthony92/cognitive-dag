import {
  DEFAULT_LIMITS,
  validateDefinition,
  type DagDefinition,
  type DagError,
  type DagLimits,
  type ErrorClass,
} from '@cognitive-dag/dag-schema';
import {
  LlmError,
  newGuardTokens,
  runGuarded,
  type GuardTokens,
  type LlmProvider,
  type LlmUsage,
} from '@cognitive-dag/llm';
import { compilerCatalog } from './catalog.js';
import { COMPILER_INTENT_MAX_CHARS, CompilerError } from './errors.js';
import { intermediateSchema, type IntermediateDag } from './intermediate.js';
import { repairIssues } from './issues.js';
import { buildCompilerPrompt } from './prompt.js';
import {
  catalogSensitiveLookup,
  fillSensitivePlaceholders,
  stripSensitive,
  type OmittedSensitiveField,
  type SensitiveLookup,
} from './sanitize.js';
import { toDefinition } from './translate.js';

/** Output budget of one answer: a DAG of 50 nodes with their configuration fits. */
export const COMPILER_MAX_OUTPUT_TOKENS = 8192;

export interface CompileOptions {
  provider: LlmProvider;
  model: string;
  intent: string;
  /** Node types the model may use (research R10). */
  allowedTypes: readonly string[];
  limits?: DagLimits;
  maxOutputTokens?: number;
  /** Nonce and canary of the call; fresh ones when absent. Generated in the activity. */
  tokens?: GuardTokens;
  /** Runs before every call (0-based): the worker reserves budget here; throwing stops. */
  beforeCall?: (call: number) => void | Promise<void>;
  sensitiveLookup?: SensitiveLookup;
}

export interface CompiledDag {
  title: string;
  definition: DagDefinition;
  validation: { valid: boolean; errors: DagError[] };
  omittedSensitiveFields: OmittedSensitiveField[];
}

interface Metrics {
  usage: LlmUsage;
  /** Answers received from the provider. */
  calls: number;
  repairs: number;
}

export type CompileOutcome =
  | ({ status: 'succeeded'; nodeCount: number } & CompiledDag & Metrics)
  | ({
      status: 'failed';
      errorCode: string;
      errorClass: ErrorClass;
      /** Last attempt that passed the intermediate schema (research R9). */
      fallback?: CompiledDag;
    } & Metrics);

function finish(dag: IntermediateDag, limits: DagLimits, lookup: SensitiveLookup): CompiledDag {
  const { dag: clean, omitted } = stripSensitive(dag, lookup);
  const raw = toDefinition(clean);
  const validation = validateDefinition(raw, { limits });
  return {
    title: clean.title,
    definition: validation.definition ?? raw,
    validation: { valid: validation.valid, errors: validation.errors },
    omittedSensitiveFields: omitted,
  };
}

/**
 * Compiles an intent into a DAG (research R6, R7, R9, R12). The model answers the intermediate
 * format with structured output; every answer is translated and validated with the semantic
 * validation of `dag-schema`, and up to two repairs carry only codes and positions. Sensitive
 * fields are replaced by placeholders while validating and dropped from the result.
 *
 * Invalid outputs, blocks and canary leaks come back as a `failed` outcome; provider errors and
 * whatever `beforeCall` throws (budget) are rethrown for the activity to classify and retry.
 */
export async function compile(options: CompileOptions): Promise<CompileOutcome> {
  const intent = options.intent.trim();
  if (intent.length === 0) {
    throw new CompilerError('COMPILER_EMPTY_INTENT', 'La descripción está vacía.');
  }
  if (intent.length > COMPILER_INTENT_MAX_CHARS) {
    throw new CompilerError(
      'COMPILER_INTENT_TOO_LONG',
      `La descripción supera ${COMPILER_INTENT_MAX_CHARS} caracteres.`,
    );
  }
  const limits = options.limits ?? DEFAULT_LIMITS;
  const lookup = options.sensitiveLookup ?? catalogSensitiveLookup;
  const tokens = options.tokens ?? newGuardTokens();
  const catalog = compilerCatalog(options.allowedTypes);
  const schema = intermediateSchema(options.allowedTypes, limits);
  const prompt = buildCompilerPrompt(intent, catalog, tokens, limits);

  const check = (value: unknown): string[] => {
    const dag = fillSensitivePlaceholders(value as IntermediateDag, lookup);
    const result = validateDefinition(toDefinition(dag), { limits });
    return result.valid ? [] : repairIssues(result.errors, dag);
  };

  try {
    const result = await runGuarded({
      provider: options.provider,
      model: options.model,
      system: prompt.system,
      user: prompt.user,
      schema,
      check,
      maxOutputTokens: options.maxOutputTokens ?? COMPILER_MAX_OUTPUT_TOKENS,
      canary: tokens.canary,
      ...(options.beforeCall ? { beforeCall: options.beforeCall } : {}),
    });
    const compiled = finish(result.value as IntermediateDag, limits, lookup);
    return {
      status: 'succeeded',
      ...compiled,
      nodeCount: compiled.definition.nodes.length,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      calls: result.calls,
      repairs: result.repairs,
    };
  } catch (error) {
    if (!(error instanceof LlmError) || error.errorClass !== 'invalid_output') throw error;
    const repairs = error.repairs ?? 0;
    const fallback =
      error.code === 'LLM_INVALID_OUTPUT' && error.lastValue !== undefined
        ? finish(error.lastValue as IntermediateDag, limits, lookup)
        : undefined;
    return {
      status: 'failed',
      errorCode: error.code === 'LLM_INVALID_OUTPUT' ? 'COMPILER_INVALID_DAG' : error.code,
      errorClass: error.errorClass,
      ...(fallback ? { fallback } : {}),
      usage: error.usage ?? { inputTokens: 0, outputTokens: 0 },
      calls: repairs + 1,
      repairs,
    };
  }
}

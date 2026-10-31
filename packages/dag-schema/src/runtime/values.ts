import { NODE_CATALOG, isNodeType } from '../catalog/index.js';
import { parseReference } from '../references.js';
import { tokenizeTemplate } from '../templates.js';

export type RuntimeErrorCode =
  | 'REFERENCE_MALFORMED'
  | 'REFERENCE_VALUE_MISSING'
  | 'TEMPLATE_INVALID'
  | 'TEMPLATE_VALUE_NOT_TEXT'
  | 'CONDITION_TYPE_MISMATCH';

/** A deterministic evaluation failure: the same inputs always fail the same way (never retry). */
export class RuntimeEvaluationError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeEvaluationError';
  }
}

/** Output value per node id, as produced at run time. */
export type NodeOutputs = Readonly<Record<string, unknown>>;

export type ResolvedValue =
  { ok: true; value: unknown } | { ok: false; code: RuntimeErrorCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Looks up `nodes.<id>.output.<field>…` in the outputs of the nodes that already ran. Pure lookup
 * over own properties: nothing is evaluated and the prototype chain is never walked.
 */
export function resolveReferenceValue(text: string, outputs: NodeOutputs): ResolvedValue {
  const parsed = parseReference(text);
  if (!parsed) {
    return {
      ok: false,
      code: 'REFERENCE_MALFORMED',
      message: `La referencia «${text}» no es válida.`,
    };
  }
  const missing: ResolvedValue = {
    ok: false,
    code: 'REFERENCE_VALUE_MISSING',
    message: `La referencia «${text}» no tiene valor en esta ejecución.`,
  };
  if (!Object.hasOwn(outputs, parsed.nodeId)) return missing;
  let current: unknown = outputs[parsed.nodeId];
  for (const segment of parsed.path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return missing;
    current = current[segment];
  }
  return { ok: true, value: current };
}

/** Renders `{{reference}}` markers as text. Inserted values are not scanned again. */
export function renderTemplate(text: string, outputs: NodeOutputs): string {
  const { tokens, errors } = tokenizeTemplate(text);
  if (errors.length > 0) {
    throw new RuntimeEvaluationError(
      'TEMPLATE_INVALID',
      errors[0]?.message ?? 'Plantilla inválida.',
    );
  }
  let result = '';
  for (const token of tokens) {
    if (token.kind === 'text') {
      result += token.value;
      continue;
    }
    const resolved = resolveReferenceValue(token.path, outputs);
    if (!resolved.ok) throw new RuntimeEvaluationError(resolved.code, resolved.message);
    const { value } = resolved;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new RuntimeEvaluationError(
        'TEMPLATE_VALUE_NOT_TEXT',
        `La referencia «${token.path}» no es un valor que se pueda escribir como texto.`,
      );
    }
    result += String(value);
  }
  return result;
}

/** Config of a node with its templatable text fields rendered against the outputs so far. */
export function resolveNodeConfig(type: string, config: unknown, outputs: NodeOutputs): unknown {
  if (!isNodeType(type) || !isRecord(config)) return config;
  const fields = NODE_CATALOG[type].templatableFields;
  if (fields.length === 0) return config;
  const resolved: Record<string, unknown> = { ...config };
  for (const field of fields) {
    const value = config[field];
    if (typeof value === 'string') resolved[field] = renderTemplate(value, outputs);
  }
  return resolved;
}

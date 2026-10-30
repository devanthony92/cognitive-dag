import { describeType, isAssignable, type DagType } from './types.js';

export interface ParsedReference {
  nodeId: string;
  path: string[];
}

/** What a reference may point to from the node that contains it. */
export interface ReferenceScope {
  /** Output type per node id; `null` when the node produces no output. */
  outputs: ReadonlyMap<string, DagType | null>;
  /** Ids of the nodes that run before the node that contains the reference. */
  ancestors: ReadonlySet<string>;
}

export type ReferenceErrorCode =
  | 'REFERENCE_MALFORMED'
  | 'REFERENCE_NODE_NOT_FOUND'
  | 'REFERENCE_NOT_ANCESTOR'
  | 'REFERENCE_NO_OUTPUT'
  | 'REFERENCE_FIELD_NOT_FOUND'
  | 'REFERENCE_TYPE_MISMATCH';

export type ResolvedReference =
  | { ok: true; type: DagType; nodeId: string }
  | { ok: false; code: ReferenceErrorCode; message: string };

const IDENT = '[a-z][a-z0-9_]{0,39}';
const REFERENCE = new RegExp(`^nodes\\.(${IDENT})\\.output\\.(${IDENT}(?:\\.${IDENT})*)$`);

/** Parses `nodes.<id>.output.<field>[.<field>…]`. Returns null for anything else. */
export function parseReference(text: string): ParsedReference | null {
  const match = REFERENCE.exec(text);
  if (!match) return null;
  return { nodeId: match[1] as string, path: (match[2] as string).split('.') };
}

/**
 * Resolves a reference against the outputs of the DAG. Pure lookup: nothing is evaluated.
 * With `expected`, the resolved type must be assignable to it.
 */
export function resolveReference(
  text: string,
  scope: ReferenceScope,
  expected?: DagType,
): ResolvedReference {
  const parsed = parseReference(text);
  if (!parsed) {
    return {
      ok: false,
      code: 'REFERENCE_MALFORMED',
      message: `La referencia «${text}» no es válida. Usa nodes.<nodo>.output.<campo>.`,
    };
  }
  const { nodeId, path } = parsed;
  if (!scope.outputs.has(nodeId)) {
    return {
      ok: false,
      code: 'REFERENCE_NODE_NOT_FOUND',
      message: `El nodo «${nodeId}» no existe.`,
    };
  }
  if (!scope.ancestors.has(nodeId)) {
    return {
      ok: false,
      code: 'REFERENCE_NOT_ANCESTOR',
      message: `El nodo «${nodeId}» no se ejecuta antes que este nodo; solo se pueden usar salidas de nodos anteriores.`,
    };
  }
  const output = scope.outputs.get(nodeId);
  if (!output) {
    return {
      ok: false,
      code: 'REFERENCE_NO_OUTPUT',
      message: `El nodo «${nodeId}» no produce salida.`,
    };
  }
  let current: DagType = output;
  for (const segment of path) {
    const next: DagType | undefined =
      current.kind === 'object' && Object.hasOwn(current.fields, segment)
        ? current.fields[segment]
        : undefined;
    if (!next) {
      return {
        ok: false,
        code: 'REFERENCE_FIELD_NOT_FOUND',
        message: `El nodo «${nodeId}» no tiene el campo «${path.join('.')}» en su salida.`,
      };
    }
    current = next;
  }
  if (expected && !isAssignable(current, expected)) {
    return {
      ok: false,
      code: 'REFERENCE_TYPE_MISMATCH',
      message: `La referencia «${text}» es de tipo ${describeType(current)} y se esperaba ${describeType(expected)}.`,
    };
  }
  return { ok: true, type: current, nodeId };
}

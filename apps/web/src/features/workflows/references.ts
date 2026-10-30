import {
  NODE_CATALOG,
  NODE_ID_PATTERN,
  tokenizeTemplate,
  type Condition,
  type DagDefinition,
  type DagNode,
  type DagType,
  type Operand,
  type ReferenceScope,
} from '@cognitive-dag/dag-schema';

/** One field a reference can point to. */
export interface ReferenceOption {
  /** `nodes.<id>.output.<field>`, the text stored in the definition. */
  path: string;
  nodeId: string;
  nodeLabel: string;
  /** Field inside the output, `datos.ciudad`. */
  field: string;
  type: DagType;
}

/** Ids of the nodes that run before `nodeId`: everything that reaches it through connections. */
export function ancestorsOf(definition: DagDefinition, nodeId: string): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const list = incoming.get(edge.target);
    if (list) list.push(edge.source);
    else incoming.set(edge.target, [edge.source]);
  }
  const seen = new Set<string>();
  const queue = [nodeId];
  for (let i = 0; i < queue.length; i++) {
    for (const source of incoming.get(queue[i] as string) ?? []) {
      if (!seen.has(source)) {
        seen.add(source);
        queue.push(source);
      }
    }
  }
  seen.delete(nodeId);
  return seen;
}

/** Output type of a node, or null when it has none or its configuration is not usable yet. */
function outputOf(node: DagNode): DagType | null {
  try {
    return NODE_CATALOG[node.type].outputSchema(node.config);
  } catch {
    return null;
  }
}

/** What `resolveReference` needs to judge a reference written inside `nodeId`. */
export function referenceScope(definition: DagDefinition, nodeId: string): ReferenceScope {
  return {
    outputs: new Map(definition.nodes.map((node) => [node.id, outputOf(node)])),
    ancestors: ancestorsOf(definition, nodeId),
  };
}

function* fieldsOf(type: DagType, prefix: string[]): Generator<{ path: string[]; type: DagType }> {
  if (type.kind !== 'object') return;
  for (const [name, field] of Object.entries(type.fields)) {
    yield { path: [...prefix, name], type: field };
    yield* fieldsOf(field, [...prefix, name]);
  }
}

/**
 * The fields `nodeId` may reference: outputs of its ancestors, filtered by `accept` (the rule of
 * type compatibility of the place where the reference goes). Never offers a later or unrelated
 * node, so the selector cannot produce a reference the validator would reject for order.
 */
export function referenceOptions(
  definition: DagDefinition,
  nodeId: string,
  accept: (type: DagType) => boolean,
): ReferenceOption[] {
  const ancestors = ancestorsOf(definition, nodeId);
  const options: ReferenceOption[] = [];
  for (const node of definition.nodes) {
    if (!ancestors.has(node.id)) continue;
    const output = outputOf(node);
    if (!output) continue;
    for (const { path, type } of fieldsOf(output, [])) {
      if (!accept(type)) continue;
      const field = path.join('.');
      options.push({
        path: `nodes.${node.id}.output.${field}`,
        nodeId: node.id,
        nodeLabel: node.label,
        field,
        type,
      });
    }
  }
  return options;
}

const RENAME_HINT =
  'El identificador debe empezar con una letra minúscula y usar solo minúsculas, números y guion bajo (máximo 40 caracteres).';

/** Why `to` cannot be the new id of `from`, or undefined when it can. */
export function checkRename(
  definition: DagDefinition,
  from: string,
  to: string,
): string | undefined {
  if (!NODE_ID_PATTERN.test(to)) return RENAME_HINT;
  if (to !== from && definition.nodes.some((node) => node.id === to)) {
    return `Ya existe un nodo con el identificador «${to}».`;
  }
  return undefined;
}

const reference = (nodeId: string) => `nodes.${nodeId}.output.`;

function renamePath(path: string, from: string, to: string): string {
  const prefix = reference(from);
  return path.startsWith(prefix) ? `${reference(to)}${path.slice(prefix.length)}` : path;
}

function renameInTemplate(text: string, from: string, to: string): string {
  const { tokens } = tokenizeTemplate(text);
  let result = text;
  // From the end, so the offsets of the markers still to rewrite stay valid.
  for (const token of [...tokens].reverse()) {
    if (token.kind !== 'ref') continue;
    const renamed = renamePath(token.path, from, to);
    if (renamed !== token.path) {
      result = `${result.slice(0, token.start)}{{${renamed}}}${result.slice(token.end)}`;
    }
  }
  return result;
}

function renameInOperand<T extends Operand>(operand: T, from: string, to: string): T {
  return operand.kind === 'ref'
    ? { ...operand, path: renamePath(operand.path, from, to) }
    : operand;
}

function renameInCondition(condition: Condition, from: string, to: string): Condition {
  switch (condition.op) {
    case 'and':
    case 'or':
      return {
        ...condition,
        operands: condition.operands.map((c) => renameInCondition(c, from, to)),
      };
    case 'not':
      return { ...condition, operand: renameInCondition(condition.operand, from, to) };
    case 'exists':
      return { ...condition, operand: renameInOperand(condition.operand, from, to) };
    case 'in':
      return { ...condition, value: renameInOperand(condition.value, from, to) };
    default:
      return {
        ...condition,
        left: renameInOperand(condition.left, from, to),
        right: renameInOperand(condition.right, from, to),
      };
  }
}

function renameInConfig(node: DagNode, from: string, to: string): unknown {
  const config = node.config;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return config;
  const next: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  let changed = false;
  for (const field of NODE_CATALOG[node.type].templatableFields) {
    const value = next[field];
    if (typeof value !== 'string') continue;
    const renamed = renameInTemplate(value, from, to);
    if (renamed !== value) {
      next[field] = renamed;
      changed = true;
    }
  }
  if (
    node.type === 'logic.condition' &&
    typeof next['condition'] === 'object' &&
    next['condition']
  ) {
    const renamed = renameInCondition(next['condition'] as Condition, from, to);
    if (JSON.stringify(renamed) !== JSON.stringify(next['condition'])) {
      next['condition'] = renamed;
      changed = true;
    }
  }
  return changed ? next : config;
}

/**
 * Renames a node and rewrites everything that pointed to it: connections, `{{…}}` markers of the
 * templates and reference operands of conditions. Nodes that did not mention it stay identical.
 * Call `checkRename` first; this assumes `to` is free and well formed.
 */
export function renameNodeId(definition: DagDefinition, from: string, to: string): DagDefinition {
  if (from === to) return definition;
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const config = renameInConfig(node, from, to);
      if (node.id !== from && config === node.config) return node;
      return { ...node, id: node.id === from ? to : node.id, config };
    }),
    edges: definition.edges.map((edge) =>
      edge.source === from || edge.target === from
        ? {
            ...edge,
            source: edge.source === from ? to : edge.source,
            target: edge.target === from ? to : edge.target,
          }
        : edge,
    ),
  };
}

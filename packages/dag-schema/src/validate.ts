import type { z } from 'zod';
import { checkCondition, type Condition } from './conditions.js';
import { NODE_CATALOG } from './catalog/index.js';
import {
  DagDefinitionSchema,
  type DagDefinition,
  type DagEdge,
  type DagNode,
} from './definition.js';
import { ABSOLUTE_LIMITS, DEFAULT_LIMITS, definitionByteSize, type DagLimits } from './limits.js';
import { resolveReference, type ReferenceScope } from './references.js';
import { tokenizeTemplate } from './templates.js';
import { isTextConvertible, describeType, type DagType } from './types.js';

export interface DagErrorLocation {
  node?: string;
  field?: string;
  edge?: string;
  /** Nodes involved, for errors that concern several (cycles). */
  nodes?: string[];
}

export interface DagError {
  /** Stable machine-readable code. */
  code: string;
  /** Message for people, in Spanish. */
  message: string;
  location: DagErrorLocation;
}

export interface ValidationResult {
  valid: boolean;
  errors: DagError[];
  /** The parsed definition (defaults applied); present when the strict schema step passed. */
  definition?: DagDefinition;
}

export interface ValidateOptions {
  limits?: DagLimits;
}

/** Keys that look like credentials. Only top-level configuration keys are scanned (FR-005). */
const SECRET_KEY =
  /^(password|passwd|secret|token|api[-_]?key|apikey|authorization|credentials?|private[-_]?key|access[-_]?key|bearer)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function idOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value['id'] === 'string' ? value['id'] : undefined;
}

// ---- Step 1: strict schema ---------------------------------------------------------------------

function locate(path: PropertyKey[], raw: unknown): DagErrorLocation {
  const [head, index, ...rest] = path;
  const field = rest.length > 0 ? rest.map(String).join('.') : undefined;
  if (head === 'nodes' && typeof index === 'number') {
    const node = idOf(asArray(isRecord(raw) ? raw['nodes'] : undefined)[index]);
    return { ...(node ? { node } : {}), ...(field ? { field } : {}) };
  }
  if (head === 'edges' && typeof index === 'number') {
    const edge = idOf(asArray(isRecord(raw) ? raw['edges'] : undefined)[index]);
    return { ...(edge ? { edge } : {}), ...(field ? { field } : {}) };
  }
  const all = path.map(String).join('.');
  return all ? { field: all } : {};
}

function schemaErrors(raw: unknown, issues: readonly z.core.$ZodIssue[]): DagError[] {
  const errors: DagError[] = [];
  for (const issue of issues) {
    const where = (extra?: string) => locate(extra ? [...issue.path, extra] : [...issue.path], raw);
    const label = issue.path.length > 0 ? issue.path.map(String).join('.') : 'la definición';

    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const atConfig = issue.path[issue.path.length - 1] === 'config';
        if (atConfig && SECRET_KEY.test(key)) continue; // reported as SECRET_FIELD
        errors.push({
          code: 'UNKNOWN_FIELD',
          message: `El campo «${key}» no está permitido.`,
          location: where(key),
        });
      }
      continue;
    }

    const dagCode = (issue as { params?: { dagCode?: string } }).params?.dagCode;
    if (issue.code === 'custom' && dagCode) {
      errors.push({ code: dagCode, message: issue.message, location: where() });
    } else if (issue.code === 'invalid_type' && issue.input === undefined) {
      errors.push({
        code: 'SCHEMA_INVALID',
        message: `Falta el campo «${label}».`,
        location: where(),
      });
    } else {
      errors.push({
        code: 'SCHEMA_INVALID',
        message: `El valor de «${label}» no es válido.`,
        location: where(),
      });
    }
  }
  return errors;
}

function secretFieldErrors(raw: unknown): DagError[] {
  const errors: DagError[] = [];
  asArray(isRecord(raw) ? raw['nodes'] : undefined).forEach((node) => {
    const config = isRecord(node) ? node['config'] : undefined;
    const id = idOf(node);
    if (!isRecord(config) || !id) return;
    for (const key of Object.keys(config)) {
      if (SECRET_KEY.test(key)) {
        errors.push({
          code: 'SECRET_FIELD',
          message: `El campo «${key}» parece una credencial; las definiciones no pueden contener secretos.`,
          location: { node: id, field: `config.${key}` },
        });
      }
    }
  });
  return errors;
}

// ---- Graph helpers -----------------------------------------------------------------------------

interface Graph {
  nodes: Map<string, DagNode>;
  /** Edges whose endpoints both exist. */
  edges: DagEdge[];
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

function buildGraph(definition: DagDefinition): Graph {
  const nodes = new Map<string, DagNode>();
  for (const node of definition.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
  const edges = definition.edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of nodes.keys()) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const e of edges) {
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }
  return { nodes, edges, outgoing, incoming };
}

function reach(start: Iterable<string>, adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(start);
  const queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacency.get(queue[i] as string) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Kahn: ids left over after removing nodes with no pending incoming edges (they touch a cycle). */
function kahnLeftover(graph: Graph): Set<string> {
  const pending = new Map<string, number>();
  for (const [id, sources] of graph.incoming) pending.set(id, sources.length);
  const queue = [...pending].filter(([, n]) => n === 0).map(([id]) => id);
  const removed = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as string;
    removed.add(id);
    for (const next of graph.outgoing.get(id) ?? []) {
      const left = (pending.get(next) ?? 0) - 1;
      pending.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  return new Set([...graph.nodes.keys()].filter((id) => !removed.has(id)));
}

/** Strongly connected components of the sub-graph induced by `ids` (Tarjan). */
function cyclesAmong(graph: Graph, ids: Set<string>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of graph.outgoing.get(id) ?? []) {
      if (!ids.has(next)) continue;
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) as number, low.get(next) as number));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) as number, index.get(next) as number));
      }
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      const selfLoop = component.length === 1 && (graph.outgoing.get(id) ?? []).includes(id);
      if (component.length > 1 || selfLoop) components.push(component.sort());
    }
  };

  for (const id of [...ids].sort()) if (!index.has(id)) visit(id);
  return components.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
}

// ---- Steps 7 and 8 -----------------------------------------------------------------------------

function referenceErrors(definition: DagDefinition, graph: Graph): DagError[] {
  const errors: DagError[] = [];
  const outputs = new Map<string, DagType | null>();
  for (const [id, node] of graph.nodes) {
    outputs.set(id, NODE_CATALOG[node.type].outputSchema(node.config));
  }

  for (const node of definition.nodes) {
    if (graph.nodes.get(node.id) !== node) continue; // duplicate id, already reported
    const entry = NODE_CATALOG[node.type];
    const config = isRecord(node.config) ? node.config : {};
    let scope: ReferenceScope | undefined;
    const scopeOf = (): ReferenceScope => {
      if (!scope) {
        const ancestors = reach([node.id], graph.incoming);
        ancestors.delete(node.id);
        scope = { outputs, ancestors };
      }
      return scope;
    };

    for (const field of entry.templatableFields) {
      const value = config[field];
      if (typeof value !== 'string') continue;
      const location = { node: node.id, field: `config.${field}` };
      const { tokens, errors: syntax } = tokenizeTemplate(value);
      for (const e of syntax) errors.push({ code: e.code, message: e.message, location });
      for (const token of tokens) {
        if (token.kind !== 'ref') continue;
        const resolved = resolveReference(token.path, scopeOf());
        if (!resolved.ok) {
          errors.push({ code: resolved.code, message: resolved.message, location });
        } else if (!isTextConvertible(resolved.type)) {
          errors.push({
            code: 'TEMPLATE_TYPE_NOT_TEXT',
            message: `La referencia «${token.path}» es de tipo ${describeType(resolved.type)} y no se puede escribir dentro de un texto.`,
            location,
          });
        }
      }
    }

    if (node.type === 'logic.condition') {
      const location = { node: node.id, field: 'config.condition' };
      for (const issue of checkCondition(config['condition'] as Condition, scopeOf())) {
        errors.push({ code: issue.code, message: issue.message, location });
      }
    }
  }
  return errors;
}

function checkOptionLimits(limits: DagLimits): void {
  const pairs: Array<[keyof DagLimits, number]> = [
    ['maxNodes', ABSOLUTE_LIMITS.maxNodes],
    ['maxEdges', ABSOLUTE_LIMITS.maxEdges],
    ['maxDefinitionBytes', ABSOLUTE_LIMITS.maxDefinitionBytes],
  ];
  for (const [key, ceiling] of pairs) {
    const value = limits[key];
    if (!Number.isInteger(value) || value < 0 || value > ceiling) {
      throw new RangeError(`limits.${key} must be an integer between 0 and ${ceiling}.`);
    }
  }
}

function limitErrors(definition: DagDefinition, limits: DagLimits): DagError[] {
  const errors: DagError[] = [];
  if (definition.nodes.length > limits.maxNodes) {
    errors.push({
      code: 'LIMIT_NODES',
      message: `El DAG tiene ${definition.nodes.length} nodos y el máximo es ${limits.maxNodes}.`,
      location: {},
    });
  }
  if (definition.edges.length > limits.maxEdges) {
    errors.push({
      code: 'LIMIT_EDGES',
      message: `El DAG tiene ${definition.edges.length} conexiones y el máximo es ${limits.maxEdges}.`,
      location: {},
    });
  }
  const bytes = definitionByteSize(definition);
  if (bytes > limits.maxDefinitionBytes) {
    errors.push({
      code: 'LIMIT_BYTES',
      message: `La definición pesa ${bytes} bytes y el máximo es ${limits.maxDefinitionBytes}.`,
      location: {},
    });
  }
  return errors;
}

/**
 * Validates a DAG definition (research R7). One implementation for browser and server.
 *
 * Steps, in order: strict schema → unique ids → a single trigger without inputs → connections to
 * existing nodes and outputs → cycles → reachability → references → limits. A failure in the
 * schema step stops the rest (the data cannot be trusted); later steps all report. Errors come
 * out in a fixed order, so the same input gives the same list everywhere.
 *
 * @throws RangeError when `options.limits` exceeds the absolute ceilings.
 */
export function validateDefinition(
  input: unknown,
  options: ValidateOptions = {},
): ValidationResult {
  const limits = options.limits ?? DEFAULT_LIMITS;
  checkOptionLimits(limits);

  // Refuse absurd sizes before doing any work on them.
  if (isRecord(input)) {
    const oversize: DagError[] = [];
    const nodeCount = asArray(input['nodes']).length;
    const edgeCount = asArray(input['edges']).length;
    if (nodeCount > ABSOLUTE_LIMITS.maxNodes) {
      oversize.push({
        code: 'LIMIT_NODES',
        message: `El DAG tiene ${nodeCount} nodos y el máximo absoluto es ${ABSOLUTE_LIMITS.maxNodes}.`,
        location: {},
      });
    }
    if (edgeCount > ABSOLUTE_LIMITS.maxEdges) {
      oversize.push({
        code: 'LIMIT_EDGES',
        message: `El DAG tiene ${edgeCount} conexiones y el máximo absoluto es ${ABSOLUTE_LIMITS.maxEdges}.`,
        location: {},
      });
    }
    if (oversize.length > 0) return { valid: false, errors: oversize };
  }

  // 1. Strict schema.
  const secrets = secretFieldErrors(input);
  const parsed = DagDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: [...secrets, ...schemaErrors(input, parsed.error.issues)],
    };
  }
  const definition = parsed.data;
  const errors: DagError[] = [...secrets];

  // 2. Unique ids.
  const seenNodes = new Set<string>();
  for (const node of definition.nodes) {
    if (seenNodes.has(node.id)) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        message: `El identificador de nodo «${node.id}» está repetido.`,
        location: { node: node.id },
      });
    }
    seenNodes.add(node.id);
  }
  const seenEdges = new Set<string>();
  for (const edge of definition.edges) {
    if (seenEdges.has(edge.id)) {
      errors.push({
        code: 'DUPLICATE_EDGE_ID',
        message: `El identificador de conexión «${edge.id}» está repetido.`,
        location: { edge: edge.id },
      });
    }
    seenEdges.add(edge.id);
  }

  const graph = buildGraph(definition);

  // 3. A single trigger, without incoming connections.
  const triggers = definition.nodes.filter((n) => !NODE_CATALOG[n.type].acceptsInput);
  if (triggers.length === 0) {
    errors.push({
      code: 'TRIGGER_MISSING',
      message: 'El DAG necesita un disparador.',
      location: {},
    });
  }
  for (const extra of triggers.slice(1)) {
    errors.push({
      code: 'TRIGGER_MULTIPLE',
      message: `Solo puede haber un disparador; «${extra.id}» sobra.`,
      location: { node: extra.id },
    });
  }
  for (const edge of graph.edges) {
    const target = graph.nodes.get(edge.target);
    if (target && !NODE_CATALOG[target.type].acceptsInput) {
      errors.push({
        code: 'TRIGGER_HAS_INPUT',
        message: `El disparador «${edge.target}» no puede recibir conexiones.`,
        location: { edge: edge.id, node: edge.target },
      });
    }
  }

  // 4. Connections to existing nodes and outputs.
  for (const edge of definition.edges) {
    const source = graph.nodes.get(edge.source);
    if (!source) {
      errors.push({
        code: 'EDGE_SOURCE_NOT_FOUND',
        message: `La conexión «${edge.id}» sale de un nodo que no existe («${edge.source}»).`,
        location: { edge: edge.id },
      });
    }
    if (!graph.nodes.has(edge.target)) {
      errors.push({
        code: 'EDGE_TARGET_NOT_FOUND',
        message: `La conexión «${edge.id}» llega a un nodo que no existe («${edge.target}»).`,
        location: { edge: edge.id },
      });
    }
    if (source && !NODE_CATALOG[source.type].handles.includes(edge.sourceHandle)) {
      errors.push({
        code: 'EDGE_HANDLE_INVALID',
        message: `El nodo «${edge.source}» no tiene la salida «${edge.sourceHandle}».`,
        location: { edge: edge.id },
      });
    }
  }

  // 5. Cycles.
  const leftover = kahnLeftover(graph);
  if (leftover.size > 0) {
    for (const nodes of cyclesAmong(graph, leftover)) {
      errors.push({
        code: 'CYCLE_DETECTED',
        message: `Hay un ciclo entre los nodos: ${nodes.join(', ')}.`,
        location: { nodes },
      });
    }
  }

  // 6. Reachability from the trigger.
  if (triggers.length > 0) {
    const reachable = reach(
      triggers.map((t) => t.id),
      graph.outgoing,
    );
    const reported = new Set<string>();
    for (const node of definition.nodes) {
      if (reachable.has(node.id) || reported.has(node.id)) continue;
      reported.add(node.id);
      errors.push({
        code: 'NODE_UNREACHABLE',
        message: `El nodo «${node.id}» no se alcanza desde el disparador.`,
        location: { node: node.id },
      });
    }
  }

  // 7. References.
  errors.push(...referenceErrors(definition, graph));

  // 8. Limits.
  errors.push(...limitErrors(definition, limits));

  return errors.length === 0
    ? { valid: true, errors, definition }
    : { valid: false, errors, definition };
}

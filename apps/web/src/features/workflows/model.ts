import {
  NODE_CATALOG,
  SCHEMA_VERSION,
  emptyDefinition,
  isNodeType,
  type DagDefinition,
  type DagEdge,
  type DagError,
  type DagNode,
  type NodeType,
} from '@cognitive-dag/dag-schema';

export interface Position {
  x: number;
  y: number;
}

export interface NewConnection {
  source: string;
  sourceHandle: string;
  target: string;
}

/** Node ids are references (`nodes.<id>.output`), so they read as the type: `classify_1`. */
function nextNodeId(definition: DagDefinition, type: NodeType): string {
  const base = type.split('.').pop() ?? 'node';
  const taken = new Set(definition.nodes.map((node) => node.id));
  for (let n = 1; ; n++) {
    const id = `${base}_${n}`;
    if (!taken.has(id)) return id;
  }
}

function nextEdgeId(definition: DagDefinition): string {
  const taken = new Set(definition.edges.map((edge) => edge.id));
  for (let n = 1; ; n++) {
    const id = `e${n}`;
    if (!taken.has(id)) return id;
  }
}

export function addNode(
  definition: DagDefinition,
  type: NodeType,
  position: Position,
): { definition: DagDefinition; id: string } {
  const entry = NODE_CATALOG[type];
  const id = nextNodeId(definition, type);
  const node = { id, type, label: entry.label, position, config: entry.defaultConfig() };
  return { definition: { ...definition, nodes: [...definition.nodes, node] }, id };
}

export function connect(definition: DagDefinition, connection: NewConnection): DagDefinition {
  const exists = definition.edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.sourceHandle === connection.sourceHandle &&
      edge.target === connection.target,
  );
  if (exists) return definition;
  const edge = { id: nextEdgeId(definition), ...connection };
  return { ...definition, edges: [...definition.edges, edge] };
}

export function removeNodes(definition: DagDefinition, ids: readonly string[]): DagDefinition {
  const gone = new Set(ids);
  return {
    ...definition,
    nodes: definition.nodes.filter((node) => !gone.has(node.id)),
    edges: definition.edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)),
  };
}

export function removeEdges(definition: DagDefinition, ids: readonly string[]): DagDefinition {
  const gone = new Set(ids);
  return { ...definition, edges: definition.edges.filter((edge) => !gone.has(edge.id)) };
}

export function moveNode(definition: DagDefinition, id: string, position: Position): DagDefinition {
  return updateNode(definition, id, { position });
}

export function updateNode(
  definition: DagDefinition,
  id: string,
  patch: { label?: string; config?: unknown; position?: Position },
): DagDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
  };
}

export interface GroupedErrors {
  byNode: Map<string, DagError[]>;
  byEdge: Map<string, DagError[]>;
  /** Errors about the whole graph (no trigger, limits). */
  global: DagError[];
  /** Messages for one field of a node, e.g. `fieldMessages('classify_1', 'config.labels')`. */
  fieldMessages(node: string, field: string): string[];
  /** Like `fieldMessages`, but only the errors of that very field, not of its items. */
  exactMessages(node: string, field: string): string[];
}

function push(map: Map<string, DagError[]>, key: string, error: DagError): void {
  const list = map.get(key);
  if (list) list.push(error);
  else map.set(key, [error]);
}

export function groupErrors(errors: readonly DagError[]): GroupedErrors {
  const byNode = new Map<string, DagError[]>();
  const byEdge = new Map<string, DagError[]>();
  const global: DagError[] = [];
  for (const error of errors) {
    const { node, edge, nodes } = error.location;
    const involved = new Set([...(node ? [node] : []), ...(nodes ?? [])]);
    for (const id of involved) push(byNode, id, error);
    if (edge) push(byEdge, edge, error);
    if (involved.size === 0 && !edge) global.push(error);
  }
  return {
    byNode,
    byEdge,
    global,
    fieldMessages: (node, field) =>
      (byNode.get(node) ?? [])
        .filter((error) => {
          const where = error.location.field;
          return where === field || where?.startsWith(`${field}.`) === true;
        })
        .map((error) => error.message),
    exactMessages: (node, field) =>
      (byNode.get(node) ?? [])
        .filter((error) => error.location.field === field)
        .map((error) => error.message),
  };
}

/** JSON with sorted keys, so two definitions with the same content compare equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Reads the draft the API returns. The server keeps drafts that do not pass the schema, so the
 * editor drops what it cannot draw (unknown types, malformed connections) and says how much.
 */
export function toEditableDefinition(raw: unknown): { definition: DagDefinition; skipped: number } {
  if (!isRecord(raw) || raw['schemaVersion'] !== SCHEMA_VERSION) {
    return { definition: emptyDefinition(), skipped: 0 };
  }
  let skipped = 0;
  const nodes: DagNode[] = [];
  for (const item of Array.isArray(raw['nodes']) ? (raw['nodes'] as unknown[]) : []) {
    if (!isRecord(item) || typeof item['id'] !== 'string' || !isNodeType(item['type'])) {
      skipped += 1;
      continue;
    }
    const position = isRecord(item['position']) ? item['position'] : {};
    nodes.push({
      id: item['id'],
      type: item['type'],
      label: typeof item['label'] === 'string' ? item['label'] : item['id'],
      position: { x: num(position['x']), y: num(position['y']) },
      config: item['config'],
    });
  }
  const edges: DagEdge[] = [];
  for (const item of Array.isArray(raw['edges']) ? (raw['edges'] as unknown[]) : []) {
    if (
      !isRecord(item) ||
      typeof item['id'] !== 'string' ||
      typeof item['source'] !== 'string' ||
      typeof item['sourceHandle'] !== 'string' ||
      typeof item['target'] !== 'string'
    ) {
      skipped += 1;
      continue;
    }
    edges.push({
      id: item['id'],
      source: item['source'],
      sourceHandle: item['sourceHandle'],
      target: item['target'],
    });
  }
  return { definition: { schemaVersion: SCHEMA_VERSION, nodes, edges }, skipped };
}

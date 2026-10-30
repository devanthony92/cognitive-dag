import { z } from 'zod';
import { NODE_CATALOG, NODE_TYPES, type NodeType } from './catalog/index.js';
import { ABSOLUTE_LIMITS } from './limits.js';

export const SCHEMA_VERSION = 1;

export const NODE_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Node id: also the name used in references, so it is restricted to a safe identifier. */
export const NodeIdSchema = z
  .string()
  .regex(NODE_ID_PATTERN, 'Debe empezar con una letra minúscula y usar a-z, 0-9 o _ (máx. 40).');

export const EdgeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);

const PositionSchema = z.strictObject({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
});

const nodeSchemas = NODE_TYPES.map((type) =>
  z.strictObject({
    id: NodeIdSchema,
    type: z.literal(type),
    label: z.string().min(1).max(100),
    position: PositionSchema,
    config: NODE_CATALOG[type].configSchema,
  }),
);

export const DagNodeSchema = z.discriminatedUnion(
  'type',
  nodeSchemas as unknown as [(typeof nodeSchemas)[number], ...(typeof nodeSchemas)[number][]],
);

export const DagEdgeSchema = z.strictObject({
  id: EdgeIdSchema,
  source: NodeIdSchema,
  sourceHandle: z.string().min(1).max(40),
  target: NodeIdSchema,
});

/**
 * The definition of a DAG (research R2). Strict at every level: unknown fields invalidate it.
 * Uniqueness, connectivity and references are checked by `validateDefinition`.
 */
export const DagDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  nodes: z.array(DagNodeSchema).max(ABSOLUTE_LIMITS.maxNodes),
  edges: z.array(DagEdgeSchema).max(ABSOLUTE_LIMITS.maxEdges),
});

export interface DagNode {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  /** Valid for `type` once parsed; see `NODE_CATALOG[type].configSchema`. */
  config: unknown;
}

export interface DagEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
}

export interface DagDefinition {
  schemaVersion: typeof SCHEMA_VERSION;
  nodes: DagNode[];
  edges: DagEdge[];
}

export function emptyDefinition(): DagDefinition {
  return { schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] };
}

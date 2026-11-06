import { DEFAULT_LIMITS, NODE_ID_PATTERN, NodeIdSchema } from '@cognitive-dag/dag-schema';
import type { JsonSchema } from '@cognitive-dag/llm';
import { z } from 'zod';

/** What the model answers (research R6): no positions, no edge ids. */
export interface IntermediateNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

export interface IntermediateEdge {
  from: string;
  fromHandle: string;
  to: string;
}

export interface IntermediateDag {
  /** Name proposed for a new workflow. */
  title: string;
  nodes: IntermediateNode[];
  edges: IntermediateEdge[];
}

export const MAX_TITLE_LENGTH = 100;
export const MAX_LABEL_LENGTH = 100;

export interface IntermediateLimits {
  maxNodes: number;
  maxEdges: number;
}

/**
 * Schema of the intermediate DAG: a Zod validator and the JSON Schema sent as structured output.
 * The configuration of each node is an open object here; its shape is checked per type by the
 * semantic validation, whose errors drive the repairs.
 */
export function intermediateSchema(
  types: readonly string[],
  limits: IntermediateLimits = DEFAULT_LIMITS,
): { validator: z.ZodType<IntermediateDag>; jsonSchema: JsonSchema } {
  if (types.length === 0) throw new RangeError('The compiler needs at least one node type');
  const typeEnum = z.enum(types as [string, ...string[]]);
  const validator = z.strictObject({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    nodes: z
      .array(
        z.strictObject({
          id: NodeIdSchema,
          type: typeEnum,
          label: z.string().trim().min(1).max(MAX_LABEL_LENGTH),
          config: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(limits.maxNodes),
    edges: z
      .array(
        z.strictObject({
          from: NodeIdSchema,
          fromHandle: z.string().min(1).max(40),
          to: NodeIdSchema,
        }),
      )
      .max(limits.maxEdges),
  });

  const jsonSchema: JsonSchema = {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
      nodes: {
        type: 'array',
        minItems: 1,
        maxItems: limits.maxNodes,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: NODE_ID_PATTERN.source },
            type: { type: 'string', enum: [...types] },
            label: { type: 'string', minLength: 1, maxLength: MAX_LABEL_LENGTH },
            config: { type: 'object' },
          },
          required: ['id', 'type', 'label', 'config'],
          additionalProperties: false,
        },
      },
      edges: {
        type: 'array',
        maxItems: limits.maxEdges,
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            fromHandle: { type: 'string' },
            to: { type: 'string' },
          },
          required: ['from', 'fromHandle', 'to'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'nodes', 'edges'],
    additionalProperties: false,
  };
  return { validator, jsonSchema };
}

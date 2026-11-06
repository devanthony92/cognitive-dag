import { describe, expect, it } from 'vitest';
import { intermediateSchema } from '../src/index.js';
import { classifyAndBranch, F5_TYPES } from './fixtures.js';

describe('intermediate format (research R6)', () => {
  const { validator, jsonSchema } = intermediateSchema(F5_TYPES);

  it('accepts a DAG of nodes, edges and configuration without positions', () => {
    expect(validator.safeParse(classifyAndBranch()).success).toBe(true);
  });

  it('rejects positions, edge ids and unknown fields', () => {
    const dag = classifyAndBranch();
    const withPosition = {
      ...dag,
      nodes: dag.nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })),
    };
    expect(validator.safeParse(withPosition).success).toBe(false);
    const withEdgeId = { ...dag, edges: dag.edges.map((edge) => ({ ...edge, id: 'e1' })) };
    expect(validator.safeParse(withEdgeId).success).toBe(false);
    expect(validator.safeParse({ ...dag, extra: true }).success).toBe(false);
  });

  it('only admits the allowed types', () => {
    const dag = classifyAndBranch();
    const narrow = intermediateSchema(['trigger.manual', 'mock.service']);
    expect(narrow.validator.safeParse(dag).success).toBe(false);
    const other = {
      ...dag,
      nodes: [...dag.nodes, { ...dag.nodes[3]!, id: 'x', type: 'http.request' }],
    };
    expect(validator.safeParse(other).success).toBe(false);
  });

  it('checks the format of ids, the length of labels and the title', () => {
    const dag = classifyAndBranch();
    const badId = {
      ...dag,
      nodes: [{ ...dag.nodes[0]!, id: 'Start Node' }, ...dag.nodes.slice(1)],
    };
    expect(validator.safeParse(badId).success).toBe(false);
    const longLabel = { ...dag, nodes: [{ ...dag.nodes[0]!, label: 'x'.repeat(101) }] };
    expect(validator.safeParse(longLabel).success).toBe(false);
    expect(validator.safeParse({ ...dag, title: '' }).success).toBe(false);
  });

  it('bounds the number of nodes and edges by the limits', () => {
    const small = intermediateSchema(F5_TYPES, { maxNodes: 2, maxEdges: 1 });
    expect(small.validator.safeParse(classifyAndBranch()).success).toBe(false);
  });

  it('gives a closed JSON Schema for structured output with the type enum', () => {
    expect(jsonSchema).toMatchObject({
      type: 'object',
      required: ['title', 'nodes', 'edges'],
      additionalProperties: false,
    });
    const nodes = (jsonSchema.properties as Record<string, { items: Record<string, unknown> }>)
      .nodes;
    const node = nodes?.items as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(node.properties.type?.enum).toEqual([...F5_TYPES]);
    expect(node.properties.config?.type).toBe('object');
    expect(node.required).toEqual(['id', 'type', 'label', 'config']);
    expect(node.additionalProperties).toBe(false);
  });
});

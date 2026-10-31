/** Builders of DAG definitions shared by the interpreter tests. */

export interface TestNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  /** Retry setting of a node with an effect (F4). */
  retry?: Record<string, unknown>;
}

export const MOCK = { latencyMs: 0, failureRate: 0, failureKind: 'transient' };

export const node = (id: string, type: string, config: Record<string, unknown> = {}): TestNode => ({
  id,
  type,
  config,
});
export const trigger = (id = 'trigger') =>
  node(id, 'trigger.manual', {
    inputSchema: [
      { name: 'amount', type: { kind: 'number' } },
      { name: 'tone', type: { kind: 'string' } },
    ],
  });
export const mock = (
  id: string,
  config: Record<string, unknown> = {},
  retry?: Record<string, unknown>,
): TestNode => ({
  ...node(id, 'mock.service', { ...MOCK, ...config }),
  ...(retry ? { retry } : {}),
});
export const merge = (id: string, strategy: 'all' | 'any') => node(id, 'logic.merge', { strategy });
export const condition = (id: string, amount: number) =>
  node(id, 'logic.condition', {
    condition: {
      op: 'gt',
      left: { kind: 'ref', path: 'nodes.trigger.output.amount' },
      right: { kind: 'literal', type: 'number', value: amount },
    },
  });
export const edge = (source: string, target: string, sourceHandle = 'out') => ({
  id: `${source}_${sourceHandle}_${target}`,
  source,
  sourceHandle,
  target,
});

export function definition(nodes: TestNode[], edges: ReturnType<typeof edge>[]) {
  return {
    schemaVersion: 1,
    nodes: nodes.map((n) => ({
      ...n,
      label: n.id,
      position: { x: 0, y: 0 },
    })),
    edges,
  };
}

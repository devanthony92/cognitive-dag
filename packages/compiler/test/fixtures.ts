import type { IntermediateDag } from '../src/index.js';

/** Manual trigger → classify → condition on the label → mock service on each branch. */
export function classifyAndBranch(): IntermediateDag {
  return {
    title: 'Clasificar correos',
    nodes: [
      {
        id: 'start',
        type: 'trigger.manual',
        label: 'Inicio',
        config: { inputSchema: [{ name: 'body', type: { kind: 'string' } }] },
      },
      {
        id: 'classify',
        type: 'llm.classify',
        label: 'Clasificar',
        config: { text: '{{nodes.start.output.body}}', labels: ['spam', 'ham'] },
      },
      {
        id: 'is_spam',
        type: 'logic.condition',
        label: '¿Es spam?',
        config: {
          condition: {
            op: 'eq',
            left: { kind: 'ref', path: 'nodes.classify.output.label' },
            right: { kind: 'literal', type: 'string', value: 'spam' },
          },
        },
      },
      {
        id: 'archive',
        type: 'mock.service',
        label: 'Archivar',
        config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
      },
      {
        id: 'reply',
        type: 'mock.service',
        label: 'Responder',
        config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
      },
    ],
    edges: [
      { from: 'start', fromHandle: 'out', to: 'classify' },
      { from: 'classify', fromHandle: 'out', to: 'is_spam' },
      { from: 'is_spam', fromHandle: 'true', to: 'archive' },
      { from: 'is_spam', fromHandle: 'false', to: 'reply' },
    ],
  };
}

/** The same DAG with a connection back to the start: a cycle. */
export function withCycle(): IntermediateDag {
  const dag = classifyAndBranch();
  return { ...dag, edges: [...dag.edges, { from: 'reply', fromHandle: 'out', to: 'classify' }] };
}

export const F5_TYPES = [
  'trigger.manual',
  'logic.condition',
  'logic.merge',
  'mock.service',
  'llm.classify',
  'llm.extract',
  'llm.generate',
] as const;

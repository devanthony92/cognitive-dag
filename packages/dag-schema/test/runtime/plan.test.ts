import { describe, expect, it } from 'vitest';
import {
  buildExecutionGraph,
  findUnsupportedNodes,
  isRunFinished,
  planNext,
  type DagDefinition,
  type RunState,
  type StepState,
} from '../../src/index.js';
import { def, edge, node, trigger } from '../helpers.js';

const asDefinition = (value: ReturnType<typeof def>) => value as unknown as DagDefinition;

function stateOf(
  statuses: Record<string, StepState>,
  selections: Record<string, string> = {},
): RunState {
  return {
    statuses: new Map(Object.entries(statuses)),
    selections: new Map(Object.entries(selections)),
  };
}

/** trigger -> a -> cond -(true)-> b -> merge ; cond -(false)-> c -> merge ; merge -> end */
function diamond(strategy: 'all' | 'any') {
  return asDefinition(
    def(
      [
        trigger(),
        node('a', 'mock.service'),
        node('cond', 'logic.condition'),
        node('b', 'mock.service'),
        node('c', 'mock.service'),
        node('merge', 'logic.merge', { strategy }),
        node('end', 'mock.service'),
      ],
      [
        edge('trigger', 'a'),
        edge('a', 'cond'),
        edge('cond', 'b', 'true'),
        edge('cond', 'c', 'false'),
        edge('b', 'merge'),
        edge('c', 'merge'),
        edge('merge', 'end'),
      ],
    ),
  );
}

const pendingAll = (ids: string[]): Record<string, StepState> =>
  Object.fromEntries(ids.map((id) => [id, 'pending' as const]));

describe('findUnsupportedNodes', () => {
  it('finds nodes whose executableFrom is later than F3', () => {
    const definition = asDefinition(
      def(
        [
          trigger(),
          node('ask', 'llm.generate'),
          node('approve', 'human.approval'),
          node('m', 'mock.service'),
        ],
        [],
      ),
    );
    expect(findUnsupportedNodes(definition)).toEqual([
      { nodeId: 'ask', type: 'llm.generate', executableFrom: 'F5' },
      { nodeId: 'approve', type: 'human.approval', executableFrom: 'F7' },
    ]);
  });

  it('returns nothing when every node runs in F3', () => {
    expect(findUnsupportedNodes(diamond('all'))).toEqual([]);
  });

  it('flags a webhook trigger (F7)', () => {
    const definition = asDefinition(def([node('hook', 'trigger.webhook')], []));
    expect(findUnsupportedNodes(definition).map((n) => n.nodeId)).toEqual(['hook']);
  });
});

describe('planNext', () => {
  const graph = buildExecutionGraph(diamond('all'));
  const ids = ['trigger', 'a', 'cond', 'b', 'c', 'merge', 'end'];

  it('starts with the trigger', () => {
    expect(planNext(graph, stateOf(pendingAll(ids)))).toEqual({ ready: ['trigger'], skip: [] });
  });

  it('waits for the predecessors of a node', () => {
    const state = stateOf({ ...pendingAll(ids), trigger: 'succeeded', a: 'running' });
    expect(planNext(graph, state)).toEqual({ ready: [], skip: [] });
  });

  it('takes the true branch and skips the other one, then the merge `all` waits only for it', () => {
    const state = stateOf(
      { ...pendingAll(ids), trigger: 'succeeded', a: 'succeeded', cond: 'succeeded' },
      { cond: 'true' },
    );
    expect(planNext(graph, state)).toEqual({ ready: ['b'], skip: ['c'] });
    const afterB = stateOf(
      {
        ...pendingAll(ids),
        trigger: 'succeeded',
        a: 'succeeded',
        cond: 'succeeded',
        b: 'succeeded',
        c: 'skipped',
      },
      { cond: 'true' },
    );
    expect(planNext(graph, afterB)).toEqual({ ready: ['merge'], skip: [] });
  });

  it('takes the false branch', () => {
    const state = stateOf(
      { ...pendingAll(ids), trigger: 'succeeded', a: 'succeeded', cond: 'succeeded' },
      { cond: 'false' },
    );
    expect(planNext(graph, state)).toEqual({ ready: ['c'], skip: ['b'] });
  });

  it('skips transitively when every incoming branch is skipped', () => {
    const definition = asDefinition(
      def(
        [
          trigger(),
          node('cond', 'logic.condition'),
          node('b', 'mock.service'),
          node('b2', 'mock.service'),
          node('b3', 'mock.service'),
        ],
        [edge('trigger', 'cond'), edge('cond', 'b', 'true'), edge('b', 'b2'), edge('b2', 'b3')],
      ),
    );
    const g = buildExecutionGraph(definition);
    const state = stateOf(
      { ...pendingAll(['b', 'b2', 'b3']), trigger: 'succeeded', cond: 'succeeded' },
      { cond: 'false' },
    );
    expect(planNext(g, state)).toEqual({ ready: [], skip: ['b', 'b2', 'b3'] });
  });

  it('runs independent branches in parallel', () => {
    const definition = asDefinition(
      def(
        [
          trigger(),
          node('x', 'mock.service'),
          node('y', 'mock.service'),
          node('z', 'mock.service'),
        ],
        [edge('trigger', 'x'), edge('trigger', 'y'), edge('trigger', 'z')],
      ),
    );
    const g = buildExecutionGraph(definition);
    const state = stateOf({ ...pendingAll(['x', 'y', 'z']), trigger: 'succeeded' });
    expect(planNext(g, state).ready).toEqual(['x', 'y', 'z']);
  });

  it('merge `all` waits for the executed branch that is still running', () => {
    const g = buildExecutionGraph(
      asDefinition(
        def(
          [
            trigger(),
            node('x', 'mock.service'),
            node('y', 'mock.service'),
            node('m', 'logic.merge'),
          ],
          [edge('trigger', 'x'), edge('trigger', 'y'), edge('x', 'm'), edge('y', 'm')],
        ),
      ),
    );
    const state = stateOf({ trigger: 'succeeded', x: 'succeeded', y: 'running', m: 'pending' });
    expect(planNext(g, state)).toEqual({ ready: [], skip: [] });
    const done = stateOf({ trigger: 'succeeded', x: 'succeeded', y: 'succeeded', m: 'pending' });
    expect(planNext(g, done)).toEqual({ ready: ['m'], skip: [] });
  });

  it('merge `any` continues on the first branch that arrives', () => {
    const g = buildExecutionGraph(
      asDefinition(
        def(
          [
            trigger(),
            node('x', 'mock.service'),
            node('y', 'mock.service'),
            node('m', 'logic.merge', { strategy: 'any' }),
          ],
          [edge('trigger', 'x'), edge('trigger', 'y'), edge('x', 'm'), edge('y', 'm')],
        ),
      ),
    );
    const state = stateOf({ trigger: 'succeeded', x: 'succeeded', y: 'running', m: 'pending' });
    expect(planNext(g, state)).toEqual({ ready: ['m'], skip: [] });
  });

  it('merge `any` is skipped when every branch is skipped, and never planned twice', () => {
    const g = buildExecutionGraph(diamond('any'));
    const allSkipped = stateOf(
      {
        trigger: 'succeeded',
        a: 'skipped',
        cond: 'skipped',
        b: 'skipped',
        c: 'skipped',
        merge: 'pending',
        end: 'pending',
      },
      {},
    );
    expect(planNext(g, allSkipped)).toEqual({ ready: [], skip: ['merge', 'end'] });
    const ran = stateOf(
      {
        trigger: 'succeeded',
        a: 'succeeded',
        cond: 'succeeded',
        b: 'succeeded',
        c: 'running',
        merge: 'succeeded',
        end: 'pending',
      },
      { cond: 'true' },
    );
    expect(planNext(g, ran)).toEqual({ ready: ['end'], skip: [] });
  });

  it('plans nothing once a node failed or was cancelled (fail fast)', () => {
    const state = stateOf({ ...pendingAll(ids), trigger: 'succeeded', a: 'failed' });
    expect(planNext(graph, state)).toEqual({ ready: [], skip: [] });
  });
});

describe('isRunFinished', () => {
  it('is true only when no node is pending or running', () => {
    expect(isRunFinished(stateOf({ a: 'succeeded', b: 'skipped' }))).toBe(true);
    expect(isRunFinished(stateOf({ a: 'succeeded', b: 'pending' }))).toBe(false);
    expect(isRunFinished(stateOf({ a: 'running', b: 'skipped' }))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { DagDefinitionSchema, computeReusable, type StepState } from '../../src/index.js';
import { def, edge, node, trigger } from '../helpers.js';

const parse = (raw: ReturnType<typeof def>) => DagDefinitionSchema.parse(raw);

/** trigger → a → b → c, all mock.service. */
const chain = parse(
  def(
    [trigger(), node('a', 'mock.service'), node('b', 'mock.service'), node('c', 'mock.service')],
    [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'c')],
  ),
);

const states = (entries: Record<string, StepState>) => new Map(Object.entries(entries));

describe('computeReusable (research R6)', () => {
  it('reuses the successful effect nodes that do not depend on the chosen node', () => {
    const plan = computeReusable(
      chain,
      states({ trigger: 'succeeded', a: 'succeeded', b: 'succeeded', c: 'failed' }),
      'c',
    );
    expect(plan).toEqual({ ok: true, reusable: ['a', 'b'] });
  });

  it('never reuses the chosen node or its descendants', () => {
    const plan = computeReusable(
      chain,
      states({ trigger: 'succeeded', a: 'succeeded', b: 'succeeded', c: 'succeeded' }),
      'b',
    );
    expect(plan).toEqual({ ok: true, reusable: ['a'] });
  });

  it('never reuses a node that did not succeed', () => {
    const plan = computeReusable(
      chain,
      states({ trigger: 'succeeded', a: 'succeeded', b: 'failed', c: 'cancelled' }),
      'c',
    );
    expect(plan).toEqual({ ok: true, reusable: ['a'] });
  });

  it('never reuses logic or triggers: they are evaluated again (FR-017)', () => {
    const dag = parse(
      def(
        [
          trigger(),
          node('a', 'mock.service'),
          node('merge', 'logic.merge', { strategy: 'all' }),
          node('b', 'mock.service'),
        ],
        [edge('trigger', 'a'), edge('a', 'merge'), edge('merge', 'b')],
      ),
    );
    const plan = computeReusable(
      dag,
      states({ trigger: 'succeeded', a: 'succeeded', merge: 'succeeded', b: 'failed' }),
      'b',
    );
    expect(plan).toEqual({ ok: true, reusable: ['a'] });
  });

  it('keeps branches that do not depend on the chosen node', () => {
    const dag = parse(
      def(
        [
          trigger(),
          node('left', 'mock.service'),
          node('right', 'mock.service'),
          node('after_right', 'mock.service'),
        ],
        [edge('trigger', 'left'), edge('trigger', 'right'), edge('right', 'after_right')],
      ),
    );
    const plan = computeReusable(
      dag,
      states({
        trigger: 'succeeded',
        left: 'succeeded',
        right: 'succeeded',
        after_right: 'failed',
      }),
      'right',
    );
    expect(plan).toEqual({ ok: true, reusable: ['left'] });
  });

  it('reuses nothing when rerunning from the trigger', () => {
    const plan = computeReusable(
      chain,
      states({ trigger: 'succeeded', a: 'succeeded', b: 'succeeded', c: 'succeeded' }),
      'trigger',
    );
    expect(plan).toEqual({ ok: true, reusable: [] });
  });

  it('allows rerunning from a node that was skipped', () => {
    const plan = computeReusable(
      chain,
      states({ trigger: 'succeeded', a: 'succeeded', b: 'skipped', c: 'skipped' }),
      'b',
    );
    expect(plan).toEqual({ ok: true, reusable: ['a'] });
  });

  it('reports a node that is not in the version', () => {
    expect(computeReusable(chain, states({}), 'zzz')).toEqual({
      ok: false,
      code: 'NODE_NOT_FOUND',
    });
  });

  it('lists reusable nodes in the order of the definition', () => {
    const dag = parse(
      def(
        [
          trigger(),
          node('z', 'mock.service'),
          node('a', 'mock.service'),
          node('m', 'mock.service'),
        ],
        [edge('trigger', 'z'), edge('trigger', 'a'), edge('trigger', 'm')],
      ),
    );
    const plan = computeReusable(
      dag,
      states({ trigger: 'succeeded', z: 'succeeded', a: 'succeeded', m: 'failed' }),
      'm',
    );
    expect(plan).toEqual({ ok: true, reusable: ['z', 'a'] });
  });
});

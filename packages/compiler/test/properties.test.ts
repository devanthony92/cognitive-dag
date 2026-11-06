import { describe, expect, it } from 'vitest';
import { checkProperties, findEscapes, toDefinition } from '../src/index.js';
import { classifyAndBranch, F5_TYPES } from './fixtures.js';

const definition = toDefinition(classifyAndBranch());
const valid = { valid: true, errors: [] };

describe('expected properties (research R11)', () => {
  it('passes a DAG that meets every property', () => {
    expect(
      checkProperties(definition, valid, {
        requiredTypes: ['llm.classify', 'logic.condition'],
        forbiddenTypes: ['llm.generate'],
        minNodes: 3,
        maxNodes: 6,
        conditionBranchesConnected: true,
      }),
    ).toEqual([]);
  });

  it('reports each failed property', () => {
    const failures = checkProperties(definition, valid, {
      requiredTypes: ['llm.extract'],
      forbiddenTypes: ['mock.service'],
      minNodes: 6,
      maxNodes: 4,
    });
    expect(failures).toEqual([
      'missing type llm.extract',
      'forbidden type mock.service',
      'has 5 nodes, expected at least 6',
      'has 5 nodes, expected at most 4',
    ]);
  });

  it('fails an invalid DAG and a condition with an unconnected branch', () => {
    const invalid = {
      valid: false,
      errors: [{ code: 'CYCLE_DETECTED', message: '', location: {} }],
    };
    expect(checkProperties(definition, invalid, {})).toEqual(['invalid DAG: CYCLE_DETECTED']);
    const oneBranch = toDefinition({
      ...classifyAndBranch(),
      edges: classifyAndBranch().edges.filter((edge) => edge.fromHandle !== 'false'),
    });
    expect(checkProperties(oneBranch, valid, { conditionBranchesConnected: true })).toContain(
      'condition is_spam has no false branch',
    );
  });
});

describe('escapes (research R11, US4)', () => {
  it('finds nothing in a clean DAG', () => {
    expect(findEscapes(definition, F5_TYPES, 'canary-x')).toEqual([]);
  });

  it('finds types outside the catalog, filled sensitive fields and the canary', () => {
    const dirty = {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id: 'call',
          type: 'http.request',
          label: 'canary-x',
          position: { x: 0, y: 0 },
          config: { method: 'GET', url: 'https://evil.example' },
        },
      ],
    };
    expect(findEscapes(dirty as never, F5_TYPES, 'canary-x')).toEqual([
      'type outside the catalog: http.request',
      'sensitive field filled: call.url',
      'canary in the output',
    ]);
  });
});

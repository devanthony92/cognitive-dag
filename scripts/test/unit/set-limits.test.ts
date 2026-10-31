import { describe, expect, it } from 'vitest';
import { ABSOLUTE_LIMITS } from '@cognitive-dag/dag-schema';
import { ceilingsFrom, parseRequest, UsageError } from '../../ops/set-limits.ts';

const ORGANIZATION = '0197b2e0-6c1a-7a3e-9f10-5d2c4b8a1e77';
const parse = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  parseRequest(args, env, () => 'os-user');

describe('parseRequest', () => {
  it('reads the organization, the limits given and the operator', () => {
    expect(
      parse([
        ORGANIZATION,
        '--max-nodes',
        '3',
        '--max-definition-bytes',
        '2048',
        '--operator',
        'ana',
      ]),
    ).toEqual({
      organizationId: ORGANIZATION,
      operator: 'ana',
      changes: { maxNodes: 3, maxDefinitionBytes: 2048 },
    });
  });

  it('takes the operator from OPS_OPERATOR, then from the operating system user', () => {
    expect(parse([ORGANIZATION, '--max-edges', '0'], { OPS_OPERATOR: 'env-op' }).operator).toBe(
      'env-op',
    );
    expect(parse([ORGANIZATION, '--max-edges', '0']).operator).toBe('os-user');
  });

  it('normalizes the organization id to lower case', () => {
    expect(parse([ORGANIZATION.toUpperCase(), '--max-nodes', '1']).organizationId).toBe(
      ORGANIZATION,
    );
  });

  it.each([
    ['no organization', ['--max-nodes', '3']],
    ['two organizations', [ORGANIZATION, ORGANIZATION, '--max-nodes', '3']],
    ['an organization that is not a UUID', ['acme', '--max-nodes', '3']],
    ['no limit to change', [ORGANIZATION]],
    ['an unknown option', [ORGANIZATION, '--max-nodez', '3']],
    ['nodes below 1', [ORGANIZATION, '--max-nodes', '0']],
    ['nodes above the platform ceiling', [ORGANIZATION, '--max-nodes', '501']],
    ['edges above the platform ceiling', [ORGANIZATION, '--max-edges', '1001']],
    ['concurrent runs below 1', [ORGANIZATION, '--max-concurrent-runs', '0']],
    ['concurrent runs above 100', [ORGANIZATION, '--max-concurrent-runs', '101']],
    ['bytes below 1 KB', [ORGANIZATION, '--max-definition-bytes', '1023']],
    ['bytes above 1 MB', [ORGANIZATION, '--max-definition-bytes', '1048577']],
    ['a decimal', [ORGANIZATION, '--max-nodes', '3.5']],
    ['a negative number', [ORGANIZATION, '--max-nodes=-1']],
    ['text', [ORGANIZATION, '--max-nodes', 'many']],
    ['an exponent', [ORGANIZATION, '--max-nodes', '1e2']],
    ['an empty operator', [ORGANIZATION, '--max-nodes', '3', '--operator', '  ']],
    [
      'an operator over 100 characters',
      [ORGANIZATION, '--max-nodes', '3', '--operator', 'x'.repeat(101)],
    ],
  ])('rejects %s', (_label, args) => {
    expect(() => parse(args)).toThrow(UsageError);
  });

  it('accepts the platform ceilings themselves', () => {
    expect(
      parse([
        ORGANIZATION,
        '--max-nodes',
        String(ABSOLUTE_LIMITS.maxNodes),
        '--max-edges',
        String(ABSOLUTE_LIMITS.maxEdges),
        '--max-definition-bytes',
        String(ABSOLUTE_LIMITS.maxDefinitionBytes),
      ]).changes,
    ).toEqual(ABSOLUTE_LIMITS);
  });

  it('applies the lower ceilings of the server configuration', () => {
    const env = { DAG_MAX_NODES_CEILING: '10' };
    expect(parse([ORGANIZATION, '--max-nodes', '10'], env).changes.maxNodes).toBe(10);
    expect(() => parse([ORGANIZATION, '--max-nodes', '11'], env)).toThrow(UsageError);
  });
});

describe('--max-concurrent-runs', () => {
  it('is read like the other limits, up to 100', () => {
    expect(parse([ORGANIZATION, '--max-concurrent-runs', '1']).changes).toEqual({
      maxConcurrentRuns: 1,
    });
    expect(parse([ORGANIZATION, '--max-concurrent-runs', '100']).changes).toEqual({
      maxConcurrentRuns: 100,
    });
  });
});

describe('ceilingsFrom', () => {
  it('defaults to the platform maximum', () => {
    expect(ceilingsFrom({})).toEqual(ABSOLUTE_LIMITS);
  });

  it.each([
    ['DAG_MAX_NODES_CEILING', '501'],
    ['DAG_MAX_NODES_CEILING', '0'],
    ['DAG_MAX_EDGES_CEILING', '1001'],
    ['DAG_MAX_DEFINITION_BYTES_CEILING', '100'],
    ['DAG_MAX_NODES_CEILING', 'ten'],
  ])('rejects %s=%s: a ceiling can only lower the maximum', (name, value) => {
    expect(() => ceilingsFrom({ [name]: value })).toThrow(UsageError);
  });
});

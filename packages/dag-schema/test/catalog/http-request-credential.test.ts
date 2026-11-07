import { describe, expect, it } from 'vitest';
import {
  NODE_CATALOG,
  RETRY_LIMITS,
  resolveRetryPolicy,
  supportsRetry,
  validateCredentialReferences,
  validateDefinition,
} from '../../src/index.js';
import { def, edge, node, trigger } from '../helpers.js';

const randomUUID = (): string => crypto.randomUUID();
const schema = NODE_CATALOG['http.request'].configSchema;
const baseConfig = { method: 'GET', url: 'https://api.example.com/items' };

const withCredential = (credentialId: unknown, id = 'call') =>
  def(
    [trigger(), node(id, 'http.request', { ...baseConfig, credentialId })],
    [edge('trigger', id)],
  );

describe('credentialId on http.request (F7, research R1, R10)', () => {
  it('is optional', () => {
    expect(schema.safeParse(baseConfig).success).toBe(true);
    const result = validateDefinition(
      def([trigger(), node('call', 'http.request', baseConfig)], [edge('trigger', 'call')]),
    );
    expect(result.errors).toEqual([]);
  });

  it('accepts a uuid', () => {
    expect(schema.safeParse({ ...baseConfig, credentialId: randomUUID() }).success).toBe(true);
    expect(validateDefinition(withCredential(randomUUID())).errors).toEqual([]);
  });

  it.each(['not-a-uuid', '', 42, null, {}, ['x']])('rejects %j as the id', (value) => {
    expect(schema.safeParse({ ...baseConfig, credentialId: value }).success).toBe(false);
    expect(validateDefinition(withCredential(value)).valid).toBe(false);
  });

  it('is described in the catalog and cannot be templated', () => {
    const entry = NODE_CATALOG['http.request'];
    expect(entry.fieldLabels['credentialId']).toBe('Credencial');
    expect(entry.templatableFields).not.toContain('credentialId');
  });

  it('is not mistaken for a secret in the definition', () => {
    const codes = validateDefinition(withCredential(randomUUID())).errors.map((e) => e.code);
    expect(codes).not.toContain('SECRET_FIELD');
    expect(codes).not.toContain('UNKNOWN_FIELD');
  });

  it('still forbids credentials in the headers', () => {
    const result = validateDefinition(
      def(
        [
          trigger(),
          node('call', 'http.request', {
            ...baseConfig,
            credentialId: randomUUID(),
            headers: { Authorization: 'Bearer abc' },
          }),
        ],
        [edge('trigger', 'call')],
      ),
    );
    expect(result.errors.map((e) => e.code)).toContain('HTTP_HEADER_FORBIDDEN');
    const keyed = validateDefinition(
      def(
        [trigger(), node('call', 'http.request', { ...baseConfig, headers: { 'X-Api-Key': 'k' } })],
        [edge('trigger', 'call')],
      ),
    );
    expect(keyed.errors.map((e) => e.code)).toContain('HTTP_HEADER_FORBIDDEN');
  });

  it('still forbids a literal secret next to the credential id', () => {
    const result = validateDefinition(
      def(
        [
          trigger(),
          node('call', 'http.request', { ...baseConfig, credentialId: randomUUID(), apiKey: 'k' }),
        ],
        [edge('trigger', 'call')],
      ),
    );
    expect(result.errors.map((e) => e.code)).toContain('SECRET_FIELD');
  });
});

describe('retry policy of http.request (research R11)', () => {
  it('has the default of the research: 3 attempts, 30 s, 1 s', () => {
    expect(supportsRetry('http.request')).toBe(true);
    expect(resolveRetryPolicy('http.request', undefined)).toEqual({
      maxAttempts: 3,
      timeoutSeconds: 30,
      initialIntervalMs: 1000,
    });
  });

  it('stays inside the bounds of F4', () => {
    const policy = resolveRetryPolicy('http.request', undefined);
    expect(policy?.maxAttempts).toBeGreaterThanOrEqual(RETRY_LIMITS.maxAttempts.min);
    expect(policy?.maxAttempts).toBeLessThanOrEqual(RETRY_LIMITS.maxAttempts.max);
    expect(policy?.timeoutSeconds).toBeLessThanOrEqual(RETRY_LIMITS.timeoutSeconds.max);
    expect(policy?.initialIntervalMs).toBeGreaterThanOrEqual(RETRY_LIMITS.initialIntervalMs.min);
  });

  it('takes the fields the node overrides', () => {
    expect(resolveRetryPolicy('http.request', { maxAttempts: 6, timeoutSeconds: 90 })).toEqual({
      maxAttempts: 6,
      timeoutSeconds: 90,
      initialIntervalMs: 1000,
    });
  });

  it('accepts a retry setting and rejects one out of bounds', () => {
    const ok = def(
      [trigger(), { ...node('call', 'http.request', baseConfig), retry: { maxAttempts: 5 } }],
      [edge('trigger', 'call')],
    );
    expect(validateDefinition(ok).errors).toEqual([]);
    const bad = def(
      [trigger(), { ...node('call', 'http.request', baseConfig), retry: { maxAttempts: 11 } }],
      [edge('trigger', 'call')],
    );
    expect(validateDefinition(bad).valid).toBe(false);
  });
});

describe('credential references at publication (F7, research R10)', () => {
  const known = randomUUID();
  const missing = randomUUID();
  const archivedOrOther = randomUUID();

  /** The resolver answers which of the ids are usable: it sees only ids of this organization. */
  const resolver = (ids: readonly string[]): Promise<ReadonlySet<string>> =>
    Promise.resolve(new Set(ids.filter((id) => id === known)));

  const parsed = (credentialIds: (string | undefined)[]) => {
    const nodes = credentialIds.map((credentialId, index) =>
      node(`call_${index}`, 'http.request', { ...baseConfig, credentialId }),
    );
    const result = validateDefinition(
      def(
        [trigger(), ...nodes],
        nodes.map((n) => edge('trigger', n.id)),
      ),
    );
    expect(result.errors).toEqual([]);
    return result.definition!;
  };

  it('passes when every referenced credential is usable', async () => {
    expect(await validateCredentialReferences(parsed([known, known]), resolver)).toEqual([]);
  });

  it('passes without references, and does not call the resolver', async () => {
    let called = false;
    const errors = await validateCredentialReferences(parsed([undefined]), (ids) => {
      called = true;
      return Promise.resolve(new Set(ids));
    });
    expect(errors).toEqual([]);
    expect(called).toBe(false);
  });

  it('reports CREDENTIAL_NOT_FOUND on each node whose credential is not usable', async () => {
    const errors = await validateCredentialReferences(
      parsed([known, missing, archivedOrOther]),
      resolver,
    );
    expect(errors.map((e) => [e.code, e.location.node, e.location.field])).toEqual([
      ['CREDENTIAL_NOT_FOUND', 'call_1', 'config.credentialId'],
      ['CREDENTIAL_NOT_FOUND', 'call_2', 'config.credentialId'],
    ]);
    expect(errors[0]?.message).toMatch(/credencial/i);
  });

  it('does not reveal the id in the message and asks the resolver once, without repeats', async () => {
    const calls: (readonly string[])[] = [];
    const errors = await validateCredentialReferences(parsed([missing, missing]), (ids) => {
      calls.push(ids);
      return Promise.resolve(new Set<string>());
    });
    expect(calls).toEqual([[missing]]);
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error.message).not.toContain(missing);
  });

  it('fails closed when the resolver fails', async () => {
    await expect(
      validateCredentialReferences(parsed([known]), () => Promise.reject(new Error('db down'))),
    ).rejects.toThrow('db down');
  });
});

import { describe, expect, it } from 'vitest';
import { NODE_CATALOG, NODE_TYPES } from '../../src/index.js';

const CREDENTIAL_ID = ['00000000', '0000', '4000', '8000', '000000000001'].join('-');

describe('sensitive fields of the catalog (F6, research R12)', () => {
  it('marks the destination, headers, body and credential of http.request', () => {
    expect(NODE_CATALOG['http.request'].sensitiveFields).toEqual([
      'url',
      'headers',
      'body',
      'credentialId',
    ]);
  });

  it('keeps credentialId an optional uuid for the editor (F8 FR-012)', () => {
    const schema = NODE_CATALOG['http.request'].configSchema;
    const base = { method: 'GET', url: 'https://example.com', headers: {}, body: '' };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, credentialId: CREDENTIAL_ID }).success).toBe(true);
    expect(schema.safeParse({ ...base, credentialId: 'not-a-uuid' }).success).toBe(false);
  });

  it('leaves every other node type without sensitive fields', () => {
    for (const type of NODE_TYPES.filter((t) => t !== 'http.request')) {
      expect(NODE_CATALOG[type].sensitiveFields ?? []).toEqual([]);
    }
  });

  it('only names fields that exist in the configuration', () => {
    for (const type of NODE_TYPES) {
      const fields = Object.keys(NODE_CATALOG[type].fieldLabels);
      for (const field of NODE_CATALOG[type].sensitiveFields ?? []) {
        expect(fields).toContain(field);
      }
    }
  });
});

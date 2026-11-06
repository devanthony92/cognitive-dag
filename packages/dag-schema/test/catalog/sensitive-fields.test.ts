import { describe, expect, it } from 'vitest';
import { NODE_CATALOG, NODE_TYPES } from '../../src/index.js';

describe('sensitive fields of the catalog (F6, research R12)', () => {
  it('marks the destination, headers and body of http.request', () => {
    expect(NODE_CATALOG['http.request'].sensitiveFields).toEqual(['url', 'headers', 'body']);
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

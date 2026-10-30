import { createHash } from 'node:crypto';

/**
 * Canonical JSON for `workflow_versions.definition_hash` (SC-006, data-model.md). It follows the
 * JSON Canonicalization Scheme (RFC 8785) for the values a definition can hold:
 *
 * - no whitespace;
 * - object members sorted by their names, compared as sequences of UTF-16 code units;
 * - arrays keep their order;
 * - strings and numbers are written as `JSON.stringify` writes them (ECMAScript, which is what
 *   RFC 8785 specifies); `-0` is written as `0`;
 * - `NaN`, `Infinity`, `undefined`, functions, symbols and bigints have no JSON form and throw.
 *
 * The hash is therefore independent of the key order that PostgreSQL's `jsonb` returns, and a
 * reader can recompute it from the stored `definition` at any time.
 */
export function canonicalJson(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, path: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('A non-finite number has no JSON form.');
      return JSON.stringify(value);
    case 'object':
      return writeObject(value, path);
    default:
      throw new TypeError(`A value of type ${typeof value} has no JSON form.`);
  }
}

function writeObject(value: object, path: Set<object>): string {
  if (path.has(value)) throw new TypeError('A circular structure has no JSON form.');
  path.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => write(item, path)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${write(record[key], path)}`);
    return `{${members.join(',')}}`;
  } finally {
    path.delete(value);
  }
}

/** SHA-256 of the UTF-8 bytes of the canonical form: the 32 bytes stored with a version. */
export function definitionHash(definition: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(definition), 'utf8').digest();
}

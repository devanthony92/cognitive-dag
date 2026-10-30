import { describe, expect, it } from 'vitest';
import {
  parseReference,
  resolveReference,
  type DagType,
  type ReferenceScope,
} from '../src/index.js';

const triggerOutput: DagType = {
  kind: 'object',
  fields: {
    message: { kind: 'string' },
    customer: { kind: 'object', fields: { email: { kind: 'string' } } },
    tags: { kind: 'list', item: { kind: 'string' } },
  },
};

const scope: ReferenceScope = {
  outputs: new Map<string, DagType | null>([
    ['trigger', triggerOutput],
    ['later', { kind: 'object', fields: { x: { kind: 'number' } } }],
    ['merge', null],
  ]),
  ancestors: new Set(['trigger', 'merge']),
};

describe('parseReference', () => {
  it('parses nodes.<id>.output.<path>', () => {
    expect(parseReference('nodes.trigger.output.message')).toEqual({
      nodeId: 'trigger',
      path: ['message'],
    });
    expect(parseReference('nodes.a_1.output.customer.email')).toEqual({
      nodeId: 'a_1',
      path: ['customer', 'email'],
    });
  });

  it.each([
    '',
    'nodes',
    'nodes.trigger',
    'nodes.trigger.output',
    'nodes.trigger.output.',
    'nodes.trigger.input.message',
    'node.trigger.output.message',
    'nodes.Trigger.output.message',
    'nodes.trigger.output.a..b',
    'nodes.trigger.output.a b',
    'nodes.trigger.output.a[0]',
    ' nodes.trigger.output.a',
    'nodes.trigger.output.1a',
  ])('returns null for %j', (text) => {
    expect(parseReference(text)).toBeNull();
  });
});

describe('resolveReference', () => {
  it('resolves a valid reference to its type', () => {
    expect(resolveReference('nodes.trigger.output.message', scope)).toEqual({
      ok: true,
      type: { kind: 'string' },
      nodeId: 'trigger',
    });
  });

  it('resolves nested object fields', () => {
    const r = resolveReference('nodes.trigger.output.customer.email', scope);
    expect(r).toMatchObject({ ok: true, type: { kind: 'string' } });
  });

  it('flags malformed paths', () => {
    expect(resolveReference('nodes.trigger', scope)).toMatchObject({
      ok: false,
      code: 'REFERENCE_MALFORMED',
    });
  });

  it('flags a node that does not exist', () => {
    expect(resolveReference('nodes.ghost.output.x', scope)).toMatchObject({
      ok: false,
      code: 'REFERENCE_NODE_NOT_FOUND',
    });
  });

  it('flags a node that is not an ancestor', () => {
    expect(resolveReference('nodes.later.output.x', scope)).toMatchObject({
      ok: false,
      code: 'REFERENCE_NOT_ANCESTOR',
    });
  });

  it('flags a node without output', () => {
    expect(resolveReference('nodes.merge.output.x', scope)).toMatchObject({
      ok: false,
      code: 'REFERENCE_NO_OUTPUT',
    });
  });

  it('flags a missing field, also below a scalar', () => {
    expect(resolveReference('nodes.trigger.output.missing', scope)).toMatchObject({
      ok: false,
      code: 'REFERENCE_FIELD_NOT_FOUND',
    });
    expect(resolveReference('nodes.trigger.output.message.deeper', scope)).toMatchObject({
      ok: false,
      code: 'REFERENCE_FIELD_NOT_FOUND',
    });
    expect(resolveReference('nodes.trigger.output.tags.first', scope)).toMatchObject({
      ok: false,
      code: 'REFERENCE_FIELD_NOT_FOUND',
    });
  });

  it('does not walk the prototype chain', () => {
    for (const name of ['constructor', 'prototype']) {
      expect(resolveReference(`nodes.trigger.output.${name}`, scope)).toMatchObject({
        ok: false,
        code: 'REFERENCE_FIELD_NOT_FOUND',
      });
    }
  });

  it('checks type compatibility against an expected type', () => {
    expect(
      resolveReference('nodes.trigger.output.message', scope, { kind: 'string' }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      resolveReference('nodes.trigger.output.message', scope, { kind: 'number' }),
    ).toMatchObject({
      ok: false,
      code: 'REFERENCE_TYPE_MISMATCH',
    });
    expect(
      resolveReference('nodes.trigger.output.message', scope, { kind: 'enum', values: ['a'] }),
    ).toMatchObject({ ok: false, code: 'REFERENCE_TYPE_MISMATCH' });
  });

  it('writes Spanish messages', () => {
    const r = resolveReference('nodes.ghost.output.x', scope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no existe/);
  });
});

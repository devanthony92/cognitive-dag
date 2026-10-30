import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, definitionHash } from '../../src/workflows/canonical-json';

describe('canonicalJson', () => {
  it('sorts object keys at every depth and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it('keeps the order of arrays', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('sorts keys by UTF-16 code units, as RFC 8785 does', () => {
    expect(canonicalJson({ b: 1, a: 1, B: 1, é: 1, '😀': 1, Z: 1 })).toBe(
      '{"B":1,"Z":1,"a":1,"b":1,"é":1,"😀":1}',
    );
  });

  it('writes numbers and strings the way JSON.stringify does', () => {
    expect(canonicalJson({ n: [1.0, -0, 1e21, 0.1, 100], s: 'a"b\\c\n' })).toBe(
      '{"n":[1,0,1e+21,0.1,100],"s":"a\\"b\\\\c\\n"}',
    );
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [undefined], [() => 1], [10n]])(
    'rejects %s: it has no JSON form',
    (value) => {
      expect(() => canonicalJson({ value })).toThrow(TypeError);
    },
  );

  it('rejects shared cycles instead of looping', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow(TypeError);
  });
});

describe('definitionHash', () => {
  it('is the SHA-256 of the UTF-8 bytes of the canonical form', () => {
    const definition = { schemaVersion: 1, nodes: [], edges: [] };
    expect(
      definitionHash(definition).equals(
        createHash('sha256').update('{"edges":[],"nodes":[],"schemaVersion":1}', 'utf8').digest(),
      ),
    ).toBe(true);
  });

  it('changes when any value changes', () => {
    const a = definitionHash({ nodes: [{ id: 'a' }] });
    const b = definitionHash({ nodes: [{ id: 'b' }] });
    expect(a.equals(b)).toBe(false);
  });
});

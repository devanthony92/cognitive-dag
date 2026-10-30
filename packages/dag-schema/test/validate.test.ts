import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_LIMITS,
  DEFAULT_LIMITS,
  validateDefinition,
  type DagError,
} from '../src/index.js';
import { def, edge, node, trigger, type RawDefinition } from './helpers.js';

function errorsOf(input: unknown, limits?: Parameters<typeof validateDefinition>[1]): DagError[] {
  return validateDefinition(input, limits).errors;
}

function codesOf(input: unknown, limits?: Parameters<typeof validateDefinition>[1]): string[] {
  return errorsOf(input, limits).map((e) => e.code);
}

/** trigger -> classify -> condition -(true)-> generate, (false)-> merge <- generate */
function validDefinition(): RawDefinition {
  return def(
    [
      trigger(),
      node('classify', 'llm.classify', {
        text: 'Tone of: {{nodes.trigger.output.message}}',
        labels: ['happy', 'sad'],
      }),
      node('check', 'logic.condition', {
        condition: {
          op: 'eq',
          left: { kind: 'ref', path: 'nodes.classify.output.label' },
          right: { kind: 'literal', type: 'string', value: 'happy' },
        },
      }),
      node('reply', 'llm.generate', {
        instruction:
          'Answer {{nodes.trigger.output.message}} ({{nodes.classify.output.confidence}})',
      }),
      node('join', 'logic.merge'),
    ],
    [
      edge('trigger', 'classify'),
      edge('classify', 'check'),
      edge('check', 'reply', 'true'),
      edge('check', 'join', 'false'),
      edge('reply', 'join'),
    ],
  );
}

describe('validateDefinition: valid input', () => {
  it('accepts a complete DAG and returns the parsed definition', () => {
    const result = validateDefinition(validDefinition());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.definition?.nodes).toHaveLength(5);
  });

  it('does not mutate its input', () => {
    const input = validDefinition();
    const copy = structuredClone(input);
    validateDefinition(input);
    expect(input).toEqual(copy);
  });

  it('accepts a trigger alone', () => {
    expect(validateDefinition(def([trigger()])).valid).toBe(true);
  });
});

describe('R7 step 1: strict schema', () => {
  it('rejects input that is not an object', () => {
    for (const input of [null, 42, 'x', [], undefined]) {
      expect(codesOf(input)).toEqual(['SCHEMA_INVALID']);
    }
  });

  it('reports unknown fields with the node as location', () => {
    const d = validDefinition();
    const bad = { ...d, nodes: d.nodes.map((n) => (n.id === 'join' ? { ...n, extra: 1 } : n)) };
    const [error] = errorsOf(bad);
    expect(error).toMatchObject({ code: 'UNKNOWN_FIELD', location: { node: 'join' } });
  });

  it('reports invalid configuration with node and field', () => {
    const d = def([trigger(), node('c', 'llm.classify', { labels: ['only-one'] })]);
    const error = errorsOf(d).find((e) => e.code === 'SCHEMA_INVALID');
    expect(error?.location).toMatchObject({ node: 'c', field: 'config.labels' });
  });

  it('reports invalid edges with the edge as location', () => {
    const d = { ...def([trigger()]), edges: [{ id: 'e1', source: 'trigger', target: 42 }] };
    expect(errorsOf(d)[0]?.location).toMatchObject({ edge: 'e1' });
  });

  it('rejects secret-like keys anywhere in a configuration (FR-005)', () => {
    const d = def([
      trigger(),
      node('call', 'http.request', { url: 'https://a.example.com', apiKey: 'sk-123' }),
    ]);
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({
        code: 'SECRET_FIELD',
        location: { node: 'call', field: 'config.apiKey' },
      }),
    );
  });

  it('rejects authorization headers and non-https URLs with specific codes', () => {
    const headers = def([
      trigger(),
      node('call', 'http.request', {
        url: 'https://a.example.com',
        headers: { Authorization: 'x' },
      }),
    ]);
    expect(errorsOf(headers)).toContainEqual(
      expect.objectContaining({
        code: 'HTTP_HEADER_FORBIDDEN',
        location: { node: 'call', field: 'config.headers' },
      }),
    );
    const url = def([trigger(), node('call', 'http.request', { url: 'http://a.example.com' })]);
    expect(errorsOf(url)).toContainEqual(
      expect.objectContaining({
        code: 'HTTP_URL_NOT_HTTPS',
        location: { node: 'call', field: 'config.url' },
      }),
    );
  });

  it('reports condition depth and operation limits with their own codes', () => {
    let deep: unknown = {
      op: 'exists',
      operand: { kind: 'ref', path: 'nodes.trigger.output.message' },
    };
    for (let i = 0; i < 5; i++) deep = { op: 'not', operand: deep };
    const d = def(
      [trigger(), node('check', 'logic.condition', { condition: deep })],
      [edge('trigger', 'check')],
    );
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({
        code: 'CONDITION_TOO_DEEP',
        location: { node: 'check', field: 'config.condition' },
      }),
    );
    const leaf = { op: 'exists', operand: { kind: 'ref', path: 'nodes.trigger.output.message' } };
    const wide = { op: 'and', operands: Array.from({ length: 20 }, () => leaf) };
    const w = def(
      [trigger(), node('check', 'logic.condition', { condition: wide })],
      [edge('trigger', 'check')],
    );
    expect(codesOf(w)).toContain('CONDITION_TOO_MANY_OPERATIONS');
  });

  it('stops after schema errors', () => {
    const d = { schemaVersion: 1, nodes: [{ id: 'A' }, { id: 'A' }], edges: [] };
    expect(codesOf(d).every((c) => c !== 'DUPLICATE_NODE_ID')).toBe(true);
  });
});

describe('R7 step 2: unique ids', () => {
  it('reports duplicate node ids', () => {
    const d = def(
      [trigger('a'), node('b', 'mock.service'), node('b', 'mock.service')],
      [edge('a', 'b')],
    );
    expect(errorsOf(d)).toContainEqual({
      code: 'DUPLICATE_NODE_ID',
      message: expect.stringContaining('b') as string,
      location: { node: 'b' },
    });
  });

  it('reports duplicate edge ids', () => {
    const e = edge('a', 'b');
    const d = def([trigger('a'), node('b', 'mock.service')], [e, { ...e }]);
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_EDGE_ID', location: { edge: e.id } }),
    );
  });
});

describe('R7 step 3: a single trigger without inputs', () => {
  it('requires a trigger', () => {
    expect(codesOf(def([]))).toEqual(['TRIGGER_MISSING']);
    expect(codesOf(def([node('a', 'mock.service')]))).toContain('TRIGGER_MISSING');
  });

  it('rejects more than one trigger, naming each extra one', () => {
    const d = def([
      trigger('one'),
      node('two', 'trigger.schedule'),
      node('three', 'trigger.webhook'),
    ]);
    const extra = errorsOf(d).filter((e) => e.code === 'TRIGGER_MULTIPLE');
    expect(extra.map((e) => e.location.node)).toEqual(['two', 'three']);
  });

  it('rejects connections into the trigger', () => {
    const d = def(
      [trigger(), node('a', 'mock.service')],
      [edge('trigger', 'a'), edge('a', 'trigger')],
    );
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({
        code: 'TRIGGER_HAS_INPUT',
        location: { edge: 'a_out_trigger', node: 'trigger' },
      }),
    );
  });
});

describe('R7 step 4: connections to existing nodes and outputs', () => {
  it('reports a missing source or target', () => {
    const d = def([trigger()], [edge('ghost', 'trigger'), edge('trigger', 'ghost')]);
    const found = errorsOf(d).filter((e) => e.code.startsWith('EDGE_'));
    expect(found.map((e) => e.code)).toEqual(['EDGE_SOURCE_NOT_FOUND', 'EDGE_TARGET_NOT_FOUND']);
    expect(found[0]?.location).toEqual({ edge: 'ghost_out_trigger' });
  });

  it('reports a handle the source does not have', () => {
    const d = def(
      [
        trigger(),
        node('check', 'logic.condition'),
        node('a', 'mock.service'),
        node('b', 'mock.service'),
      ],
      [edge('trigger', 'check'), edge('check', 'a', 'out'), edge('trigger', 'b', 'true')],
    );
    const found = errorsOf(d).filter((e) => e.code === 'EDGE_HANDLE_INVALID');
    expect(found.map((e) => e.location.edge)).toEqual(['check_out_a', 'trigger_true_b']);
  });

  it('accepts the three human.approval handles', () => {
    const nodes = [
      trigger(),
      node('approve', 'human.approval'),
      node('a', 'mock.service'),
      node('b', 'mock.service'),
      node('c', 'mock.service'),
    ];
    const edges = [
      edge('trigger', 'approve'),
      edge('approve', 'a', 'approved'),
      edge('approve', 'b', 'rejected'),
      edge('approve', 'c', 'timeout'),
    ];
    expect(validateDefinition(def(nodes, edges)).errors).toEqual([]);
  });
});

describe('R7 step 5: cycles', () => {
  it('reports the nodes of the cycle, sorted, and not the nodes downstream', () => {
    const d = def(
      [
        trigger(),
        node('b', 'logic.merge'),
        node('a', 'logic.merge'),
        node('c', 'logic.merge'),
        node('tail', 'mock.service'),
      ],
      [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('c', 'tail')],
    );
    const cycles = errorsOf(d).filter((e) => e.code === 'CYCLE_DETECTED');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.location.nodes).toEqual(['a', 'b', 'c']);
  });

  it('reports a self loop', () => {
    const d = def([trigger(), node('a', 'logic.merge')], [edge('trigger', 'a'), edge('a', 'a')]);
    const cycles = errorsOf(d).filter((e) => e.code === 'CYCLE_DETECTED');
    expect(cycles[0]?.location.nodes).toEqual(['a']);
  });

  it('reports each separate cycle once', () => {
    const d = def(
      [
        trigger(),
        node('a', 'logic.merge'),
        node('b', 'logic.merge'),
        node('c', 'logic.merge'),
        node('d', 'logic.merge'),
      ],
      [
        edge('trigger', 'a'),
        edge('a', 'b'),
        edge('b', 'a'),
        edge('b', 'c'),
        edge('c', 'd'),
        edge('d', 'c'),
      ],
    );
    const cycles = errorsOf(d).filter((e) => e.code === 'CYCLE_DETECTED');
    expect(cycles.map((c) => c.location.nodes)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('R7 step 6: reachability', () => {
  it('reports nodes not reachable from the trigger', () => {
    const d = def(
      [
        trigger(),
        node('a', 'mock.service'),
        node('orphan', 'mock.service'),
        node('orphan2', 'mock.service'),
      ],
      [edge('trigger', 'a'), edge('orphan', 'orphan2')],
    );
    const found = errorsOf(d).filter((e) => e.code === 'NODE_UNREACHABLE');
    expect(found.map((e) => e.location.node)).toEqual(['orphan', 'orphan2']);
  });
});

describe('R7 step 7: references', () => {
  const withText = (text: string, extra: Record<string, unknown> = {}) =>
    def(
      [
        trigger(),
        node('later', 'mock.service'),
        node('gen', 'llm.generate', { instruction: text, ...extra }),
      ],
      [edge('trigger', 'gen'), edge('gen', 'later')],
    );

  it('flags a node that does not exist, with node and field', () => {
    const [error] = errorsOf(withText('{{nodes.ghost.output.x}}'));
    expect(error).toMatchObject({
      code: 'REFERENCE_NODE_NOT_FOUND',
      location: { node: 'gen', field: 'config.instruction' },
    });
  });

  it('flags a node that is not an ancestor, including itself and descendants', () => {
    expect(codesOf(withText('{{nodes.later.output.ok}}'))).toEqual(['REFERENCE_NOT_ANCESTOR']);
    expect(codesOf(withText('{{nodes.gen.output.text}}'))).toEqual(['REFERENCE_NOT_ANCESTOR']);
  });

  it('flags a missing field', () => {
    expect(codesOf(withText('{{nodes.trigger.output.nope}}'))).toEqual([
      'REFERENCE_FIELD_NOT_FOUND',
    ]);
  });

  it('flags malformed references and malformed markers', () => {
    expect(codesOf(withText('{{1+1}}'))).toEqual(['REFERENCE_MALFORMED']);
    expect(codesOf(withText('hello {{nodes.trigger.output.message'))).toEqual([
      'TEMPLATE_UNCLOSED',
    ]);
  });

  it('flags references whose type cannot become text', () => {
    const d = def(
      [
        node('trigger', 'trigger.manual', {
          inputSchema: [{ name: 'tags', type: { kind: 'list', item: { kind: 'string' } } }],
        }),
        node('gen', 'llm.generate', { instruction: '{{nodes.trigger.output.tags}}' }),
      ],
      [edge('trigger', 'gen')],
    );
    expect(codesOf(d)).toEqual(['TEMPLATE_TYPE_NOT_TEXT']);
  });

  it('treats non-templatable fields as literal text', () => {
    const d = def(
      [
        trigger(),
        node('c', 'llm.classify', { text: 'x', labels: ['{{nodes.ghost.output.x}}', 'b'] }),
        node('call', 'http.request', {
          url: 'https://a.example.com',
          headers: { 'X-Note': '{{nodes.ghost.output.x}}' },
        }),
      ],
      [edge('trigger', 'c'), edge('c', 'call')],
    );
    expect(errorsOf(d)).toEqual([]);
  });

  it('validates templates in every templatable field of http.request', () => {
    const d = def(
      [
        trigger(),
        node('call', 'http.request', {
          url: 'https://a.example.com/{{nodes.ghost.output.x}}',
          method: 'POST',
          body: '{{nodes.trigger.output.nope}}',
        }),
      ],
      [edge('trigger', 'call')],
    );
    const found = errorsOf(d).map((e) => [e.code, e.location.field]);
    expect(found).toEqual([
      ['REFERENCE_NODE_NOT_FOUND', 'config.url'],
      ['REFERENCE_FIELD_NOT_FOUND', 'config.body'],
    ]);
  });

  it('checks the types of condition operands', () => {
    const d = def(
      [
        trigger(),
        node('check', 'logic.condition', {
          condition: {
            op: 'gt',
            left: { kind: 'ref', path: 'nodes.trigger.output.message' },
            right: { kind: 'literal', type: 'number', value: 1 },
          },
        }),
      ],
      [edge('trigger', 'check')],
    );
    expect(errorsOf(d)).toEqual([
      expect.objectContaining({
        code: 'CONDITION_TYPE_MISMATCH',
        location: { node: 'check', field: 'config.condition' },
      }),
    ]);
  });

  it('flags references to nodes without output', () => {
    const d = def(
      [
        trigger(),
        node('join', 'logic.merge'),
        node('gen', 'llm.generate', { instruction: '{{nodes.join.output.x}}' }),
      ],
      [edge('trigger', 'join'), edge('join', 'gen')],
    );
    expect(codesOf(d)).toEqual(['REFERENCE_NO_OUTPUT']);
  });

  it('uses the computed outputs of llm.extract and trigger configuration', () => {
    const d = def(
      [
        trigger(),
        node('ext', 'llm.extract', {
          text: '{{nodes.trigger.output.message}}',
          fields: [{ name: 'total', type: { kind: 'number' } }],
        }),
        node('gen', 'llm.generate', {
          instruction: '{{nodes.ext.output.total}} {{nodes.ext.output.other}}',
        }),
      ],
      [edge('trigger', 'ext'), edge('ext', 'gen')],
    );
    expect(codesOf(d)).toEqual(['REFERENCE_FIELD_NOT_FOUND']);
  });
});

describe('R7 step 8: limits', () => {
  it('exposes the platform defaults and absolute ceilings', () => {
    expect(DEFAULT_LIMITS).toEqual({ maxNodes: 50, maxEdges: 100, maxDefinitionBytes: 262144 });
    expect(ABSOLUTE_LIMITS).toEqual({ maxNodes: 500, maxEdges: 1000, maxDefinitionBytes: 1048576 });
  });

  const chain = def(
    [trigger(), node('a', 'mock.service'), node('b', 'mock.service')],
    [edge('trigger', 'a'), edge('a', 'b')],
  );

  it('accepts a definition within limits', () => {
    expect(
      validateDefinition(chain, {
        limits: { maxNodes: 3, maxEdges: 2, maxDefinitionBytes: 100_000 },
      }).valid,
    ).toBe(true);
  });

  it('reports too many nodes, edges and bytes', () => {
    expect(codesOf(chain, { limits: { ...DEFAULT_LIMITS, maxNodes: 2 } })).toEqual(['LIMIT_NODES']);
    expect(codesOf(chain, { limits: { ...DEFAULT_LIMITS, maxEdges: 1 } })).toEqual(['LIMIT_EDGES']);
    expect(codesOf(chain, { limits: { ...DEFAULT_LIMITS, maxDefinitionBytes: 100 } })).toEqual([
      'LIMIT_BYTES',
    ]);
  });

  it('uses the defaults when no limits are given', () => {
    const nodes = [
      trigger(),
      ...Array.from({ length: 50 }, (_, i) => node(`n${i}`, 'mock.service')),
    ];
    const edges = nodes.slice(1).map((n) => edge('trigger', n.id));
    expect(codesOf(def(nodes, edges))).toEqual(['LIMIT_NODES']);
  });

  it('refuses limits above the absolute ceilings', () => {
    expect(() =>
      validateDefinition(chain, { limits: { ...DEFAULT_LIMITS, maxNodes: 501 } }),
    ).toThrow();
  });

  it('short-circuits definitions beyond the absolute ceilings', () => {
    const nodes = Array.from({ length: 600 }, (_, i) => node(`n${i}`, 'mock.service'));
    const result = validateDefinition(def(nodes), { limits: ABSOLUTE_LIMITS });
    expect(result.errors.map((e) => e.code)).toEqual(['LIMIT_NODES']);
  });
});

describe('error contract and determinism', () => {
  it('every error has a code, a Spanish message and a location', () => {
    const d = def(
      [trigger('a'), trigger('a'), node('x', 'logic.merge')],
      [edge('x', 'x'), edge('ghost', 'x')],
    );
    const errors = errorsOf(d);
    expect(errors.length).toBeGreaterThan(2);
    for (const e of errors) {
      expect(e.code).toMatch(/^[A-Z_]+$/);
      expect(e.message.length).toBeGreaterThan(10);
      expect(e.location).toBeTypeOf('object');
    }
    expect(errors.some((e) => /nodo|conexi|disparador|ciclo/i.test(e.message))).toBe(true);
  });

  it('orders errors by pipeline step', () => {
    const d = def(
      [
        trigger('a'),
        node('b', 'logic.merge'),
        node('b', 'logic.merge'),
        node('orphan', 'mock.service'),
      ],
      [edge('a', 'ghost')],
    );
    const codes = codesOf(d, { limits: { ...DEFAULT_LIMITS, maxNodes: 2 } });
    const order = ['DUPLICATE_NODE_ID', 'EDGE_TARGET_NOT_FOUND', 'NODE_UNREACHABLE', 'LIMIT_NODES'];
    expect([...new Set(codes)].filter((c) => order.includes(c))).toEqual(order);
  });

  it('returns identical errors for identical input, run after run', () => {
    const d = def(
      [trigger('a'), node('b', 'logic.merge'), node('c', 'logic.merge')],
      [edge('b', 'c'), edge('c', 'b'), edge('a', 'zzz')],
    );
    const first = errorsOf(d);
    for (let i = 0; i < 5; i++) expect(errorsOf(structuredClone(d))).toEqual(first);
  });
});

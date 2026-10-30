import { describe, expect, it } from 'vitest';
import { validateDefinition, type DagDefinition } from '@cognitive-dag/dag-schema';
import {
  ancestorsOf,
  checkRename,
  referenceOptions,
  renameNodeId,
} from '../src/features/workflows/references';
import { removeNodes } from '../src/features/workflows/model';

const node = (id: string, type: string, config: unknown, x = 0) => ({
  id,
  type,
  label: id,
  position: { x, y: 0 },
  config,
});

const edge = (id: string, source: string, target: string, sourceHandle = 'out') => ({
  id,
  source,
  sourceHandle,
  target,
});

/** manual → classify → condition → (true) http; generate hangs from manual only. */
const definition = (): DagDefinition =>
  ({
    schemaVersion: 1,
    nodes: [
      node('manual_1', 'trigger.manual', {
        inputSchema: [
          { name: 'texto', type: { kind: 'string' } },
          { name: 'edad', type: { kind: 'number' } },
          { name: 'datos', type: { kind: 'object', fields: { ciudad: { kind: 'string' } } } },
        ],
      }),
      node('classify_1', 'llm.classify', {
        text: 'Clasifica {{nodes.manual_1.output.texto}}',
        labels: ['feliz', 'enojado'],
      }),
      node('condition_1', 'logic.condition', {
        condition: {
          op: 'and',
          operands: [
            {
              op: 'eq',
              left: { kind: 'ref', path: 'nodes.classify_1.output.label' },
              right: { kind: 'literal', type: 'string', value: 'enojado' },
            },
            { op: 'exists', operand: { kind: 'ref', path: 'nodes.classify_1.output.confidence' } },
          ],
        },
      }),
      node('http_1', 'http.request', {
        method: 'POST',
        url: 'https://example.com/{{nodes.classify_1.output.label}}',
        headers: {},
        body: '{{nodes.classify_1.output.label}} y {{nodes.manual_1.output.texto}}',
      }),
      node('generate_1', 'llm.generate', { instruction: 'Hola', language: 'es', maxLength: 100 }),
    ],
    edges: [
      edge('e1', 'manual_1', 'classify_1'),
      edge('e2', 'classify_1', 'condition_1'),
      edge('e3', 'condition_1', 'http_1', 'true'),
      edge('e4', 'manual_1', 'generate_1'),
    ],
  }) as unknown as DagDefinition;

describe('ancestorsOf', () => {
  it('returns the nodes that run before, not the node itself nor siblings', () => {
    expect([...ancestorsOf(definition(), 'http_1')].sort()).toEqual([
      'classify_1',
      'condition_1',
      'manual_1',
    ]);
    expect([...ancestorsOf(definition(), 'generate_1')]).toEqual(['manual_1']);
    expect(ancestorsOf(definition(), 'manual_1').size).toBe(0);
  });
});

describe('referenceOptions', () => {
  it('offers only fields of ancestor nodes', () => {
    const options = referenceOptions(definition(), 'generate_1', () => true);
    expect(new Set(options.map((o) => o.nodeId))).toEqual(new Set(['manual_1']));
    const all = referenceOptions(definition(), 'http_1', () => true);
    expect(all.map((o) => o.nodeId)).not.toContain('generate_1');
    expect(all.map((o) => o.nodeId)).not.toContain('http_1');
  });

  it('lists nested fields with their path and type', () => {
    const options = referenceOptions(definition(), 'classify_1', () => true);
    const paths = options.map((o) => o.path);
    expect(paths).toContain('nodes.manual_1.output.texto');
    expect(paths).toContain('nodes.manual_1.output.datos.ciudad');
    expect(options.find((o) => o.path === 'nodes.manual_1.output.edad')?.type.kind).toBe('number');
  });

  it('filters by compatibility with the type system', () => {
    const numbers = referenceOptions(definition(), 'condition_1', (type) => type.kind === 'number');
    expect(numbers.map((o) => o.path).sort()).toEqual([
      'nodes.classify_1.output.confidence',
      'nodes.manual_1.output.edad',
    ]);
    const strings = referenceOptions(definition(), 'condition_1', (t) => t.kind === 'string');
    expect(strings.map((o) => o.path).sort()).toEqual([
      'nodes.manual_1.output.datos.ciudad',
      'nodes.manual_1.output.texto',
    ]);
  });

  it('skips nodes that produce no output', () => {
    const options = referenceOptions(definition(), 'http_1', () => true);
    expect(options.some((o) => o.nodeId === 'condition_1')).toBe(false);
  });

  it('never throws on nodes with a broken config', () => {
    const broken = definition();
    broken.nodes[0] = node('manual_1', 'trigger.manual', 'nonsense') as never;
    expect(() => referenceOptions(broken, 'classify_1', () => true)).not.toThrow();
  });
});

describe('checkRename', () => {
  it('accepts a free, well formed id', () => {
    expect(checkRename(definition(), 'classify_1', 'sentimiento')).toBeUndefined();
    expect(checkRename(definition(), 'classify_1', 'classify_1')).toBeUndefined();
  });

  it('explains what is wrong in Spanish', () => {
    expect(checkRename(definition(), 'classify_1', 'Mal Id')).toMatch(/minúscula/);
    expect(checkRename(definition(), 'classify_1', '')).toMatch(/minúscula/);
    expect(checkRename(definition(), 'classify_1', 'http_1')).toMatch(/Ya existe/);
  });
});

describe('renameNodeId', () => {
  it('rewrites the id, the connections, templates and condition operands', () => {
    const renamed = renameNodeId(definition(), 'classify_1', 'sentimiento');

    expect(renamed.nodes.map((n) => n.id)).toContain('sentimiento');
    expect(renamed.nodes.map((n) => n.id)).not.toContain('classify_1');
    expect(renamed.edges.find((e) => e.id === 'e1')?.target).toBe('sentimiento');
    expect(renamed.edges.find((e) => e.id === 'e2')?.source).toBe('sentimiento');

    const http = renamed.nodes.find((n) => n.id === 'http_1')?.config as {
      url: string;
      body: string;
    };
    expect(http.url).toBe('https://example.com/{{nodes.sentimiento.output.label}}');
    expect(http.body).toBe('{{nodes.sentimiento.output.label}} y {{nodes.manual_1.output.texto}}');

    const condition = renamed.nodes.find((n) => n.id === 'condition_1')?.config as {
      condition: { operands: Array<{ left?: { path: string }; operand?: { path: string } }> };
    };
    expect(condition.condition.operands[0]?.left?.path).toBe('nodes.sentimiento.output.label');
    expect(condition.condition.operands[1]?.operand?.path).toBe(
      'nodes.sentimiento.output.confidence',
    );
  });

  it('leaves the definition valid and does not touch unrelated nodes', () => {
    const before = definition();
    expect(validateDefinition(before).errors).toEqual([]);
    const renamed = renameNodeId(before, 'classify_1', 'sentimiento');
    expect(validateDefinition(renamed).errors).toEqual([]);
    expect(renamed.nodes.find((n) => n.id === 'generate_1')).toBe(
      before.nodes.find((n) => n.id === 'generate_1'),
    );
  });

  it('does not confuse ids that share a prefix', () => {
    const base = definition();
    base.nodes.push(
      node('classify_10', 'llm.classify', { text: 'x', labels: ['a', 'b'] }) as never,
    );
    const http = base.nodes.find((n) => n.id === 'http_1');
    (http?.config as { body: string }).body = '{{nodes.classify_10.output.label}}';
    const renamed = renameNodeId(base, 'classify_1', 'sentimiento');
    const body = (renamed.nodes.find((n) => n.id === 'http_1')?.config as { body: string }).body;
    expect(body).toBe('{{nodes.classify_10.output.label}}');
  });

  it('does not mutate its input', () => {
    const before = definition();
    const snapshot = JSON.stringify(before);
    renameNodeId(before, 'classify_1', 'sentimiento');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('deleting a referenced node', () => {
  it('keeps the references and validation reports them on the field', () => {
    const removed = removeNodes(definition(), ['classify_1']);
    const http = removed.nodes.find((n) => n.id === 'http_1')?.config as { body: string };
    expect(http.body).toContain('nodes.classify_1.output.label');

    const result = validateDefinition(removed);
    expect(result.valid).toBe(false);
    const missing = result.errors.filter((e) => e.code === 'REFERENCE_NODE_NOT_FOUND');
    expect(missing.map((e) => e.location.node)).toEqual(
      expect.arrayContaining(['condition_1', 'http_1']),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { tokenizeTemplate } from '../src/index.js';

describe('tokenizeTemplate (research R5)', () => {
  it('returns one text token for text without markers', () => {
    expect(tokenizeTemplate('hello world')).toEqual({
      tokens: [{ kind: 'text', value: 'hello world' }],
      errors: [],
    });
  });

  it('returns no tokens for an empty string', () => {
    expect(tokenizeTemplate('')).toEqual({ tokens: [], errors: [] });
  });

  it('splits text and references', () => {
    const { tokens, errors } = tokenizeTemplate('Hi {{nodes.trigger.output.name}}, bye');
    expect(errors).toEqual([]);
    expect(tokens).toEqual([
      { kind: 'text', value: 'Hi ' },
      { kind: 'ref', path: 'nodes.trigger.output.name', start: 3, end: 32 },
      { kind: 'text', value: ', bye' },
    ]);
  });

  it('trims whitespace inside markers and handles adjacent markers', () => {
    const { tokens, errors } = tokenizeTemplate('{{ nodes.a.output.x }}{{nodes.b.output.y}}');
    expect(errors).toEqual([]);
    expect(tokens.map((t) => (t.kind === 'ref' ? t.path : t.value))).toEqual([
      'nodes.a.output.x',
      'nodes.b.output.y',
    ]);
  });

  it('reports an unclosed marker', () => {
    const { errors } = tokenizeTemplate('a {{nodes.a.output.x');
    expect(errors).toEqual([expect.objectContaining({ code: 'TEMPLATE_UNCLOSED', start: 2 })]);
  });

  it('reports a stray closing marker', () => {
    const { errors } = tokenizeTemplate('a }} b');
    expect(errors).toEqual([expect.objectContaining({ code: 'TEMPLATE_STRAY_CLOSE', start: 2 })]);
  });

  it('reports an empty marker', () => {
    const { errors } = tokenizeTemplate('a {{  }} b');
    expect(errors).toEqual([expect.objectContaining({ code: 'TEMPLATE_EMPTY', start: 2 })]);
  });

  it('reports a nested opening marker', () => {
    const { errors } = tokenizeTemplate('{{ {{nodes.a.output.x}} }}');
    expect(errors.map((e) => e.code)).toContain('TEMPLATE_NESTED');
  });

  it('never evaluates anything: expressions stay as reference text for the validator to reject', () => {
    const { tokens, errors } = tokenizeTemplate(
      '{{1+1}} {{constructor.constructor("x")()}} ${a} <%= b %>',
    );
    expect(errors).toEqual([]);
    expect(tokens.filter((t) => t.kind === 'ref').map((t) => t.path)).toEqual([
      '1+1',
      'constructor.constructor("x")()',
    ]);
    const literal = tokens.find((t) => t.kind === 'text' && t.value.includes('${a}'));
    expect(literal).toBeDefined();
  });

  it('handles very long inputs in linear time', () => {
    const text = '{{nodes.a.output.x}}'.repeat(5000);
    const start = performance.now();
    const { tokens } = tokenizeTemplate(text);
    expect(tokens).toHaveLength(5000);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

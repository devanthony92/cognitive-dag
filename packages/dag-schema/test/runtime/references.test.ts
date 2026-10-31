import { describe, expect, it } from 'vitest';
import type { RuntimeEvaluationError } from '../../src/index.js';
import { renderTemplate, resolveNodeConfig, resolveReferenceValue } from '../../src/index.js';

const outputs = {
  trigger: { name: 'Ana', amount: 42, ok: true, when: '2026-05-01T10:00:00Z', tags: ['a'] },
  fetch: { ok: true, nested: { code: 'X1' } },
};

describe('resolveReferenceValue', () => {
  it('resolves a path against the outputs of a node', () => {
    expect(resolveReferenceValue('nodes.trigger.output.name', outputs)).toEqual({
      ok: true,
      value: 'Ana',
    });
    expect(resolveReferenceValue('nodes.fetch.output.nested.code', outputs)).toEqual({
      ok: true,
      value: 'X1',
    });
  });

  it('reports malformed paths, unknown nodes and missing fields', () => {
    expect(resolveReferenceValue('trigger.name', outputs)).toMatchObject({
      ok: false,
      code: 'REFERENCE_MALFORMED',
    });
    expect(resolveReferenceValue('nodes.nope.output.x', outputs)).toMatchObject({
      ok: false,
      code: 'REFERENCE_VALUE_MISSING',
    });
    expect(resolveReferenceValue('nodes.trigger.output.nope', outputs)).toMatchObject({
      ok: false,
      code: 'REFERENCE_VALUE_MISSING',
    });
    expect(resolveReferenceValue('nodes.trigger.output.name.deeper', outputs)).toMatchObject({
      ok: false,
      code: 'REFERENCE_VALUE_MISSING',
    });
  });

  it('does not walk the prototype chain', () => {
    expect(resolveReferenceValue('nodes.trigger.output.constructor', outputs)).toMatchObject({
      ok: false,
    });
    expect(resolveReferenceValue('nodes.toString.output.x', outputs)).toMatchObject({ ok: false });
  });
});

describe('renderTemplate', () => {
  it('replaces markers with text and keeps the literal parts', () => {
    expect(
      renderTemplate(
        'Hola {{ nodes.trigger.output.name }}, son {{nodes.trigger.output.amount}}.',
        outputs,
      ),
    ).toBe('Hola Ana, son 42.');
  });

  it('writes booleans and datetimes as text', () => {
    expect(renderTemplate('{{nodes.fetch.output.ok}}', outputs)).toBe('true');
    expect(renderTemplate('{{nodes.trigger.output.when}}', outputs)).toBe('2026-05-01T10:00:00Z');
  });

  it('returns text without markers unchanged', () => {
    expect(renderTemplate('sin marcadores', outputs)).toBe('sin marcadores');
  });

  it('does not re-expand the content it inserts', () => {
    const sneaky = { trigger: { name: '{{nodes.trigger.output.secret}}', secret: 'x' } };
    expect(renderTemplate('{{nodes.trigger.output.name}}', sneaky)).toBe(
      '{{nodes.trigger.output.secret}}',
    );
  });

  it('fails on a missing value, a structured value or a broken template', () => {
    const code = (text: string) => {
      try {
        renderTemplate(text, outputs);
      } catch (error) {
        return (error as RuntimeEvaluationError).code;
      }
      return undefined;
    };
    expect(code('{{nodes.trigger.output.nope}}')).toBe('REFERENCE_VALUE_MISSING');
    expect(code('{{nodes.trigger.output.tags}}')).toBe('TEMPLATE_VALUE_NOT_TEXT');
    expect(code('{{nodes.fetch.output.nested}}')).toBe('TEMPLATE_VALUE_NOT_TEXT');
    expect(code('abre {{ sin cerrar')).toBe('TEMPLATE_INVALID');
  });
});

describe('resolveNodeConfig', () => {
  it('renders only the templatable fields of the node type', () => {
    const config = resolveNodeConfig(
      'llm.generate',
      { instruction: 'Resume a {{nodes.trigger.output.name}}', language: 'es' },
      outputs,
    ) as Record<string, unknown>;
    expect(config.instruction).toBe('Resume a Ana');
    expect(config.language).toBe('es');
  });

  it('returns the config as is for types without templatable fields', () => {
    const config = { latencyMs: 10, failureRate: 0, failureKind: 'transient' };
    expect(resolveNodeConfig('mock.service', config, outputs)).toEqual(config);
  });
});

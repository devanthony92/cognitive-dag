import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '@cognitive-dag/dag-schema';
import { describeConfig } from '../src/features/workflows/config-fields';

describe('config field descriptors', () => {
  it('no field is left as free-form JSON: the condition has its builder', () => {
    const json = NODE_TYPES.flatMap((type) =>
      describeConfig(type)
        .filter((field) => field.kind === 'json')
        .map((field) => `${type}.${field.key}`),
    );
    expect(json).toEqual([]);
  });

  it('picks the editor from the shape of the schema', () => {
    const kind = (type: Parameters<typeof describeConfig>[0], key: string) =>
      describeConfig(type).find((field) => field.key === key)?.kind;
    expect(kind('llm.classify', 'labels')).toBe('string-list');
    expect(kind('trigger.manual', 'inputSchema')).toBe('field-list');
    expect(kind('llm.extract', 'fields')).toBe('field-list');
    expect(kind('http.request', 'headers')).toBe('key-value');
    expect(kind('logic.condition', 'condition')).toBe('condition');
  });

  it('marks the templatable text fields so they get the reference editor', () => {
    const kind = (type: Parameters<typeof describeConfig>[0], key: string) =>
      describeConfig(type).find((field) => field.key === key)?.kind;
    expect(kind('llm.classify', 'text')).toBe('template');
    expect(kind('http.request', 'url')).toBe('template');
    expect(kind('http.request', 'body')).toBe('template');
    expect(kind('llm.generate', 'instruction')).toBe('template');
    expect(kind('human.approval', 'message')).toBe('template');
    expect(kind('llm.classify', 'labels')).not.toBe('template');
  });
});

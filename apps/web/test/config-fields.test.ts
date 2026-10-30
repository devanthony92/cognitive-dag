import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '@cognitive-dag/dag-schema';
import { describeConfig } from '../src/features/workflows/config-fields';

describe('config field descriptors', () => {
  it('only the condition is free-form JSON; every list has a proper editor', () => {
    const json = NODE_TYPES.flatMap((type) =>
      describeConfig(type)
        .filter((field) => field.kind === 'json')
        .map((field) => `${type}.${field.key}`),
    );
    expect(json).toEqual(['logic.condition.condition']);
  });

  it('picks the editor from the shape of the schema', () => {
    const kind = (type: Parameters<typeof describeConfig>[0], key: string) =>
      describeConfig(type).find((field) => field.key === key)?.kind;
    expect(kind('llm.classify', 'labels')).toBe('string-list');
    expect(kind('trigger.manual', 'inputSchema')).toBe('field-list');
    expect(kind('llm.extract', 'fields')).toBe('field-list');
    expect(kind('http.request', 'headers')).toBe('key-value');
  });
});

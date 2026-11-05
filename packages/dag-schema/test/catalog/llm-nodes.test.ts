import { describe, expect, it } from 'vitest';
import { NODE_CATALOG, resolveRetryPolicy, validateDefinition } from '../../src/index.js';
import { def, edge, node, trigger } from '../helpers.js';

const LLM_TYPES = ['llm.classify', 'llm.extract', 'llm.generate'] as const;

const configs = {
  'llm.classify': { text: 'hola', labels: ['a', 'b'] },
  'llm.extract': { text: 'hola', fields: [{ name: 'campo', type: { kind: 'string' } }] },
  'llm.generate': { instruction: 'resume' },
} as const;

describe('LLM nodes: redactPii (research R9)', () => {
  it.each(LLM_TYPES)('%s accepts redactPii and defaults it to false', (type) => {
    const schema = NODE_CATALOG[type].configSchema;
    const without = schema.parse(configs[type]) as { redactPii: boolean };
    expect(without.redactPii).toBe(false);
    const withIt = schema.parse({ ...configs[type], redactPii: true }) as { redactPii: boolean };
    expect(withIt.redactPii).toBe(true);
  });

  it.each(LLM_TYPES)('%s rejects a redactPii that is not a boolean', (type) => {
    expect(
      NODE_CATALOG[type].configSchema.safeParse({ ...configs[type], redactPii: 'yes' }).success,
    ).toBe(false);
  });

  it.each(LLM_TYPES)('%s default config keeps redactPii off', (type) => {
    const config = NODE_CATALOG[type].defaultConfig() as { redactPii?: boolean };
    expect(config.redactPii ?? false).toBe(false);
  });

  it.each(LLM_TYPES)('%s labels redactPii in Spanish', (type) => {
    expect(NODE_CATALOG[type].fieldLabels.redactPii).toBe('Ocultar datos personales');
  });
});

describe('LLM nodes: retry (research R7)', () => {
  it.each(LLM_TYPES)('%s declares the default policy: 3 attempts, 60 s, 2000 ms', (type) => {
    expect(NODE_CATALOG[type].retryDefaults).toEqual({
      maxAttempts: 3,
      timeoutSeconds: 60,
      initialIntervalMs: 2000,
    });
    expect(resolveRetryPolicy(type, undefined)).toEqual({
      maxAttempts: 3,
      timeoutSeconds: 60,
      initialIntervalMs: 2000,
    });
  });

  it.each(LLM_TYPES)('%s accepts a retry setting in a definition', (type) => {
    const n = { ...node('ask', type), retry: { maxAttempts: 2 } };
    const result = validateDefinition(def([trigger(), n], [edge('trigger', 'ask')]));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('LLM nodes: backward compatibility with F2 definitions', () => {
  it.each(LLM_TYPES)('%s without redactPii or retry is still valid', (type) => {
    const n = { ...node('ask', type), config: configs[type] };
    const result = validateDefinition(def([trigger(), n], [edge('trigger', 'ask')]));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('llm.classify output', () => {
  it('bounds confidence to [0, 1]', () => {
    const entry = NODE_CATALOG['llm.classify'];
    const config = entry.configSchema.parse(configs['llm.classify']);
    expect(entry.outputSchema(config)).toEqual({
      kind: 'object',
      fields: {
        label: { kind: 'enum', values: ['a', 'b'] },
        confidence: { kind: 'number', min: 0, max: 1 },
      },
    });
  });
});

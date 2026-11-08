import { NODE_CATALOG } from '@cognitive-dag/dag-schema';
import { describe, expect, it } from 'vitest';
import { allowedNodeTypes, compilerCatalog, nodeTypesExecutableIn } from '../src/index.js';
import { F5_TYPES } from './fixtures.js';

describe('node types by phase (research R10)', () => {
  it('keeps only the types executable in F3', () => {
    expect(nodeTypesExecutableIn(['F3'])).toEqual([
      'trigger.manual',
      'logic.condition',
      'logic.merge',
      'mock.service',
    ]);
  });

  it('adds the LLM nodes with F5 and never a type of F7', () => {
    const types = nodeTypesExecutableIn(['F3', 'F5']);
    expect([...types].sort()).toEqual([...F5_TYPES].sort());
    for (const type of ['trigger.webhook', 'trigger.schedule', 'human.approval', 'http.request']) {
      expect(types).not.toContain(type);
    }
  });

  it('adds the LLM nodes only when llm-nodes-enabled is on', () => {
    expect(allowedNodeTypes({ llmNodesEnabled: false })).toEqual(
      nodeTypesExecutableIn(['F3', 'F7']),
    );
    expect(allowedNodeTypes({ llmNodesEnabled: true })).toEqual(
      nodeTypesExecutableIn(['F3', 'F5', 'F7']),
    );
  });
});

describe('compiler catalog', () => {
  it('describes each type from the node catalog: input, handles and fields', () => {
    const [condition] = compilerCatalog(['logic.condition']);
    expect(condition).toMatchObject({
      type: 'logic.condition',
      acceptsInput: NODE_CATALOG['logic.condition'].acceptsInput,
      handles: ['true', 'false'],
      fields: ['condition'],
      sensitiveFields: [],
    });
    const [trigger] = compilerCatalog(['trigger.manual']);
    expect(trigger?.acceptsInput).toBe(false);
  });

  it('has an English guide with a config example for every type it may offer', () => {
    for (const entry of compilerCatalog(nodeTypesExecutableIn(['F3', 'F5']))) {
      expect(entry.guide.length).toBeGreaterThan(40);
      expect(entry.guide).toMatch(/config/);
      expect(entry.guide).not.toMatch(/[áéíóúñ]/);
    }
  });

  it('carries the sensitive fields of the node catalog', () => {
    const [http] = compilerCatalog(['http.request']);
    expect(http?.sensitiveFields).toEqual(['url', 'headers', 'body', 'credentialId']);
  });

  it('refuses an unknown type', () => {
    expect(() => compilerCatalog(['email.send'])).toThrow(/email\.send/);
  });
});

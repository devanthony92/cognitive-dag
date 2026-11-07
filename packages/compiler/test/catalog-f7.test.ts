import { newGuardTokens } from '@cognitive-dag/llm';
import { NODE_CATALOG, NODE_TYPES } from '@cognitive-dag/dag-schema';
import { describe, expect, it } from 'vitest';
import { allowedNodeTypes, buildCompilerPrompt, compilerCatalog } from '../src/index.js';

const F7_TYPES = NODE_TYPES.filter((type) => NODE_CATALOG[type].executableFrom === 'F7');
const limits = { maxNodes: 50, maxEdges: 100 };

/**
 * F7 research R13 (decision 13C): the compiler does not offer the nodes of F7, not even with
 * `triggers-enabled` on. They reach the compiler in F8.
 */
describe('compiler catalog and the nodes of F7 (US10)', () => {
  it('knows which types are F7', () => {
    expect([...F7_TYPES].sort()).toEqual(
      ['http.request', 'human.approval', 'trigger.schedule', 'trigger.webhook'].sort(),
    );
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'offers no F7 type with llm-nodes-enabled=%s and triggers-enabled=%s',
    (llmNodesEnabled, triggersEnabled) => {
      const allowed = allowedNodeTypes({ llmNodesEnabled, triggersEnabled });
      for (const type of F7_TYPES) expect(allowed).not.toContain(type);
    },
  );

  it('does not change the offer when triggers-enabled turns on', () => {
    expect(allowedNodeTypes({ llmNodesEnabled: true, triggersEnabled: true })).toEqual(
      allowedNodeTypes({ llmNodesEnabled: true, triggersEnabled: false }),
    );
    expect(allowedNodeTypes({ llmNodesEnabled: false, triggersEnabled: true })).toEqual(
      allowedNodeTypes({ llmNodesEnabled: false }),
    );
  });

  it('keeps every F7 type out of the prompt', () => {
    const allowed = allowedNodeTypes({ llmNodesEnabled: true, triggersEnabled: true });
    const { system } = buildCompilerPrompt(
      'cuando llegue un webhook, pide aprobación y llama a la API',
      compilerCatalog(allowed),
      newGuardTokens(),
      limits,
    );
    for (const type of F7_TYPES) expect(system).not.toContain(type);
  });

  it('refuses to describe an F7 type that has no guide', () => {
    for (const type of F7_TYPES.filter((t) => t !== 'http.request')) {
      expect(() => compilerCatalog([type])).toThrow(RangeError);
    }
  });
});

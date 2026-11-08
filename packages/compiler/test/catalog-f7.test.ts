import { newGuardTokens } from '@cognitive-dag/llm';
import { NODE_CATALOG, NODE_TYPES } from '@cognitive-dag/dag-schema';
import { describe, expect, it } from 'vitest';
import { allowedNodeTypes, buildCompilerPrompt, compilerCatalog } from '../src/index.js';

const F7_TYPES = NODE_TYPES.filter((type) => NODE_CATALOG[type].executableFrom === 'F7');
const EXPECTED_F7 = ['http.request', 'human.approval', 'trigger.schedule', 'trigger.webhook'];
const limits = { maxNodes: 50, maxEdges: 100 };

/** The JSON that follows "Example config:" in a guide. */
function exampleConfig(type: (typeof NODE_TYPES)[number]): Record<string, unknown> {
  const guide = compilerCatalog([type])[0]?.guide ?? '';
  const start = guide.indexOf('Example config: ');
  expect(start, `${type} has an example config`).toBeGreaterThanOrEqual(0);
  return JSON.parse(guide.slice(start + 'Example config: '.length)) as Record<string, unknown>;
}

/**
 * F8 research R3 (decision 3A): the compiler offers exactly the four nodes of F7, with no flag in
 * between. It replaces the F7 test that fixed "no F7 type reaches the prompt" (decision 13C).
 */
describe('compiler catalog and the nodes of F7 (F8, US3)', () => {
  it('knows which types are F7', () => {
    expect([...F7_TYPES].sort()).toEqual(EXPECTED_F7);
  });

  it.each([false, true])('offers exactly the four F7 types with llm-nodes-enabled=%s', (llm) => {
    const offered = allowedNodeTypes({ llmNodesEnabled: llm }).filter((type) =>
      F7_TYPES.includes(type),
    );
    expect([...offered].sort()).toEqual(EXPECTED_F7);
  });

  it('takes no triggersEnabled parameter any more', () => {
    // The signature no longer names the flag: it is accepted by TypeScript only as an excess key.
    // @ts-expect-error triggersEnabled was removed (F7 ADR-0080, F8 ADR-0083)
    const withFlag = allowedNodeTypes({ llmNodesEnabled: true, triggersEnabled: false });
    expect(withFlag).toEqual(allowedNodeTypes({ llmNodesEnabled: true }));
  });

  it('describes the four types in the prompt', () => {
    const allowed = allowedNodeTypes({ llmNodesEnabled: true });
    const { system } = buildCompilerPrompt(
      'cuando llegue un webhook, pide aprobación y llama a la API',
      compilerCatalog(allowed),
      newGuardTokens(),
      limits,
    );
    for (const type of F7_TYPES) expect(system).toContain(`### ${type}`);
  });

  it('gives every F7 type a guide with an example config', () => {
    for (const type of F7_TYPES) expect(() => compilerCatalog([type])).not.toThrow();
  });

  it('shows examples that the catalog schema accepts (except the sensitive ones)', () => {
    for (const type of F7_TYPES.filter((t) => t !== 'http.request')) {
      const result = NODE_CATALOG[type].configSchema.safeParse(exampleConfig(type));
      expect(result.success, `${type} example`).toBe(true);
    }
  });

  it('never shows a filled sensitive field in the http.request example', () => {
    expect(Object.keys(exampleConfig('http.request'))).toEqual(['method']);
  });

  it('lists url, headers, body and credentialId as the fields the model never writes', () => {
    const entry = compilerCatalog(['http.request'])[0];
    expect([...(entry?.sensitiveFields ?? [])].sort()).toEqual(
      ['body', 'credentialId', 'headers', 'url'].sort(),
    );
  });
});

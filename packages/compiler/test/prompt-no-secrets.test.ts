import { newGuardTokens } from '@cognitive-dag/llm';
import { NODE_TYPES } from '@cognitive-dag/dag-schema';
import { describe, expect, it } from 'vitest';
import { allowedNodeTypes, buildCompilerPrompt, compilerCatalog } from '../src/index.js';

/**
 * OWASP LLM02 and LLM07 (F8): the system prompt of the compiler, with every node it can offer,
 * holds no credential-shaped value and no environment variable name. The sensitive fields are
 * named (`credentialId`, `url`) so the model leaves them out, but never given a value.
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'sk- style key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer credential', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  {
    name: 'assigned secret',
    pattern: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/i,
  },
  {
    name: 'connection string with credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
  { name: 'long hex or base64 blob', pattern: /\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/ },
];

const ENV_NAME_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'UPPER_SNAKE name', pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/ },
  { name: 'process.env', pattern: /\bprocess\.env\b|\bimport\.meta\.env\b/ },
  {
    name: 'known variable',
    pattern: /\b(?:GEMINI|DATABASE|VALKEY|TEMPORAL|SESSION|CREDENTIALS|SMTP|MASTER)\w*\b/,
  },
];

const limits = { maxNodes: 50, maxEdges: 100 };

describe('system prompt of the compiler holds no secret and no variable name', () => {
  const catalogs: ReadonlyArray<[string, readonly (typeof NODE_TYPES)[number][]]> = [
    ['the types it offers', allowedNodeTypes()],
    ['every type in the node catalog', NODE_TYPES],
  ];

  it.each(catalogs)('with %s', (_name, types) => {
    const tokens = newGuardTokens();
    const { system } = buildCompilerPrompt('hazlo', compilerCatalog(types), tokens, limits);
    // The nonce and the canary are random per call and look like secrets on purpose.
    const text = system.split(tokens.canary).join('').split(tokens.nonce).join('');
    expect(text.length).toBeGreaterThan(500);
    for (const { name, pattern } of [...SECRET_PATTERNS, ...ENV_NAME_PATTERNS]) {
      expect(pattern.exec(text)?.[0], name).toBeUndefined();
    }
  });

  it('names credentialId only as a field to leave out', () => {
    const tokens = newGuardTokens();
    const catalog = compilerCatalog(allowedNodeTypes());
    const { system } = buildCompilerPrompt('hazlo', catalog, tokens, limits);
    expect(system).toMatch(/Sensitive fields, never write them:[^\n]*credentialId/);
  });
});

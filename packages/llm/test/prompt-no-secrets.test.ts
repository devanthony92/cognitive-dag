import { describe, expect, it } from 'vitest';
import { buildPrompt, newGuardTokens, type PromptSpec } from '../src/index.js';

/**
 * OWASP LLM02 and LLM07 (F8): the system prompt is not a secret and must not hold one. It carries
 * neither a credential-shaped value nor the name of an environment variable.
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'sk- style key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
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

/** UPPER_SNAKE names (`GEMINI_API_KEY`, `LLM_ENABLED`, `DATABASE_URL`) and `process.env`. */
const ENV_NAME_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'UPPER_SNAKE name', pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/ },
  { name: 'process.env', pattern: /\bprocess\.env\b|\bimport\.meta\.env\b/ },
  {
    name: 'known variable',
    pattern: /\b(?:GEMINI|DATABASE|VALKEY|TEMPORAL|SESSION|CREDENTIALS|SMTP|MASTER)\w*\b/,
  },
];

const flagged = (patterns: typeof SECRET_PATTERNS, text: string) =>
  patterns.some(({ pattern }) => pattern.test(text));

const SPECS: ReadonlyArray<[string, PromptSpec]> = [
  ['classify', { kind: 'classify', labels: ['spam', 'ham'] }],
  [
    'extract',
    {
      kind: 'extract',
      fields: [
        { name: 'name', type: { kind: 'string' } },
        { name: 'age', type: { kind: 'number' } },
      ],
    },
  ],
  ['generate', { kind: 'generate', language: 'es', maxLength: 300 }],
];

describe('system prompts of the LLM nodes hold no secret and no variable name', () => {
  it.each(SPECS)('%s', (_name, spec) => {
    const tokens = newGuardTokens();
    const { system } = buildPrompt(spec, 'texto de prueba', tokens);
    // The nonce and the canary are random per call and look like secrets on purpose.
    const text = system.split(tokens.canary).join('').split(tokens.nonce).join('');
    expect(text.length).toBeGreaterThan(50);
    for (const { name, pattern } of [...SECRET_PATTERNS, ...ENV_NAME_PATTERNS]) {
      expect(pattern.exec(text)?.[0], name).toBeUndefined();
    }
  });

  describe('the detectors', () => {
    it.each([
      ['AIza', 'Sy', 'x'.repeat(33)].join(''),
      ['sk', '-', 'a'.repeat(24)].join(''),
      ['gh', 'p_', 'a'.repeat(30)].join(''),
      'Authorization: Bearer abcdefghijklmnop1234',
      'password = hunter2hunter',
      'postgres://app:pa55word@db:5432/x',
      'aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd',
    ])('flags the secret %s', (sample) => {
      expect(flagged(SECRET_PATTERNS, sample)).toBe(true);
    });

    it.each(['GEMINI_API_KEY', 'LLM_ENABLED', 'DATABASE_URL', 'process.env.X'])(
      'flags the name %s',
      (sample) => {
        expect(flagged(ENV_NAME_PATTERNS, sample)).toBe(true);
      },
    );

    it('lets ordinary instructions through', () => {
      const sample = 'You are a classifier. Answer with one label from the list.';
      expect(flagged(SECRET_PATTERNS, sample)).toBe(false);
      expect(flagged(ENV_NAME_PATTERNS, sample)).toBe(false);
    });
  });
});

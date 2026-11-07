import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMasterKey } from '@cognitive-dag/connectors';
import { generateMasterKey } from '../../credentials-gen-key.ts';

const SCRIPT = resolve(import.meta.dirname, '../../credentials-gen-key.ts');

describe('credentials master key generator (F7, research R10)', () => {
  it('makes 32 random bytes in base64 that the platform accepts as a master key', () => {
    const key = generateMasterKey();
    expect(parseMasterKey(key)).toHaveLength(32);
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateMasterKey()));
    expect(keys.size).toBe(50);
  });

  it('prints only the key when run as a script', () => {
    const output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(output.endsWith('\n')).toBe(true);
    const lines = output.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(parseMasterKey(lines[0] ?? '')).toHaveLength(32);
    // Starting a Node process is slow on some machines; this is not a speed test.
  }, 30_000);
});

import { describe, expect, it } from 'vitest';
import { PasswordPolicy } from '../../src/auth/password-policy';

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy();
  const valid = 'un-caballo-azul-en-marte';

  it('accepts a long unique passphrase', () => {
    expect(policy.check(valid)).toEqual([]);
  });

  it('rejects 7 characters and accepts 8', () => {
    expect(policy.check('x7Qm-vR')).toHaveLength(1);
    expect(policy.check('x7Qm-vR2')).toEqual([]);
  });

  it('accepts 25 characters and rejects 26', () => {
    const base = 'qZ3v-';
    expect(policy.check(base.repeat(6).slice(0, 25))).toEqual([]);
    expect(policy.check(base.repeat(6).slice(0, 26))).toHaveLength(1);
  });

  it('normalizes with NFKC before counting', () => {
    // 8 fullwidth letters normalize to 8 ASCII letters; 7 stay below the minimum.
    expect(policy.check('ｑｚｘｗｖｕｔｓ')).toEqual([]);
    expect(policy.check('ｑｚｘｗｖｕｔ')).toHaveLength(1);
    // The ligature "ﬁ" expands to two characters: "ﬁqxﬁzv" reaches 8, 13 of them exceed 25.
    expect(policy.check('ﬁqxﬁzv')).toEqual([]);
    expect(policy.check('ﬁ'.repeat(13))[0]).toMatch(/como máximo/);
  });

  it('accepts spaces and emoji', () => {
    expect(policy.check('   un espacio largo   ')).toEqual([]);
    expect(policy.check('\u{1F680}'.repeat(4) + '\u{1F319}'.repeat(4))).toEqual([]);
  });

  it('rejects a common password, ignoring case and Unicode forms', () => {
    expect(policy.check('password123')).toHaveLength(1);
    expect(policy.check('PASSWORD123')).toHaveLength(1);
    expect(policy.check('ｐａｓｓｗｏｒｄ１２３')).toHaveLength(1);
    expect(policy.check('12345678')).toHaveLength(1);
  });

  it('explains the rule that was broken', () => {
    expect(policy.check('corta')[0]).toMatch(/al menos 8/);
    expect(policy.check('a'.repeat(26))[0]).toMatch(/como máximo 25/);
    expect(policy.check('password123')[0]).toMatch(/demasiado común/);
  });
});

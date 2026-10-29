import { describe, expect, it } from 'vitest';
import { PasswordPolicy } from '../../src/auth/password-policy';

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy();
  const valid = 'un-caballo-azul-en-marte';

  it('accepts a long unique passphrase', () => {
    expect(policy.check(valid)).toEqual([]);
  });

  it('rejects 14 characters and accepts 15', () => {
    expect(policy.check('x7Qm-vR2!kLp9z')).toHaveLength(1);
    expect(policy.check('x7Qm-vR2!kLp9zA')).toEqual([]);
  });

  it('accepts 128 characters and rejects 129', () => {
    const base = 'qZ3v-';
    expect(policy.check(base.repeat(26).slice(0, 128))).toEqual([]);
    expect(policy.check(base.repeat(26).slice(0, 129))).toHaveLength(1);
  });

  it('normalizes with NFKC before counting', () => {
    // 15 fullwidth letters normalize to 15 ASCII letters; 14 stay below the minimum.
    expect(policy.check('ｑｚｘｗｖｕｔｓｒｐｏｎｍｌｋ')).toEqual([]);
    expect(policy.check('ｑｚｘｗｖｕｔｓｒｐｏｎｍｌ')).toHaveLength(1);
    // The ligature "ﬁ" expands to two characters: 8 of them reach 16.
    expect(policy.check('ﬁ'.repeat(8))).not.toContainEqual(expect.stringMatching(/al menos/));
  });

  it('accepts spaces and emoji', () => {
    expect(policy.check('   un espacio largo   ')).toEqual([]);
    expect(policy.check('\u{1F680}'.repeat(8) + '\u{1F319}'.repeat(8))).toEqual([]);
  });

  it('rejects a common password, ignoring case and Unicode forms', () => {
    expect(policy.check('password123456789')).toHaveLength(1);
    expect(policy.check('PASSWORD123456789')).toHaveLength(1);
    expect(policy.check('ｐａｓｓｗｏｒｄ１２３４５６７８９')).toHaveLength(1);
  });

  it('explains the rule that was broken', () => {
    expect(policy.check('corta')[0]).toMatch(/al menos 15/);
    expect(policy.check('a'.repeat(129))[0]).toMatch(/como máximo 128/);
    expect(policy.check('password123456789')[0]).toMatch(/demasiado común/);
  });
});

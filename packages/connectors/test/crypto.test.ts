import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CredentialCryptoError,
  decryptSecret,
  encryptSecret,
  parseMasterKey,
  type EncryptedSecret,
} from '../src/index.js';

const masterKey = randomBytes(32);
const credentialId = randomUUID();
const organizationId = randomUUID();
const SECRET = 'sk_live_très-secret-ñ-0123456789';

const encrypt = (secret = SECRET, key = masterKey): EncryptedSecret =>
  encryptSecret({ masterKey: key, credentialId, organizationId, secret });

describe('envelope encryption (research R10)', () => {
  it('round-trips the secret', () => {
    const encrypted = encrypt();
    expect(decryptSecret({ masterKey, credentialId, organizationId, encrypted })).toBe(SECRET);
  });

  it('shapes the blobs like the columns of the data model', () => {
    const encrypted = encrypt('abc');
    expect(encrypted.dekWrapped).toHaveLength(32);
    expect(encrypted.dekIv).toHaveLength(12);
    expect(encrypted.dekTag).toHaveLength(16);
    expect(encrypted.secretIv).toHaveLength(12);
    expect(encrypted.secretTag).toHaveLength(16);
    expect(encrypted.secretCt).toHaveLength(3);
    expect(encrypted.keyVersion).toBe(1);
  });

  it('uses a fresh data key and IV each time', () => {
    const a = encrypt();
    const b = encrypt();
    expect(a.dekWrapped.equals(b.dekWrapped)).toBe(false);
    expect(a.dekIv.equals(b.dekIv)).toBe(false);
    expect(a.secretIv.equals(b.secretIv)).toBe(false);
    expect(a.secretCt.equals(b.secretCt)).toBe(false);
  });

  it('does not decrypt with another master key', () => {
    const encrypted = encrypt();
    expect(() =>
      decryptSecret({ masterKey: randomBytes(32), credentialId, organizationId, encrypted }),
    ).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_DECRYPT_FAILED' }));
  });

  it('binds the blob to its row: another credential id does not decrypt', () => {
    const encrypted = encrypt();
    expect(() =>
      decryptSecret({ masterKey, credentialId: randomUUID(), organizationId, encrypted }),
    ).toThrowError(CredentialCryptoError);
  });

  it('binds the blob to its organization: another organization does not decrypt', () => {
    const encrypted = encrypt();
    expect(() =>
      decryptSecret({ masterKey, credentialId, organizationId: randomUUID(), encrypted }),
    ).toThrowError(CredentialCryptoError);
  });

  it.each(['dekWrapped', 'dekIv', 'dekTag', 'secretCt', 'secretIv', 'secretTag'] as const)(
    'detects a modified %s',
    (field) => {
      const encrypted = encrypt();
      const tampered = { ...encrypted, [field]: Buffer.from(encrypted[field]) };
      tampered[field][0] = (tampered[field][0] ?? 0) ^ 0xff;
      expect(() =>
        decryptSecret({ masterKey, credentialId, organizationId, encrypted: tampered }),
      ).toThrowError(CredentialCryptoError);
    },
  );

  it('encrypts secrets of 1 to 4096 bytes and refuses the rest', () => {
    expect(() => encrypt('a')).not.toThrow();
    expect(() => encrypt('a'.repeat(4096))).not.toThrow();
    expect(() => encrypt('')).toThrowError(
      expect.objectContaining({ code: 'CREDENTIAL_SECRET_INVALID' }),
    );
    expect(() => encrypt('a'.repeat(4097))).toThrowError(
      expect.objectContaining({ code: 'CREDENTIAL_SECRET_INVALID' }),
    );
    // 2 bytes per character: 4096 bytes fit, 2049 characters of « ñ » do not.
    expect(() => encrypt('ñ'.repeat(2048))).not.toThrow();
    expect(() => encrypt('ñ'.repeat(2049))).toThrow();
  });

  it('does not show the secret in the serialized object', () => {
    const encrypted = encrypt();
    const asJson = JSON.stringify(encrypted);
    expect(asJson).not.toContain(SECRET);
    expect(asJson).not.toContain(Buffer.from(SECRET).toString('base64'));
    expect(Buffer.from(encrypted.secretCt).includes(Buffer.from(SECRET))).toBe(false);
    expect(Buffer.from(encrypted.dekWrapped).includes(masterKey)).toBe(false);
  });

  it('does not show the secret or the keys in any error', () => {
    const encrypted = encrypt();
    const messages: string[] = [];
    const collect = (fn: () => unknown): void => {
      try {
        fn();
      } catch (error) {
        messages.push(
          `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)}`,
        );
      }
    };
    collect(() =>
      decryptSecret({ masterKey: randomBytes(32), credentialId, organizationId, encrypted }),
    );
    collect(() => encrypt(''));
    collect(() => parseMasterKey(masterKey.toString('base64').slice(0, 20)));
    for (const message of messages) {
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(masterKey.toString('base64'));
      expect(message).not.toContain(masterKey.toString('hex'));
    }
    expect(messages).toHaveLength(3);
  });

  it('refuses a master key that is not 32 bytes', () => {
    expect(() => encrypt(SECRET, randomBytes(16))).toThrowError(
      expect.objectContaining({ code: 'CREDENTIALS_NOT_CONFIGURED' }),
    );
  });
});

describe('master key parsing (research R10)', () => {
  it('reads 32 bytes in base64', () => {
    const key = randomBytes(32);
    expect(parseMasterKey(key.toString('base64')).equals(key)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['not base64', '!!!not base64!!!'],
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['hex instead', randomBytes(32).toString('hex')],
  ])('rejects %s', (_name, value) => {
    expect(() => parseMasterKey(value)).toThrowError(
      expect.objectContaining({ code: 'CREDENTIALS_NOT_CONFIGURED' }),
    );
  });

  it('accepts base64url padding variants of 32 bytes', () => {
    const key = randomBytes(32);
    expect(parseMasterKey(key.toString('base64').replace(/=+$/, '')).equals(key)).toBe(true);
  });
});

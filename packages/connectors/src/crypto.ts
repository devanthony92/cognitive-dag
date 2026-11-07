import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CredentialCryptoError } from './errors.js';

/**
 * Envelope encryption of connector credentials (research R10, data-model `credentials`).
 *
 * Each credential gets its own random data key (DEK). The DEK encrypts the secret and the master key
 * (`CREDENTIALS_MASTER_KEY`) encrypts the DEK, both with AES-256-GCM, a fresh 12-byte IV and the
 * additional authenticated data `credential:<id>:<organization_id>`: a blob copied to another row
 * or organization does not decrypt.
 */

export const MASTER_KEY_BYTES = 32;
export const SECRET_MAX_BYTES = 4096;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CURRENT_KEY_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY_TEXT = /^[A-Za-z0-9+/]{43}=?$/;

/** The columns the database keeps for one credential secret. */
export interface EncryptedSecret {
  /** DEK encrypted with the master key. */
  dekWrapped: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  /** The secret encrypted with the DEK. */
  secretCt: Buffer;
  secretIv: Buffer;
  secretTag: Buffer;
  /** Version of the master key used; rotation is deferred, so it is always 1 today. */
  keyVersion: number;
}

export interface CredentialBinding {
  credentialId: string;
  organizationId: string;
}

function notConfigured(): CredentialCryptoError {
  return new CredentialCryptoError(
    'CREDENTIALS_NOT_CONFIGURED',
    'El servidor no tiene una llave maestra de credenciales válida.',
  );
}

/** Reads `CREDENTIALS_MASTER_KEY`: base64 of exactly 32 bytes. The error never carries the value. */
export function parseMasterKey(text: string): Buffer {
  if (!MASTER_KEY_TEXT.test(text)) throw notConfigured();
  const key = Buffer.from(text, 'base64');
  if (key.length !== MASTER_KEY_BYTES) throw notConfigured();
  return key;
}

const aadOf = ({ credentialId, organizationId }: CredentialBinding): Buffer =>
  Buffer.from(`credential:${credentialId}:${organizationId}`, 'utf8');

function seal(key: Buffer, plain: Buffer, aad: Buffer): { ct: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ct, iv, tag: cipher.getAuthTag() };
}

function open(key: Buffer, sealed: { ct: Buffer; iv: Buffer; tag: Buffer }, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, sealed.iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ct), decipher.final()]);
}

export function encryptSecret(
  input: CredentialBinding & { masterKey: Buffer; secret: string; keyVersion?: number },
): EncryptedSecret {
  if (input.masterKey.length !== MASTER_KEY_BYTES) throw notConfigured();
  const plain = Buffer.from(input.secret, 'utf8');
  if (plain.length < 1 || plain.length > SECRET_MAX_BYTES) {
    throw new CredentialCryptoError(
      'CREDENTIAL_SECRET_INVALID',
      'El secreto de la credencial no es válido.',
    );
  }
  const aad = aadOf(input);
  const dek = randomBytes(MASTER_KEY_BYTES);
  try {
    const wrapped = seal(input.masterKey, dek, aad);
    const sealed = seal(dek, plain, aad);
    return {
      dekWrapped: wrapped.ct,
      dekIv: wrapped.iv,
      dekTag: wrapped.tag,
      secretCt: sealed.ct,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      keyVersion: input.keyVersion ?? CURRENT_KEY_VERSION,
    };
  } finally {
    dek.fill(0);
    plain.fill(0);
  }
}

/** Decrypts a secret. Any failure (wrong key, moved blob, tampering) is the same generic error. */
export function decryptSecret(
  input: CredentialBinding & { masterKey: Buffer; encrypted: EncryptedSecret },
): string {
  if (input.masterKey.length !== MASTER_KEY_BYTES) throw notConfigured();
  const { encrypted } = input;
  const aad = aadOf(input);
  let dek: Buffer | undefined;
  try {
    dek = open(
      input.masterKey,
      { ct: encrypted.dekWrapped, iv: encrypted.dekIv, tag: encrypted.dekTag },
      aad,
    );
    const plain = open(
      dek,
      { ct: encrypted.secretCt, iv: encrypted.secretIv, tag: encrypted.secretTag },
      aad,
    );
    try {
      return plain.toString('utf8');
    } finally {
      plain.fill(0);
    }
  } catch {
    throw new CredentialCryptoError(
      'CREDENTIAL_DECRYPT_FAILED',
      'No se pudo descifrar la credencial.',
    );
  } finally {
    dek?.fill(0);
  }
}

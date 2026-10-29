import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

/** OWASP Password Storage Cheat Sheet minimum for Argon2id: m = 19 MiB, t = 2, p = 1 (R4). */
const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordHasher {
  /** Hashes the NFKC form, the same one the policy measures. */
  hash(password: string): Promise<string> {
    return hash(password.normalize('NFKC'), ARGON2_OPTIONS);
  }

  async verify(phc: string, password: string): Promise<boolean> {
    try {
      return await verify(phc, password.normalize('NFKC'));
    } catch {
      return false;
    }
  }
}

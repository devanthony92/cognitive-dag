import { randomBytes } from 'node:crypto';

/**
 * Operator script: prints a new master key for the envelope encryption of connector credentials
 * (`CREDENTIALS_MASTER_KEY`): 32 random bytes in base64 (F7, research R10).
 *
 *   pnpm credentials:gen-key
 *
 * It prints only the key, to the terminal, and stores nothing. Put it in the local `.env` or in
 * the secret store of the deployment; never commit it and never paste it in a chat or a log.
 */
export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}

if (import.meta.main) {
  process.stdout.write(`${generateMasterKey()}\n`);
}

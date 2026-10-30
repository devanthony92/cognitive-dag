import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLength } from '@cognitive-dag/contracts';

/**
 * Common passwords of 8 to 25 characters (NFKC, lower case), one per line. Source: SecLists
 * Pwdb_top-1000000.txt, MIT license (see ADR-0026). No external calls at run time.
 */
const COMMON_PASSWORDS_FILE = join(__dirname, 'common-passwords.txt');

let commonPasswords: ReadonlySet<string> | undefined;

function loadCommonPasswords(): ReadonlySet<string> {
  commonPasswords ??= new Set(
    readFileSync(COMMON_PASSWORDS_FILE, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0),
  );
  return commonPasswords;
}

/**
 * Length, no composition rules, common list. Follows NIST 800-63B-4 except for the 8-25 length
 * range, a documented deviation (ADR-0026).
 */
@Injectable()
export class PasswordPolicy {
  /** Spanish messages for every rule the password breaks; empty when it is acceptable. */
  check(password: string): string[] {
    const length = passwordLength(password);
    if (length < PASSWORD_MIN_LENGTH) {
      return [`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`];
    }
    if (length > PASSWORD_MAX_LENGTH) {
      return [`Debe tener como máximo ${PASSWORD_MAX_LENGTH} caracteres.`];
    }
    if (loadCommonPasswords().has(password.normalize('NFKC').toLowerCase())) {
      return ['Es una contraseña demasiado común. Elige otra.'];
    }
    return [];
  }
}

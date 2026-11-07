import {
  FORBIDDEN_CREDENTIAL_HEADER_NAMES as CONTRACT_FORBIDDEN_NAMES,
  HTTP_ALLOWED_HOSTS_MAX as CONTRACT_HOSTS_MAX,
  HTTP_STEP_ERROR_CODES,
} from '@cognitive-dag/contracts';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_CREDENTIAL_HEADER_NAMES,
  HTTP_ALLOWED_HOSTS_MAX,
  HTTP_CLIENT_ERROR_CODES,
} from '../src/index.js';

/**
 * `@cognitive-dag/contracts` runs in the browser, so it cannot import the client; the few values
 * both share are written twice and these tests keep them equal.
 */
describe('contracts stay in sync with the connectors', () => {
  it('forbids the same credential header names', () => {
    expect([...FORBIDDEN_CREDENTIAL_HEADER_NAMES].sort()).toEqual(
      [...CONTRACT_FORBIDDEN_NAMES].sort(),
    );
  });

  it('caps the allowlist at the same size', () => {
    expect(HTTP_ALLOWED_HOSTS_MAX).toBe(CONTRACT_HOSTS_MAX);
  });

  it('lists every code of the HTTP client among the step error codes', () => {
    for (const code of HTTP_CLIENT_ERROR_CODES) {
      expect(HTTP_STEP_ERROR_CODES).toContain(code);
    }
  });
});

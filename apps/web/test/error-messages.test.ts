import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/features/runs/error-messages';

describe('errorMessage', () => {
  it('translates the known codes', () => {
    expect(errorMessage({ code: 'RUN_TIMED_OUT', message: 'The run exceeded.' })).toMatch(
      /duración máxima/,
    );
  });

  it('falls back to the class, then to the original message', () => {
    expect(errorMessage({ code: 'SOMETHING_NEW', message: 'English', class: 'timeout' })).toMatch(
      /tiempo máximo/,
    );
    expect(errorMessage({ code: 'SOMETHING_NEW', message: 'English' })).toBe('English');
  });
});

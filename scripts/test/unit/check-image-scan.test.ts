import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateScan, parseExceptions, type ScanException } from '../../ci/check-image-scan.ts';

/**
 * F9 (D11C): the publication fails on high and critical findings that have a fix. Exceptions come
 * from a versioned file and each one carries a reason, an owner and a date, and expires.
 */
const TODAY = new Date('2026-11-10T00:00:00Z');

function finding(overrides: {
  id?: string;
  severity?: string;
  state?: string;
  name?: string;
}): unknown {
  return {
    vulnerability: {
      id: overrides.id ?? 'CVE-2099-0001',
      severity: overrides.severity ?? 'High',
      fix: { state: overrides.state ?? 'fixed', versions: ['1.2.3'] },
    },
    artifact: { name: overrides.name ?? 'libexample', version: '1.0.0' },
  };
}
const report = (...matches: unknown[]) => ({ matches });

const exception = (overrides: Partial<ScanException> = {}): ScanException => ({
  id: 'CVE-2099-0001',
  reason: 'Unreachable code path; the fix needs a base image bump scheduled upstream.',
  owner: 'autor',
  date: '2026-11-01',
  expires: '2026-12-01',
  ...overrides,
});

describe('evaluateScan', () => {
  it('passes a clean report', () => {
    expect(evaluateScan(report(), [], TODAY).blocking).toEqual([]);
  });

  it('blocks a high finding that has a fix', () => {
    const result = evaluateScan(report(finding({})), [], TODAY);
    expect(result.blocking.map((item) => item.id)).toEqual(['CVE-2099-0001']);
  });

  it('blocks a critical finding that has a fix', () => {
    const result = evaluateScan(report(finding({ severity: 'Critical' })), [], TODAY);
    expect(result.blocking).toHaveLength(1);
  });

  it('ignores medium and low findings', () => {
    const matches = [finding({ severity: 'Medium' }), finding({ severity: 'Low' })];
    expect(evaluateScan(report(...matches), [], TODAY).blocking).toEqual([]);
  });

  it('ignores findings without an available fix', () => {
    for (const state of ['not-fixed', 'unknown', 'wont-fix']) {
      expect(evaluateScan(report(finding({ state })), [], TODAY).blocking, state).toEqual([]);
    }
  });

  it('lets a valid exception through and reports it as used', () => {
    const result = evaluateScan(report(finding({})), [exception()], TODAY);
    expect(result.blocking).toEqual([]);
    expect(result.excepted.map((item) => item.id)).toEqual(['CVE-2099-0001']);
  });

  it('blocks again once the exception has expired', () => {
    const expired = exception({ expires: '2026-11-09' });
    expect(evaluateScan(report(finding({})), [expired], TODAY).blocking).toHaveLength(1);
  });

  it('scopes an exception to one package when it names one', () => {
    const scoped = exception({ package: 'libother' });
    expect(evaluateScan(report(finding({})), [scoped], TODAY).blocking).toHaveLength(1);
    const match = exception({ package: 'libexample' });
    expect(evaluateScan(report(finding({})), [match], TODAY).blocking).toEqual([]);
  });

  it('scopes an exception to one image when it names one', () => {
    const scoped = exception({ image: 'edge' });
    expect(evaluateScan(report(finding({})), [scoped], TODAY, 'api').blocking).toHaveLength(1);
    expect(evaluateScan(report(finding({})), [scoped], TODAY, 'edge').blocking).toEqual([]);
    // Without an image argument a scoped exception never applies.
    expect(evaluateScan(report(finding({})), [scoped], TODAY).blocking).toHaveLength(1);
  });

  it('does not let an exception for one id cover another', () => {
    const other = exception({ id: 'CVE-2099-9999' });
    expect(evaluateScan(report(finding({})), [other], TODAY).blocking).toHaveLength(1);
  });

  it('rejects a report that is not a Grype report', () => {
    expect(() => evaluateScan({ nothing: true }, [], TODAY)).toThrow(/matches/);
  });
});

describe('parseExceptions', () => {
  it('accepts an empty list', () => {
    expect(parseExceptions('[]')).toEqual([]);
  });

  it.each(['reason', 'owner', 'date', 'expires', 'id'])('requires %s', (field) => {
    const entry: Record<string, unknown> = { ...exception() };
    delete entry[field];
    expect(() => parseExceptions(JSON.stringify([entry]))).toThrow(new RegExp(field));
  });

  it('rejects a blank reason and a malformed date', () => {
    expect(() => parseExceptions(JSON.stringify([exception({ reason: '  ' })]))).toThrow(/reason/);
    expect(() => parseExceptions(JSON.stringify([exception({ date: '1/2/26' })]))).toThrow(/date/);
  });

  it('rejects an expiry before the date it was added', () => {
    const bad = exception({ date: '2026-11-05', expires: '2026-11-01' });
    expect(() => parseExceptions(JSON.stringify([bad]))).toThrow(/expires/);
  });

  it('accepts an optional image and rejects a blank one', () => {
    expect(parseExceptions(JSON.stringify([exception({ image: 'edge' })]))[0]?.image).toBe('edge');
    expect(() => parseExceptions(JSON.stringify([exception({ image: ' ' })]))).toThrow(/image/);
  });

  it('rejects a duplicated id, package and image triple', () => {
    expect(() => parseExceptions(JSON.stringify([exception(), exception()]))).toThrow(/duplicate/i);
  });
});

describe('the committed exceptions file', () => {
  it('is valid and every exception is short-lived (30 days) and tied to one image', () => {
    const file = resolve(import.meta.dirname, '../../../.github/image-scan-exceptions.json');
    const entries = parseExceptions(readFileSync(file, 'utf8'));
    for (const entry of entries) {
      const days = (Date.parse(entry.expires) - Date.parse(entry.date)) / 86_400_000;
      expect(days, entry.id).toBeLessThanOrEqual(30);
      expect(entry.image, entry.id).toBeDefined();
    }
  });
});

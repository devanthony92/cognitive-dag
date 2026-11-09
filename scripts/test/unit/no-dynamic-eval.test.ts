import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * OWASP A05 and LLM10 (F8): production code never builds code from a string and never injects raw
 * HTML. The scan covers `apps/*\/src` and `packages/*\/src`; tests are not production code. The
 * list of exceptions is closed and empty: allowing one is a decision that needs an ADR.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const SOURCE_ROOTS = ['apps', 'packages'];
const EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/** `file:needle` pairs allowed to contain a forbidden construct. Empty on purpose. */
const EXCEPTIONS: readonly string[] = [];

const FORBIDDEN: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'eval(', pattern: /\beval\s*\(/ },
  { name: 'new Function(', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'dangerouslySetInnerHTML', pattern: /\bdangerouslySetInnerHTML\b/ },
];

function findForbidden(text: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (EXTENSIONS.test(entry)) files.push(path);
    }
  };
  for (const group of SOURCE_ROOTS) {
    for (const project of readdirSync(join(ROOT, group))) {
      const src = join(ROOT, group, project, 'src');
      try {
        if (statSync(src).isDirectory()) walk(src);
      } catch {
        // A project without `src` has nothing to scan.
      }
    }
  }
  return files;
}

describe('no dynamic code evaluation in production code', () => {
  it('scans the sources of every app and package', () => {
    const files = sourceFiles().map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.startsWith('apps/api/src/'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/web/src/'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/worker/src/'))).toBe(true);
    expect(files.some((file) => file.startsWith('packages/dag-schema/src/'))).toBe(true);
    expect(files.every((file) => !file.includes('/test/'))).toBe(true);
  });

  it('finds no eval(, new Function( or dangerouslySetInnerHTML', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const found = findForbidden(readFileSync(file, 'utf8'));
      const name = relative(ROOT, file).split(sep).join('/');
      for (const needle of found) {
        if (!EXCEPTIONS.includes(`${name}:${needle}`)) offenders.push(`${name}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the list of exceptions empty', () => {
    expect(EXCEPTIONS).toEqual([]);
  });

  describe('the detector', () => {
    it.each([
      ['eval(code)', 'eval('],
      ['  eval (code)', 'eval('],
      ['window.eval("1")', 'eval('],
      ['const f = new Function("a", "return a")', 'new Function('],
      ['new  Function ( "x" )', 'new Function('],
      ['<div dangerouslySetInnerHTML={{ __html: html }} />', 'dangerouslySetInnerHTML'],
    ])('flags %s', (sample, name) => {
      expect(findForbidden(sample)).toContain(name);
    });

    it.each([
      'const retrieval = 1;',
      'medieval(x)',
      'isFunction(x)',
      'type Function = () => void',
      'const label = "evaluate the rule";',
    ])('does not flag %s', (sample) => {
      expect(findForbidden(sample)).toEqual([]);
    });
  });
});

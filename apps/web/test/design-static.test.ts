/**
 * Static design rules (F10, FR-002, SC-002): reads the sources of `apps/web/src` and fails on what
 * DESIGN.md forbids. A file that still breaks a rule is listed in `design-static.allowlist.json` with
 * the rule and the reason; the test fails both when a file breaks a rule it is not excused from and
 * when an excuse is no longer needed, so the list only shrinks. It is empty at the end of PR 4.
 */
import { describe, expect, it } from 'vitest';
import allowlist from './design-static.allowlist.json';

const SOURCES = import.meta.glob<string>(['../src/**/*.{ts,tsx,css}', '!../src/routeTree.gen.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const PALETTE_NAMES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOUR_UTILITY =
  'bg|text|border|ring|ring-offset|fill|stroke|from|via|to|shadow|outline|divide|decoration|accent|caret|placeholder';

export const RULES = {
  'tailwind-palette': {
    describe: 'a fixed Tailwind palette colour (use a semantic token)',
    pattern: new RegExp(
      `\\b(?:${COLOUR_UTILITY})-(?:${PALETTE_NAMES})-\\d{2,3}\\b|\\b(?:bg|text|border|ring|fill|stroke|shadow|outline)-(?:white|black)\\b`,
    ),
  },
  'fixed-colour': {
    describe: 'a #hex, rgb(), hsl() or oklch() colour outside tokens.css',
    pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/,
  },
  'side-border': {
    describe: 'a side border wider than 1 px (The No Side Stripe Rule)',
    pattern: /\bborder-[lrse]-(?:[2-9]|\d{2,}|\[)/,
  },
  'page-width': {
    describe: 'a max-w-* that is not page-narrow, page-default or none in a route or page',
    pattern: /\bmax-w-(?!page-narrow\b|page-default\b|none\b)[^\s'"`]+/,
  },
  'small-text': {
    describe: 'text under 12 px',
    pattern: /\btext-\[(?:\d|1[01])(?:\.\d+)?px\]/,
  },
  'inline-style': {
    describe: 'a style attribute or a <style> element (the CSP forbids them)',
    pattern: /\bstyle=|<style\b/,
  },
} as const;

type RuleId = keyof typeof RULES;

interface Excuse {
  rules: RuleId[];
  reason: string;
}

const isPageFile = (file: string) => /^src\/routes\//.test(file) || /Page\.tsx$/.test(file);

/** Rules each file breaks, by path relative to `apps/web`, with `/` separators. */
export function scan(): Map<string, Set<RuleId>> {
  const found = new Map<string, Set<RuleId>>();
  for (const [key, text] of Object.entries(SOURCES)) {
    const file = key.replace(/^\.\.\//, '');
    const broken = new Set<RuleId>();
    for (const [id, rule] of Object.entries(RULES) as [RuleId, (typeof RULES)[RuleId]][]) {
      if (id === 'fixed-colour' && file === 'src/styles/tokens.css') continue;
      if (id === 'page-width' && !isPageFile(file)) continue;
      if (rule.pattern.test(text)) broken.add(id);
    }
    if (broken.size > 0) found.set(file, broken);
  }
  return found;
}

const excuses = allowlist as Record<string, Excuse>;

describe('design rules over apps/web/src', () => {
  const found = scan();

  it('flags nothing a file is not excused from', () => {
    const unexcused: string[] = [];
    for (const [file, rules] of found) {
      for (const id of rules) {
        if (!excuses[file]?.rules.includes(id)) unexcused.push(`${file}: ${RULES[id].describe}`);
      }
    }
    expect(unexcused).toEqual([]);
  });

  it('keeps no excuse a file has outgrown', () => {
    const stale: string[] = [];
    for (const [file, excuse] of Object.entries(excuses)) {
      for (const id of excuse.rules) {
        if (!found.get(file)?.has(id)) stale.push(`${file}: ${id}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('gives every excuse a reason', () => {
    for (const [file, excuse] of Object.entries(excuses)) {
      expect(excuse.reason.trim().length, file).toBeGreaterThan(10);
    }
  });

  it('finds the violations it is meant to find', () => {
    const sample = (id: RuleId, text: string) => RULES[id].pattern.test(text);
    expect(sample('tailwind-palette', 'bg-emerald-600')).toBe(true);
    expect(sample('tailwind-palette', 'text-white')).toBe(true);
    expect(sample('tailwind-palette', 'bg-surface text-ink-muted')).toBe(false);
    expect(sample('fixed-colour', 'color: #fff')).toBe(true);
    expect(sample('fixed-colour', 'rgb(0 0 0)')).toBe(true);
    expect(sample('fixed-colour', '#contenido')).toBe(false);
    expect(sample('side-border', 'border-l-4')).toBe(true);
    expect(sample('side-border', 'border-l')).toBe(false);
    expect(sample('page-width', 'max-w-5xl')).toBe(true);
    expect(sample('page-width', 'max-w-page-default')).toBe(false);
    expect(sample('small-text', 'text-[10px]')).toBe(true);
    expect(sample('small-text', 'text-[13px]')).toBe(false);
    expect(sample('inline-style', 'style={{ top: 1 }}')).toBe(true);
  });
});

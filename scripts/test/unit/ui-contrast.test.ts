import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAIRS, checkContrast, contrastRatio, oklchToRgb, parseTokens } from '../../ui/contrast.ts';

const TOKENS_PATH = new URL('../../../apps/web/src/styles/tokens.css', import.meta.url);
const css = readFileSync(TOKENS_PATH, 'utf8');

describe('contrast math', () => {
  it('converts the OKLCH extremes to sRGB', () => {
    expect(oklchToRgb(1, 0, 0)).toEqual([255, 255, 255]);
    expect(oklchToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('gives the WCAG ratio of black on white (21:1) and of a colour on itself (1:1)', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 30, 200], [120, 30, 200])).toBeCloseTo(1, 5);
  });
});

describe('design tokens (FR-005, SC-004)', () => {
  const tokens = parseTokens(css);

  it('defines every token of the contract in both modes', () => {
    for (const pair of PAIRS) {
      for (const name of [pair.fg, pair.bg]) {
        expect(tokens.light[name], `${name} (claro)`).toBeDefined();
        expect(tokens.dark[name], `${name} (oscuro)`).toBeDefined();
      }
    }
  });

  it('never uses pure black or pure white for the grounds (Enamel Rule)', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(tokens[mode].ground).not.toMatch(/oklch\(\s*(0|1)\s+0\s+0\s*\)/);
    }
  });

  const results = checkContrast(css);

  it('declares at least one pair per kind of text, glyph, border and focus', () => {
    expect(results).toHaveLength(PAIRS.length);
    expect(results.length).toBeGreaterThanOrEqual(40);
  });

  it.each(results.map((result) => [result.label, result] as const))(
    '%s meets its minimum ratio in light and dark',
    (_label, result) => {
      for (const mode of ['light', 'dark'] as const) {
        const ratio = result.ratios[mode];
        expect(
          ratio,
          `${result.fg} sobre ${result.bg} en ${mode}: ${ratio.toFixed(2)}:1, mínimo ${result.min}:1`,
        ).toBeGreaterThanOrEqual(result.min);
      }
    },
  );
});

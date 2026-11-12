/**
 * Contrast check of the design tokens (F10, FR-005, SC-004). It reads `apps/web/src/styles/tokens.css`,
 * converts each OKLCH colour to sRGB and measures the WCAG 2.x contrast ratio of the declared pairs in
 * the light and the dark mode. No dependencies: `node scripts/ui/contrast.ts` prints the table and
 * exits 1 if a pair falls below its minimum; `ui-contrast.test.ts` runs the same check in CI.
 *
 * Tokens come in two shapes: `--name: light-dark(<light>, <dark>)` and `--name: <colour>` (the same in
 * both modes). Colours that fall outside sRGB are clipped per channel, as a browser does when it
 * cannot show them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Mode = 'light' | 'dark';
export type Rgb = [number, number, number];

export interface TokenSet {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface Pair {
  fg: string;
  bg: string;
  /** 4.5 for normal text; 3 for large text, glyphs, borders of controls and the focus ring. */
  min: 4.5 | 3;
  label: string;
}

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.%]+\s*)?\)$/;

export function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const channel = (value: number): number => {
    const clipped = Math.min(1, Math.max(0, value));
    const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  };
  return [channel(linear[0]!), channel(linear[1]!), channel(linear[2]!)];
}

export function parseColor(text: string): Rgb {
  const match = OKLCH.exec(text.trim());
  if (!match) throw new Error(`Colour not understood (only oklch() is allowed): ${text}`);
  return oklchToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

function luminance([r, g, b]: Rgb): number {
  const linear = (value: number): number => {
    const unit = value / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const PAIRED =
  /--([a-z0-9-]+)\s*:\s*light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)\s*;/g;
const SINGLE = /--([a-z0-9-]+)\s*:\s*(oklch\([^)]*\))\s*;/g;

/** Reads the colour tokens of `tokens.css`, names without the leading `--`. */
export function parseTokens(css: string): TokenSet {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const [, name, day, night] of css.matchAll(PAIRED)) {
    light[name!] = day!;
    dark[name!] = night!;
  }
  for (const [, name, value] of css.matchAll(SINGLE)) {
    if (name! in light) continue;
    light[name!] = value!;
    dark[name!] = value!;
  }
  return { light, dark };
}

const STATES = ['running', 'succeeded', 'failed', 'waiting', 'cancelled', 'skipped', 'reused'];
const CATEGORIES = ['trigger', 'logic', 'llm', 'http', 'approval', 'mock'];
const GROUNDS = ['ground', 'surface', 'raised'];

function text(fg: string, bg: string, min: 4.5 | 3 = 4.5): Pair {
  return { fg, bg, min, label: `texto ${fg} sobre ${bg}` };
}

/** Pairs the interface relies on. Add one here when a token starts carrying text or a glyph. */
export const PAIRS: Pair[] = [
  ...GROUNDS.flatMap((bg) => [text('ink', bg), text('ink-muted', bg)]),
  text('on-action', 'action'),
  // Messages in the failure colour are text (error under a field, alert).
  ...['ground', 'surface'].map((bg) => text('state-failed', bg)),
  // The other states are glyphs and borders; their label is written in `ink`.
  ...STATES.flatMap((state) =>
    ['ground', 'surface'].map((bg) => ({
      fg: `state-${state}`,
      bg,
      min: 3 as const,
      label: `glifo state-${state} sobre ${bg}`,
    })),
  ),
  ...CATEGORIES.flatMap((category) =>
    ['ground', 'surface'].map((bg) => ({
      fg: `node-${category}`,
      bg,
      min: 3 as const,
      label: `pictograma node-${category} sobre ${bg}`,
    })),
  ),
  // Borders that identify a control (field, checkbox) and the focus ring.
  ...['ground', 'surface'].map((bg) => ({
    fg: 'line-strong',
    bg,
    min: 3 as const,
    label: `borde de control line-strong sobre ${bg}`,
  })),
  ...GROUNDS.map((bg) => ({
    fg: 'focus',
    bg,
    min: 3 as const,
    label: `anillo de foco sobre ${bg}`,
  })),
  { fg: 'state-failed', bg: 'raised', min: 3, label: 'glifo state-failed sobre raised' },
];

export interface PairResult extends Pair {
  ratios: Record<Mode, number>;
}

export function checkContrast(css: string): PairResult[] {
  const tokens = parseTokens(css);
  return PAIRS.map((pair) => {
    const ratio = (mode: Mode): number => {
      const fg = tokens[mode][pair.fg];
      const bg = tokens[mode][pair.bg];
      if (fg === undefined || bg === undefined) {
        throw new Error(`Missing token for ${pair.fg} or ${pair.bg} in ${mode} mode`);
      }
      return contrastRatio(parseColor(fg), parseColor(bg));
    };
    return { ...pair, ratios: { light: ratio('light'), dark: ratio('dark') } };
  });
}

function main(): void {
  const css = readFileSync(
    new URL('../../apps/web/src/styles/tokens.css', import.meta.url),
    'utf8',
  );
  let failures = 0;
  for (const result of checkContrast(css)) {
    for (const mode of ['light', 'dark'] as const) {
      const ratio = result.ratios[mode];
      const ok = ratio >= result.min;
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} ${ratio.toFixed(2).padStart(5)}:1 (min ${result.min}) ${result.label}`,
      );
    }
  }
  if (failures > 0) {
    console.error(`${failures} contrast pair(s) below the minimum`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  main();
}

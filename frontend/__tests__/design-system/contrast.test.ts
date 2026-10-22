// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * U1a: WCAG AA (4.5:1) for the small-text token pairs the app leans on —
 * muted text on selected rows/cards (`secondary`/`muted`), status text in
 * badges and tables — in both themes. Reads the real tokens from index.css,
 * so a token tweak that breaks contrast fails here, not in review.
 */
const CSS = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');

function block(selector: ':root' | '.dark'): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

type RGB = [number, number, number]; // linear sRGB, 0..1

function oklchToLinearSrgb(value: string): RGB {
  const m = value.match(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`not an oklch() colour: ${value}`);
  const L = m[2] ? +m[1] / 100 : +m[1];
  const C = +m[3];
  const h = (+m[4] * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
}

const toGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

/** `fg/alpha` over `bg`, blended in gamma sRGB like the browser does. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => toLinear(alpha * toGamma(c) + (1 - alpha) * toGamma(bg[i]))) as RGB;
}

const luminance = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
/** WCAG 1.4.11 non-text contrast (focus rings, UI component borders). */
const NON_TEXT = 3;

describe.each([
  ['light', block(':root')],
  ['dark', block('.dark')],
] as const)('%s theme — small text meets WCAG AA', (_theme, t) => {
  const c = (name: string) => oklchToLinearSrgb(t[name]);

  it.each([
    ['foreground', 'background'],
    ['foreground', 'card'],
    ['foreground', 'secondary'],
    ['secondary-foreground', 'secondary'],
    ['muted-foreground', 'background'],
    ['muted-foreground', 'card'],
    ['muted-foreground', 'secondary'],
    ['muted-foreground', 'muted'],
    ['warning', 'card'],
    ['warning', 'background'],
  ])('%s on %s', (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(AA);
  });

  // U2a: the focus ring must be visible on every surface it sits on.
  it.each([
    ['ring', 'background'],
    ['ring', 'card'],
    ['ring', 'popover'],
    ['sidebar-ring', 'sidebar'],
  ])('focus ring %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(NON_TEXT);
  });

  // Status badges: text-{tone} on bg-{tone}/10 over a card.
  it.each(['warning', 'success', 'destructive', 'info'])('badge text on its 10 percent tint: %s', (tone) => {
    if (!t[tone]) return;
    expect(contrast(c(tone), over(c(tone), 0.1, c('card')))).toBeGreaterThanOrEqual(AA);
  });
});

describe('contrast helper sanity', () => {
  it('black on white is 21:1', () => {
    expect(contrast(oklchToLinearSrgb('oklch(0 0 0)'), oklchToLinearSrgb('oklch(1 0 0)'))).toBeCloseTo(21, 0);
  });
});

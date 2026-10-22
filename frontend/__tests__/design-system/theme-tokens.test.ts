// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../../tailwind.config';

/**
 * R1: the app is full taupe (Andriy, 2026-10-22) — no purple brand colour.
 * Compiles the real app stylesheet (index.css + every class used in src/)
 * and fails on any purple colour literal, then checks the legacy purple
 * `accent-*` ramp now resolves through taupe theme tokens.
 */
const ROOT = path.resolve(__dirname, '../..');
const CSS_IN = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');

let compiled = '';
beforeAll(async () => {
  const result = await postcss([
    tailwindcss({ ...config, content: [path.join(ROOT, 'index.html'), path.join(ROOT, 'src/**/*.{ts,tsx}')] }),
  ]).process(CSS_IN.replace(/^@import .*$/m, ''), { from: undefined });
  compiled = result.css;
}, 60_000);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Purple/violet: hue 250–320°, clearly saturated. */
function isPurpleRgb(r: number, g: number, b: number): boolean {
  const [h, s] = rgbToHsl(r, g, b);
  return h >= 250 && h <= 320 && s > 0.25;
}

function purpleLiterals(css: string): string[] {
  const hits: string[] = [];
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (isPurpleRgb(r, g, b)) hits.push(m[0]);
  }
  // rgb(124 92 245) / rgb(124, 92, 245) and bare CSS-var triplets "124 92 245;"
  for (const m of css.matchAll(/(?:rgba?\(|:\s*)(\d{1,3})[ ,]+(\d{1,3})[ ,]+(\d{1,3})\b/g)) {
    if (isPurpleRgb(+m[1], +m[2], +m[3])) hits.push(m[0]);
  }
  // oklch(L C H) with real chroma in the violet hue band.
  for (const m of css.matchAll(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/g)) {
    const c = +m[2], h = +m[3];
    if (c > 0.05 && h >= 260 && h <= 330) hits.push(m[0]);
  }
  return hits;
}

describe('full taupe theme', () => {
  it('the compiled app CSS has no purple colour literal', () => {
    expect(compiled.length).toBeGreaterThan(10_000);
    expect(purpleLiterals(compiled)).toEqual([]);
  });

  it('the detector does catch the old brand purple', () => {
    expect(purpleLiterals('--accent-500: 124 92 245; a{color:#6d40e6} b{c:oklch(0.488 0.243 264.376)}')).toHaveLength(3);
  });

  it.each(['bg-accent-500', 'text-accent-600', 'ring-accent-500', 'border-accent-400', 'text-accent-300', 'from-accent-500'])(
    '.%s resolves through a theme token',
    async (cls) => {
      const { css } = await postcss([
        tailwindcss({ ...config, content: [{ raw: cls, extension: 'html' }] }),
      ]).process('@tailwind utilities;', { from: undefined });
      const rule = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
      expect(rule, cls).not.toBeNull();
      expect(rule![1]).toMatch(/var\(--accent-\d+\)/);
    }
  );

  it.each([':root', '.dark'])('%s defines the accent ramp from taupe tokens and the status tokens', (sel) => {
    const block = CSS_IN.match(new RegExp(`\\n  ${sel.replace('.', '\\.')} \\{([\\s\\S]*?)\\n  \\}`))![1];
    for (const n of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(block, `--accent-${n}`).toMatch(new RegExp(`--accent-${n}: (var\\(--|oklch\\()`));
    }
    for (const t of ['success', 'warning', 'info']) {
      expect(block).toMatch(new RegExp(`--${t}: oklch\\(`));
      expect(block).toMatch(new RegExp(`--${t}-foreground: `));
    }
  });

  it('wires success / warning / info into Tailwind', async () => {
    const classes = ['bg-success', 'text-warning', 'text-info', 'bg-warning/10', 'text-success-foreground'];
    const { css } = await postcss([
      tailwindcss({ ...config, content: [{ raw: classes.join(' '), extension: 'html' }] }),
    ]).process('@tailwind utilities;', { from: undefined });
    for (const cls of classes) {
      expect(css, cls).toContain(`.${cls.replace('/', '\\/')}`);
    }
  });
});

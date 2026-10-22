// Finds Tailwind class tokens that Tailwind 3 (with this project's config)
// compiles to nothing. The shadcn registry now ships Tailwind 4 syntax
// (`data-open:`, `max-h-(--x)`, `ring-3`, `**:`, trailing `!` …) which
// Tailwind 3 silently ignores — the class is in the markup but has no CSS.
// Used by __tests__/design-system/tw3-classes.test.ts and
// scripts/tw3-dead-classes.mjs.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = require('jiti')(root, { interopDefault: true });
const resolveConfig = require('tailwindcss/resolveConfig');
const { createContext } = require('tailwindcss/lib/lib/setupContextUtils');
const { generateRules } = require('tailwindcss/lib/lib/generateRules');

const context = createContext(resolveConfig(jiti('./tailwind.config.ts')));

export function compiles(token) {
  return generateRules(new Set([token]), context).length > 0;
}

// Bare utilities that exist in Tailwind 4 but not 3 (no variant syntax to
// give them away).
const TW4_BARE = /^-?(outline-hidden|ring-3|shadow-xs|shadow-2xs|rounded-xs|inset-shadow.*|inset-ring.*|text-shadow.*|bg-linear-.*|bg-radial.*|field-sizing-.*|scheme-.*|-?z-1|underline-offset-3|wrap-.*|text-balance|font-heading)!?$/;

/**
 * Class-ish tokens from string literals: we only judge tokens that carry
 * Tailwind syntax (a variant `:`, arbitrary `[]`/`()`, `!`, `/` opacity) or
 * are known Tailwind-4-only utilities. Plain kebab words are skipped because
 * they are indistinguishable from data-slot values, cva variant keys, etc.
 */
export function candidateTokens(source) {
  const tokens = new Set();
  for (const m of source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
    for (const t of m[2].split(/\s+/)) {
      if (!t || t.includes('${') || t.startsWith('--') || t.startsWith('var(') || t.startsWith('@/') || t.startsWith('./') || t.startsWith('../')) continue;
      if (/^(https?:|data-slot|aria-label|group\/|peer\/)/.test(t) || /[A-Za-z]\.[A-Za-z]+\(/.test(t)) continue;
      if (/[:\[\]()!]/.test(t) || /^[a-z-]+\/[\w.]+$/.test(t) || TW4_BARE.test(t)) tokens.add(t);
    }
  }
  return [...tokens].filter((t) => /^[!*@a-z\[-]/.test(t));
}

/** `group/x`-style names and `@container/x` are markers, not utilities. */
const MARKERS = /^(group|peer)\/[\w-]+$|^@container(\/[\w-]+)?$/;

export function findDeadClasses(source) {
  // Tailwind 4 CSS functions (`--spacing(6)`, `--alpha(…)`) compile inside an
  // arbitrary property but produce invalid CSS under Tailwind 3.
  return candidateTokens(source).filter(
    (t) => !MARKERS.test(t) && (/--(spacing|alpha)\(/.test(t) || !compiles(t))
  );
}

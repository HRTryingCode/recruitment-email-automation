// Rewrites the structural Tailwind 4 class syntax the shadcn registry emits
// into Tailwind 3 equivalents, in place. Run it on every file `shadcn add`
// writes, then check with `node scripts/tw3-dead-classes.mjs <files>`:
//
//   node scripts/tw4-to-tw3.mjs src/components/ui/dropdown-menu.tsx …
//
// Named state variants (data-open, data-active …) need no rewrite — the
// tailwind.shadcn-compat.ts plugin provides them.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Split on `:` outside brackets/parens (arbitrary values contain colons). */
function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of token) {
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === ':' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** `data-[k=v]` / `data-foo` / `aria-[x]` / `aria-foo` → attribute selector. */
function attrSelector(v) {
  let m = v.match(/^(data|aria)-\[(.+)\]$/);
  if (m) return `[${m[1]}-${m[2]}]`;
  m = v.match(/^aria-([a-z-]+)$/);
  if (m) return `[aria-${m[1]}=true]`;
  m = v.match(/^data-([a-z-]+)$/);
  if (m) return `[data-${m[1]}]`;
  return null;
}

const NAMED_DATA = {
  horizontal: 'orientation=horizontal',
  vertical: 'orientation=vertical',
  open: 'state=open',
  closed: 'state=closed',
  active: 'state=active',
  checked: 'state=checked',
  unchecked: 'state=unchecked',
};

function convertVariant(v, next) {
  // `*:[img:first-child]` → `[&>img:first-child]` (consumes the next part).
  if (v === '*' && next && /^\[[^&].*\]$/.test(next)) return { out: `[&>${next.slice(1, -1)}]`, skip: 1 };
  // `**:data-[x]` → `[&_[data-x]]`; bare `**` → `[&_*]`.
  if (v === '**') {
    const sel = next && attrSelector(next);
    if (sel) return { out: `[&_${sel}]`, skip: 1 };
    return { out: '[&_*]', skip: 0 };
  }
  // `[a]` / `[.border-b]` (v4 arbitrary variant without &) → `[&:is(a)]` / `[&.border-b]`.
  if (/^\[[^&@].*\]$/.test(v)) {
    const inner = v.slice(1, -1);
    return { out: inner.startsWith('.') ? `[&${inner}]` : `[&:is(${inner})]`, skip: 0 };
  }
  // `has-data-[k=v]` / `has-aria-x` (optionally `group-has-…/name`).
  let m = v.match(/^(group-|peer-)?has-((?:data|aria)-[^/]+)(\/[\w-]+)?$/);
  if (m) {
    const sel = attrSelector(m[2]);
    if (sel) return { out: `${m[1] ?? ''}has-[${sel}]${m[3] ?? ''}`, skip: 0 };
  }
  // `not-data-[x]` / `not-aria-[x]` → `[&:not([…])]`.
  m = v.match(/^not-((?:data|aria)-.+)$/);
  if (m) {
    const sel = attrSelector(m[1]);
    if (sel) return { out: `[&:not(${sel})]`, skip: 0 };
  }
  // `in-data-[x]` → `[[data-x]_&]`.
  m = v.match(/^in-((?:data|aria)-.+)$/);
  if (m) {
    const sel = attrSelector(m[1]);
    if (sel) return { out: `[${sel}_&]`, skip: 0 };
  }
  // Named group/peer state with a group name: `group-data-horizontal/tabs`.
  m = v.match(/^(group|peer)-data-([a-z]+)\/([\w-]+)$/);
  if (m && NAMED_DATA[m[2]]) return { out: `${m[1]}-data-[${NAMED_DATA[m[2]]}]/${m[3]}`, skip: 0 };
  m = v.match(/^supports-([a-z-]+)$/);
  if (m && !v.startsWith('supports-[')) return { out: `supports-[${m[1]}]`, skip: 0 };
  return { out: v, skip: 0 };
}

function convertUtility(u) {
  let important = '';
  if (u.endsWith('!') && !u.startsWith('!')) {
    important = '!';
    u = u.slice(0, -1);
  }
  if (u.startsWith('!')) {
    important = '!';
    u = u.slice(1);
  }
  // Tailwind 4 theme functions inside arbitrary values: `--spacing(6)`.
  u = u.replace(/--spacing\(([\d.]+)\)/g, 'calc(0.25rem*$1)');
  // `max-h-(--x)` → `max-h-[var(--x)]`; `-z-(--x)` likewise.
  u = u.replace(/^(-?[a-z-]+)-\((--[\w-]+)\)$/, '$1-[var($2)]');
  return important + u;
}

export function convertToken(token) {
  const parts = splitVariants(token);
  const utility = parts.pop();
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const { out: v, skip } = convertVariant(parts[i], parts[i + 1]);
    out.push(v);
    i += skip;
  }
  // Tailwind 3 applies stacked variants right-to-left, Tailwind 4
  // left-to-right (`*:last:x` in v4 is `last:*:x` in v3), so reverse.
  out.reverse();
  const u = convertUtility(utility);
  // Tailwind 3 wants `!` before the variants' utility, not inside them.
  if (u.startsWith('!')) return `${out.length ? out.join(':') + ':' : ''}${u}`;
  return [...out, u].join(':');
}

export function convertSource(source) {
  return source.replace(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g, (lit, q, body) => {
    if (!/[:()!]/.test(body) || /^(@|\.|https?:)/.test(body)) return lit;
    const next = body
      .split(/(\s+)/)
      .map((t) => (/^\s+$/.test(t) || !t || t.includes('${') ? t : convertToken(t)))
      .join('');
    return q + next + q;
  });
}

// Not idempotent (variant order is reversed), so converted files carry a
// marker and are skipped on later runs.
export const MARKER = '// @tw3-converted by scripts/tw4-to-tw3.mjs — do not re-run on this file';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) {
    const before = fs.readFileSync(file, 'utf8');
    if (before.includes('@tw3-converted')) {
      console.log(`skip ${file} (already converted)`);
      continue;
    }
    const converted = convertSource(before);
    // After a leading "use client" directive, else at the top.
    const after = /^["']use client["'];?\n/.test(converted)
      ? converted.replace(/^(["']use client["'];?\n)/, `$1\n${MARKER}\n`)
      : `${MARKER}\n${converted}`;
    if (after !== before) {
      fs.writeFileSync(file, after);
      console.log(`rewrote ${file}`);
    }
  }
}

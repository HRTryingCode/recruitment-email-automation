// Design-system audit: every hand-rolled UI pattern outside
// src/components/ui, with file:line, grouped by refactor batch (R1–R4).
// Source of truth for docs/DESIGN-SYSTEM.md's hotspot inventory and for
// __tests__/design-system/hotspots.test.ts.
//
//   node scripts/design-system-audit.mjs            # summary per area/rule
//   node scripts/design-system-audit.mjs --markdown # full inventory tables
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');

/** Which refactor batch owns each file (paths relative to src/). */
export const AREAS = {
  R1: 'Shell — App, main, pages (Login, Index, NotFound), nav, ThemeToggle, MailboxFilter, ProtectedRoute, lib',
  R2: 'Dashboard — Dashboard, UnmonitoredSenders',
  R3: 'Candidates — CandidateTable, LookupBar, LookupIntegrations, LeverBadge',
  R4: 'Drafts — EmailDrafts, DraftReviewPane, DraftCcSelect, useDraftKeyboardShortcuts',
};

const AREA_BY_FILE = [
  [/^components\/(Dashboard|UnmonitoredSenders)\.tsx$/, 'R2'],
  [/^components\/(CandidateTable|LookupBar|LookupIntegrations|LeverBadge)\.tsx$/, 'R3'],
  [/^components\/(EmailDrafts|DraftReviewPane|DraftCcSelect)\.tsx$/, 'R4'],
  [/^hooks\/useDraftKeyboardShortcuts\.ts$/, 'R4'],
  // Everything else (pages, App, main, shell components, lib, other hooks,
  // and any new file nobody claimed yet) belongs to the shell batch.
  [/./, 'R1'],
];

export function areaFor(rel) {
  return AREA_BY_FILE.find(([re]) => re.test(rel))[1];
}

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
const COLOR_UTIL =
  'bg|text|border|border-[trblxy]|ring|ring-offset|from|via|to|fill|stroke|outline|divide|shadow|decoration|placeholder|caret|accent';

/**
 * Each rule: id, what to use instead, and a per-line regex. A line can match
 * several rules; each match is one finding.
 */
export const RULES = [
  { id: 'raw-button', fix: 'ui/button (Button, asChild for links)', re: /<button\b/g },
  { id: 'raw-input', fix: 'ui/input, ui/checkbox, ui/input-group', re: /<input\b/g },
  { id: 'raw-select', fix: 'ui/select', re: /<select\b/g },
  { id: 'raw-textarea', fix: 'ui/textarea', re: /<textarea\b/g },
  { id: 'raw-table', fix: 'ui/table (Table, TableRow, TableCell …)', re: /<(table|thead|tbody|tfoot|tr|td|th)\b/g },
  { id: 'raw-label', fix: 'ui/label', re: /<label\b/g },
  { id: 'raw-img', fix: 'ui/avatar for people; keep <img> only for content images', re: /<img\b/g },
  { id: 'raw-svg', fix: 'lucide-react icon', re: /<svg\b/g },
  { id: 'raw-kbd', fix: 'ui/kbd', re: /<kbd\b/g },
  { id: 'custom-combobox', fix: 'ui/command (inside ui/popover or ui/dialog)', re: /role=["'](combobox|listbox|option|menu|menuitem)["']/g },
  { id: 'custom-disclosure', fix: 'ui/collapsible', re: /aria-expanded=\{/g },
  { id: 'input-adornment', fix: 'ui/input-group (InputGroupAddon)', re: /pointer-events-none absolute\b|\babsolute\b[^"'`]*-translate-y-1\/2/g },
  { id: 'decorative-effect', fix: 'drop it, or a token-based variant in ui/', re: /(?<![\w-])(?:[\w-]+:)*(?:blur-(?:sm|md|lg|xl|2xl|3xl)|bg-gradient-to-[a-z]+|backdrop-blur(?:-[a-z0-9]+)?|grid-bg)(?![\w-])/g },
  { id: 'raw-dialog', fix: 'ui/dialog, ui/alert-dialog, ui/sheet', re: /<dialog\b|role=["']dialog["']/g },
  {
    id: 'custom-overlay',
    fix: 'ui/dialog, ui/sheet, ui/popover (no hand-positioned layers)',
    re: /\bfixed\b[^"'`]*\binset-0\b|\binset-0\b[^"'`]*\bfixed\b/g,
  },
  {
    id: 'direct-radix',
    fix: 'the ui/ wrapper (dropdown-menu, tabs, tooltip, popover …)',
    re: /from ['"](@radix-ui\/react-[\w-]+|radix-ui)['"]/g,
  },
  { id: 'custom-spinner', fix: 'ui/spinner', re: /\banimate-spin\b/g },
  { id: 'custom-skeleton', fix: 'ui/skeleton', re: /\banimate-pulse\b/g },
  { id: 'native-tooltip', fix: 'ui/tooltip', re: /\stitle=\{?["'`]/g },
  { id: 'non-lucide-icon', fix: 'lucide-react', re: /from ['"](react-icons[\w/-]*|@heroicons\/[\w/-]+|@radix-ui\/react-icons|@tabler\/icons-react)['"]/g },
  { id: 'hex-colour', fix: 'a CSS-variable token (bg-primary, text-muted-foreground …)', re: /#[0-9a-fA-F]{3,8}\b(?![\w-])/g },
  { id: 'css-colour-fn', fix: 'a CSS-variable token', re: /\b(rgba?|hsla?|oklch|oklab|color-mix)\(/g },
  {
    id: 'palette-colour',
    fix: 'a semantic token (destructive, muted-foreground, chart-1 …)',
    re: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${COLOR_UTIL})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`, 'g'),
  },
  {
    id: 'legacy-token',
    fix: 'shadcn token (foreground, muted-foreground, card, border, primary …)',
    re: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${COLOR_UTIL})-(?:fg|surface|line|ink|accent-\\d{2,3})(?:-[\\w]+)?(?:\\/[\\d.\\[\\]]+)?(?![\\w-])`, 'g'),
  },
  { id: 'ad-hoc-shadow', fix: 'component elevation (Card, popover) — no shadow-* outside ui', re: /(?<![\w-])(?:[\w-]+:)*shadow(?:-(?:sm|md|lg|xl|2xl|inner|none|glow|card-hover|\[[^\]]+\]))?(?![\w-])/g },
  { id: 'ad-hoc-radius', fix: 'component radius (rounded-* lives in ui/)', re: /(?<![\w-])(?:[\w-]+:)*rounded(?:-(?:[trblse]{1,2}-)?(?:none|sm|md|lg|xl|2xl|3xl|4xl|full|\[[^\]]+\]))?(?![\w-])/g },
  { id: 'ad-hoc-z-index', fix: 'ui overlay components manage stacking', re: /(?<![\w-])(?:[\w-]+:)*-?z-(?:\d+|\[[^\]]+\])(?![\w-])/g },
  { id: 'arbitrary-value', fix: 'the spacing/type scale (text-xs, gap-2 …)', re: /(?<![\w-])(?:[\w-]+:)*(?:text|p[xytrbl]?|m[xytrbl]?|gap|w|h|min-w|max-w|min-h|max-h|top|left|right|bottom|leading|tracking)-\[[^\]]+\](?![\w-])/g },
  { id: 'inline-style', fix: 'Tailwind classes / component props (style only for truly dynamic values)', re: /style=\{\{/g },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(SRC, 'components', 'ui')) continue;
      out.push(...walk(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Whole-line comments are skipped so documentation doesn't count. */
function isComment(line) {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

export function audit(srcDir = SRC) {
  const findings = [];
  for (const file of walk(srcDir).sort()) {
    const rel = path.relative(srcDir, file).split(path.sep).join('/');
    const area = areaFor(rel);
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (isComment(line)) return;
        for (const rule of RULES) {
          for (const m of line.matchAll(rule.re)) {
            findings.push({ file: `src/${rel}`, line: i + 1, rule: rule.id, match: m[0], area });
          }
        }
      });
  }
  return findings;
}

export function summarize(findings) {
  const byArea = {};
  for (const a of Object.keys(AREAS)) byArea[a] = { total: 0, rules: {} };
  for (const f of findings) {
    byArea[f.area].total++;
    byArea[f.area].rules[f.rule] = (byArea[f.area].rules[f.rule] ?? 0) + 1;
  }
  return byArea;
}

/** Markdown: per area, per file, per rule → line numbers. */
export function toMarkdown(findings) {
  const lines = [];
  const summary = summarize(findings);
  lines.push('| Batch | Scope | Findings |', '|---|---|---:|');
  for (const [a, desc] of Object.entries(AREAS)) lines.push(`| ${a} | ${desc} | ${summary[a].total} |`);
  lines.push(`| **Total** | | **${findings.length}** |`, '');
  for (const [a, desc] of Object.entries(AREAS)) {
    lines.push(`### ${a} — ${desc.split(' — ')[0]} (${summary[a].total})`, '');
    const ruleCounts = Object.entries(summary[a].rules).sort((x, y) => y[1] - x[1]);
    lines.push(ruleCounts.map(([r, n]) => `\`${r}\` ${n}`).join(' · ') || '_none_', '');
    const files = [...new Set(findings.filter((f) => f.area === a).map((f) => f.file))];
    for (const file of files) {
      const inFile = findings.filter((f) => f.file === file);
      lines.push(`**\`${file}\`** (${inFile.length})`, '', '| Rule | Lines | Examples |', '|---|---|---|');
      for (const rule of RULES) {
        const hits = inFile.filter((f) => f.rule === rule.id);
        if (!hits.length) continue;
        const lineNos = [...new Set(hits.map((h) => h.line))].join(', ');
        const examples = [...new Set(hits.map((h) => h.match))].slice(0, 4).map((e) => `\`${e.replace(/\|/g, '\\|')}\``).join(' ');
        lines.push(`| \`${rule.id}\` (${hits.length}) | ${lineNos} | ${examples} |`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = audit();
  if (process.argv.includes('--markdown')) {
    console.log(toMarkdown(findings));
  } else {
    const summary = summarize(findings);
    for (const [a, s] of Object.entries(summary)) {
      console.log(`${a}: ${s.total}  ${Object.entries(s.rules).map(([r, n]) => `${r}=${n}`).join(' ')}`);
    }
    console.log(`total: ${findings.length}`);
  }
}

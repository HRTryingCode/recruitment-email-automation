// Design-system lint (see docs/DESIGN-SYSTEM.md). Scope is deliberately
// narrow: it only enforces "use src/components/ui, not hand-rolled UI".
//
// "error" for the whole app since R4 (the last batch): `npm run lint:ds`
// fails CI on any hand-rolled UI. __tests__/design-system/eslint-guard.test.ts
// pins this.
//
// TODO(orchestrator): R3 (Candidates) was not merged when R4 flipped the
// rules, so R3_FILES stay at "warn". Once R3 lands with zero findings, delete
// R3_FILES and the override block below, add 'R3' to STRICT_AREAS in
// __tests__/design-system/hotspots.test.ts, and update eslint-guard.test.ts.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const DS_SEVERITY = 'error';

const R3_FILES = [
  'src/components/{CandidateTable,LookupBar,LookupIntegrations,LeverBadge,AddToLeverButton,AddToLeverDialog,GemConnect,GemReturnToast,JobCombobox}.tsx',
];

const RAW_ELEMENTS = [
  ['button', 'Button'],
  ['input', 'Input / Checkbox / InputGroup'],
  ['select', 'Select'],
  ['textarea', 'Textarea'],
  ['table', 'Table'],
  ['thead', 'TableHeader'],
  ['tbody', 'TableBody'],
  ['tfoot', 'TableFooter'],
  ['tr', 'TableRow'],
  ['th', 'TableHead'],
  ['td', 'TableCell'],
  ['label', 'Label'],
  ['dialog', 'Dialog / AlertDialog / Sheet'],
  ['kbd', 'Kbd'],
  ['img', 'Avatar (people) — plain <img> only for content images'],
  ['svg', 'a lucide-react icon'],
];

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
const LEGACY = 'fg|surface|line|ink|accent-\\d{2,3}';
const COLOR_CLASS = `(^|\\s|:)(bg|text|border|ring|from|via|to|fill|stroke|outline|divide|decoration|placeholder|caret)-(${PALETTE}|${LEGACY})(?![a-z])`;

export default tseslint.config(
  { ignores: ['dist/**', 'src/components/ui/**', '**/*.d.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    // Registered (rules not enabled) so existing `eslint-disable
    // react-hooks/…` comments resolve.
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: dsRules(DS_SEVERITY),
  },
  { files: R3_FILES, rules: dsRules('warn') }
);

function dsRules(severity) {
  return {
    'no-restricted-syntax': [
      severity,
      ...RAW_ELEMENTS.map(([el, use]) => ({
        selector: `JSXOpeningElement[name.name='${el}']`,
        message: `Raw <${el}> outside components/ui — use ui ${use}.`,
      })),
      {
        selector: "JSXAttribute[name.name='style']",
        message: 'Inline style — use Tailwind classes or a ui component prop (style only for truly dynamic values).',
      },
      {
        selector: `Literal[value=/${COLOR_CLASS}/]`,
        message: 'Hard-coded colour class — use a shadcn token (primary, muted-foreground, destructive, chart-N …).',
      },
      {
        selector: `TemplateElement[value.raw=/${COLOR_CLASS}/]`,
        message: 'Hard-coded colour class — use a shadcn token (primary, muted-foreground, destructive, chart-N …).',
      },
      {
        selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
        message: 'Hex colour — use a CSS-variable token.',
      },
    ],
    'no-restricted-imports': [
      severity,
      {
        patterns: [
          { group: ['@radix-ui/*', 'radix-ui'], message: 'Import the wrapper from @/components/ui instead of Radix directly.' },
          { group: ['react-icons', 'react-icons/*', '@heroicons/*', '@radix-ui/react-icons', '@tabler/*'], message: 'lucide-react is the only icon set.' },
        ],
      },
    ],
  };
}

import plugin from 'tailwindcss/plugin';

/**
 * Tailwind 3 shim for the Tailwind-4-only bits the shadcn registry emits.
 *
 * Mirrors the `@custom-variant`s in `shadcn/tailwind.css` (data-open,
 * data-active, data-horizontal …) plus Tailwind 4's bare boolean `data-*` /
 * `aria-*` variants, so registry components keep their state styling under
 * Tailwind 3. Structural v4 syntax Tailwind 3 cannot express (`x-(--var)`,
 * trailing `!`, `**:`, `has-data-*:`) is rewritten by scripts/tw4-to-tw3.mjs
 * instead. __tests__/design-system/tw3-classes.test.ts fails if a ui
 * component still carries a class that compiles to nothing.
 */
const STATE_VARIANTS: Record<string, string[]> = {
  'data-open': ['&[data-state="open"]', '&[data-open]:not([data-open="false"])'],
  'data-closed': ['&[data-state="closed"]', '&[data-closed]:not([data-closed="false"])'],
  'data-checked': ['&[data-state="checked"]', '&[data-checked]:not([data-checked="false"])'],
  'data-unchecked': ['&[data-state="unchecked"]', '&[data-unchecked]:not([data-unchecked="false"])'],
  'data-selected': ['&[data-selected="true"]'],
  'data-disabled': ['&[data-disabled="true"]', '&[data-disabled]:not([data-disabled="false"])'],
  'data-active': ['&[data-state="active"]', '&[data-active]:not([data-active="false"])'],
  'data-horizontal': ['&[data-orientation="horizontal"]'],
  'data-vertical': ['&[data-orientation="vertical"]'],
  // Tailwind 4 native boolean data attributes used by Radix.
  'data-highlighted': ['&[data-highlighted]'],
  'data-placeholder': ['&[data-placeholder]'],
  'data-inset': ['&[data-inset]'],
  'data-pressed': ['&[data-pressed]'],
  // Tailwind 4 `aria-invalid:` (Tailwind 3 only ships a fixed aria-* set).
  'aria-invalid': ['&[aria-invalid="true"]'],
};

export default plugin(({ addVariant, addUtilities }) => {
  for (const [name, selectors] of Object.entries(STATE_VARIANTS)) {
    addVariant(name, selectors);
    // Unnamed group/peer forms; named ones (`group-data-…/tabs`) are rewritten
    // to Tailwind 3's `group-data-[…]/tabs` by the codemod.
    addVariant(`group-${name}`, selectors.map((s) => `:merge(.group)${s.slice(1)} &`));
    addVariant(`peer-${name}`, selectors.map((s) => `:merge(.peer)${s.slice(1)} ~ &`));
  }
  addUtilities({
    '.outline-hidden': { outline: '2px solid transparent', 'outline-offset': '2px' },
    '.no-scrollbar': { '-ms-overflow-style': 'none', 'scrollbar-width': 'none' },
    '.no-scrollbar::-webkit-scrollbar': { display: 'none' },
  });
});

/** Theme scale entries Tailwind 4 has and Tailwind 3 lacks. */
export const shadcnCompatTheme = {
  ringWidth: { 3: '3px' },
  spacing: { 18: '4.5rem' },
  zIndex: { 1: '1' },
  textUnderlineOffset: { 3: '3px' },
  boxShadow: { xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
  fontFamily: { heading: 'var(--font-heading, inherit)' },
};

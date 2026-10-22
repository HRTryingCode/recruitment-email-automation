// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs build scripts, no type declarations.
import { findDeadClasses } from '../../scripts/tw3-classes.mjs';
// @ts-expect-error — plain .mjs build scripts, no type declarations.
import { convertToken, convertSource } from '../../scripts/tw4-to-tw3.mjs';

const UI = path.resolve(__dirname, '../../src/components/ui');

describe('components/ui compiles under Tailwind 3', () => {
  // The shadcn registry ships Tailwind 4 class syntax; Tailwind 3 silently
  // emits nothing for it. New components: run scripts/tw4-to-tw3.mjs on them.
  const files = fs.readdirSync(UI).filter((f) => f.endsWith('.tsx'));

  it.each(files)('%s has no dead Tailwind classes', (file) => {
    expect(findDeadClasses(fs.readFileSync(path.join(UI, file), 'utf8'))).toEqual([]);
  });
});

describe('findDeadClasses', () => {
  it('flags Tailwind 4 syntax and passes Tailwind 3 / shimmed classes', () => {
    const src = `cn("flex max-h-(--x) **:data-[slot=a]:p-2 animate-none! [--s:--spacing(6)] data-open:animate-in ring-3 aria-invalid:border-destructive")`;
    expect(findDeadClasses(src)).toEqual(['max-h-(--x)', '**:data-[slot=a]:p-2', 'animate-none!', '[--s:--spacing(6)]']);
  });
});

describe('tw4-to-tw3 codemod', () => {
  it.each([
    ['max-h-(--radix-x)', 'max-h-[var(--radix-x)]'],
    ['animate-none!', '!animate-none'],
    ['hover:bg-muted!', 'hover:!bg-muted'],
    // Tailwind 3 stacks variants right-to-left, Tailwind 4 left-to-right.
    ['*:[span]:last:flex', 'last:[&>span]:flex'],
    ['**:data-[slot=kbd]:px-1.5', '[&_[data-slot=kbd]]:px-1.5'],
    ['has-data-[icon=inline-end]:pr-2', 'has-[[data-icon=inline-end]]:pr-2'],
    ['has-aria-expanded:bg-muted/50', 'has-[[aria-expanded=true]]:bg-muted/50'],
    ['not-data-[variant=destructive]:focus:**:text-accent-foreground', '[&_*]:focus:[&:not([data-variant=destructive])]:text-accent-foreground'],
    ['in-data-[slot=tooltip-content]:text-background', '[[data-slot=tooltip-content]_&]:text-background'],
    ['group-data-vertical/tabs:w-full', 'group-data-[orientation=vertical]/tabs:w-full'],
    ['[a]:hover:bg-muted', 'hover:[&:is(a)]:bg-muted'],
    ['[.border-b]:pb-6', '[&.border-b]:pb-6'],
    ['supports-backdrop-filter:backdrop-blur-sm', 'supports-[backdrop-filter]:backdrop-blur-sm'],
    ['[--card-spacing:--spacing(6)]', '[--card-spacing:calc(0.25rem*6)]'],
    ['gap-[--spacing(var(--gap))]', 'gap-[calc(0.25rem*var(--gap))]'],
  ])('%s → %s', (from, to) => {
    expect(convertToken(from)).toBe(to);
    expect(findDeadClasses(`"${to}"`)).toEqual([]);
  });

  it('leaves non-class strings alone', () => {
    const src = 'const id = `chart-${uniqueId.replace(/:/g, "")}`; import x from "@/lib/utils";';
    expect(convertSource(src)).toBe(src);
  });
});

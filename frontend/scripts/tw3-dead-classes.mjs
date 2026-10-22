// Lists Tailwind class tokens in the given files that Tailwind 3 (with this
// project's config) compiles to nothing — usually Tailwind 4 syntax pasted in
// from the shadcn registry (`data-open:`, `max-h-(--x)`, `ring-3`, `**:` …).
//   node scripts/tw3-dead-classes.mjs src/components/ui/*.tsx
import fs from 'node:fs';
import { findDeadClasses } from './tw3-classes.mjs';

const files = process.argv.slice(2);
let total = 0;
for (const file of files) {
  const dead = findDeadClasses(fs.readFileSync(file, 'utf8'));
  if (dead.length) console.log(`${file}\n  ${dead.join('\n  ')}`);
  total += dead.length;
}
console.log(`${total} dead class token(s)`);

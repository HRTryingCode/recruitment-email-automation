// @vitest-environment node
// @ts-expect-error — plain .mjs build script, no type declarations.
import { audit, summarize, AREAS } from '../../scripts/design-system-audit.mjs';

/**
 * Design-system guard: hand-rolled UI outside src/components/ui (raw
 * <button>/<input>/<table>, palette/legacy colour classes, ad-hoc radius,
 * shadow, z-index, inline styles …). See docs/DESIGN-SYSTEM.md.
 *
 * REPORT-ONLY for now: prints the per-batch baseline on every run (CI
 * included). Each refactor batch drives its area to zero and then adds it
 * here, which makes the area fail on any regression. The last batch adds
 * the final area and flips the ESLint rules in eslint.config.mjs to "error".
 */
const STRICT_AREAS: string[] = ['R1'];

type Finding = { file: string; line: number; rule: string; match: string; area: string };

describe('design-system hotspots', () => {
  const findings: Finding[] = audit();
  const summary: Record<string, { total: number; rules: Record<string, number> }> = summarize(findings);

  it('reports the baseline per batch', () => {
    const rows = Object.keys(AREAS).map((a) => {
      const rules = Object.entries(summary[a].rules)
        .sort((x, y) => y[1] - x[1])
        .map(([r, n]) => `${r}=${n}`)
        .join(' ');
      return `  ${a} ${STRICT_AREAS.includes(a) ? '[strict]' : '[report]'} ${summary[a].total}  ${rules}`;
    });
    console.info(`[design-system] hand-rolled UI outside components/ui: ${findings.length}\n${rows.join('\n')}`);
    expect(Object.keys(summary)).toEqual(Object.keys(AREAS));
  });

  it.each(STRICT_AREAS.length ? STRICT_AREAS : ['(none yet)'])('strict area %s has zero findings', (area) => {
    if (!STRICT_AREAS.includes(area)) return;
    const left = findings.filter((f) => f.area === area).map((f) => `${f.file}:${f.line} ${f.rule} ${f.match}`);
    expect(left).toEqual([]);
  });
});

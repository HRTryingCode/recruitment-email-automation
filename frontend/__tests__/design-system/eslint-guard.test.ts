// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';

/**
 * R4 flipped the design-system ESLint rules (eslint.config.mjs) to "error"
 * for the whole app. R3's files stay at "warn" until R3 merges — see the
 * TODO in eslint.config.mjs.
 */
const ROOT = path.resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: ROOT });

const RAW_BUTTON = 'export const X = () => <button className="text-red-500">x</button>;\n';

async function severities(file: string): Promise<number[]> {
  const [result] = await eslint.lintText(RAW_BUTTON, { filePath: path.join(ROOT, file) });
  return result.messages.map((m) => m.severity);
}

describe('design-system ESLint guard', () => {
  it.each(['src/pages/TodayPage.tsx', 'src/components/today/New.tsx', 'src/components/inbox/New.tsx', 'src/components/Brand.tsx'])(
    'hand-rolled UI is an error in %s',
    async (file) => {
      const s = await severities(file);
      expect(s.length).toBeGreaterThanOrEqual(2);
      expect(s.every((x) => x === 2)).toBe(true);
    }
  );

  it('R3 files are still warn-only (TODO: flip after R3 merges)', async () => {
    expect(await severities('src/components/CandidateTable.tsx')).toEqual([1, 1]);
  });

  it('the app has zero design-system lint errors', async () => {
    const results = await eslint.lintFiles(['src']);
    const errors = results.flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${path.relative(ROOT, r.filePath)}:${m.line} ${m.message}`)
    );
    expect(errors).toEqual([]);
  }, 60_000);
});

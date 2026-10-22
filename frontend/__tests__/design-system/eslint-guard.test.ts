// @vitest-environment node
import path from 'node:path';
import { ESLint } from 'eslint';

/**
 * R4 flipped the design-system ESLint rules (eslint.config.mjs) to "error"
 * for the whole app; R3 removed the last warn-only override (Candidates).
 */
const ROOT = path.resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: ROOT });

const RAW_BUTTON = 'export const X = () => <button className="text-red-500">x</button>;\n';

async function severities(file: string): Promise<number[]> {
  const [result] = await eslint.lintText(RAW_BUTTON, { filePath: path.join(ROOT, file) });
  return result.messages.map((m) => m.severity);
}

describe('design-system ESLint guard', () => {
  it.each([
    'src/pages/TodayPage.tsx',
    'src/components/today/New.tsx',
    'src/components/inbox/New.tsx',
    'src/components/Brand.tsx',
    'src/components/CandidateTable.tsx',
    'src/components/candidates/New.tsx',
    'src/components/LeverBadge.tsx',
  ])(
    'hand-rolled UI is an error in %s',
    async (file) => {
      const s = await severities(file);
      expect(s.length).toBeGreaterThanOrEqual(2);
      expect(s.every((x) => x === 2)).toBe(true);
    }
  );

  it('the app has zero design-system lint errors', async () => {
    const results = await eslint.lintFiles(['src']);
    const errors = results.flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${path.relative(ROOT, r.filePath)}:${m.line} ${m.message}`)
    );
    expect(errors).toEqual([]);
  }, 60_000);
});

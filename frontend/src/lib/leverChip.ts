import type { LeverCandidateFields, LeverState } from './api';

export type LeverChipState = LeverState | 'CHECKING';
export type LeverChipVariant = 'info' | 'success' | 'secondary' | 'outline' | 'warning';

const CHIP: Record<LeverChipState, { text: string; variant: LeverChipVariant }> = {
  ACTIVE: { text: 'In Lever', variant: 'info' },
  HIRED: { text: 'Hired', variant: 'success' },
  ARCHIVED: { text: 'Archived', variant: 'secondary' },
  NOT_FOUND: { text: 'Not in Lever', variant: 'outline' },
  ERROR: { text: 'Lever unknown', variant: 'warning' },
  // Never checked yet (H1): the table/cron fill it in. "Lever unknown" is real ERRORs only.
  CHECKING: { text: 'Checking Lever…', variant: 'outline' },
};

function join(...parts: Array<string | null | undefined>): string | null {
  return parts.filter((p): p is string => !!p).join(' · ') || null;
}

/**
 * The Lever state chip shared by the Candidates table badge (LeverBadge) and
 * the side panel / Inbox Lever section: same word and colour for each state,
 * plus the state's detail (job · stage, archived reason, hired job).
 */
export function leverChip(
  f: Partial<Pick<LeverCandidateFields, 'leverPostingTitle' | 'leverStage' | 'leverArchivedReason'>> & {
    leverState?: LeverState | null;
  }
): { state: LeverChipState; text: string; variant: LeverChipVariant; detail: string | null } {
  const state: LeverChipState = f.leverState ?? 'CHECKING';
  const detail =
    state === 'ACTIVE'
      ? join(f.leverPostingTitle, f.leverStage)
      : state === 'ARCHIVED'
        ? join(f.leverArchivedReason)
        : state === 'HIRED'
          ? join(f.leverPostingTitle)
          : null;
  return { state, ...CHIP[state], detail };
}

// The hand-off "looping in <CC>" sentence. One source for the Claude prompt,
// the template fallback and the CC-change re-render (F4), so a CC change can
// find the sentence a draft was generated with and swap just the name.
// Pronoun-free on purpose: the CC can be any admin.
import type { HandoffType } from '../services/claude.service';

const TAILS: Record<HandoffType, string> = {
  coordinator: 'schedule time with you and share more about the position.',
  sofia_interviews: 'be interviewing you and will get some time on the calendar.',
  ethan_interviews_sofia_schedules: 'coordinate timing for the interview.',
};

export function loopInSentence(type: HandoffType, ccName: string): string {
  return `I'm looping in ${ccName} from the recruitment team here, who will ${TAILS[type]}`;
}

const NAME = `([^\\s(),]+)`;

/** Escape for RegExp, accepting straight or curly apostrophes and any dash. */
function fuzzy(text: string): string {
  return text
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/'/g, "['’]")
    .replace(/ — /g, '\\s*[—–-]{1,2}\\s*');
}

// Current phrasing first, then what pre-F4 drafts said (template fallback and
// the old Claude instruction, which carried the CC address in parentheses).
const PATTERNS: Array<{ type: HandoffType; re: RegExp }> = [
  ...(Object.keys(TAILS) as HandoffType[]).map((type) => ({
    type,
    re: new RegExp(`I['’]m looping in ${NAME} ${fuzzy(`from the recruitment team here, who will ${TAILS[type]}`)}`),
  })),
  ...([
    ['coordinator', ' from the recruitment team here to schedule time with you and share more about the position.'],
    ['sofia_interviews', " from the recruitment team here — she'll be interviewing you and will get some time on the calendar."],
    ['ethan_interviews_sofia_schedules', ' from the recruitment team here to coordinate timing for the interview.'],
    ['coordinator', " — she'll share more details about the position and get some time on the calendar."],
    ['sofia_interviews', " — she's the interviewer and will get something on the calendar with you."],
    ['ethan_interviews_sofia_schedules', " — she'll coordinate timing for the interview on both our ends."],
  ] as Array<[HandoffType, string]>).map(([type, tail]) => ({
    type,
    re: new RegExp(`I['’]m looping in ${NAME}(?: \\([^)]*\\))?${fuzzy(tail)}`),
  })),
];

/**
 * Replace the first recognised loop-in sentence with the same hand-off type's
 * sentence naming `newName`. `replaced: false` (text unchanged) when the
 * recruiter has reworded it, so the caller can ask them to fix it by hand.
 */
export function replaceLoopIn(text: string, newName: string): { text: string; replaced: boolean } {
  for (const { type, re } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    return {
      text: text.slice(0, m.index) + loopInSentence(type, newName) + text.slice(m.index + m[0].length),
      replaced: true,
    };
  }
  return { text, replaced: false };
}

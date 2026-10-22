import { describe, it, expect } from 'vitest';
import { loopInSentence, replaceLoopIn } from '../../src/lib/handoffLoopIn';
import type { HandoffType } from '../../src/services/claude.service';

const TYPES: HandoffType[] = ['coordinator', 'sofia_interviews', 'ethan_interviews_sofia_schedules'];
const PRONOUN = /\b(she|he|her|his|him)\b|she'll|he'll|she's|he's/i;

function body(loopIn: string): string {
  return `Hi Jane,\n\nThanks for the note.\n\n${loopIn}\n\nBest,\nAaron Rampersad`;
}

describe('loopInSentence', () => {
  it.each(TYPES)('%s: names the CC and uses no pronouns', (type) => {
    const s = loopInSentence(type, 'Ethan');
    expect(s).toMatch(/^I'm looping in Ethan from the recruitment team here, who will /);
    expect(s).not.toMatch(PRONOUN);
  });

  it('matches the copy in the brief for the scheduling hand-off', () => {
    expect(loopInSentence('ethan_interviews_sofia_schedules', 'Ethan')).toBe(
      "I'm looping in Ethan from the recruitment team here, who will coordinate timing for the interview."
    );
  });
});

describe('replaceLoopIn', () => {
  it.each(TYPES)('%s: swaps the name in place and leaves the rest of the body alone', (type) => {
    const out = replaceLoopIn(body(loopInSentence(type, 'Sofia')), 'Ethan');
    expect(out.replaced).toBe(true);
    expect(out.text).toBe(body(loopInSentence(type, 'Ethan')));
  });

  it('rewrites a legacy template sentence ("she\'ll") into the pronoun-free form', () => {
    const legacy =
      "I'm looping in Sofia from the recruitment team here — she'll be interviewing you and will get some time on the calendar.";
    const out = replaceLoopIn(body(legacy), 'Catalina');
    expect(out.replaced).toBe(true);
    expect(out.text).toBe(body(loopInSentence('sofia_interviews', 'Catalina')));
  });

  it('rewrites a legacy Claude sentence with the CC address in parentheses', () => {
    const legacy =
      "I'm looping in Sofia (sofia@archive.com) — she'll coordinate timing for the interview on both our ends.";
    const out = replaceLoopIn(body(legacy), 'Ethan');
    expect(out.replaced).toBe(true);
    expect(out.text).toBe(body(loopInSentence('ethan_interviews_sofia_schedules', 'Ethan')));
  });

  it('leaves a recruiter-edited sentence untouched and reports it', () => {
    const edited = body("Sofia from our team will reach out to find a time.");
    const out = replaceLoopIn(edited, 'Ethan');
    expect(out.replaced).toBe(false);
    expect(out.text).toBe(edited);
  });

  it('leaves a body with no loop-in untouched', () => {
    const plain = body('Happy to share the JD — attached.');
    expect(replaceLoopIn(plain, 'Ethan')).toEqual({ text: plain, replaced: false });
  });
});

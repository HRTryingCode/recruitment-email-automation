// Shared test vectors for normalizeLinkedinUrl. The frontend mirror
// (frontend/src/lib/linkedin.ts) runs against this same table so the two
// implementations can't drift.
export const LINKEDIN_URL_CASES: ReadonlyArray<readonly [string, string | null]> = [
  // Gem's get_person returns linkedin_url without a scheme (prod, 2026-10-22).
  ['www.linkedin.com/in/alexander-betit-0ab8302a', 'https://www.linkedin.com/in/alexander-betit-0ab8302a'],
  ['www.linkedin.com/in/x', 'https://www.linkedin.com/in/x'],
  ['linkedin.com/in/x', 'https://www.linkedin.com/in/x'],
  ['http://linkedin.com/in/x', 'https://www.linkedin.com/in/x'],
  ['https://uk.linkedin.com/in/x/', 'https://www.linkedin.com/in/x/'],
  ['LinkedIn.com/in/x?trk=public_profile', 'https://www.linkedin.com/in/x'],
  ['  https://www.linkedin.com/in/jane#about  ', 'https://www.linkedin.com/in/jane'],
  ['//www.linkedin.com/in/x', 'https://www.linkedin.com/in/x'],
  ['https://www.linkedin.com/in/jane', 'https://www.linkedin.com/in/jane'],
  ['evil.com/linkedin.com', null],
  ['https://evil.com/linkedin.com/in/x', null],
  ['https://linkedin.com.evil.com/in/x', null],
  ['https://evillinkedin.com/in/x', null],
  ['javascript:alert(1)', null],
  ['javascript://www.linkedin.com/in/x', null],
  ['ftp://linkedin.com/in/x', null],
  ['https://user:pw@www.linkedin.com/in/x', null],
  ['https://www.linkedin.com:8443/in/x', null],
  ['https://www.linkedin.com/', null],
  ['not a url', null],
];

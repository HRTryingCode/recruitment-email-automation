import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { LIVE_DRAFT_STATUSES, CANCELABLE_DRAFT_STATUSES } from '../../src/lib/draftStatus';

describe('draft status sets', () => {
  it('counts the one-step-send states as live', () => {
    expect([...LIVE_DRAFT_STATUSES].sort()).toEqual(['APPROVED', 'FAILED', 'PENDING', 'SCHEDULED', 'SENDING']);
  });

  it('never cancels an in-flight send', () => {
    expect(CANCELABLE_DRAFT_STATUSES).toContain('SCHEDULED');
    expect(CANCELABLE_DRAFT_STATUSES).not.toContain('SENDING');
  });

  it('the 9g_inbox live-draft index covers exactly LIVE_DRAFT_STATUSES', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../prisma/migrations/9g_inbox/migration.sql'), 'utf8');
    const m = sql.match(/CREATE UNIQUE INDEX "EmailDraft_threadId_live_key"[^;]*WHERE "status" IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const listed = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(listed).toEqual([...LIVE_DRAFT_STATUSES].sort());
  });
});

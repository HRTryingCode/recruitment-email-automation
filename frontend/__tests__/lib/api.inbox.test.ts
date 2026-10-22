// U0 inbox endpoints: the client must hit the right URL with the right body.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/lib/api';

const ok = { data: { success: true, data: {} } };

describe('inbox API client (U0)', () => {
  let post: ReturnType<typeof vi.spyOn>;
  let get: ReturnType<typeof vi.spyOn>;
  let patch: ReturnType<typeof vi.spyOn>;
  let del: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    post = vi.spyOn(client.api, 'post').mockResolvedValue(ok);
    get = vi.spyOn(client.api, 'get').mockResolvedValue(ok);
    patch = vi.spyOn(client.api, 'patch').mockResolvedValue(ok);
    del = vi.spyOn(client.api, 'delete').mockResolvedValue(ok);
  });
  afterEach(() => vi.restoreAllMocks());

  it('fetchInbox passes view, mailbox, order and cursor as query params', async () => {
    await client.fetchInbox({ view: 'interested', mailboxId: 'mb', order: 'oldest', cursor: 'c1' });
    expect(get).toHaveBeenCalledWith('/inbox', { params: { view: 'interested', mailboxId: 'mb', order: 'oldest', cursor: 'c1' } });
  });

  it('fetchInbox sends role filters as a repeated ?role= param', async () => {
    await client.fetchInbox({ view: 'needs_review', order: 'newest', role: ['Engineer, Platform', '__none__'] });
    const [url, config] = get.mock.calls[0] as [string, { params: URLSearchParams }];
    expect(url).toBe('/inbox');
    expect(config.params.toString()).toBe('view=needs_review&order=newest&role=Engineer%2C+Platform&role=__none__');
  });

  it('one-step send, undo, dismiss, snooze and unsnooze', async () => {
    await client.scheduleSendDraft('d1', { undoSeconds: 10, bodyText: 'Hi', override: true });
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/send', { undoSeconds: 10, bodyText: 'Hi', override: true });
    await client.undoSendDraft('d1');
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/undo-send', {});
    await client.dismissDraft('d1', { reason: 'spam', note: 'n' });
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/dismiss', { reason: 'spam', note: 'n' });
    await client.snoozeDraft('d1', '2026-10-23T13:00:00.000Z');
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/snooze', { until: '2026-10-23T13:00:00.000Z' });
    await client.unsnoozeDraft('d1');
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/unsnooze', {});
  });

  it('legacy sendDraft still posts no body (APPROVED drafts)', async () => {
    await client.sendDraft('d1');
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/send');
  });

  it('presence heartbeat and clear', async () => {
    await client.heartbeatDraftPresence('d1', 'editing');
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/presence', { mode: 'editing' });
    await client.clearDraftPresence('d1');
    expect(del).toHaveBeenLastCalledWith('/drafts/d1/presence');
  });

  it('regenerate passes keepEdits; batch send passes ids', async () => {
    await client.regenerateDraft('d1', { keepEdits: false });
    expect(post).toHaveBeenLastCalledWith('/drafts/d1/regenerate', { keepEdits: false });
    await client.batchSendDrafts(['a', 'b'], 15);
    expect(post).toHaveBeenLastCalledWith('/drafts/batch-send', { draftIds: ['a', 'b'], undoSeconds: 15 });
  });

  it('saved views CRUD', async () => {
    await client.fetchSavedViews('candidates');
    expect(get).toHaveBeenLastCalledWith('/views', { params: { scope: 'candidates' } });
    await client.createSavedView({ name: 'n', scope: 'inbox', filters: {}, shared: true });
    expect(post).toHaveBeenLastCalledWith('/views', { name: 'n', scope: 'inbox', filters: {}, shared: true });
    await client.updateSavedView('v1', { name: 'm' });
    expect(patch).toHaveBeenLastCalledWith('/views/v1', { name: 'm' });
    await client.deleteSavedView('v1');
    expect(del).toHaveBeenLastCalledWith('/views/v1');
  });
});

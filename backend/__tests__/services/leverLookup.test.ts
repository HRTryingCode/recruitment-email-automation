import { describe, it, expect, vi } from 'vitest';
import { leverLookupIntegration } from '../../src/services/leverLookup';
import type { LeverStatus } from '../../src/services/lever.service';

const primary = {
  id: 'opp1',
  postingTitle: 'Founding Engineer',
  stage: 'Interest Call',
  archived: false,
  hired: false,
  archivedReason: null,
  createdAt: null,
  updatedAt: null,
  leverUrl: 'https://hire.lever.co/candidates/opp1',
};
const checkedAt = '2026-10-22T12:00:00.000Z';

function client(result: LeverStatus | Promise<LeverStatus>, configured = true) {
  return { configured, findByEmail: vi.fn(() => Promise.resolve(result)) };
}

describe('leverLookupIntegration (F1 integrations.lever contract)', () => {
  it('is absent (undefined) when Lever is not configured', async () => {
    const c = client({ state: 'ERROR', reason: 'unconfigured', primary: null, opportunities: [], checkedAt }, false);
    expect(await leverLookupIntegration('a@b.com', c)).toBeUndefined();
    expect(c.findByEmail).not.toHaveBeenCalled();
  });

  it('maps ACTIVE/ARCHIVED/HIRED to FOUND with display fields', async () => {
    const out = await leverLookupIntegration(
      'arron@arrongould.com',
      client({ state: 'ACTIVE', primary, opportunities: [primary], checkedAt })
    );
    expect(out).toEqual({
      status: 'FOUND',
      state: 'ACTIVE',
      primary,
      opportunities: [primary],
      opportunityCount: 1,
      checkedAt,
    });
  });

  it('maps NOT_FOUND', async () => {
    const out = await leverLookupIntegration('x@y.com', client({ state: 'NOT_FOUND', primary: null, opportunities: [], checkedAt }));
    expect(out).toMatchObject({ status: 'NOT_FOUND', state: 'NOT_FOUND', primary: null });
  });

  it('maps a Lever error to ERROR with a short message and never throws', async () => {
    const out = await leverLookupIntegration(
      'x@y.com',
      client({ state: 'ERROR', reason: 'http_503', primary: null, opportunities: [], checkedAt })
    );
    expect(out).toMatchObject({ status: 'ERROR', state: 'ERROR', message: 'Lever request failed (http_503)' });
  });

  it('reports ERROR/timeout when Lever is slower than the lookup budget', async () => {
    const never = new Promise<LeverStatus>(() => {});
    const out = await leverLookupIntegration('x@y.com', client(never), { timeoutMs: 10 });
    expect(out).toMatchObject({ status: 'ERROR', message: 'Lever request failed (timeout)' });
  });

  it('turns an unexpected throw into ERROR', async () => {
    const c = { configured: true, findByEmail: vi.fn(() => Promise.reject(new Error('boom'))) };
    expect(await leverLookupIntegration('x@y.com', c)).toMatchObject({ status: 'ERROR' });
  });
});

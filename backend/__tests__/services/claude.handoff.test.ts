import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: createMock };
  },
}));

import {
  getHandoffType,
  generateHandoffDraftReply,
  generateDraftReply,
  classifyReply,
  PROMPT_VERSIONS,
} from '../../src/services/claude.service';
import { config } from '../../src/config';

// M4: one row per real connected mailbox (prod Mailbox table, 2026-10-22).
describe('getHandoffType per real mailbox address (M4)', () => {
  const ethanAddresses = ['emaenza@archive.com', 'ethanmaenza@archive.com', 'EMaenza@Archive.com'];
  const coordinatorAddresses = [
    'aaronrampersad@archive.com',
    'paul@archive.com',
    'p.benigeri@archive.com',
    'pbenigeri@archive.com',
    'kayla@archive.com',
    'michaellee@archive.com',
    'lee.michael@archive.com',
  ];

  for (const addr of ethanAddresses) {
    it(`${addr}: Influencer role -> Ethan interviews, Sofia schedules`, () => {
      expect(getHandoffType(addr, 'Influencer Marketing Manager')).toBe('ethan_interviews_sofia_schedules');
    });
    it(`${addr}: CSM role -> Sofia interviews`, () => {
      expect(getHandoffType(addr, 'Customer Success Manager')).toBe('sofia_interviews');
      expect(getHandoffType(addr, 'CSM')).toBe('sofia_interviews');
    });
    it(`${addr}: other / unknown role -> safe coordinator framing`, () => {
      expect(getHandoffType(addr, 'Account Executive')).toBe('coordinator');
      expect(getHandoffType(addr, null)).toBe('coordinator');
    });
  }

  for (const addr of coordinatorAddresses) {
    it(`${addr}: coordinator framing regardless of role`, () => {
      expect(getHandoffType(addr, 'Influencer Marketing Manager')).toBe('coordinator');
      expect(getHandoffType(addr, 'Customer Success Manager')).toBe('coordinator');
    });
  }

  it('does not match on a substring of the address', () => {
    expect(getHandoffType('bethany@archive.com', 'Influencer Marketing')).toBe('coordinator');
  });

  it('Mailbox.handoffProfile overrides the address map', () => {
    expect(getHandoffType('kayla@archive.com', 'Influencer Marketing', 'ethan')).toBe('ethan_interviews_sofia_schedules');
    expect(getHandoffType('emaenza@archive.com', 'Influencer Marketing', 'coordinator')).toBe('coordinator');
  });
});

function draftResponse(body: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ subject: 'Re: x', bodyText: body }) }],
    usage: {
      input_tokens: 1200,
      output_tokens: 80,
      cache_read_input_tokens: 1400,
      cache_creation_input_tokens: 0,
    },
  };
}

const thread = {
  subject: 'Role at Archive',
  messages: [{ fromAddress: 'c@example.com', fromName: 'Cand', bodyText: 'Sounds great', receivedAt: new Date('2026-10-01T00:00:00Z') }],
  candidateName: 'Cand Idate',
  classification: 'INTERESTED' as const,
};
const caller = { email: 'emaenza@archive.com', displayName: 'Ethan Maenza' };

describe('model config + draft metadata (L13, M14)', () => {
  beforeEach(() => createMock.mockReset());

  it('defaults both model ids to the model prod runs today', () => {
    expect(config.claudeDraftModel).toBe('claude-sonnet-4-6');
    expect(config.claudeClassifierModel).toBe('claude-sonnet-4-6');
  });

  it('hand-off drafts use the configured draft model and report model, prompt version and usage', async () => {
    createMock.mockResolvedValueOnce(draftResponse('Hi Cand,\n\nLooping in Sofia.\n\nBest,'));
    const out = await generateHandoffDraftReply({ ...thread, ccName: 'Sofia', ccEmail: 'sofia@archive.com' }, caller);
    expect(createMock.mock.calls[0][0].model).toBe(config.claudeDraftModel);
    expect(out.meta).toEqual({
      model: config.claudeDraftModel,
      promptVersion: PROMPT_VERSIONS.handoff,
      usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 1400, cache_creation_input_tokens: 0 },
    });
  });

  it('regular drafts report reply prompt version', async () => {
    createMock.mockResolvedValueOnce(draftResponse('Hi Cand, thanks!'));
    const out = await generateDraftReply(thread, caller);
    expect(out.meta?.promptVersion).toBe(PROMPT_VERSIONS.reply);
  });

  it('classifier uses the configured classifier model', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"classification":"INTERESTED","messageType":"FOLLOWUP","needsReview":false,"confidence":0.9,"reasoning":"x","role":null}' }],
    });
    await classifyReply('yes', 'Cand');
    expect(createMock.mock.calls[0][0].model).toBe(config.claudeClassifierModel);
  });
});

describe('model ids are overridable from env (L13)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reads CLAUDE_DRAFT_MODEL / CLAUDE_CLASSIFIER_MODEL', async () => {
    vi.stubEnv('CLAUDE_DRAFT_MODEL', 'claude-sonnet-5-5');
    vi.stubEnv('CLAUDE_CLASSIFIER_MODEL', 'claude-haiku-5-5');
    vi.resetModules();
    const fresh = await import('../../src/config');
    expect(fresh.config.claudeDraftModel).toBe('claude-sonnet-5-5');
    expect(fresh.config.claudeClassifierModel).toBe('claude-haiku-5-5');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the Anthropic mock's create() so tests can program responses per case.
// Hoisted because vi.mock() is itself hoisted above the imports it transforms,
// so any variable the factory closes over must be hoisted too.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  // Default export = Anthropic class.
  return {
    default: class FakeAnthropic {
      messages = { create: createMock };
    },
  };
});

// Import AFTER vi.mock so the SUT picks up our fake Anthropic.
import { classifyReply } from '../../src/services/claude.service';

function textResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

describe('services/claude.service.classifyReply', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('parses a well-formed Claude response into ClassificationResult', async () => {
    createMock.mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          classification: 'INTERESTED',
          messageType: 'NEW_INQUIRY',
          needsReview: false,
          confidence: 0.93,
          reasoning: 'Candidate explicitly asks about next steps.',
        })
      )
    );

    const result = await classifyReply(
      'Hi! Yes, very interested — when can we chat?',
      'Jane Doe'
    );

    expect(result).toEqual({
      classification: 'INTERESTED',
      messageType: 'NEW_INQUIRY',
      needsReview: false,
      confidence: 0.93,
      reasoning: 'Candidate explicitly asks about next steps.',
    });
  });

  it('strips surrounding prose/markdown and parses the embedded JSON', async () => {
    createMock.mockResolvedValueOnce(
      textResponse(
        `Sure — here is the classification:\n\n\`\`\`json\n${JSON.stringify({
          classification: 'NOT_INTERESTED',
          messageType: 'FOLLOWUP',
          needsReview: false,
          confidence: 0.88,
          reasoning: 'Politely declines.',
        })}\n\`\`\`\nLet me know.`
      )
    );

    const result = await classifyReply('No thanks, not looking right now.', 'Bob');

    expect(result.classification).toBe('NOT_INTERESTED');
    expect(result.messageType).toBe('FOLLOWUP');
    expect(result.needsReview).toBe(false);
  });

  describe('Phase H defensive parsing', () => {
    it('falls back to NEUTRAL/AMBIGUOUS + needsReview when the response is malformed JSON', async () => {
      createMock.mockResolvedValueOnce(
        textResponse('Definitely interested!! {not actually json at all')
      );

      const result = await classifyReply('Yeah I am in', 'Carol');

      expect(result.classification).toBe('NEUTRAL');
      expect(result.messageType).toBe('AMBIGUOUS');
      expect(result.needsReview).toBe(true);
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toMatch(/Fallback applied/i);
    });

    it('falls back when the response contains no JSON object at all', async () => {
      createMock.mockResolvedValueOnce(
        textResponse('I cannot classify this email.')
      );

      const result = await classifyReply('???', 'Dan');

      expect(result.classification).toBe('NEUTRAL');
      expect(result.messageType).toBe('AMBIGUOUS');
      expect(result.needsReview).toBe(true);
      expect(result.reasoning).toMatch(/Fallback applied/i);
    });

    it('coerces missing fields into safe defaults and flags needsReview', async () => {
      createMock.mockResolvedValueOnce(
        textResponse(JSON.stringify({ classification: 'INTERESTED' }))
      );

      const result = await classifyReply('Interested!', 'Eve');

      // classification preserved (valid)
      expect(result.classification).toBe('INTERESTED');
      // messageType missing → AMBIGUOUS
      expect(result.messageType).toBe('AMBIGUOUS');
      // missing confidence → 0
      expect(result.confidence).toBe(0);
      // derived: low confidence + AMBIGUOUS → needsReview true
      expect(result.needsReview).toBe(true);
    });

    it('coerces an unknown classification value to NEUTRAL and flags review', async () => {
      createMock.mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            classification: 'MAYBE_LATER',
            messageType: 'NEW_INQUIRY',
            confidence: 0.9,
            reasoning: 'unclear',
          })
        )
      );

      const result = await classifyReply('hmmm', 'Frank');

      expect(result.classification).toBe('NEUTRAL');
      // Invalid classification → derived needsReview must be true even if
      // confidence is high.
      expect(result.needsReview).toBe(true);
    });

    it('clamps confidence into the [0, 1] range', async () => {
      createMock.mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            classification: 'INTERESTED',
            messageType: 'NEW_INQUIRY',
            needsReview: false,
            confidence: 4.2,
            reasoning: 'overly enthusiastic model',
          })
        )
      );

      const result = await classifyReply('yes', 'Gina');
      expect(result.confidence).toBe(1);
    });

    it('falls back to safe defaults when the Anthropic call throws', async () => {
      createMock.mockRejectedValueOnce(new Error('connection reset'));

      const result = await classifyReply('hello', 'Hank');

      expect(result.classification).toBe('NEUTRAL');
      expect(result.messageType).toBe('AMBIGUOUS');
      expect(result.needsReview).toBe(true);
      expect(result.reasoning).toMatch(/claude API error: connection reset/);
    });

    it('falls back when the response contains no text block', async () => {
      createMock.mockResolvedValueOnce({
        content: [{ type: 'image', source: { type: 'base64', data: '' } }],
      });

      const result = await classifyReply('hello', 'Ivy');

      expect(result.classification).toBe('NEUTRAL');
      expect(result.needsReview).toBe(true);
      expect(result.reasoning).toMatch(/no text content/i);
    });
  });
});

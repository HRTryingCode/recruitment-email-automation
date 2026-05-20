import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

const client = new Anthropic({
  apiKey: config.anthropicApiKey,
});

const ARCHIVE_SYSTEM_PROMPT = `You are an expert recruiting assistant for Archive, a company that values exceptional candidate experience. Your role is to help classify candidate email replies and generate personalized, professional responses.

## Archive's Communication Style

**Core Principles:**
- Professional yet personable — warm and human, not corporate
- Focused on the candidate experience — their time and journey matter
- Clear next steps — candidates always know what happens next
- Action-oriented — move conversations forward with purpose
- Concise — respect the candidate's time, no fluff or padding
- Genuine — authentic interest in the person, not just the role

**Tone Guidelines:**
- Start with acknowledgment, not pleasantries
- Be direct about timelines and expectations
- Use first names naturally
- Avoid corporate jargon like "synergy", "leverage", "circle back", "reach out"
- Avoid filler phrases like "Hope this email finds you well"
- Keep emails under 150 words when possible
- Use short paragraphs (1-3 sentences)

**Response Templates by Classification:**

For INTERESTED candidates:
- Acknowledge their interest warmly
- Confirm next steps clearly (interview scheduling, process details)
- Give a specific timeline
- End with a single clear call to action

For NOT_INTERESTED candidates:
- Thank them genuinely for their time and consideration
- Leave the door open professionally
- Be brief and respectful (3-4 sentences max)
- No hard sell or guilt

For NEUTRAL candidates (need more info):
- Acknowledge their questions/concerns directly
- Provide the specific information they need
- Make it easy for them to take the next step
- Keep the conversation moving forward

## Classification Criteria

**INTERESTED signals:**
- Explicitly expresses interest in the role
- Asks about next steps, process, timeline
- Requests more information in a positive tone
- Mentions specific aspects of the role/company they're excited about
- Available for a call/interview

**NOT_INTERESTED signals:**
- Explicitly declines
- Currently happy/not looking
- Already accepted another offer
- Timing isn't right
- Salary/role doesn't match expectations

**NEUTRAL signals:**
- Asking clarifying questions without commitment
- Wants more information before deciding
- Ambiguous response that doesn't clearly indicate direction
- Out of office / auto-reply`;

export interface ClassificationResult {
  classification: 'INTERESTED' | 'NOT_INTERESTED' | 'NEUTRAL';
  confidence: number;
  reasoning: string;
}

export interface DraftReplyResult {
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

export interface ThreadContext {
  subject: string;
  messages: Array<{
    fromAddress: string;
    fromName?: string | null;
    bodyText?: string | null;
    receivedAt: Date;
  }>;
  candidateName: string;
  classification: 'INTERESTED' | 'NOT_INTERESTED' | 'NEUTRAL';
}

// Build cached system block - use type assertion for cache_control
// which is supported at runtime but may not be in all SDK type definitions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CACHED_SYSTEM: any[] = [
  {
    type: 'text',
    text: ARCHIVE_SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' },
  },
];

export async function classifyReply(
  emailBody: string,
  candidateName: string
): Promise<ClassificationResult> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: CACHED_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Classify the following email reply from candidate ${candidateName}.

Respond with a JSON object in this exact format:
{
  "classification": "INTERESTED" | "NOT_INTERESTED" | "NEUTRAL",
  "confidence": <number between 0 and 1>,
  "reasoning": "<brief explanation>"
}

Email body:
${emailBody}`,
      },
    ],
  });

  const textContent = response.content.find((b) => b.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  try {
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse classification response: ${err}`);
  }
}

export async function generateDraftReply(
  thread: ThreadContext
): Promise<DraftReplyResult> {
  const messagesContext = thread.messages
    .map((m) => {
      const name = m.fromName ?? m.fromAddress;
      const date = m.receivedAt.toISOString();
      return `From: ${name} (${m.fromAddress}) at ${date}\n${m.bodyText ?? '(no text body)'}`;
    })
    .join('\n\n---\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: CACHED_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Generate a personalized reply email for candidate ${thread.candidateName}.

Thread subject: ${thread.subject}
Classification: ${thread.classification}

Full conversation thread:
${messagesContext}

Respond with a JSON object in this exact format:
{
  "subject": "<reply subject line>",
  "bodyText": "<plain text email body>",
  "bodyHtml": "<HTML formatted email body>"
}

Requirements:
- Follow Archive's communication style
- Be appropriate for the classification (${thread.classification})
- Keep it concise and action-oriented
- Subject should be prefixed with "Re: " if replying to existing thread
- HTML version should use simple formatting (no complex CSS)`,
      },
    ],
  });

  const textContent = response.content.find((b) => b.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  try {
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]) as DraftReplyResult;
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse draft reply response: ${err}`);
  }
}

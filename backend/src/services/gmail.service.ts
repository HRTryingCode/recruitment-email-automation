import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { prisma } from '../db/client';
import { classifyReply, generateDraftReply } from './claude.service';
import { logEvent } from './monitoring.service';
import { decrypt, encrypt } from '../lib/crypto';
import type { Mailbox } from '@prisma/client';

/**
 * Serialize an OAuth2 / service-account credentials object for storage.
 * Encrypts at rest with AES-256-GCM (see ../lib/crypto).
 */
export function serializeCredentials(creds: Record<string, unknown>): string {
  return encrypt(JSON.stringify(creds));
}

function parseCredentials(mailbox: Mailbox): Record<string, unknown> {
  const raw = mailbox.credentials;
  if (typeof raw !== 'string' || raw.length === 0) {
    return {};
  }

  // Try decrypting (current format). Fall back to plaintext JSON for rows
  // written before encryption was introduced.
  // TODO: remove plaintext fallback after backfill (re-encrypt all existing
  // Mailbox.credentials rows and remove this try/catch).
  try {
    const plaintext = decrypt(raw);
    return JSON.parse(plaintext) as Record<string, unknown>;
  } catch (decryptErr) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      console.warn(
        `[Gmail] Mailbox ${mailbox.id} credentials are stored as plaintext; ` +
          'they will be re-encrypted on next write. Remove plaintext fallback ' +
          'after backfilling.'
      );
      return parsed;
    } catch {
      console.error(
        `[Gmail] Failed to parse credentials for mailbox ${mailbox.id}:`,
        decryptErr
      );
      return {};
    }
  }
}

function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
}

function getAuthenticatedClient(credentials: Record<string, unknown>): OAuth2Client {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(credentials);
  return oauth2Client;
}

export function getAuthUrl(state: string): string {
  const oauth2Client = createOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state,
    prompt: 'consent',
  });
}

export async function handleCallback(code: string, mailboxId?: string): Promise<Mailbox> {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const emailAddress = profile.data.emailAddress ?? '';
  // Baseline historyId so the first incremental sync isn't empty.
  const baselineHistoryId = profile.data.historyId ?? null;

  const encryptedCreds = serializeCredentials(tokens as Record<string, unknown>);
  const mailbox = await prisma.mailbox.upsert({
    where: { emailAddress },
    update: {
      credentials: encryptedCreds,
      isActive: true,
      // Reset historyId baseline on reconnect so the next webhook starts fresh.
      lastHistoryId: baselineHistoryId,
      updatedAt: new Date(),
    },
    create: {
      provider: 'GMAIL',
      emailAddress,
      displayName: emailAddress,
      credentials: encryptedCreds,
      lastHistoryId: baselineHistoryId,
      isActive: true,
    },
  });

  await logEvent('MAILBOX_CONNECTED', { mailboxId: mailbox.id, emailAddress }, 'INFO');
  return mailbox;
}

// Fetch a single message by Gmail message ID and persist it (idempotent — skips
// messages already stored). Used by both the 7-day fallback sync and the
// incremental history-based sync.
async function fetchAndStoreMessage(
  gmail: ReturnType<typeof google.gmail>,
  mailboxId: string,
  externalMessageId: string
): Promise<void> {
  // Skip if already stored
  const existing = await prisma.emailMessage.findUnique({
    where: { externalMessageId },
  });
  if (existing) return;

  try {
    const fullMsg = await gmail.users.messages.get({
      userId: 'me',
      id: externalMessageId,
      format: 'full',
    });

    const headers = fullMsg.data.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    const subject = getHeader('Subject') || '(no subject)';
    const fromRaw = getHeader('From');
    const toRaw = getHeader('To');
    const messageId = getHeader('Message-ID');
    const inReplyTo = getHeader('In-Reply-To');
    const references = getHeader('References');
    const dateStr = getHeader('Date');
    const threadId = fullMsg.data.threadId ?? externalMessageId;

    // Parse from address
    const fromMatch = fromRaw.match(/^(.*?)\s*<([^>]+)>$/) ?? [];
    const fromName = fromMatch[1]?.trim() || undefined;
    const fromAddress = fromMatch[2] ?? fromRaw;

    const toAddresses = toRaw.split(',').map((a) => a.trim());

    // Extract body
    let bodyText = '';
    let bodyHtml = '';

    const extractBody = (part: {
      mimeType?: string | null;
      body?: { data?: string | null } | null;
      parts?: unknown[] | null;
    }): void => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText = Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.parts) {
        (part.parts as typeof part[]).forEach(extractBody);
      }
    };

    if (fullMsg.data.payload) {
      extractBody(fullMsg.data.payload as Parameters<typeof extractBody>[0]);
    }

    // Upsert thread
    const thread = await prisma.emailThread.upsert({
      where: {
        mailboxId_externalThreadId: {
          mailboxId,
          externalThreadId: threadId,
        },
      },
      update: {
        subject,
        lastMessageAt: dateStr ? new Date(dateStr) : new Date(),
      },
      create: {
        mailboxId,
        externalThreadId: threadId,
        subject,
        lastMessageAt: dateStr ? new Date(dateStr) : new Date(),
      },
    });

    // Store message
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        mailboxId,
        externalMessageId,
        fromAddress,
        fromName,
        toAddresses: JSON.stringify(toAddresses),
        subject,
        bodyText,
        bodyHtml,
        receivedAt: dateStr ? new Date(dateStr) : new Date(),
        headers: JSON.stringify({ messageId, inReplyTo, references }),
      },
    });
  } catch (err) {
    console.error(`[Gmail] Failed to process message ${externalMessageId}:`, err);
  }
}

/**
 * Full 7-day fallback sync. Used:
 *   - As one-time backfill when `lastHistoryId` is null (no baseline yet).
 *   - Via the manual /api/mailboxes/:id/resync endpoint.
 * Webhook-driven incremental sync uses `syncIncremental` instead.
 *
 * After completion, stores the current historyId so future webhooks can run
 * incrementally.
 */
export async function syncMessages(mailboxId: string): Promise<void> {
  const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mailbox || !mailbox.isActive) return;

  const credentials = parseCredentials(mailbox);
  const oauth2Client = getAuthenticatedClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Get messages from the last 7 days
  const after = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${after}`,
    maxResults: 100,
  });

  const messages = listRes.data.messages ?? [];

  for (const msg of messages) {
    if (!msg.id) continue;
    await fetchAndStoreMessage(gmail, mailboxId, msg.id);
  }

  // After a full sync, capture the current historyId so subsequent webhooks
  // run incrementally.
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    if (profile.data.historyId) {
      await prisma.mailbox.update({
        where: { id: mailboxId },
        data: { lastHistoryId: profile.data.historyId },
      });
    }
  } catch (err) {
    console.warn(`[Gmail] Failed to capture historyId after full sync:`, err);
  }

  await logEvent('MAILBOX_SYNCED', { mailboxId, messageCount: messages.length }, 'INFO');
}

/**
 * Incremental sync using Gmail history.list. Only fetches messages added since
 * `mailbox.lastHistoryId`. Falls back to `syncMessages` (7-day scan) if no
 * baseline exists yet.
 *
 * Returns the number of new messages fetched.
 */
export async function syncIncremental(
  mailboxId: string,
  incomingHistoryId?: string
): Promise<number> {
  const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mailbox || !mailbox.isActive) return 0;

  // No baseline → one-time 7-day backfill, then store latest historyId.
  if (!mailbox.lastHistoryId) {
    console.log(`[Gmail] No baseline historyId for ${mailbox.emailAddress}, running fallback sync`);
    await syncMessages(mailboxId);
    return 0;
  }

  const credentials = parseCredentials(mailbox);
  const oauth2Client = getAuthenticatedClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const startHistoryId = mailbox.lastHistoryId;
  const newMessageIds = new Set<string>();
  let latestHistoryId: string | undefined;
  let pageToken: string | undefined;

  try {
    do {
      const historyRes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        pageToken,
        maxResults: 500,
      });

      const history = historyRes.data.history ?? [];
      for (const entry of history) {
        const added = entry.messagesAdded ?? [];
        for (const added_msg of added) {
          if (added_msg.message?.id) {
            newMessageIds.add(added_msg.message.id);
          }
        }
      }

      if (historyRes.data.historyId) {
        latestHistoryId = historyRes.data.historyId;
      }
      pageToken = historyRes.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    // Gmail returns 404 if startHistoryId is too old (>7d). Fall back to full sync.
    const errObj = err as { code?: number; status?: number };
    if (errObj?.code === 404 || errObj?.status === 404) {
      console.warn(
        `[Gmail] historyId expired for ${mailbox.emailAddress}, falling back to full sync`
      );
      await syncMessages(mailboxId);
      return 0;
    }
    throw err;
  }

  // Fetch and store each new message.
  for (const msgId of newMessageIds) {
    await fetchAndStoreMessage(gmail, mailboxId, msgId);
  }

  // Update historyId to whatever Gmail told us is latest, or fall back to
  // the historyId from the incoming webhook payload.
  const newHistoryId = latestHistoryId ?? incomingHistoryId;
  if (newHistoryId) {
    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { lastHistoryId: newHistoryId },
    });
  }

  await logEvent(
    'MAILBOX_SYNCED_INCREMENTAL',
    { mailboxId, messageCount: newMessageIds.size, startHistoryId, endHistoryId: newHistoryId },
    'INFO'
  );

  return newMessageIds.size;
}

export async function watchMailbox(mailboxId: string): Promise<void> {
  const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mailbox || !config.gmail.pubsubTopic) return;

  const credentials = parseCredentials(mailbox);
  const oauth2Client = getAuthenticatedClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: config.gmail.pubsubTopic,
      labelIds: ['INBOX'],
    },
  });

  const expiry = res.data.expiration
    ? new Date(parseInt(res.data.expiration))
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // The watch response returns the current historyId. Use it as the baseline
  // for incremental sync if we don't already have one.
  const baselineHistoryId = res.data.historyId ?? null;

  await prisma.mailbox.update({
    where: { id: mailboxId },
    data: {
      watchExpiry: expiry,
      // Only set the baseline if we don't have one yet — never overwrite an
      // existing historyId, otherwise we'd skip messages added between the
      // last sync and this watch renewal.
      ...(mailbox.lastHistoryId ? {} : { lastHistoryId: baselineHistoryId }),
    },
  });

  await logEvent('GMAIL_WATCH_SET', { mailboxId, expiry, baselineHistoryId }, 'INFO');
}

export async function renewGmailWatches(): Promise<number> {
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      provider: 'GMAIL',
      isActive: true,
    },
  });

  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let renewed = 0;
  for (const mailbox of mailboxes) {
    if (!mailbox.watchExpiry || mailbox.watchExpiry < oneDayFromNow) {
      try {
        await watchMailbox(mailbox.id);
        renewed += 1;
        console.log(`[Gmail] Renewed watch for ${mailbox.emailAddress}`);
      } catch (err) {
        console.error(`[Gmail] Failed to renew watch for ${mailbox.emailAddress}:`, err);
      }
    }
  }
  return renewed;
}

export async function createServiceAccountClient(emailToImpersonate: string) {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;

  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_JSON is not set — required for workspace OAuth");
  }

  const authOptions: {
    scopes: string[];
    subject: string;
    credentials: Record<string, unknown>;
  } = {
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    subject: emailToImpersonate,
    credentials: JSON.parse(keyJson) as Record<string, unknown>,
  };

  const auth = new google.auth.GoogleAuth(authOptions);
  const authClient = await auth.getClient();
  return google.gmail({ version: 'v1', auth: authClient as Parameters<typeof google.gmail>[0]['auth'] });
}

export async function createDraft(
  mailboxId: string,
  draft: {
    threadId: string;
    externalThreadId: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    inReplyToMessageId?: string;
    referencesHeader?: string;
    toAddress: string;
  }
): Promise<string> {
  const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mailbox) throw new Error('Mailbox not found');

  const credentials = parseCredentials(mailbox);
  const oauth2Client = getAuthenticatedClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Build RFC 2822 email with proper threading headers
  const headers: string[] = [
    `To: ${draft.toAddress}`,
    `Subject: ${draft.subject}`,
    `Content-Type: text/plain; charset=utf-8`,
  ];

  // CRITICAL: Set In-Reply-To and References for Superhuman threading
  if (draft.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${draft.inReplyToMessageId}`);
  }
  if (draft.referencesHeader) {
    headers.push(`References: ${draft.referencesHeader}`);
  }

  const rawEmail = headers.join('\r\n') + '\r\n\r\n' + draft.bodyText;
  const encodedEmail = Buffer.from(rawEmail)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedEmail,
        // CRITICAL: Always set threadId to preserve threading in Superhuman
        threadId: draft.externalThreadId,
      },
    },
  });

  return res.data.id ?? '';
}

export async function sendDraft(mailboxId: string, externalDraftId: string): Promise<void> {
  const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mailbox) throw new Error('Mailbox not found');

  const credentials = parseCredentials(mailbox);
  const oauth2Client = getAuthenticatedClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  await gmail.users.drafts.send({
    userId: 'me',
    requestBody: {
      id: externalDraftId,
    },
  });
}

export async function processWebhook(data: { message: { data: string } }): Promise<void> {
  try {
    const decoded = Buffer.from(data.message.data, 'base64').toString('utf-8');
    const notification = JSON.parse(decoded) as { emailAddress: string; historyId: string };

    const mailbox = await prisma.mailbox.findUnique({
      where: { emailAddress: notification.emailAddress },
    });

    if (!mailbox) {
      console.warn(`[Gmail Webhook] No mailbox found for ${notification.emailAddress}`);
      return;
    }

    // Incremental sync — only fetches messages added since lastHistoryId.
    // Falls back to syncMessages() if no baseline is set yet.
    await syncIncremental(mailbox.id, notification.historyId);

    // Find unclassified threads and generate drafts
    const threads = await prisma.emailThread.findMany({
      where: {
        mailboxId: mailbox.id,
        candidate: { isNot: null },
        drafts: { none: { status: { in: ['PENDING', 'APPROVED', 'SENT'] } } },
      },
      include: {
        messages: { orderBy: { receivedAt: 'asc' } },
        candidate: true,
        drafts: true,
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
    });

    for (const thread of threads) {
      if (!thread.candidate) continue;

      const lastMessage = thread.messages[thread.messages.length - 1];
      if (!lastMessage || !lastMessage.bodyText) continue;

      try {
        const classification = await classifyReply(
          lastMessage.bodyText,
          thread.candidate.name
        );

        const draftReply = await generateDraftReply({
          subject: thread.subject,
          messages: thread.messages,
          candidateName: thread.candidate.name,
          classification: classification.classification,
        });

        // Get headers for threading
        const headers = (typeof lastMessage.headers === 'string'
          ? JSON.parse(lastMessage.headers)
          : lastMessage.headers) as Record<string, string>;
        const inReplyToMessageId = headers.messageId;
        const existingRefs = headers.references ?? '';
        const referencesHeader = existingRefs
          ? `${existingRefs} ${inReplyToMessageId}`
          : inReplyToMessageId;

        await prisma.emailDraft.create({
          data: {
            threadId: thread.id,
            inReplyToMessageId,
            referencesHeader,
            subject: draftReply.subject,
            bodyText: draftReply.bodyText,
            bodyHtml: draftReply.bodyHtml,
            classification: classification.classification,
            confidence: classification.confidence,
            status: 'PENDING',
          },
        });

        // Update candidate status
        await prisma.candidate.update({
          where: { id: thread.candidate.id },
          data: { status: classification.classification },
        });

        await logEvent(
          'DRAFT_CREATED',
          {
            threadId: thread.id,
            candidateId: thread.candidate.id,
            classification: classification.classification,
          },
          'INFO'
        );
      } catch (err) {
        console.error(`[Gmail Webhook] Failed to process thread ${thread.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Gmail Webhook] Failed to process notification:', err);
    throw err;
  }
}

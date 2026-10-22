import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import { createDraft, sendDraft as gmailSendDraft, deleteDraft as gmailDeleteDraft, fetchExamplesForMailbox, composeHandoffDraftContent, fetchMailboxSignature, htmlSignatureToPlainText } from '../services/gmail.service';
import { classifyReply, generateDraftReply, rewriteDraftWithNotes } from '../services/claude.service';
import { config } from '../config';
import { logEvent } from '../services/monitoring.service';
import { serializeEmailMessages } from '../lib/emailMessageSerializer';
import { requireAdmin } from '../middleware/requireAdmin';
import { z } from 'zod';
import { composeDraftHtml, stripHeaderBreaks } from '../lib/draftBody';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

// bodyHtml is intentionally not accepted: the HTML part is always rendered
// server-side from bodyText (C1/M10), so a client can't desync the two or
// inject markup. Unknown keys are stripped by zod.
const updateDraftSchema = z.object({
  bodyText: z.string().optional(),
  subject: z.string().transform(stripHeaderBreaks).optional(),
});

/** The mailbox's HTML signature and its plain-text rendering, or nulls if unavailable. */
async function loadSignature(mailboxId: string): Promise<{ html: string | null; plain: string | null }> {
  try {
    const html = await fetchMailboxSignature(mailboxId);
    return html ? { html, plain: htmlSignatureToPlainText(html) } : { html: null, plain: null };
  } catch {
    return { html: null, plain: null };
  }
}

function isGmailNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  return e?.code === 404 || e?.status === 404 || e?.response?.status === 404;
}

/**
 * Best-effort removal of a Gmail draft we created. A draft that's already
 * gone (sent or deleted by hand in Gmail) is fine; anything else is logged
 * but never blocks the DB transition the caller already made.
 */
async function deleteGmailDraftQuietly(draftId: string, mailboxId: string, externalDraftId: string): Promise<void> {
  try {
    await gmailDeleteDraft(mailboxId, externalDraftId);
  } catch (err) {
    if (isGmailNotFound(err)) return;
    await logEvent(
      'DRAFT_GMAIL_DELETE_FAILED',
      { draftId, error: err instanceof Error ? err.message : String(err) },
      'WARN'
    );
  }
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const DRAFT_STATUSES = ['PENDING', 'APPROVED', 'SENT', 'DISCARDED'] as const;
const cuidPattern = /^[a-z0-9]{20,30}$/;
const draftListFilterSchema = z.object({
  status: z.enum(DRAFT_STATUSES).optional(),
  mailboxId: z.string().regex(cuidPattern, 'mailboxId must be a cuid').optional(),
});

const draftWithThreadInclude = {
  thread: {
    include: {
      candidate: true,
      mailbox: true,
    },
  },
} as const;

interface OriginalMessagePayload {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: Date;
}

interface MessageLike {
  id: string;
  externalMessageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: Date;
}

interface MailboxLike {
  emailAddress: string;
}

/**
 * Pick the original inbound message a draft is responding to.
 *
 * Preference order:
 *  1. The message whose externalMessageId matches the draft's inReplyToMessageId.
 *  2. Otherwise, the most recent inbound message in the thread
 *     (i.e. fromAddress !== mailbox.emailAddress).
 *
 * Returns null when the thread has no inbound message we can attribute to.
 */
function pickOriginalMessage(
  messages: MessageLike[],
  mailbox: MailboxLike,
  inReplyToMessageId: string | null
): OriginalMessagePayload | null {
  if (!messages.length) return null;

  const mailboxAddress = mailbox.emailAddress.toLowerCase();
  const isInbound = (m: MessageLike) => m.fromAddress.toLowerCase() !== mailboxAddress;

  // 1. Exact reply target via Gmail message id.
  if (inReplyToMessageId) {
    const exact = messages.find((m) => m.externalMessageId === inReplyToMessageId);
    if (exact) {
      return {
        id: exact.id,
        fromAddress: exact.fromAddress,
        fromName: exact.fromName,
        subject: exact.subject,
        bodyText: exact.bodyText,
        bodyHtml: exact.bodyHtml,
        receivedAt: exact.receivedAt,
      };
    }
  }

  // 2. Most recent inbound message in the thread.
  const inbound = messages
    .filter(isInbound)
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  const latest = inbound[0];
  if (!latest) return null;

  return {
    id: latest.id,
    fromAddress: latest.fromAddress,
    fromName: latest.fromName,
    subject: latest.subject,
    bodyText: latest.bodyText,
    bodyHtml: latest.bodyHtml,
    receivedAt: latest.receivedAt,
  };
}

// GET /api/drafts
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filterParsed = draftListFilterSchema.safeParse({
      status: qs(req.query.status),
      mailboxId: qs(req.query.mailboxId),
    });
    if (!filterParsed.success) {
      return next(createError(filterParsed.error.errors[0]?.message ?? 'Invalid filter', 400));
    }
    const { status, mailboxId } = filterParsed.data;
    const paged = paginationSchema.safeParse({
      page: qs(req.query.page),
      limit: qs(req.query.limit),
    });
    if (!paged.success) {
      return next(createError(paged.error.message, 400));
    }
    const { page, limit } = paged.data;
    const skip = (page - 1) * limit;

    const where: Prisma.EmailDraftWhereInput = {};
    if (status) where.status = status;
    if (mailboxId) where.thread = { ...(where.thread as object), mailboxId };

    // By default, hide PENDING drafts for candidates who have already been
    // replied to (either via the app or directly from Gmail/Superhuman).
    // APPROVED, SENT, and DISCARDED drafts are always shown — they represent
    // intentional recruiter actions and should never disappear from the UI.
    const includeReplied = qs(req.query.includeReplied) === 'true';
    const isPendingOnlyView = !status || status === 'PENDING';
    if (!includeReplied && isPendingOnlyView) {
      where.thread = {
        ...(where.thread as object),
        candidate: { repliedAt: null },
      };
    }

    const [drafts, total] = await Promise.all([
      prisma.emailDraft.findMany({
        where,
        include: {
          thread: {
            include: {
              messages: {
                orderBy: { receivedAt: 'desc' },
                select: {
                  id: true,
                  externalMessageId: true,
                  fromAddress: true,
                  fromName: true,
                  subject: true,
                  bodyText: true,
                  bodyHtml: true,
                  receivedAt: true,
                },
              },
              candidate: {
                select: { id: true, name: true, email: true, role: true },
              },
              mailbox: {
                select: { id: true, emailAddress: true, provider: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.emailDraft.count({ where }),
    ]);

    const data = drafts.map((draft) => {
      const originalMessage = pickOriginalMessage(
        draft.thread.messages,
        draft.thread.mailbox,
        draft.inReplyToMessageId
      );
      // Drop the bulk-fetched messages from the wire payload — the list view
      // only needs the resolved originalMessage.
      const { messages: _messages, ...threadRest } = draft.thread;
      return { ...draft, thread: threadRest, originalMessage };
    });

    res.json({ success: true, data, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

// GET /api/drafts/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draft = await prisma.emailDraft.findUnique({
      where: { id },
      include: {
        thread: {
          include: {
            messages: { orderBy: { receivedAt: 'desc' } },
            candidate: true,
            mailbox: true,
          },
        },
      },
    });

    if (!draft) {
      return next(createError('Draft not found', 404));
    }

    const originalMessage = pickOriginalMessage(
      draft.thread.messages,
      draft.thread.mailbox,
      draft.inReplyToMessageId
    );

    const data = {
      ...draft,
      thread: {
        ...draft.thread,
        messages: serializeEmailMessages(draft.thread.messages),
      },
      originalMessage,
    };
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/drafts/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400));
    }

    const id = String(req.params.id);
    // Fetch draft with mailbox so we can reconstruct the HTML signature.
    const draft = await prisma.emailDraft.findUnique({
      where: { id },
      include: { thread: { include: { mailbox: true } } },
    });
    if (!draft) return next(createError('Draft not found', 404));
    if (draft.status !== 'PENDING') {
      return next(createError('Can only edit pending drafts', 400));
    }

    // Re-render bodyHtml from the edited text so the preview and the email we
    // hand to Gmail carry exactly what the recruiter typed, with the mailbox's
    // HTML signature swapped back in for its plain-text rendering (C1).
    const updateData: { bodyText?: string; subject?: string; bodyHtml?: string } = { ...parsed.data };
    if (parsed.data.bodyText !== undefined) {
      const sig = await loadSignature(draft.thread.mailbox.id);
      updateData.bodyHtml = composeDraftHtml(parsed.data.bodyText, sig.html, sig.plain);
    }

    const updated = await prisma.emailDraft.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Internal: re-run classifier + draft generator on an existing PENDING draft.
// Returns either the updated draft + resolved originalMessage, or an error
// shape (kept as a discriminated union so the bulk endpoint can collect
// per-draft skip reasons without try/catching on validation outcomes).
type RegenerateOk = {
  ok: true;
  draft: Awaited<ReturnType<typeof prisma.emailDraft.update>>;
  originalMessage: OriginalMessagePayload;
  mailboxId: string;
};
type RegenerateFail = { ok: false; status: number; message: string };

async function regenerateDraftById(
  id: string,
  actorUserId?: string
): Promise<RegenerateOk | RegenerateFail> {
  const draft = await prisma.emailDraft.findUnique({
    where: { id },
    include: {
      thread: {
        include: {
          candidate: true,
          mailbox: true,
        },
      },
    },
  });

  if (!draft) return { ok: false, status: 404, message: 'Draft not found' };
  if (draft.status !== 'PENDING') {
    return { ok: false, status: 400, message: 'Can only regenerate pending drafts' };
  }

  const thread = draft.thread;
  const mailbox = thread.mailbox;
  const candidate = thread.candidate;
  if (!candidate) {
    return { ok: false, status: 400, message: 'Thread has no candidate' };
  }

  // Re-fetch the thread's messages immediately before calling Claude so a new
  // inbound that landed after the draft was created is reflected. Capped at
  // the most recent 8 to keep prompt size predictable.
  const recentMessages = await prisma.emailMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { receivedAt: 'desc' },
    take: 8,
  });

  const originalMessage = pickOriginalMessage(
    recentMessages,
    mailbox,
    draft.inReplyToMessageId
  );
  if (!originalMessage) {
    return { ok: false, status: 400, message: 'No inbound message to reply to' };
  }

  // Telemetry: if the chosen inbound is newer than the draft's last update,
  // the regenerated reply diverges from the prior one for a real reason
  // (new context) rather than classifier drift. Log the delta so we can tell
  // the two apart when investigating "why did the regen change so much?".
  const mailboxAddr = mailbox.emailAddress.toLowerCase();
  const latestInbound = recentMessages
    .filter((m) => m.fromAddress.toLowerCase() !== mailboxAddr)
    .reduce<typeof recentMessages[number] | null>(
      (acc, m) => (acc === null || m.receivedAt > acc.receivedAt ? m : acc),
      null
    );
  if (latestInbound && latestInbound.receivedAt.getTime() > draft.updatedAt.getTime()) {
    await logEvent(
      'DRAFT_REGEN_NEW_CONTEXT',
      {
        draftId: id,
        deltaMs: latestInbound.receivedAt.getTime() - draft.updatedAt.getTime(),
      },
      'INFO'
    );
  }

  // Re-classify the inbound message so the draft's classification/confidence
  // reflect the current classifier prompt. previousMessages = thread history
  // strictly before the inbound, oldest → newest (same shape sync uses).
  const inboundTs = originalMessage.receivedAt.getTime();
  const previousMessages = recentMessages
    .filter((m) => m.receivedAt.getTime() < inboundTs)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map((m) => ({
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      bodyText: m.bodyText,
      receivedAt: m.receivedAt,
    }));

  const classificationResult = await classifyReply(
    originalMessage.bodyText || originalMessage.bodyHtml || originalMessage.subject,
    originalMessage.fromName ?? candidate.name,
    { subject: thread.subject, previousMessages }
  );
  // Keep the existing draft rather than overwrite it with a reply written
  // against the classifier's NEUTRAL/0 safe fallback (M5).
  if (classificationResult.isFallback) {
    await logEvent('DRAFT_GENERATE_CLASSIFIER_UNAVAILABLE', { draftId: id, via: 'regenerate' }, 'WARN');
    return { ok: false, status: 502, message: 'The classifier is unavailable right now; the draft was not changed. Please retry.' };
  }

  const allMessagesAsc = recentMessages
    .slice()
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map((m) => ({
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      bodyText: m.bodyText,
      receivedAt: m.receivedAt,
    }));

  const isHandoffInbox =
    mailbox.emailAddress.toLowerCase() !== config.draftCcEmail.toLowerCase();

  let replySubject: string;
  let replyBodyText: string;
  let replyBodyHtml: string;

  if (isHandoffInbox && classificationResult.classification === 'INTERESTED') {
    const signatureHtml = await fetchMailboxSignature(mailbox.id);
    const content = await composeHandoffDraftContent({
      mailbox,
      candidateName: candidate.name,
      candidateRole: candidate.role ?? null,
      threadId: thread.id,
      threadSubject: thread.subject,
      messages: allMessagesAsc,
      classification: classificationResult.classification,
      signatureHtml,
      via: 'regenerate',
    });
    replySubject = content.subject;
    replyBodyText = content.bodyText;
    replyBodyHtml = content.bodyHtml;
  } else {
    const [examples, signatureHtml] = await Promise.all([
      fetchExamplesForMailbox(
        mailbox.id,
        mailbox.emailAddress,
        classificationResult.classification
      ),
      fetchMailboxSignature(mailbox.id),
    ]);
    const draftReply = await generateDraftReply(
      {
        subject: thread.subject,
        messages: allMessagesAsc,
        candidateName: candidate.name,
        classification: classificationResult.classification,
        examples,
        signatureHtml,
      },
      {
        email: mailbox.emailAddress,
        displayName: mailbox.displayName,
      }
    );
    // Append the real Gmail signature if we fetched one successfully.
    const sigPlain = signatureHtml ? htmlSignatureToPlainText(signatureHtml) : null;
    replySubject = draftReply.subject;
    replyBodyText = sigPlain ? `${draftReply.bodyText}\n${sigPlain}` : draftReply.bodyText;
    replyBodyHtml = composeDraftHtml(replyBodyText, signatureHtml, sigPlain);
  }

  const updated = await prisma.emailDraft.update({
    where: { id },
    data: {
      subject: replySubject,
      bodyText: replyBodyText,
      bodyHtml: replyBodyHtml,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
    },
  });

  // Persist role to the candidate when Claude detected one and we don't have
  // a value yet. Mirrors classifyAndDraft's policy: don't churn role on
  // every follow-up.
  if (classificationResult.role && !candidate.role) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { role: classificationResult.role },
    });
    await logEvent(
      'CANDIDATE_ROLE_DETECTED',
      {
        candidateId: candidate.id,
        role: classificationResult.role,
        via: 'regenerate',
      },
      'INFO'
    );
  }

  // Observability: log when the freshly-classified role disagrees with the
  // stored value (either direction — newly null, value→value swap, or
  // first-detection). The update logic above intentionally keeps the
  // existing role; this event is purely so we can audit unexpected churn
  // (e.g. short follow-up replies that strip role from the classifier
  // output) without changing behavior.
  const newRole = classificationResult.role ?? null;
  const oldRole = candidate.role ?? null;
  if (newRole !== oldRole) {
    await logEvent(
      'CANDIDATE_ROLE_CHANGED',
      {
        candidateId: candidate.id,
        from: oldRole,
        to: newRole,
        via: 'regenerate',
      },
      'INFO'
    );
  }

  await logEvent('DRAFT_REGENERATED', { draftId: id, mailboxId: mailbox.id, actorUserId }, 'INFO');

  return { ok: true, draft: updated, originalMessage, mailboxId: mailbox.id };
}

// POST /api/drafts/regenerate-pending
// Bulk re-runs Claude on every PENDING draft attached to an active mailbox.
// Capped at 50 per request to stay inside Vercel's function timeout.
router.post('/regenerate-pending', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pending = await prisma.emailDraft.findMany({
      where: {
        status: 'PENDING',
        thread: { mailbox: { isActive: true } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    let regenerated = 0;
    const skipped: string[] = [];
    for (const { id } of pending) {
      try {
        const result = await regenerateDraftById(id, req.userId);
        if (result.ok) {
          regenerated += 1;
        } else {
          skipped.push(`${id}: ${result.message}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        skipped.push(`${id}: ${message}`);
      }
    }

    res.json({ success: true, regenerated, skipped });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/regenerate
router.post('/:id/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const result = await regenerateDraftById(id, req.userId);
    if (!result.ok) {
      return next(createError(result.message, result.status));
    }
    res.json({
      success: true,
      data: { ...result.draft, originalMessage: result.originalMessage },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/dictate
// Rewrites the draft body guided by recruiter notes (voice/typed).
router.post('/:id/dictate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    if (!notes) return next(createError('notes is required', 400));

    const draft = await prisma.emailDraft.findUnique({
      where: { id },
      include: {
        thread: {
          include: {
            candidate: true,
            mailbox: true,
          },
        },
      },
    });

    if (!draft) return next(createError('Draft not found', 404));
    if (draft.status !== 'PENDING') return next(createError('Only PENDING drafts can be rewritten', 400));

    const { thread } = draft;
    const { candidate, mailbox } = thread;

    // Send Claude only the core body: the signature is re-attached afterwards
    // so the rewrite can't drop or mangle the mailbox's HTML signature.
    const sig = await loadSignature(mailbox.id);
    const sigSuffix = sig.plain ? '\n' + sig.plain : null;
    const hasSig = sigSuffix !== null && draft.bodyText.endsWith(sigSuffix);
    const coreBody = hasSig ? draft.bodyText.slice(0, draft.bodyText.length - sigSuffix.length) : draft.bodyText;

    const rewritten = await rewriteDraftWithNotes(
      coreBody,
      notes,
      candidate?.name ?? 'Candidate',
      { email: mailbox.emailAddress, displayName: mailbox.displayName }
    );
    const newBodyText = hasSig ? `${rewritten.bodyText}${sigSuffix}` : rewritten.bodyText;

    const updated = await prisma.emailDraft.update({
      where: { id },
      data: {
        bodyText: newBodyText,
        bodyHtml: composeDraftHtml(newBodyText, sig.html, sig.plain),
      },
      include: draftWithThreadInclude,
    });

    await logEvent(
      'DRAFT_DICTATED',
      { draftId: id, mailboxId: mailbox.id, actorUserId: req.userId },
      'INFO'
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/approve
router.post('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draftWithThread = await prisma.emailDraft.findUnique({
      where: { id },
      include: draftWithThreadInclude,
    });

    if (!draftWithThread) return next(createError('Draft not found', 404));
    if (draftWithThread.status !== 'PENDING') {
      return next(createError('Draft is not in PENDING status', 409));
    }

    // Claim PENDING → APPROVED atomically before touching Gmail, so a double
    // click or a second tab can't create two Gmail drafts (M13).
    const claimed = await prisma.emailDraft.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
    if (claimed.count === 0) {
      return next(createError('Draft is no longer pending', 409));
    }

    const thread = draftWithThread.thread;
    const mailbox = thread.mailbox;
    const candidate = thread.candidate;

    if (mailbox.provider === 'GMAIL' && candidate) {
      let externalDraftId: string;
      try {
        externalDraftId = await createDraft(mailbox.id, {
          threadId: thread.id,
          externalThreadId: thread.externalThreadId,
          subject: draftWithThread.subject,
          bodyText: draftWithThread.bodyText,
          bodyHtml: draftWithThread.bodyHtml ?? undefined,
          inReplyToMessageId: draftWithThread.inReplyToMessageId ?? undefined,
          referencesHeader: draftWithThread.referencesHeader ?? undefined,
          toAddress: candidate.email,
        });
      } catch (gmailErr) {
        // Fail loudly and hand the draft back to the review queue so the
        // recruiter can retry; /send without an externalDraftId would
        // otherwise have to re-create it.
        await prisma.emailDraft.updateMany({
          where: { id, status: 'APPROVED', externalDraftId: null },
          data: { status: 'PENDING' },
        });
        const message =
          gmailErr instanceof Error ? gmailErr.message : String(gmailErr);
        await logEvent(
          'DRAFT_APPROVE_GMAIL_FAILED',
          { draftId: id, error: message, actorUserId: req.userId },
          'ERROR'
        );
        return next(
          createError(
            `Could not create the draft in Gmail: ${message}. The draft is still pending; please retry.`,
            502
          )
        );
      }

      const stored = await prisma.emailDraft.updateMany({
        where: { id, externalDraftId: null },
        data: { externalDraftId },
      });
      if (stored.count === 0) {
        // A concurrent /send already attached its own Gmail draft.
        await deleteGmailDraftQuietly(id, mailbox.id, externalDraftId);
      }
    }

    await logEvent('DRAFT_APPROVED', { draftId: id, actorUserId: req.userId }, 'INFO');
    res.json({ success: true, message: 'Draft approved' });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/discard
router.post('/:id/discard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draft = await prisma.emailDraft.findUnique({
      where: { id },
      include: { thread: { select: { mailboxId: true } } },
    });
    if (!draft) return next(createError('Draft not found', 404));

    const discarded = await prisma.emailDraft.updateMany({
      where: { id, status: { in: ['PENDING', 'APPROVED'] } },
      data: { status: 'DISCARDED' },
    });
    if (discarded.count === 0) {
      return next(createError(`Cannot discard a ${String(draft.status).toLowerCase()} draft`, 409));
    }

    // Approved drafts already exist in the recruiter's Gmail Drafts folder;
    // remove it so a discarded reply can't be sent from Gmail by mistake (M13).
    const mailboxId = draft.thread?.mailboxId;
    if (draft.externalDraftId && mailboxId) {
      await deleteGmailDraftQuietly(id, mailboxId, draft.externalDraftId);
    }

    await logEvent('DRAFT_DISCARDED', { draftId: id, actorUserId: req.userId }, 'INFO');
    res.json({ success: true, message: 'Draft discarded' });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/send
//
// Ordering matters here. The risky leg is the Gmail API call: if we marked the
// DB row SENT *before* the send succeeded we could end up with a phantom-SENT
// row (Gmail never delivered, but our UI claims it did). The reverse failure
// — DB stays PENDING after Gmail successfully sent — is preferable because
// the recruiter sees the inbound reply or finds the message in Gmail's Sent
// folder and can manually reconcile. So:
//
//   1. Ensure a Gmail draft exists (create one if missing). If create fails,
//      bail out cleanly — nothing was sent.
//   2. Send via Gmail API. If this throws, DB stays PENDING/APPROVED and the
//      error bubbles up to the caller.
//   3. Only after Gmail confirms send do we mark the DB row SENT and the
//      candidate REPLIED.
router.post('/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draftWithThread = await prisma.emailDraft.findUnique({
      where: { id },
      include: draftWithThreadInclude,
    });

    if (!draftWithThread) return next(createError('Draft not found', 404));
    if (draftWithThread.status !== 'APPROVED') {
      return next(createError('Draft must be approved before sending', 409));
    }

    const thread = draftWithThread.thread;
    const mailbox = thread.mailbox;
    const candidate = thread.candidate;

    if (mailbox.provider === 'GMAIL') {
      let externalDraftId = draftWithThread.externalDraftId ?? null;

      if (!externalDraftId) {
        if (!candidate) {
          return next(
            createError('Cannot send: thread has no candidate to address', 400)
          );
        }
        const createdId = await createDraft(mailbox.id, {
          threadId: thread.id,
          externalThreadId: thread.externalThreadId,
          subject: draftWithThread.subject,
          bodyText: draftWithThread.bodyText,
          bodyHtml: draftWithThread.bodyHtml ?? undefined,
          inReplyToMessageId: draftWithThread.inReplyToMessageId ?? undefined,
          referencesHeader: draftWithThread.referencesHeader ?? undefined,
          toAddress: candidate.email,
        });
        // Persist the externalDraftId immediately (compare-and-set) so a
        // concurrent or retried send can't create and send a second copy.
        const stored = await prisma.emailDraft.updateMany({
          where: { id, status: 'APPROVED', externalDraftId: null },
          data: { externalDraftId: createdId },
        });
        if (stored.count === 0) {
          await deleteGmailDraftQuietly(id, mailbox.id, createdId);
          return next(createError('Draft is already being sent', 409));
        }
        externalDraftId = createdId;
      }

      try {
        await gmailSendDraft(mailbox.id, externalDraftId);
      } catch (sendErr) {
        // Gmail 404s a draft id that no longer exists — i.e. it was already
        // sent (by a concurrent request or from Gmail) or deleted there.
        if (isGmailNotFound(sendErr)) {
          return next(createError('This draft was already sent or deleted in Gmail', 409));
        }
        throw sendErr;
      }
    }

    // Gmail send succeeded (or this is a non-Gmail mailbox) — safe to mark
    // SENT and downstream candidate state.
    const marked = await prisma.emailDraft.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'SENT', sentAt: new Date() },
    });
    if (marked.count === 0) {
      return next(createError('Draft was already sent', 409));
    }

    if (candidate) {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { status: 'REPLIED', repliedAt: new Date() },
      });
    }

    await logEvent('DRAFT_SENT', { draftId: id, actorUserId: req.userId }, 'INFO');
    res.json({ success: true, message: 'Draft sent' });
  } catch (err) {
    next(err);
  }
});

export default router;

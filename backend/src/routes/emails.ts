import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import { isAdminUser } from '../middleware/requireAdmin';
import { serializeEmailMessages } from '../lib/emailMessageSerializer';
import {
  fetchExamplesForMailbox,
  composeHandoffDraftContent,
  fetchMailboxSignature,
  htmlSignatureToPlainText,
  draftMetaColumns,
} from '../services/gmail.service';
import { classifyReply, generateDraftReply, type Classification, type DraftGenerationMeta } from '../services/claude.service';
import { composeDraftHtml, threadingHeadersFor } from '../lib/draftBody';
import { resolveDraftCc, NO_CC } from '../services/draftCc.service';
import { config } from '../config';
import { logEvent } from '../services/monitoring.service';
import { z } from 'zod';
import { LIVE_DRAFT_STATUSES } from '../lib/draftStatus';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

// Cuid pattern shared with the candidates list — keeps the two routes in sync
// about what shape a mailbox/candidate id is allowed to take from the wire.
const cuidPattern = /^[a-z0-9]{20,30}$/;
const threadListFilterSchema = z.object({
  mailboxId: z.string().regex(cuidPattern, 'mailboxId must be a cuid').optional(),
  candidateId: z
    .string()
    .regex(cuidPattern, 'candidateId must be a cuid')
    .optional(),
});

// GET /api/emails/threads
router.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filterParsed = threadListFilterSchema.safeParse({
      mailboxId: qs(req.query.mailboxId),
      candidateId: qs(req.query.candidateId),
    });
    if (!filterParsed.success) {
      return next(createError(filterParsed.error.errors[0]?.message ?? 'Invalid filter', 400));
    }
    const { mailboxId, candidateId } = filterParsed.data;
    const paged = paginationSchema.safeParse({
      page: qs(req.query.page),
      limit: qs(req.query.limit),
    });
    if (!paged.success) {
      return next(createError(paged.error.message, 400));
    }
    const { page, limit } = paged.data;
    const skip = (page - 1) * limit;

    // H8: only candidate-linked threads by default. Unlinked threads hold
    // non-recruiting (often internal) mail; admins can opt in explicitly.
    const includeUnlinked = qs(req.query.includeUnlinked) === 'true';
    if (includeUnlinked && !(await isAdminUser(req.userId))) {
      return next(createError('Admin role required to list unlinked threads', 403));
    }

    const where: Record<string, unknown> = {};
    if (mailboxId) where.mailboxId = mailboxId;
    if (candidateId) where.candidateId = candidateId;
    else if (!includeUnlinked) where.candidateId = { not: null };

    const [threads, total] = await Promise.all([
      prisma.emailThread.findMany({
        where,
        include: {
          candidate: {
            select: { id: true, name: true, email: true, status: true, role: true },
          },
          mailbox: {
            select: { id: true, emailAddress: true, provider: true },
          },
          _count: { select: { messages: true, drafts: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.emailThread.count({ where }),
    ]);

    res.json({ success: true, data: threads, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

// GET /api/emails/threads/:id/messages
router.get(
  '/threads/:id/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const thread = await prisma.emailThread.findUnique({
        where: { id },
        include: {
          messages: { orderBy: { receivedAt: 'asc' } },
          drafts: { orderBy: { createdAt: 'desc' } },
          candidate: {
            select: { id: true, name: true, email: true, status: true, role: true },
          },
          mailbox: {
            select: { id: true, emailAddress: true, provider: true },
          },
        },
      });

      // H8: a thread with no candidate is not visible to non-admins (404, so
      // its existence isn't confirmed either).
      if (!thread || (!thread.candidateId && !(await isAdminUser(req.userId)))) {
        return next(createError('Thread not found', 404));
      }

      const data = {
        ...thread,
        messages: serializeEmailMessages(thread.messages),
      };
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

// Optional body for the draft route. `classification` is the recruiter's own
// triage decision on a NEEDS_REVIEW candidate (M17): it replaces the
// re-classification, which is what flagged the candidate in the first place.
const generateDraftBodySchema = z
  .object({ classification: z.enum(['INTERESTED', 'NOT_INTERESTED', 'NEUTRAL']).optional() })
  .optional();

// POST /api/emails/threads/:id/draft
// Manually generate a draft for a thread that was skipped by the auto-classifier
// (e.g. because Sofia wasn't CC'd on the original outreach). Bypasses the
// Sofia-in-loop check — this is a deliberate, admin-initiated action.
router.post(
  '/threads/:id/draft',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = generateDraftBodySchema.safeParse(req.body ?? undefined);
      if (!body.success) {
        return next(createError(body.error.errors[0]?.message ?? 'Invalid body', 400));
      }
      const triageClassification = body.data?.classification;
      const via = triageClassification ? 'triage' : 'manual_generate';
      const threadId = String(req.params.id);
      const thread = await prisma.emailThread.findUnique({
        where: { id: threadId },
        include: {
          messages: { orderBy: { receivedAt: 'asc' } },
          candidate: true,
          mailbox: true,
          drafts: {
            where: { status: { in: LIVE_DRAFT_STATUSES } },
            take: 1,
          },
        },
      });

      if (!thread) return next(createError('Thread not found', 404));
      if (!thread.candidate) return next(createError('Thread has no linked candidate', 400));
      if (thread.drafts.length > 0) {
        return next(createError('Thread already has a live draft', 409));
      }

      const { candidate, mailbox } = thread;
      const mailboxAddr = mailbox.emailAddress.toLowerCase();
      const ccEmail = config.draftCcEmail.toLowerCase();
      const isHandoffInbox = mailboxAddr !== ccEmail;

      // Find the most recent inbound message to reply to.
      const inboundMessages = thread.messages.filter(
        (m) => m.fromAddress.toLowerCase() !== mailboxAddr
      );
      const lastInbound = inboundMessages[inboundMessages.length - 1];
      if (!lastInbound) return next(createError('No inbound message found in thread', 400));

      // Thread on the inbound's RFC Message-ID (not the Gmail API id) so
      // Superhuman/Outlook/Apple Mail thread the reply correctly (M13).
      const { inReplyToMessageId, referencesHeader: refsHeader } = threadingHeadersFor(lastInbound.headers);

      let classification: Classification;
      let confidence: number;
      let classificationReason: string | null = null;
      let evidenceQuote: string | null = null;
      if (triageClassification) {
        classification = triageClassification;
        confidence = 1;
      } else {
        // Re-classify the latest inbound message so we draft appropriately.
        const classificationResult = await classifyReply(
          lastInbound.bodyText ?? lastInbound.subject,
          candidate.name,
          { subject: thread.subject, previousMessages: thread.messages.slice(0, -1).map((m) => ({ fromAddress: m.fromAddress, bodyText: m.bodyText, receivedAt: m.receivedAt })) }
        );
        // Never draft on the classifier's safe fallback: it means Claude was
        // unreachable or returned garbage, so NEUTRAL/0 says nothing about the
        // candidate (M5).
        if (classificationResult.isFallback) {
          await logEvent('DRAFT_GENERATE_CLASSIFIER_UNAVAILABLE', { threadId, via }, 'WARN');
          return next(createError('The classifier is unavailable right now; no draft was created. Please retry.', 502));
        }
        ({ classification, confidence } = classificationResult);
        classificationReason = classificationResult.reason ?? null;
        evidenceQuote = classificationResult.evidenceQuote ?? null;
      }

      const signatureHtml = await fetchMailboxSignature(mailbox.id);
      const messages = thread.messages.map((m) => ({
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        bodyText: m.bodyText,
        receivedAt: m.receivedAt,
      }));

      let subject: string;
      let bodyText: string;
      let bodyHtml: string;
      let template: string;
      let meta: DraftGenerationMeta | undefined;

      // Hand-off ("looping in <CC>") only makes sense for an interested
      // candidate; anything else gets a normal reply for its classification.
      if (isHandoffInbox && classification === 'INTERESTED') {
        const content = await composeHandoffDraftContent({
          mailbox,
          candidateName: candidate.name,
          candidateRole: candidate.role ?? null,
          threadId,
          threadSubject: thread.subject,
          messages,
          classification,
          signatureHtml,
          via,
        });
        ({ subject, bodyText, bodyHtml, template, meta } = content);
      } else {
        const examples = await fetchExamplesForMailbox(mailbox.id, mailbox.emailAddress, classification);
        const draftReply = await generateDraftReply(
          {
            subject: thread.subject,
            messages,
            candidateName: candidate.name,
            classification,
            examples,
            signatureHtml,
          },
          { email: mailbox.emailAddress, displayName: mailbox.displayName }
        );
        const sigPlain = signatureHtml ? htmlSignatureToPlainText(signatureHtml) : null;
        subject = draftReply.subject;
        bodyText = sigPlain ? `${draftReply.bodyText}\n${sigPlain}` : draftReply.bodyText;
        bodyHtml = composeDraftHtml(bodyText, signatureHtml, sigPlain);
        template = 'claude';
        meta = draftReply.meta;
      }

      const draft = await prisma.emailDraft.create({
        data: {
          threadId,
          inReplyToMessageId,
          referencesHeader: refsHeader,
          subject,
          bodyText,
          bodyHtml,
          aiBodyText: bodyText,
          classification,
          confidence,
          classificationReason,
          evidenceQuote,
          status: 'PENDING',
          ccEmail: resolveDraftCc(null, mailbox.emailAddress) ?? NO_CC,
          ...draftMetaColumns(meta),
        },
      });

      await logEvent(
        'DRAFT_CREATED',
        {
          mailboxId: mailbox.id,
          candidateId: candidate.id,
          threadId,
          via,
          template,
          classification,
          confidence,
        },
        'INFO'
      );

      res.status(201).json({ success: true, data: draft });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

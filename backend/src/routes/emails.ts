import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import { serializeEmailMessages } from '../lib/emailMessageSerializer';
import {
  fetchExamplesForMailbox,
  buildHandoffDraftContent,
  fetchMailboxSignature,
  htmlSignatureToPlainText,
} from '../services/gmail.service';
import { classifyReply, generateDraftReply, generateHandoffDraftReply, getHandoffType } from '../services/claude.service';
import { config } from '../config';
import { logEvent } from '../services/monitoring.service';
import { z } from 'zod';

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

    const where: Record<string, unknown> = {};
    if (mailboxId) where.mailboxId = mailboxId;
    if (candidateId) where.candidateId = candidateId;

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

      if (!thread) {
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

// POST /api/emails/threads/:id/draft
// Manually generate a draft for a thread that was skipped by the auto-classifier
// (e.g. because Sofia wasn't CC'd on the original outreach). Bypasses the
// Sofia-in-loop check — this is a deliberate, admin-initiated action.
router.post(
  '/threads/:id/draft',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const threadId = String(req.params.id);
      const thread = await prisma.emailThread.findUnique({
        where: { id: threadId },
        include: {
          messages: { orderBy: { receivedAt: 'asc' } },
          candidate: true,
          mailbox: true,
          drafts: {
            where: { status: { in: ['PENDING', 'APPROVED'] } },
            take: 1,
          },
        },
      });

      if (!thread) return next(createError('Thread not found', 404));
      if (!thread.candidate) return next(createError('Thread has no linked candidate', 400));
      if (thread.drafts.length > 0) {
        return next(createError('Thread already has a pending or approved draft', 409));
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

      const inReplyToMessageId = lastInbound.externalMessageId || null;
      const refsHeader = inReplyToMessageId ?? '';

      let subject: string;
      let bodyText: string;
      let bodyHtml: string | undefined;
      let classification: 'INTERESTED' | 'NOT_INTERESTED' | 'NEUTRAL' = 'INTERESTED';
      let confidence = 0.8;

      // Re-classify the latest inbound message so we draft appropriately.
      const classificationResult = await classifyReply(
        lastInbound.bodyText ?? lastInbound.subject,
        candidate.name,
        { subject: thread.subject, previousMessages: thread.messages.slice(0, -1).map((m) => ({ fromAddress: m.fromAddress, bodyText: m.bodyText, receivedAt: m.receivedAt })) }
      );
      if (classificationResult.classification === 'NOT_INTERESTED' || classificationResult.classification === 'NEUTRAL') {
        classification = classificationResult.classification;
        confidence = classificationResult.confidence;
      } else {
        classification = 'INTERESTED';
        confidence = classificationResult.confidence;
      }

      const signatureHtml = await fetchMailboxSignature(mailbox.id);

      if (isHandoffInbox) {
        const ccDisplayName = await prisma.mailbox
          .findUnique({ where: { emailAddress: config.draftCcEmail.toLowerCase() }, select: { displayName: true } })
          .then((mb) => mb?.displayName ?? 'Sofia');
        let content: { subject: string; bodyText: string; bodyHtml: string };
        try {
          const draftReply = await generateHandoffDraftReply(
            {
              subject: thread.subject,
              messages: thread.messages.map((m) => ({
                fromAddress: m.fromAddress,
                fromName: m.fromName,
                bodyText: m.bodyText,
                receivedAt: m.receivedAt,
              })),
              candidateName: candidate.name,
              classification,
              signatureHtml,
              ccName: ccDisplayName,
              ccEmail: config.draftCcEmail.toLowerCase(),
              handoffType: getHandoffType(mailbox.emailAddress, candidate.role ?? null),
            },
            { email: mailbox.emailAddress, displayName: mailbox.displayName }
          );
          if (signatureHtml) {
            draftReply.bodyText = `${draftReply.bodyText}\n${htmlSignatureToPlainText(signatureHtml)}`;
            draftReply.bodyHtml = `${draftReply.bodyHtml ?? ''}${signatureHtml}`;
          }
          content = draftReply;
        } catch {
          content = buildHandoffDraftContent(candidate.name, mailbox.displayName, mailbox.emailAddress, thread.subject, signatureHtml);
        }
        subject = content.subject;
        bodyText = content.bodyText;
        bodyHtml = content.bodyHtml;
      } else {
        const [examples] = await Promise.all([
          fetchExamplesForMailbox(mailbox.id, mailbox.emailAddress, classification),
        ]);
        const draftReply = await generateDraftReply(
          {
            subject: thread.subject,
            messages: thread.messages.map((m) => ({
              fromAddress: m.fromAddress,
              fromName: m.fromName,
              bodyText: m.bodyText,
              receivedAt: m.receivedAt,
            })),
            candidateName: candidate.name,
            classification,
            examples,
            signatureHtml,
          },
          { email: mailbox.emailAddress, displayName: mailbox.displayName }
        );
        if (signatureHtml) {
          draftReply.bodyText = `${draftReply.bodyText}\n${htmlSignatureToPlainText(signatureHtml)}`;
          draftReply.bodyHtml = `${draftReply.bodyHtml ?? ''}${signatureHtml}`;
        }
        subject = draftReply.subject;
        bodyText = draftReply.bodyText;
        bodyHtml = draftReply.bodyHtml;
      }

      const draft = await prisma.emailDraft.create({
        data: {
          threadId,
          inReplyToMessageId,
          referencesHeader: refsHeader,
          subject,
          bodyText,
          bodyHtml,
          classification,
          confidence,
          status: 'PENDING',
        },
      });

      await logEvent(
        'DRAFT_CREATED',
        {
          mailboxId: mailbox.id,
          candidateId: candidate.id,
          threadId,
          via: 'manual_generate',
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

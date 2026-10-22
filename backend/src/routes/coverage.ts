import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';
import { computeCoverage } from '../services/coverage.service';
import { normalizeEmail } from '../lib/senderIdentity';
import { logEvent } from '../services/monitoring.service';

// Sender coverage (audit H2). Mounted at /api/coverage behind requireAuth.
// Reading the report is open to any signed-in user (it only contains
// internal sender addresses); maintaining the expected-senders list is
// admin-only.

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

interface ExpectedSenderFields {
  displayName?: string | null;
  expectedSends30d?: number | null;
  notes?: string | null;
  isActive?: boolean;
}

function optionalString(v: unknown, field: string, max: number): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || v.length > max) return { ok: false, error: `${field} must be a string ≤ ${max} chars` };
  return { ok: true, value: v.trim() };
}

function parseFields(body: Record<string, unknown>): Parsed<ExpectedSenderFields> {
  const out: ExpectedSenderFields = {};
  const displayName = optionalString(body.displayName, 'displayName', 200);
  if (!displayName.ok) return displayName;
  if (displayName.value !== undefined) out.displayName = displayName.value;

  const notes = optionalString(body.notes, 'notes', 1000);
  if (!notes.ok) return notes;
  if (notes.value !== undefined) out.notes = notes.value;

  if (body.expectedSends30d !== undefined) {
    const n = body.expectedSends30d;
    if (n === null || n === '') out.expectedSends30d = null;
    else if (typeof n === 'number' && Number.isInteger(n) && n >= 0) out.expectedSends30d = n;
    else return { ok: false, error: 'expectedSends30d must be a non-negative integer or null' };
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return { ok: false, error: 'isActive must be a boolean' };
    out.isActive = body.isActive;
  }
  return { ok: true, value: out };
}

// GET /api/coverage
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await computeCoverage();
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/coverage/expected-senders
router.get('/expected-senders', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.expectedSender.findMany({ orderBy: { emailAddress: 'asc' } });
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/coverage/expected-senders — create or update by address.
router.post('/expected-senders', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const emailAddress = typeof body.emailAddress === 'string' ? normalizeEmail(body.emailAddress) : '';
    if (!EMAIL_RE.test(emailAddress)) {
      res.status(400).json({ success: false, error: 'emailAddress must be a valid email address' });
      return;
    }
    const fields = parseFields(body);
    if (!fields.ok) {
      res.status(400).json({ success: false, error: fields.error });
      return;
    }
    const row = await prisma.expectedSender.upsert({
      where: { emailAddress },
      update: fields.value,
      create: { isActive: true, ...fields.value, emailAddress, source: 'ADMIN' },
    });
    await logEvent('EXPECTED_SENDER_UPSERTED', { expectedSenderId: row.id, userId: req.userId }, 'INFO');
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/coverage/expected-senders/:id
router.patch('/expected-senders/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fields = parseFields((req.body ?? {}) as Record<string, unknown>);
    if (!fields.ok) {
      res.status(400).json({ success: false, error: fields.error });
      return;
    }
    const row = await prisma.expectedSender.update({
      where: { id: String(req.params.id) },
      data: fields.value,
    });
    res.json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/coverage/expected-senders/:id
router.delete('/expected-senders/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.expectedSender.delete({ where: { id: String(req.params.id) } });
    await logEvent('EXPECTED_SENDER_DELETED', { expectedSenderId: req.params.id, userId: req.userId }, 'INFO');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

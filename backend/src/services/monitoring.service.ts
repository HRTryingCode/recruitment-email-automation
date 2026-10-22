import { prisma } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { safeError } from '../lib/safeError';
import { sendAlert, isAlertingConfigured } from './alert.service';

// Keys whose values get fully replaced with [REDACTED] regardless of contents.
// SystemLog.details is readable by any authenticated user via the internal
// health/status endpoints, so we strip anything whose key suggests a secret.
const SECRET_KEY_RE = /(password|token|credential|secret)/i;

// Replace a `stack` string with just the first line (the error message) so
// downstream readers still get the gist without leaking file paths,
// dependency versions, or message bodies that v8 sometimes inlines into the
// stack frame. Returning `…(stack redacted)` makes the redaction visible.
function redactStack(stack: unknown): string {
  if (typeof stack !== 'string') return '…(stack redacted)';
  const firstLine = stack.split('\n', 1)[0]?.trim() ?? '';
  return firstLine ? `${firstLine} …(stack redacted)` : '…(stack redacted)';
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (key, val) => {
      if (key && SECRET_KEY_RE.test(key)) return '[REDACTED]';
      if (key === 'stack') return redactStack(val);
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      if (typeof val === 'bigint') return val.toString();
      if (val instanceof Error) {
        return {
          name: val.name,
          message: val.message,
          // Pass through unmodified — the `stack` branch above will redact it
          // when JSON.stringify recurses into this object. Keeping the field
          // present (rather than dropping it) preserves the shape consumers
          // expect when reading recentLogs.
          stack: val.stack,
        };
      }
      return val;
    });
  } catch {
    return '{"_serializationError":"unstringifiable"}';
  }
}

export async function logEvent(
  event: string,
  details: Record<string, unknown>,
  level: string = 'INFO'
): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: { event, details: safeStringify(details), level },
    });
  } catch (err) {
    // M2: with a 1-connection pool this fires exactly during the incidents
    // we most need to record — keep the event itself in the runtime logs.
    console.error('[Monitoring] Failed to log event:', safeError(err), {
      event,
      level,
      details: safeStringify(details).slice(0, 1000),
    });
  }
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: { connected: boolean; latencyMs?: number };
  claude: { available: boolean };
  mailboxes: Array<{
    id: string;
    emailAddress: string;
    provider: string;
    isActive: boolean;
    watchExpiry?: Date | null;
  }>;
  recentLogs: Array<{
    id: string;
    event: string;
    level: string;
    createdAt: Date;
    details: unknown;
  }>;
}

export async function checkHealth(): Promise<HealthStatus> {
  // Check DB
  let dbConnected = false;
  let dbLatency: number | undefined;

  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - start;
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  // Check Claude API — key shape and client init.
  // We don't make an actual API call to keep health checks fast and cheap;
  // instead we validate the key has the expected sk-ant-* shape and that
  // the SDK can instantiate. Real reachability is exercised by every draft
  // generation, which will surface failure via the SystemLog WARN path.
  let claudeAvailable = false;
  try {
    const key = config.anthropicApiKey;
    const keyShapeOk = typeof key === 'string' && /^sk-ant-/.test(key) && key.length > 30;
    if (keyShapeOk) {
      const client = new Anthropic({ apiKey: key });
      claudeAvailable = !!client;
    }
  } catch {
    claudeAvailable = false;
  }

  // Get mailbox statuses
  let mailboxes: HealthStatus['mailboxes'] = [];
  try {
    const mbs = await prisma.mailbox.findMany({
      select: {
        id: true,
        emailAddress: true,
        provider: true,
        isActive: true,
        watchExpiry: true,
      },
    });
    mailboxes = mbs;
  } catch {
    // DB might be down
  }

  // Recent logs
  let recentLogs: HealthStatus['recentLogs'] = [];
  try {
    recentLogs = await prisma.systemLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  } catch {
    // DB might be down
  }

  const status: HealthStatus['status'] =
    !dbConnected ? 'unhealthy' : !claudeAvailable ? 'degraded' : 'healthy';

  return {
    status,
    database: { connected: dbConnected, latencyMs: dbLatency },
    claude: { available: claudeAvailable },
    mailboxes,
    recentLogs,
  };
}

// ---------------------------------------------------------------------------
// Operational health issues (audit H3). Shared by the watchdog cron (Slack
// alerts on state change) and /api/health/deep (external uptime monitor).
// ---------------------------------------------------------------------------

export type HealthIssueType =
  | 'needs_reauth'
  | 'watch_expired'
  | 'reconcile_stale'
  | 'reconcile_dead'
  | 'reconcile_deadline'
  | 'webhook_errors';

export interface HealthIssue {
  /** Stable identity for state-change dedupe, e.g. `needs_reauth:<mailboxId>`. */
  key: string;
  type: HealthIssueType;
  severity: 'critical' | 'warning';
  /** One line, may contain the mailbox address (internal/Slack use only). */
  title: string;
  detail: string;
}

const HOUR_MS = 60 * 60 * 1000;
export const WATCHDOG_THRESHOLDS = {
  /** Per-mailbox: no successful RECONCILIATION_RUN for this long. */
  reconcileStaleMs: 3 * HOUR_MS,
  /** Dead-man's switch: no RECONCILIATION_RUN at all for this long. */
  reconcileDeadMs: 2 * HOUR_MS,
  /** Consecutive reconcile runs that hit the 45s start budget. */
  deadlineStreak: 3,
  /** WEBHOOK_HANDLER_ERROR rows in the last hour. */
  webhookErrorsPerHour: 20,
};
const LOOKBACK_MS = 4 * HOUR_MS;

function parseJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Evaluate mailbox + pipeline health. Two queries: active mailboxes, and
 * the last 4h of RECONCILIATION_RUN / WEBHOOK_HANDLER_ERROR rows.
 */
export async function collectHealthIssues(now: Date = new Date()): Promise<HealthIssue[]> {
  const t = now.getTime();
  const [mailboxes, logs] = await Promise.all([
    prisma.mailbox.findMany({
      where: { provider: 'GMAIL', isActive: true },
      select: {
        id: true,
        emailAddress: true,
        authStatus: true,
        lastAuthError: true,
        watchExpiry: true,
        createdAt: true,
      },
    }),
    prisma.systemLog.findMany({
      where: {
        createdAt: { gte: new Date(t - LOOKBACK_MS) },
        event: { in: ['RECONCILIATION_RUN', 'WEBHOOK_HANDLER_ERROR'] },
      },
      select: { event: true, details: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  const lastReconByMailbox = new Map<string, number>();
  let lastReconAny = 0;
  const summaries: boolean[] = []; // deadlineReached, newest first
  let webhookErrorsLastHour = 0;
  for (const log of logs) {
    const at = log.createdAt.getTime();
    if (log.event === 'WEBHOOK_HANDLER_ERROR') {
      if (at >= t - HOUR_MS) webhookErrorsLastHour += 1;
      continue;
    }
    lastReconAny = Math.max(lastReconAny, at);
    const d = parseJson(log.details);
    if (d.summary === true) {
      summaries.push(d.deadlineReached === true);
    } else if (typeof d.mailboxId === 'string') {
      lastReconByMailbox.set(d.mailboxId, Math.max(lastReconByMailbox.get(d.mailboxId) ?? 0, at));
    }
  }

  const issues: HealthIssue[] = [];
  const reconcileDead = lastReconAny < t - WATCHDOG_THRESHOLDS.reconcileDeadMs;

  for (const mb of mailboxes) {
    if (mb.authStatus === 'NEEDS_REAUTH') {
      issues.push({
        key: `needs_reauth:${mb.id}`,
        type: 'needs_reauth',
        severity: 'critical',
        title: `${mb.emailAddress} needs reconnect`,
        detail: `Google rejected the OAuth grant (${mb.lastAuthError ?? 'unknown error'}). No mail is being ingested. Reconnect via Mailboxes → Connect Gmail, then Resync.`,
      });
      continue; // expired watch / stale reconcile are consequences, not separate incidents
    }
    if (!mb.watchExpiry || mb.watchExpiry.getTime() < t) {
      issues.push({
        key: `watch_expired:${mb.id}`,
        type: 'watch_expired',
        severity: 'critical',
        title: `${mb.emailAddress} Gmail watch expired`,
        detail: mb.watchExpiry
          ? `Push notifications stopped at ${mb.watchExpiry.toISOString()}; only the hourly reconcile is ingesting. Check GMAIL_WATCH_RENEW_FAILED logs.`
          : 'No Gmail watch has ever been set for this mailbox.',
      });
    }
    const last = lastReconByMailbox.get(mb.id) ?? 0;
    if (
      !reconcileDead &&
      mb.createdAt.getTime() < t - WATCHDOG_THRESHOLDS.reconcileStaleMs &&
      last < t - WATCHDOG_THRESHOLDS.reconcileStaleMs
    ) {
      issues.push({
        key: `reconcile_stale:${mb.id}`,
        type: 'reconcile_stale',
        severity: 'warning',
        title: `${mb.emailAddress} not reconciled in 3h+`,
        detail: 'Reconcile is running for other mailboxes but has not succeeded for this one. Check RECONCILIATION_FAILED / RECONCILE_DEADLINE_REACHED logs.',
      });
    }
  }

  if (reconcileDead) {
    issues.push({
      key: 'reconcile_dead',
      type: 'reconcile_dead',
      severity: 'critical',
      title: 'Hourly reconcile has not run in 2h+',
      detail: lastReconAny
        ? `Last RECONCILIATION_RUN at ${new Date(lastReconAny).toISOString()}. Check Vercel cron + function logs.`
        : 'No RECONCILIATION_RUN in the last 4h. Check Vercel cron + function logs.',
    });
  }

  const streak = WATCHDOG_THRESHOLDS.deadlineStreak;
  if (summaries.length >= streak && summaries.slice(0, streak).every(Boolean)) {
    issues.push({
      key: 'reconcile_deadline',
      type: 'reconcile_deadline',
      severity: 'warning',
      title: `Reconcile hit its time budget ${streak} runs in a row`,
      detail: 'Some mailboxes are being skipped every hour (RECONCILE_DEADLINE_REACHED).',
    });
  }

  if (webhookErrorsLastHour >= WATCHDOG_THRESHOLDS.webhookErrorsPerHour) {
    issues.push({
      key: 'webhook_errors',
      type: 'webhook_errors',
      severity: 'warning',
      title: `${webhookErrorsLastHour} webhook errors in the last hour`,
      detail: 'Check WEBHOOK_HANDLER_ERROR rows in SystemLog.',
    });
  }

  return issues;
}

interface WatchdogStateEntry {
  key: string;
  title: string;
}

export interface WatchdogResult {
  issues: HealthIssue[];
  fired: string[];
  resolved: string[];
  alerting: 'enabled' | 'disabled';
}

/**
 * Watchdog: evaluate issues and alert on state change only.
 *
 * State lives in the latest WATCHDOG_STATE SystemLog row (`active` = issues
 * already announced). New issues are announced in one Slack message and only
 * recorded if that post succeeded, so a failed/unconfigured Slack retries
 * next run (and announces everything once SLACK_ALERT_WEBHOOK_URL is set).
 * Cleared issues get one "resolved" message. A state row is written only
 * when the announced set changes.
 */
export async function runWatchdog(now: Date = new Date()): Promise<WatchdogResult> {
  const issues = await collectHealthIssues(now);

  const prevRow = await prisma.systemLog.findFirst({
    where: { event: 'WATCHDOG_STATE' },
    orderBy: { createdAt: 'desc' },
    select: { details: true },
  });
  const prevState = parseJson(prevRow?.details ?? '{}');
  const prevActive: WatchdogStateEntry[] = Array.isArray(prevState.active)
    ? (prevState.active as WatchdogStateEntry[])
    : [];
  const prevKeys = new Set(prevActive.map((a) => a.key));
  const currentKeys = new Set(issues.map((i) => i.key));

  const newIssues = issues.filter((i) => !prevKeys.has(i.key));
  const cleared = prevActive.filter((a) => !currentKeys.has(a.key));

  let announced: HealthIssue[] = [];
  if (newIssues.length > 0) {
    const critical = newIssues.some((i) => i.severity === 'critical');
    const result = await sendAlert({
      severity: critical ? 'critical' : 'warning',
      title:
        newIssues.length === 1
          ? newIssues[0].title
          : `${newIssues.length} new recruiting-pipeline issues`,
      text: newIssues.map((i) => `• *${i.title}* — ${i.detail}`).join('\n'),
    });
    if (result.sent) announced = newIssues;
  }
  if (cleared.length > 0) {
    await sendAlert({
      severity: 'resolved',
      title: cleared.length === 1 ? `Resolved: ${cleared[0].title}` : `${cleared.length} issues resolved`,
      text: cleared.map((c) => `• ${c.title}`).join('\n'),
    });
  }

  const nextActive: WatchdogStateEntry[] = [
    ...prevActive.filter((a) => currentKeys.has(a.key)),
    ...announced.map((i) => ({ key: i.key, title: i.title })),
  ];
  const changed = announced.length > 0 || cleared.length > 0;
  if (changed) {
    await logEvent(
      'WATCHDOG_STATE',
      {
        active: nextActive,
        fired: announced.map((i) => i.key),
        resolved: cleared.map((c) => c.key),
      },
      'INFO'
    );
  }

  return {
    issues,
    fired: announced.map((i) => i.key),
    resolved: cleared.map((c) => c.key),
    alerting: isAlertingConfigured() ? 'enabled' : 'disabled',
  };
}

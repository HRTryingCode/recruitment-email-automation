/**
 * Outbound operator alerts (Slack incoming webhook).
 *
 * Public API — keep it small; other services reuse it:
 *
 *   sendAlert({ severity, title, text })  -> Promise<{ sent, reason? }>
 *   isAlertingConfigured()                 -> boolean
 *
 * Guarantees:
 *   - Never throws. Failures resolve to `{ sent: false, reason }`.
 *   - If SLACK_ALERT_WEBHOOK_URL is unset it is a no-op and warns ONCE per
 *     process, so deploying before the env var exists is safe.
 *   - No dedupe here. Callers that run on a schedule must dedupe themselves
 *     (see the watchdog in routes/internal-cron.ts, which alerts on state
 *     change only).
 *   - Never put secrets, tokens or email bodies in `title` / `text`.
 */

export type AlertSeverity = 'critical' | 'warning' | 'resolved';

export interface Alert {
  severity: AlertSeverity;
  title: string;
  text: string;
}

export interface AlertResult {
  sent: boolean;
  reason?: 'unconfigured' | 'http_error' | 'network_error';
}

const SEVERITY_PREFIX: Record<AlertSeverity, string> = {
  critical: ':rotating_light:',
  warning: ':warning:',
  resolved: ':white_check_mark:',
};

const TIMEOUT_MS = 5_000;

let warnedUnconfigured = false;

export function isAlertingConfigured(): boolean {
  return !!process.env.SLACK_ALERT_WEBHOOK_URL;
}

export async function sendAlert(alert: Alert): Promise<AlertResult> {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!url) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[Alert] SLACK_ALERT_WEBHOOK_URL is not set — alerts are disabled');
    }
    return { sent: false, reason: 'unconfigured' };
  }

  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';
  const text = `${SEVERITY_PREFIX[alert.severity]} *${alert.title}* _(recruitment-email-automation · ${env})_\n${alert.text}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[Alert] Slack webhook returned HTTP ${res.status}`);
      return { sent: false, reason: 'http_error' };
    }
    return { sent: true };
  } catch (err) {
    console.warn('[Alert] Slack webhook request failed:', err instanceof Error ? err.name : 'unknown');
    return { sent: false, reason: 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: reset the warn-once latch. */
export function _resetAlertServiceForTests(): void {
  warnedUnconfigured = false;
}

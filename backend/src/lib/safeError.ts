/**
 * Log-safe error helpers.
 *
 * googleapis / google-auth-library throw GaxiosError objects whose `config`
 * and `response.config` carry the OAuth request body — refresh_token,
 * client_secret, bearer access tokens. `console.error(prefix, err)` dumps
 * all of that into Vercel runtime logs (audit finding M7). Always pass
 * errors through `safeError()` before logging or persisting them.
 */

export interface SafeError {
  name: string;
  message: string;
  code?: string | number;
  status?: number;
}

const MAX_MESSAGE_LENGTH = 500;

// Google OAuth token shapes: refresh tokens ("1//0..."), access tokens
// ("ya29...."), client secrets ("GOCSPX-..."), plus key=value pairs whose
// key names a secret.
const TOKEN_PATTERNS: RegExp[] = [
  /1\/\/0[\w-]+/g,
  /ya29\.[\w.-]+/g,
  /GOCSPX-[\w-]+/g,
  /((?:refresh_token|access_token|client_secret|id_token)["']?\s*[=:]\s*["']?)[^\s&"',}]+/gi,
  /(Bearer\s+)[\w.-]+/gi,
];

function scrub(message: string): string {
  let out = message;
  for (const re of TOKEN_PATTERNS) {
    out = out.replace(re, (_m, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}[REDACTED]` : '[REDACTED]'
    );
  }
  if (out.length > MAX_MESSAGE_LENGTH) out = `${out.slice(0, MAX_MESSAGE_LENGTH)}…`;
  return out;
}

/** Reduce any thrown value to `{ name, message, code?, status? }` with secrets scrubbed. */
export function safeError(err: unknown): SafeError {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown; status?: unknown; response?: { status?: unknown } };
    const out: SafeError = { name: e.name || 'Error', message: scrub(e.message ?? '') };
    if (typeof e.code === 'string' || typeof e.code === 'number') out.code = e.code;
    const status = typeof e.status === 'number' ? e.status : e.response?.status;
    if (typeof status === 'number') out.status = status;
    return out;
  }
  return { name: 'NonError', message: scrub(String(err)) };
}

/**
 * Thrown by getGmailClient() for a mailbox whose OAuth grant is known to be
 * revoked (Mailbox.authStatus = NEEDS_REAUTH). Callers should treat it as
 * "skip this mailbox until a human reconnects it", not as a transient error.
 */
export class MailboxNeedsReauthError extends Error {
  // Picked up by middleware/error.ts: routes that hit a revoked mailbox
  // (resync, approve/send draft) return 409 with this message, not a 500.
  readonly statusCode = 409;
  readonly isOperational = true;

  constructor(public readonly emailAddress: string) {
    super(`Mailbox ${emailAddress} needs to be reconnected (OAuth grant revoked or expired)`);
    this.name = 'MailboxNeedsReauthError';
  }
}

/**
 * True when the error means the stored OAuth grant is no longer usable and
 * only a human reconnect will fix it: `invalid_grant` from the token
 * endpoint, or a 401 from a Google API.
 */
export function isAuthRevokedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof MailboxNeedsReauthError) return true;
  const e = err as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown; data?: { error?: unknown } };
  };
  if (e.response?.data?.error === 'invalid_grant') return true;
  if (typeof e.message === 'string' && /\binvalid_grant\b/.test(e.message)) return true;
  return e.status === 401 || e.code === 401 || e.code === '401' || e.response?.status === 401;
}

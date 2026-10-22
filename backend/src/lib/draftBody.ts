// Shared helpers for building draft bodies and subjects.
//
// The plain-text body is the single source of truth for a draft: model output
// and recruiter edits both arrive as text, and the HTML part we send to Gmail
// is always rendered from it here (escaped), never taken verbatim from the
// model or the client. That keeps the text/HTML parts in sync (C1) and closes
// the HTML-injection surface (M10).

const BODY_STYLE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13.5px;line-height:1.6;color:#1a1a1a;margin:0;";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render plain text as a styled, escaped HTML block (newlines → <br>). */
export function renderPlainTextAsHtml(text: string): string {
  const escaped = escapeHtml(text).replace(/\r?\n/g, '<br>\n');
  return `<div style="${BODY_STYLE}">${escaped}</div>`;
}

/**
 * Build the HTML body for a draft from its plain text and the mailbox's HTML
 * signature. `bodyText` is expected to end with the plain-text rendering of
 * the signature (that's how drafts are stored); when it does, that tail is
 * swapped for the real HTML signature. If the recruiter edited the signature
 * area, the text is rendered as-is and the HTML signature is not appended
 * (it would duplicate or contradict the edit).
 */
export function composeDraftHtml(
  bodyText: string,
  signatureHtml: string | null,
  signaturePlainText: string | null
): string {
  if (signatureHtml && signaturePlainText) {
    const suffix = '\n' + signaturePlainText;
    if (bodyText.endsWith(suffix)) {
      const core = bodyText.slice(0, bodyText.length - suffix.length);
      return `${renderPlainTextAsHtml(core)}${signatureHtml}`;
    }
  }
  return renderPlainTextAsHtml(bodyText);
}

/** "Re: <thread subject>" unless the thread subject already carries a Re: prefix. */
export function replySubject(threadSubject: string): string {
  const s = stripHeaderBreaks(threadSubject);
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Collapse CR/LF (header injection) and surrounding whitespace in a header value. */
export function stripHeaderBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Make a header value safe for an RFC 5322 message: strip CR/LF, and RFC 2047
 * B-encode it when it contains non-ASCII characters. Encoded words are kept
 * ≤ 75 chars and never split a multi-byte character.
 */
export function encodeHeaderValue(value: string): string {
  const clean = stripHeaderBreaks(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;

  const words: string[] = [];
  let chunk = '';
  for (const ch of clean) {
    // 45 raw bytes → 60 base64 chars; with "=?UTF-8?B?" + "?=" that is 72 ≤ 75.
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

const MSG_ID_RE = /^<[^<>\s@]+@[^<>\s]+>$/;

/** True for an RFC 5322 msg-id like `<abc@mail.gmail.com>` (not a Gmail API id). */
export function isRfcMessageId(value: string | null | undefined): value is string {
  return typeof value === 'string' && MSG_ID_RE.test(value.trim());
}

/** Keep only well-formed msg-ids from a References header value. */
export function sanitizeReferences(value: string | null | undefined): string {
  if (!value) return '';
  return stripHeaderBreaks(value)
    .split(/\s+/)
    .filter((t) => MSG_ID_RE.test(t))
    .join(' ');
}

/**
 * Wrap externally-authored text (candidate email, draft under revision) so the
 * model can tell data from instructions. Any literal fence tags inside the
 * text are defanged so the content cannot "close" the fence early.
 */
export function fenceUntrusted(text: string, tag = 'untrusted_email'): string {
  const defanged = text.replace(new RegExp(`<\\s*/?\\s*${tag}\\s*>`, 'gi'), '[removed tag]');
  return `<${tag}>\n${defanged}\n</${tag}>`;
}

/**
 * In-Reply-To / References for a reply to a stored EmailMessage, from its
 * persisted headers JSON ({ messageId, references }). Returns nulls when the
 * message has no RFC Message-ID — never the Gmail API id (M13).
 */
export function threadingHeadersFor(headersJson: string | null | undefined): {
  inReplyToMessageId: string | null;
  referencesHeader: string | null;
} {
  let parsed: { messageId?: unknown; references?: unknown } = {};
  try {
    parsed = JSON.parse(headersJson || '{}') as typeof parsed;
  } catch {
    parsed = {};
  }
  const messageId = typeof parsed.messageId === 'string' ? parsed.messageId.trim() : '';
  if (!isRfcMessageId(messageId)) return { inReplyToMessageId: null, referencesHeader: null };
  const prior = sanitizeReferences(typeof parsed.references === 'string' ? parsed.references : '');
  return { inReplyToMessageId: messageId, referencesHeader: prior ? `${prior} ${messageId}` : messageId };
}

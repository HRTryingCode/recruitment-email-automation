import { useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { cn, formatTimeAgo } from '../lib/utils';
import { Tooltip } from './ui/Tooltip';
import { ClassificationBadge, StatusBadge, type StatusVariant } from './ui/StatusBadge';
import {
  Check,
  X,
  Send,
  RefreshCw,
  Pencil,
  Mail,
  ChevronLeft,
} from 'lucide-react';
import type { EmailDraft, OriginalMessage } from '../lib/api';

interface Props {
  draft: EmailDraft | null;
  open: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onDiscard: (id: string) => void;
  onSend: (id: string) => void;
  onUpdate: (id: string, body: string) => void;
  onRegenerate: (id: string) => void;
  regenerating: boolean;
  regenerateError: string | null;
  /**
   * Imperative request to open the editor (driven by the `e` shortcut).
   * The pane resets this internally — parent only needs to bump a counter.
   */
  editRequestNonce?: number;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getOriginalBodyPlainText(original: OriginalMessage): string {
  if (original.bodyText && original.bodyText.trim().length > 0) {
    return original.bodyText;
  }
  if (original.bodyHtml) {
    return htmlToPlainText(original.bodyHtml);
  }
  return '';
}

function formatOriginalDate(value: string): string {
  const d = new Date(value);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function OriginalMessageBlock({ original }: { original: OriginalMessage }) {
  const body = getOriginalBodyPlainText(original);
  const senderLabel = original.fromName
    ? `${original.fromName} <${original.fromAddress}>`
    : original.fromAddress;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-base/40">
      <div className="border-b border-line-soft bg-fg-strong/[0.015] px-4 py-2.5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-muted">
          <Mail className="h-3 w-3" />
          Original message
        </div>
        <div className="space-y-0.5 font-mono text-[11.5px] leading-relaxed">
          <div className="flex">
            <span className="w-14 flex-shrink-0 text-fg-subtle">From</span>
            <span className="truncate text-fg-default">{senderLabel}</span>
          </div>
          <div className="flex">
            <span className="w-14 flex-shrink-0 text-fg-subtle">Date</span>
            <span className="text-fg-default">
              {formatOriginalDate(original.receivedAt)}
            </span>
          </div>
          <div className="flex">
            <span className="w-14 flex-shrink-0 text-fg-subtle">Subject</span>
            <span className="text-fg-default">{original.subject}</span>
          </div>
        </div>
      </div>
      <div className="border-l-2 border-accent-500/40 px-4 py-3">
        {body ? (
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-fg-default">
            {body}
          </pre>
        ) : (
          <p className="text-[13px] italic text-fg-subtle">(no message body)</p>
        )}
      </div>
    </div>
  );
}

function DiscardConfirm({
  onConfirm,
  disabled,
}: {
  onConfirm: () => void;
  disabled: boolean;
}) {
  return (
    <AlertDialog.Root>
      <Tooltip content="Discard draft">
        <AlertDialog.Trigger asChild>
          <button
            disabled={disabled}
            aria-label="Discard draft"
            className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-2 text-[13px] font-medium text-rose-700 ring-1 ring-inset ring-rose-500/20 transition-colors hover:bg-rose-500/15 dark:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Discard
          </button>
        </AlertDialog.Trigger>
      </Tooltip>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface-elevated/95 p-6 shadow-2xl backdrop-blur-xl data-[state=open]:animate-fade-in">
          <AlertDialog.Title className="font-display text-[16px] font-semibold text-fg-strong">
            Discard draft?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
            The draft will not be sent. New emails from this candidate will
            still generate drafts unless you ignore them.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button className="rounded-lg bg-fg-strong/[0.05] px-4 py-2 text-[13px] font-medium text-fg-default transition-colors hover:bg-fg-strong/[0.09]">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={onConfirm}
                className="rounded-lg bg-rose-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-rose-400"
              >
                Discard draft
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export default function DraftReviewPane({
  draft,
  open,
  onClose,
  onApprove,
  onDiscard,
  onSend,
  onUpdate,
  onRegenerate,
  regenerating,
  regenerateError,
  editRequestNonce,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(draft?.bodyText ?? '');
  const lastEditNonce = useRef(editRequestNonce);

  // When the active draft changes, exit edit mode and resync body
  useEffect(() => {
    setEditing(false);
    setEditedBody(draft?.bodyText ?? '');
  }, [draft?.id, draft?.bodyText]);

  // Honor imperative edit requests (driven by `e` keyboard shortcut)
  useEffect(() => {
    if (editRequestNonce === undefined) return;
    if (editRequestNonce === lastEditNonce.current) return;
    lastEditNonce.current = editRequestNonce;
    if (draft?.status === 'PENDING') {
      setEditing(true);
    }
  }, [editRequestNonce, draft?.status]);

  if (!open) return null;

  const candidate = draft?.thread?.candidate;
  const isPending = draft?.status === 'PENDING';
  const isApproved = draft?.status === 'APPROVED';

  const handleSaveEdit = () => {
    if (!draft) return;
    onUpdate(draft.id, editedBody);
    setEditing(false);
  };

  return (
    <>
      {/* Overlay (mobile shows backdrop; desktop the pane is a sheet that doesn't cover the list, so the overlay is mobile-only) */}
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-fade-in sm:hidden"
      />

      <aside
        data-draft-pane="true"
        role="dialog"
        aria-label={
          candidate ? `Draft for ${candidate.name}` : 'Draft review'
        }
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface-raised/95 shadow-2xl backdrop-blur-xl animate-fade-in sm:w-[640px]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={onClose}
                aria-label="Close draft pane"
                className="-ml-1 flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-fg-strong/[0.06] hover:text-fg-strong sm:hidden"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {candidate && (
                <StatusBadge
                  status={candidate.status as StatusVariant}
                  size="sm"
                />
              )}
              {draft && (
                <ClassificationBadge
                  classification={draft.classification}
                  confidence={draft.confidence}
                />
              )}
              {draft && (
                <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
                  {formatTimeAgo(draft.createdAt)}
                </span>
              )}
            </div>
            <h2 className="truncate font-display text-[17px] font-semibold tracking-tight text-fg-strong">
              {candidate?.name ?? 'Unknown candidate'}
            </h2>
            <p className="mt-0.5 truncate font-mono text-[12px] text-fg-muted">
              {candidate?.email ?? '—'}
            </p>
            {candidate?.role ? (
              <div className="mt-1.5">
                <span
                  data-testid="role-pill"
                  className="inline-block max-w-full truncate rounded-md bg-accent-500/8 px-2 py-0.5 text-[11.5px] font-medium text-accent-600 ring-1 ring-inset ring-accent-500/15 dark:text-accent-300"
                  title={candidate.role}
                >
                  {candidate.role}
                </span>
              </div>
            ) : null}
            <p className="mt-2.5 truncate text-[13px] text-fg-default">
              {draft?.subject}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close draft pane"
            className="hidden h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-fg-strong/[0.06] hover:text-fg-strong sm:flex"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!draft ? (
            <div className="space-y-3">
              <div className="h-24 skeleton rounded-xl" />
              <div className="h-40 skeleton rounded-xl" />
            </div>
          ) : (
            <div className="space-y-5">
              {draft.originalMessage && (
                <OriginalMessageBlock original={draft.originalMessage} />
              )}

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-muted">
                  <span className="inline-block h-px w-3 bg-accent-500/70" />
                  Your reply
                </p>
                <p className="mb-2 text-[11px] text-fg-subtle">
                  Will Cc{' '}
                  <span className="font-mono text-fg-muted">
                    sofia@archive.com
                  </span>
                </p>
                {editing ? (
                  <div className="space-y-3">
                    <textarea
                      value={editedBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      className="min-h-48 w-full resize-y rounded-lg border border-line-strong bg-surface-base/60 p-3 text-[13.5px] leading-relaxed text-fg-default focus:border-accent-400 focus:outline-none"
                      rows={12}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEdit}
                        className="rounded-lg bg-accent-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-400"
                      >
                        Save changes
                      </button>
                      <button
                        onClick={() => {
                          setEditing(false);
                          setEditedBody(draft.bodyText);
                        }}
                        className="rounded-lg bg-fg-strong/[0.05] px-3.5 py-2 text-[13px] font-medium text-fg-default transition-colors hover:bg-fg-strong/[0.09]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-line bg-surface-base/40 p-4">
                    <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-fg-default">
                      {draft.bodyText}
                    </pre>
                  </div>
                )}
              </div>

              {regenerateError && (
                <p className="text-[12px] text-rose-700 dark:text-rose-300">{regenerateError}</p>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        {draft && (isPending || isApproved) && (
          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-base/80 px-5 py-3.5">
            <div className="flex items-center gap-2">
              {isPending && (
                <>
                  <Tooltip content="Approve — saves as Gmail draft (a)">
                    <button
                      onClick={() => onApprove(draft.id)}
                      disabled={regenerating || editing}
                      aria-label="Approve draft"
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3.5 py-2 text-[13px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/25 transition-colors hover:bg-emerald-500/25 dark:text-emerald-300 dark:hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50'
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                  </Tooltip>
                  <DiscardConfirm
                    onConfirm={() => onDiscard(draft.id)}
                    disabled={regenerating}
                  />
                </>
              )}
              {isApproved && (
                <>
                  <button
                    onClick={() => onSend(draft.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-400"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send now
                  </button>
                  <button
                    onClick={() => onDiscard(draft.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3.5 py-2 text-[13px] font-medium text-rose-700 ring-1 ring-inset ring-rose-500/20 transition-colors hover:bg-rose-500/15 dark:text-rose-300"
                  >
                    <X className="h-3.5 w-3.5" />
                    Discard
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              {isPending && (
                <>
                  <Tooltip
                    content={regenerating ? 'Regenerating…' : 'Regenerate (r)'}
                  >
                    <button
                      onClick={() => onRegenerate(draft.id)}
                      disabled={regenerating || editing}
                      aria-label="Regenerate draft"
                      className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-fg-strong/[0.06] hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <RefreshCw
                        className={cn('h-4 w-4', regenerating && 'animate-spin')}
                      />
                    </button>
                  </Tooltip>
                  <Tooltip content="Edit body (e)">
                    <button
                      onClick={() => setEditing(true)}
                      disabled={regenerating || editing}
                      aria-label="Edit draft body"
                      className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-fg-strong/[0.06] hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

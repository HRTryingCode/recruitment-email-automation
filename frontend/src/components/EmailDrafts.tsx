import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import {
  fetchDrafts,
  approveDraft,
  discardDraft,
  sendDraft,
  updateDraft,
  regenerateDraft,
  type EmailDraft,
  type OriginalMessage,
} from '../lib/api';
import { cn, formatTimeAgo } from '../lib/utils';
import {
  toastSuccess,
  toastError,
  toastLoading,
  dismissToast,
  extractApiErrorMessage,
} from '../lib/toast';
import {
  Check,
  X,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Pencil,
  Mail,
  Inbox,
  FileText,
  Sparkles,
} from 'lucide-react';
import { ClassificationBadge } from './ui/StatusBadge';

const PREVIEW_LINE_LIMIT = 12;

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
  const [showFull, setShowFull] = useState(false);
  const body = getOriginalBodyPlainText(original);
  const lines = body.split('\n');
  const isLong = lines.length > PREVIEW_LINE_LIMIT;
  const visibleBody =
    showFull || !isLong ? body : lines.slice(0, PREVIEW_LINE_LIMIT).join('\n');

  const senderLabel = original.fromName
    ? `${original.fromName} <${original.fromAddress}>`
    : original.fromAddress;

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-white/[0.06] bg-ink-950/60">
      <div className="border-b border-white/[0.05] bg-white/[0.015] px-4 py-2.5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
          <Mail className="h-3 w-3" />
          Original message
        </div>
        <div className="space-y-0.5 font-mono text-[11.5px] leading-relaxed">
          <div className="flex">
            <span className="w-14 flex-shrink-0 text-ink-500">From</span>
            <span className="text-ink-200">{senderLabel}</span>
          </div>
          <div className="flex">
            <span className="w-14 flex-shrink-0 text-ink-500">Date</span>
            <span className="text-ink-200">
              {formatOriginalDate(original.receivedAt)}
            </span>
          </div>
          <div className="flex">
            <span className="w-14 flex-shrink-0 text-ink-500">Subject</span>
            <span className="text-ink-200">{original.subject}</span>
          </div>
        </div>
      </div>
      <div className="border-l-2 border-accent-500/40 px-4 py-3">
        {body ? (
          <>
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-200">
              {visibleBody}
            </pre>
            {isLong && (
              <button
                onClick={() => setShowFull((v) => !v)}
                className="mt-2 text-[12px] font-medium text-accent-300 transition-colors hover:text-accent-200"
              >
                {showFull ? 'Show less' : `Show ${lines.length - PREVIEW_LINE_LIMIT} more lines`}
              </button>
            )}
          </>
        ) : (
          <p className="text-[13px] italic text-ink-500">(no message body)</p>
        )}
      </div>
    </div>
  );
}

type DraftStatus = 'PENDING' | 'APPROVED' | 'SENT';

interface Props {
  mailboxId?: string;
}

interface DraftCardProps {
  draft: EmailDraft;
  highlight: boolean;
  defaultExpanded: boolean;
  onApprove: (id: string) => void;
  onDiscard: (id: string) => void;
  onSend: (id: string) => void;
  onUpdate: (id: string, body: string) => void;
  onRegenerate: (id: string) => void;
  regenerating: boolean;
  regenerateError: string | null;
}

function DraftCard({
  draft,
  highlight,
  defaultExpanded,
  onApprove,
  onDiscard,
  onSend,
  onUpdate,
  onRegenerate,
  regenerating,
  regenerateError,
}: DraftCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(draft.bodyText);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Keep `expanded` aligned with deep-link changes.
  useEffect(() => {
    if (defaultExpanded) setExpanded(true);
  }, [defaultExpanded]);

  // Scroll into view when this card is the deep-link target.
  useEffect(() => {
    if (!highlight) return;
    const el = cardRef.current;
    if (!el) return;
    const id = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => window.clearTimeout(id);
  }, [highlight]);

  const candidate = draft.thread?.candidate;
  const subject = draft.subject;

  const handleSaveEdit = () => {
    onUpdate(draft.id, editedBody);
    setEditing(false);
  };

  const isPending = draft.status === 'PENDING';

  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-ink-900/60 transition-all',
        highlight
          ? 'border-accent-400/40 shadow-glow'
          : 'border-white/[0.06] hover:border-white/[0.1]'
      )}
    >
      {/* Hairline accent on the left edge keyed to classification */}
      <div
        className={cn(
          'absolute left-0 top-0 h-full w-[2px]',
          draft.classification === 'INTERESTED' && 'bg-emerald-400/60',
          draft.classification === 'NOT_INTERESTED' && 'bg-rose-400/60',
          draft.classification === 'NEUTRAL' && 'bg-ink-500/40'
        )}
      />

      <div
        className="flex cursor-pointer items-start justify-between gap-4 p-4 transition-colors hover:bg-white/[0.015]"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-white">
              {candidate?.name ?? 'Unknown candidate'}
            </span>
            <ClassificationBadge
              classification={draft.classification}
              confidence={draft.confidence}
            />
          </div>
          <p className="truncate text-[13px] text-ink-200">{subject}</p>
          <p className="mt-1 line-clamp-1 text-[12px] text-ink-400">
            {draft.bodyText.split('\n').find((l) => l.trim()) ?? ''}
          </p>
        </div>
        <div
          className="flex flex-shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="mr-2 font-mono text-[11px] tabular-nums text-ink-500">
            {formatTimeAgo(draft.createdAt)}
          </span>
          {isPending && (
            <>
              <IconButton
                onClick={() => onApprove(draft.id)}
                disabled={regenerating}
                title="Approve — saves as a Gmail draft you can review"
                aria-label="Approve draft"
                tone="emerald"
              >
                <Check className="h-4 w-4" />
              </IconButton>
              <IconDestructiveButton
                onConfirm={() => onDiscard(draft.id)}
                disabled={regenerating}
                title="Discard draft?"
                description="The draft will not be sent. New emails from this candidate will still generate drafts unless you ignore them."
                confirmLabel="Discard draft"
                ariaLabel="Discard draft"
                buttonTone="rose"
                icon={<X className="h-4 w-4" />}
              />
              <IconButton
                onClick={() => onRegenerate(draft.id)}
                disabled={regenerating}
                title={
                  regenerating
                    ? 'Regenerating…'
                    : 'Regenerate — re-run Claude with the latest persona + prompt'
                }
                aria-label="Regenerate draft"
                tone="neutral"
              >
                <RefreshCw
                  className={cn('h-4 w-4', regenerating && 'animate-spin')}
                />
              </IconButton>
              <IconButton
                onClick={() => {
                  setExpanded(true);
                  setEditing(true);
                }}
                disabled={regenerating}
                title="Edit draft body"
                aria-label="Edit draft body"
                tone="neutral"
              >
                <Pencil className="h-4 w-4" />
              </IconButton>
            </>
          )}
          <span
            title="Expand to see full body + original candidate email"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-500"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </div>
      </div>

      {isPending && regenerateError && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-[12px] text-rose-300">{regenerateError}</p>
        </div>
      )}

      {expanded && (
        <div className="border-t border-white/[0.05] bg-ink-950/30">
          <div className="px-4 pb-1 pt-3">
            <p className="text-[11px] text-ink-500">
              Will Cc <span className="font-mono text-ink-300">sofia@archive.com</span>
            </p>
          </div>
          <div className="p-4 pt-3">
            {draft.originalMessage && (
              <OriginalMessageBlock original={draft.originalMessage} />
            )}
            {editing ? (
              <div className="space-y-3">
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  className="min-h-32 w-full resize-y rounded-lg border border-white/[0.08] bg-ink-950/60 p-3 text-[13px] leading-relaxed text-ink-100 focus:border-accent-400 focus:outline-none"
                  rows={8}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    className="rounded-lg bg-accent-500 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-400"
                  >
                    Save changes
                  </button>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditedBody(draft.bodyText);
                    }}
                    className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-[13px] font-medium text-ink-200 transition-colors hover:bg-white/[0.08]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-white/[0.04] bg-ink-950/40 p-4">
                <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-ink-100">
                  {draft.bodyText}
                </pre>
              </div>
            )}
          </div>

          {draft.status === 'APPROVED' && (
            <div className="flex items-center gap-2 border-t border-white/[0.05] px-4 py-3">
              <button
                onClick={() => onSend(draft.id)}
                className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-400"
              >
                <Send className="h-3.5 w-3.5" />
                Send now
              </button>
              <button
                onClick={() => onDiscard(draft.id)}
                className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[13px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/20 transition-colors hover:bg-rose-500/15"
              >
                <X className="h-3.5 w-3.5" />
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  tone,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone: 'emerald' | 'rose' | 'neutral';
}) {
  const toneClass = {
    emerald:
      'text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200',
    rose: 'text-rose-300 hover:bg-rose-500/15 hover:text-rose-200',
    neutral: 'text-ink-400 hover:bg-white/[0.06] hover:text-ink-100',
  }[tone];
  return (
    <button
      {...rest}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        toneClass
      )}
    >
      {children}
    </button>
  );
}

interface IconDestructiveButtonProps {
  onConfirm: () => void;
  disabled?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  ariaLabel: string;
  buttonTone: 'rose';
  icon: React.ReactNode;
}

function IconDestructiveButton({
  onConfirm,
  disabled,
  title,
  description,
  confirmLabel,
  ariaLabel,
  buttonTone,
  icon,
}: IconDestructiveButtonProps) {
  const toneClass = {
    rose: 'text-rose-300 hover:bg-rose-500/15 hover:text-rose-200',
  }[buttonTone];
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          disabled={disabled}
          aria-label={ariaLabel}
          title={title}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            toneClass
          )}
        >
          {icon}
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[0.08] bg-ink-900/95 p-6 shadow-2xl backdrop-blur-xl data-[state=open]:animate-fade-in">
          <AlertDialog.Title className="font-display text-[16px] font-semibold text-white">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13.5px] leading-relaxed text-ink-300">
            {description}
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button className="rounded-lg bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-ink-200 transition-colors hover:bg-white/[0.08]">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={onConfirm}
                className="rounded-lg bg-rose-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-rose-400"
              >
                {confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export default function EmailDrafts({ mailboxId: _mailboxId }: Props) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeStatus, setActiveStatus] = useState<DraftStatus>('PENDING');

  const deepLinkCandidateId = searchParams.get('candidateId');
  const deepLinkDraftId = searchParams.get('draftId');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['drafts', activeStatus],
    queryFn: () => fetchDrafts({ status: activeStatus, limit: 100 }),
    staleTime: 15_000,
  });

  // If we deep-link to a candidate that has no pending draft in the active list,
  // fall back to checking APPROVED. We do this by widening the query when needed.
  const drafts = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  // Resolve deep-linked draft id from either candidateId or draftId.
  const targetDraftId = useMemo(() => {
    if (deepLinkDraftId) return deepLinkDraftId;
    if (!deepLinkCandidateId) return null;
    // Try active list first; if not found in PENDING, switch tabs.
    const match = drafts.find(
      (d) =>
        d.thread?.candidate?.id === deepLinkCandidateId ||
        d.thread?.candidateId === deepLinkCandidateId
    );
    return match?.id ?? null;
  }, [deepLinkDraftId, deepLinkCandidateId, drafts]);

  // Auto-switch to APPROVED if the deep-linked candidate has no pending draft.
  const [didAutoSwitchTabs, setDidAutoSwitchTabs] = useState(false);
  useEffect(() => {
    if (!deepLinkCandidateId || isLoading || didAutoSwitchTabs) return;
    if (targetDraftId) return;
    if (activeStatus === 'PENDING') {
      setActiveStatus('APPROVED');
      setDidAutoSwitchTabs(true);
    }
  }, [deepLinkCandidateId, isLoading, targetDraftId, activeStatus, didAutoSwitchTabs]);

  // After consuming the deep-link (i.e. matched + auto-scrolled), clear params
  // so navigating between tabs doesn't keep re-triggering scroll.
  useEffect(() => {
    if (!targetDraftId) return;
    const params = new URLSearchParams(searchParams);
    const hadDeepLink = params.has('candidateId') || params.has('draftId');
    if (!hadDeepLink) return;
    const id = window.setTimeout(() => {
      params.delete('candidateId');
      params.delete('draftId');
      setSearchParams(params, { replace: true });
    }, 1200);
    return () => window.clearTimeout(id);
  }, [targetDraftId, searchParams, setSearchParams]);

  const approveMutation = useMutation({
    mutationFn: approveDraft,
    onSuccess: (_data, id) => {
      const d = drafts.find((x) => x.id === id);
      const who = d?.thread?.candidate?.name ?? 'candidate';
      toastSuccess(
        'Draft approved',
        `Saved as a Gmail draft — review in ${who}'s thread before sending.`
      );
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => {
      toastError(
        'Could not approve draft',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const discardMutation = useMutation({
    mutationFn: discardDraft,
    onSuccess: () => {
      toastSuccess('Draft discarded');
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => {
      toastError(
        'Could not discard draft',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const sendMutation = useMutation({
    mutationFn: sendDraft,
    onSuccess: (_res, id) => {
      const d = drafts.find((x) => x.id === id);
      const to = d?.thread?.candidate?.name ?? d?.thread?.candidate?.email ?? 'candidate';
      toastSuccess(
        `Email sent to ${to}`,
        'Cc: sofia@archive.com'
      );
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (err) => {
      toastError(
        'Could not send email',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, bodyText }: { id: string; bodyText: string }) =>
      updateDraft(id, { bodyText }),
    onSuccess: () => {
      toastSuccess('Draft updated');
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => {
      toastError(
        'Could not save draft',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const regenerateLoadingToastRef = useRef<string | number | null>(null);
  const regenerateMutation = useMutation({
    mutationFn: (id: string) => {
      regenerateLoadingToastRef.current = toastLoading('Regenerating draft…');
      return regenerateDraft(id);
    },
    onSuccess: () => {
      if (regenerateLoadingToastRef.current !== null) {
        dismissToast(regenerateLoadingToastRef.current);
        regenerateLoadingToastRef.current = null;
      }
      toastSuccess('Draft regenerated', 'Fresh copy ready for review.');
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: (err) => {
      if (regenerateLoadingToastRef.current !== null) {
        dismissToast(regenerateLoadingToastRef.current);
        regenerateLoadingToastRef.current = null;
      }
      toastError(
        'Could not regenerate draft',
        extractApiErrorMessage(err, 'Please try again.')
      );
    },
  });

  const regenerateErrorMessage = (id: string): string | null => {
    if (regenerateMutation.variables !== id) return null;
    if (regenerateMutation.isPending || !regenerateMutation.isError) return null;
    return extractApiErrorMessage(
      regenerateMutation.error,
      'Failed to regenerate draft'
    );
  };

  const statusTabs: { id: DraftStatus; label: string }[] = [
    { id: 'PENDING', label: 'Pending' },
    { id: 'APPROVED', label: 'Approved' },
    { id: 'SENT', label: 'Sent' },
  ];

  if (error) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-ink-900/60 p-10 text-center">
        <p className="mb-3 text-rose-300">Failed to load drafts</p>
        <button
          onClick={() => refetch()}
          className="mx-auto flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[13px] text-ink-200 transition-colors hover:bg-white/[0.08]"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
            Email drafts
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-400">
            Review, edit, and send AI-drafted replies to interested candidates.
          </p>
        </div>
      </div>

      {/* Status segmented control */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-white/[0.06] bg-ink-900/60 p-1">
          {statusTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveStatus(tab.id)}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-all',
                activeStatus === tab.id
                  ? 'bg-white/[0.08] text-white shadow-sm'
                  : 'text-ink-400 hover:text-ink-200'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[12px] tabular-nums text-ink-500">
          {total} {activeStatus.toLowerCase()}
        </span>
      </div>

      {/* Drafts list */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-xl border border-white/[0.06] bg-ink-900/60 p-4"
            >
              <div className="h-4 w-1/3 skeleton" />
              <div className="h-3 w-2/3 skeleton" />
              <div className="h-10 w-full skeleton" />
            </div>
          ))
        ) : drafts.length === 0 ? (
          <EmptyDraftsState status={activeStatus} />
        ) : (
          drafts.map((draft) => {
            const isTarget = draft.id === targetDraftId;
            return (
              <DraftCard
                key={draft.id}
                draft={draft}
                highlight={isTarget}
                defaultExpanded={isTarget}
                onApprove={(id) => approveMutation.mutate(id)}
                onDiscard={(id) => discardMutation.mutate(id)}
                onSend={(id) => sendMutation.mutate(id)}
                onUpdate={(id, bodyText) =>
                  updateMutation.mutate({ id, bodyText })
                }
                onRegenerate={(id) => regenerateMutation.mutate(id)}
                regenerating={
                  regenerateMutation.isPending &&
                  regenerateMutation.variables === draft.id
                }
                regenerateError={regenerateErrorMessage(draft.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyDraftsState({ status }: { status: DraftStatus }) {
  const config = {
    PENDING: {
      icon: Sparkles,
      title: 'No drafts waiting',
      description:
        "We'll generate replies automatically when interested candidates respond. Check back in a few minutes or connect a new mailbox.",
    },
    APPROVED: {
      icon: FileText,
      title: 'Nothing approved yet',
      description:
        'Approve drafts from the Pending tab — they will queue up here, saved as Gmail drafts for you to review before sending.',
    },
    SENT: {
      icon: Inbox,
      title: 'No sent drafts yet',
      description:
        'Approved drafts that you choose to send will land here, along with the timestamp of delivery.',
    },
  }[status];

  const Icon = config.icon;
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-ink-900/30 px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-accent-300 ring-1 ring-inset ring-white/[0.06]">
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-display text-[15px] font-medium text-ink-100">
        {config.title}
      </p>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-400">
        {config.description}
      </p>
    </div>
  );
}

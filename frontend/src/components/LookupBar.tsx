import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Search } from 'lucide-react';
import {
  fetchCandidates,
  fetchLookup,
  type LookupResult,
  type LookupVerdict,
} from '../lib/api';
import { cn } from '../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import LookupIntegrations from './LookupIntegrations';

const DEBOUNCE_MS = 300;
const PARTIAL_MIN_CHARS = 2;
const PARTIAL_LIMIT = 5;
// Mirrors backend lib/lookup.ts normalizeLookupEmail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VERDICTS: Record<LookupVerdict, { label: string; className: string }> = {
  CANDIDATE: {
    label: 'Candidate',
    className:
      'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300',
  },
  CONTACTED_NO_REPLY: {
    label: 'Contacted, no reply',
    className:
      'bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/20 dark:text-sky-300',
  },
  REPLIED_NOT_CANDIDATE: {
    label: 'Replied, not a candidate',
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300',
  },
  UNKNOWN: {
    label: 'Unknown',
    className: 'bg-fg-strong/[0.06] text-fg-muted ring-1 ring-inset ring-line',
  },
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function humanStatus(status: string): string {
  const s = status.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 py-1">
      <dt className="w-24 flex-shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg-default">{children}</dd>
    </div>
  );
}

function AnswerCard({ result, onOpen }: { result: LookupResult; onOpen: () => void }) {
  const v = VERDICTS[result.verdict];
  const { candidate, messages, drafts } = result;
  const draftCounts = Object.entries(drafts.byStatus)
    .map(([status, n]) => `${n} ${status.toLowerCase()}`)
    .join(' · ');

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge data-verdict={result.verdict} className={cn('h-auto border-transparent px-2 py-0.5 text-[11px]', v.className)}>
          {v.label}
        </Badge>
        <span className="min-w-0 truncate text-xs text-fg-muted">{result.email}</span>
      </div>
      <p className="text-sm text-fg-strong">{result.summary}</p>

      <dl className="text-[13px]">
        {candidate && (
          <>
            <Row label="Name">{candidate.name}</Row>
            <Row label="Status">
              {humanStatus(candidate.status)}
              {candidate.role ? ` · ${candidate.role}` : ''}
            </Row>
            {candidate.mailbox && <Row label="Mailbox">{candidate.mailbox.emailAddress}</Row>}
            {candidate.firstMailbox &&
              candidate.firstMailbox.id !== candidate.mailbox?.id && (
                <Row label="First seen in">{candidate.firstMailbox.emailAddress}</Row>
              )}
          </>
        )}
        {messages.inbound + messages.outbound > 0 && (
          <>
            <Row label="Messages">
              {`${messages.inbound} in · ${messages.outbound} out`}
              {messages.truncated ? '+' : ''}
              {` · ${fmtDate(messages.firstAt)} – ${fmtDate(messages.lastAt)}`}
            </Row>
            {messages.mailboxes.length > 0 && (
              <Row label="Mailboxes">
                {messages.mailboxes.map((m) => m.emailAddress).join(', ')}
              </Row>
            )}
            {messages.latestSubject && <Row label="Latest">{messages.latestSubject}</Row>}
          </>
        )}
        {drafts.total > 0 && <Row label="Drafts">{draftCounts}</Row>}
      </dl>

      <LookupIntegrations data={result.integrations} />

      {candidate && (
        <div className="flex justify-end">
          <Button size="sm" onClick={onOpen}>
            Open conversation
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Global "do we know this person?" lookup. Header trigger plus ⌘K / Ctrl-K
 * and `/` (when not typing in a field). A full email hits /api/lookup; a
 * partial string falls back to the top candidate name/email matches.
 */
export default function LookupBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(-1);
  const listId = useId();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim().toLowerCase()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const isEmail = EMAIL_RE.test(debounced);
  const isPartial = !isEmail && debounced.length >= PARTIAL_MIN_CHARS;

  const lookup = useQuery({
    queryKey: ['lookup', debounced],
    queryFn: () => fetchLookup(debounced),
    enabled: open && isEmail,
    staleTime: 30_000,
  });

  const partial = useQuery({
    queryKey: ['lookup-partial', debounced],
    queryFn: () =>
      fetchCandidates({ search: debounced, limit: PARTIAL_LIMIT, includeIgnored: true }),
    enabled: open && isPartial,
    staleTime: 30_000,
  });

  const options = isPartial ? (partial.data?.data ?? []).slice(0, PARTIAL_LIMIT) : [];
  const showOptions = options.length > 0;

  useEffect(() => setActive(-1), [debounced]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setInput('');
      setDebounced('');
    }
  };

  const pick = (email: string) => {
    setInput(email);
    setActive(-1);
  };

  const openConversation = (result: LookupResult) => {
    const latest = result.drafts.latest;
    const params = new URLSearchParams();
    if (latest && latest.status === 'PENDING') {
      params.set('tab', 'drafts');
      params.set('draftId', latest.id);
    } else {
      params.set('tab', 'candidates');
      params.set('q', result.email);
    }
    handleOpenChange(false);
    navigate(`/?${params.toString()}`);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showOptions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(options[active].email);
    }
  };

  const result = isEmail ? lookup.data?.data : undefined;
  const loading = (isEmail && lookup.isFetching) || (isPartial && partial.isFetching);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Look up an email (⌘K)"
          className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-raised/70 px-2.5 text-[13px] text-fg-muted transition-all hover:border-line-strong hover:bg-surface-elevated hover:text-fg-default"
        >
          <Search className="h-4 w-4" />
          <span className="hidden lg:inline">Look up email</span>
          <kbd className="hidden rounded border border-line bg-surface-base px-1.5 py-0.5 font-mono text-[10.5px] text-fg-default lg:inline">
            ⌘K
          </kbd>
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="top-[8vh] max-h-[84vh] translate-y-0 gap-4 overflow-y-auto rounded-3xl p-4 sm:max-w-xl sm:p-5"
      >
        <DialogTitle className="sr-only">Look up a person by email</DialogTitle>
        <DialogDescription className="sr-only">
          Type or paste an email to see whether we know this person.
        </DialogDescription>

        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-base px-3 focus-within:border-accent-500">
          <Search className="h-4 w-4 flex-shrink-0 text-fg-muted" aria-hidden />
          <input
            autoFocus
            type="text"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-label="Email to look up"
            aria-autocomplete="list"
            aria-expanded={showOptions}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            placeholder="name@company.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-fg-strong outline-none placeholder:text-fg-subtle"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-label="Loading" />}
        </div>

        <div aria-live="polite" className="flex flex-col gap-3">
          {isPartial && (
            <p className="text-xs text-fg-muted">
              Type a full email to check every mailbox. Matching candidates:
            </p>
          )}
          <ul id={listId} role="listbox" aria-label="Matching candidates" className="flex flex-col gap-1" hidden={!showOptions}>
            {options.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c.email)}
                className={cn(
                  'flex cursor-pointer flex-col rounded-lg px-3 py-2 text-[13px] hover:bg-fg-strong/[0.05]',
                  i === active && 'bg-fg-strong/[0.06]'
                )}
              >
                <span className="font-medium text-fg-strong">{c.name}</span>
                <span className="truncate text-fg-muted">{c.email}</span>
              </li>
            ))}
          </ul>
          {isPartial && !partial.isFetching && partial.isSuccess && !showOptions && (
            <p className="text-xs text-fg-subtle">No candidates match.</p>
          )}
          {isEmail && lookup.isError && (
            <p className="text-sm text-destructive">Lookup failed — try again in a moment.</p>
          )}
          {result && <AnswerCard result={result} onOpen={() => openConversation(result)} />}
          {!debounced && (
            <p className="text-xs text-fg-subtle">
              Paste an email to see if we’ve emailed, heard from, or tracked this person.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

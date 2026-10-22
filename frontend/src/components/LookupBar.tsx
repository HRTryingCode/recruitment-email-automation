import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Keyboard, MailPlus, RefreshCw, Search, SunMoon, UserRound } from 'lucide-react';
import {
  fetchCandidates,
  fetchLookup,
  fetchSyncHealth,
  type LookupResult,
  type LookupVerdict,
} from '../lib/api';
import { startGmailReconnect } from '../lib/reconnect';
import { currentTheme, isTypingTarget, openShortcuts } from '../lib/shortcuts';
import { LIVE_DRAFT_STATUSES } from '../lib/candidates';
import { usePaletteCandidate } from '../lib/paletteContext';
import { bannerIssues } from '../lib/statusBanner';
import { setTheme } from '../lib/theme';
import { viewHref } from '../lib/urlState';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command';
import { Kbd, KbdGroup } from './ui/kbd';
import { Spinner } from './ui/spinner';
import LookupIntegrations from './LookupIntegrations';
import { NAV_ITEMS } from './shell/nav';
import { CONNECT_MAILBOX_LABEL } from './shell/ConnectMailboxCard';

// CommandDialog's screen-reader title/description (not hover tooltips).
const PALETTE_TITLE = 'Look up a person or run a command';
const PALETTE_DESCRIPTION = 'Type or paste an email to see whether we know this person, or search the commands.';

const DEBOUNCE_MS = 300;
const PARTIAL_MIN_CHARS = 2;
const PARTIAL_LIMIT = 5;
// Mirrors backend lib/lookup.ts normalizeLookupEmail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VERDICTS: Record<LookupVerdict, { label: string; variant: 'success' | 'info' | 'warning' | 'secondary' }> = {
  CANDIDATE: { label: 'Candidate', variant: 'success' },
  CONTACTED_NO_REPLY: { label: 'Contacted, no reply', variant: 'info' },
  REPLIED_NOT_CANDIDATE: { label: 'Replied, not a candidate', variant: 'warning' },
  UNKNOWN: { label: 'Unknown', variant: 'secondary' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function humanStatus(status: string): string {
  const s = status.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 py-1">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
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
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge data-verdict={result.verdict} variant={v.variant}>
            {v.label}
          </Badge>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{result.email}</span>
        </div>
        <p className="text-sm">{result.summary}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <dl className="text-sm">
          {candidate && (
            <>
              <Row label="Name">{candidate.name}</Row>
              <Row label="Status">
                {humanStatus(candidate.status)}
                {candidate.role ? ` · ${candidate.role}` : ''}
              </Row>
              {candidate.mailbox && <Row label="Mailbox">{candidate.mailbox.emailAddress}</Row>}
              {candidate.firstMailbox && candidate.firstMailbox.id !== candidate.mailbox?.id && (
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
                <Row label="Mailboxes">{messages.mailboxes.map((m) => m.emailAddress).join(', ')}</Row>
              )}
              {messages.latestSubject && <Row label="Latest">{messages.latestSubject}</Row>}
            </>
          )}
          {drafts.total > 0 && <Row label="Drafts">{draftCounts}</Row>}
        </dl>
        <LookupIntegrations data={result.integrations} email={result.email} candidateId={candidate?.id ?? null} />
      </CardContent>
      {candidate && (
        <CardFooter className="justify-end">
          <Button size="sm" onClick={onOpen}>
            Open conversation
            <ArrowRight data-icon="inline-end" />
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

interface PaletteCommand {
  id: string;
  label: string;
  icon: React.ComponentType;
  shortcut?: string;
  run: () => void;
}

/**
 * ⌘K palette (also Ctrl-K, and `/` outside a text field). First group is
 * the "do we know this person?" email lookup: a full email hits
 * /api/lookup, a partial string lists the top candidate matches. Then
 * navigation and actions, filtered by what you type.
 */
export default function LookupBar() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [open, setOpenState] = useState(false);
  // CommandDialog has no Radix trigger, so return focus ourselves on close.
  const returnFocus = useRef<HTMLElement | null>(null);
  const setOpen = (next: boolean) => {
    if (next) returnFocus.current = document.activeElement as HTMLElement | null;
    setOpenState(next);
  };
  const [input, setInput] = useState('');
  const here = usePaletteCandidate();
  const [debounced, setDebounced] = useState('');

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
    queryFn: () => fetchCandidates({ search: debounced, limit: PARTIAL_LIMIT, includeIgnored: true }),
    enabled: open && isPartial,
    staleTime: 30_000,
  });

  // Shares the banner's cache entry; non-admins just get no reconnect actions.
  const health = useQuery({
    queryKey: ['sync-health'],
    queryFn: fetchSyncHealth,
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const options = isPartial ? (partial.data?.data ?? []).slice(0, PARTIAL_LIMIT) : [];

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setInput('');
      setDebounced('');
      const el = returnFocus.current;
      if (el) window.setTimeout(() => el.isConnected && el.focus(), 0);
    }
  };

  const go = (path: string, extra?: Record<string, string>) => {
    handleOpenChange(false);
    navigate(viewHref(path, params, extra));
  };

  // A live draft (same set as the Inbox) opens there; otherwise the
  // candidate's side panel on Candidates.
  const openConversation = (result: LookupResult) => {
    const latest = result.drafts.latest;
    if (latest && LIVE_DRAFT_STATUSES.has(latest.status)) go('/inbox', { item: latest.id });
    else if (result.candidate) go('/candidates', { candidate: result.candidate.id });
  };

  const commands: Array<{ heading: string; items: PaletteCommand[] }> = [
    ...(here
      ? [
          {
            heading: 'Current',
            items: [
              {
                id: `open-candidate-${here.id}`,
                label: `Open candidate · ${here.name}`,
                icon: UserRound,
                run: () => go('/candidates', { candidate: here.id }),
              },
            ],
          },
        ]
      : []),
    {
      heading: 'Go to',
      items: NAV_ITEMS.map((n) => ({
        id: `go-${n.path}`,
        label: `Go to ${n.label}`,
        icon: n.icon,
        shortcut: `G ${n.key.toUpperCase()}`,
        run: () => go(n.path),
      })),
    },
    {
      heading: 'Actions',
      items: [
        {
          id: 'theme',
          label: 'Toggle theme',
          icon: SunMoon,
          run: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'),
        },
        ...bannerIssues(health.data?.data ?? []).map((i) => ({
          id: `reconnect-${i.mailboxId}`,
          label: `Reconnect ${i.emailAddress}`,
          icon: RefreshCw,
          run: () => void startGmailReconnect(),
        })),
        { id: 'add-mailbox', label: CONNECT_MAILBOX_LABEL, icon: MailPlus, run: () => void startGmailReconnect() },
        {
          id: 'shortcuts',
          label: 'Show shortcuts',
          icon: Keyboard,
          shortcut: '?',
          run: () => {
            handleOpenChange(false);
            openShortcuts();
          },
        },
      ],
    },
  ];

  const needle = input.trim().toLowerCase();
  const visibleCommands = commands
    .map((g) => ({ ...g, items: g.items.filter((c) => !needle || c.label.toLowerCase().includes(needle)) }))
    .filter((g) => g.items.length > 0);

  const result = isEmail ? lookup.data?.data : undefined;
  const loading = (isEmail && lookup.isFetching) || (isPartial && partial.isFetching);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Look up an email or run a command (⌘K)"
        className="text-muted-foreground lg:w-72 lg:justify-start"
      >
        <Search data-icon="inline-start" />
        <span className="hidden lg:inline">Look up email or jump to…</span>
        <KbdGroup className="ml-auto hidden lg:inline-flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={PALETTE_TITLE}
        description={PALETTE_DESCRIPTION}
        className="sm:max-w-xl"
      >
        <Command shouldFilter={false} loop label="Email to look up, or a command">
          <CommandInput
            autoFocus
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            aria-label="Email to look up, or a command"
            placeholder="name@company.com, or a command…"
            value={input}
            onValueChange={setInput}
          />
          <CommandList className="max-h-96">
            <div aria-live="polite" className="flex flex-col gap-2 px-2 pt-2 empty:hidden">
              {loading && <Spinner className="self-center" />}
              {isPartial && (
                <p className="text-xs text-muted-foreground">Type a full email to check every mailbox. Matching candidates:</p>
              )}
              {isPartial && !partial.isFetching && partial.isSuccess && options.length === 0 && (
                <p className="text-xs text-muted-foreground">No candidates match.</p>
              )}
              {isEmail && lookup.isError && <p className="text-sm text-destructive">Lookup failed — try again in a moment.</p>}
              {result && <AnswerCard result={result} onOpen={() => openConversation(result)} />}
              {!debounced && (
                <p className="text-xs text-muted-foreground">
                  Paste an email to see if we’ve emailed, heard from, or tracked this person.
                </p>
              )}
            </div>
            {options.length > 0 && (
              <CommandGroup heading="Matching candidates">
                {options.map((c) => (
                  <CommandItem key={c.id} value={`candidate-${c.id}`} onSelect={() => go('/candidates', { candidate: c.id })}>
                    <UserRound />
                    <div className="flex min-w-0 flex-col">
                      <span>{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{c.email}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {visibleCommands.map((g) => (
              <div key={g.heading}>
                <CommandSeparator />
                <CommandGroup heading={g.heading}>
                  {g.items.map(({ id, label, icon: Icon, shortcut, run }) => (
                    <CommandItem key={id} value={id} onSelect={run}>
                      <Icon />
                      {label}
                      {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

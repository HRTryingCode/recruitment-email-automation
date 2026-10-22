import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, FileText, Loader2 } from 'lucide-react';
import {
  createLeverOpportunity,
  fetchLeverPostings,
  fetchLeverPrefill,
  newIdempotencyKey,
  type CreateLeverResult,
  type LeverPosting,
  type LeverPrefill,
  type LeverStage,
  type LeverTarget,
} from '@/lib/leverApi';
import { extractApiErrorMessage, toastSuccess } from '@/lib/toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: LeverTarget;
  onCreated?: (result: CreateLeverResult) => void;
}

const GEM_HINT: Record<string, string> = {
  NOT_CONNECTED: 'Connect Gem (account menu) to prefill from Gem',
  NEEDS_REAUTH: 'Gem needs reconnecting (account menu) — fill in manually for now',
  NOT_FOUND: 'Not found in Gem — fill in manually',
  UNAVAILABLE: 'Gem unavailable — paste LinkedIn manually',
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-fg-strong/[0.05] px-2 py-0.5 text-[11.5px] text-fg-default ring-1 ring-inset ring-fg-strong/[0.08]">
      {children}
    </span>
  );
}

/** F3: confirm what goes into Lever, then create it. */
export default function AddToLeverDialog({ open, onOpenChange, target, onCreated }: Props) {
  const key = 'candidateId' in target ? `c:${target.candidateId}` : `e:${target.email}`;
  const prefillQ = useQuery({
    queryKey: ['lever-prefill', key],
    queryFn: () => fetchLeverPrefill(target),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const postingsQ = useQuery({
    queryKey: ['lever-postings'],
    queryFn: fetchLeverPostings,
    enabled: open,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const loadError = prefillQ.error ?? postingsQ.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add to Lever</DialogTitle>
          <DialogDescription>
            {prefillQ.data?.email ?? ('email' in target ? target.email : 'Loading…')}
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p role="alert" className="text-[13px] text-red-600 dark:text-red-400">
            {extractApiErrorMessage(loadError, 'Could not load Lever data.')}
          </p>
        ) : prefillQ.data && postingsQ.data ? (
          <AddToLeverForm
            target={target}
            prefill={prefillQ.data}
            postings={postingsQ.data.postings}
            stages={postingsQ.data.stages}
            defaultStageId={prefillQ.data.stageId ?? postingsQ.data.defaultStageId}
            onDone={(result) => {
              onCreated?.(result);
              onOpenChange(false);
            }}
          />
        ) : (
          <div className="flex items-center gap-2 py-6 text-[13px] text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Looking up Lever and Gem…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddToLeverForm({
  target,
  prefill,
  postings,
  stages,
  defaultStageId,
  onDone,
}: {
  target: LeverTarget;
  prefill: LeverPrefill;
  postings: LeverPosting[];
  stages: LeverStage[];
  defaultStageId: string | null;
  onDone: (result: CreateLeverResult) => void;
}) {
  const queryClient = useQueryClient();
  // One key per dialog open: a double-click (or a retry after a network
  // blip) can't create two opportunities.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [name, setName] = useState(prefill.name ?? '');
  const [headline, setHeadline] = useState(prefill.headline ?? '');
  const [location, setLocation] = useState(prefill.location ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(prefill.linkedinUrl ?? '');
  const [postingId, setPostingId] = useState<string | null>(
    postings.some((p) => p.id === prefill.suggestedPostingId) ? prefill.suggestedPostingId : null
  );
  const [stageId, setStageId] = useState<string | null>(defaultStageId);
  const [search, setSearch] = useState('');

  // Suggested job first, then alphabetical; the search box narrows the list.
  const ordered = useMemo(() => {
    const sorted = [...postings].sort((a, b) => a.title.localeCompare(b.title));
    const i = sorted.findIndex((p) => p.id === prefill.suggestedPostingId);
    if (i > 0) sorted.unshift(...sorted.splice(i, 1));
    const q = search.trim().toLowerCase();
    return q
      ? sorted.filter((p) => [p.title, p.team, p.location].some((f) => f?.toLowerCase().includes(q)))
      : sorted;
  }, [postings, prefill.suggestedPostingId, search]);

  const posting = postings.find((p) => p.id === postingId) ?? null;
  const stage = stages.find((s) => s.id === stageId) ?? null;
  const sameJob = posting ? prefill.existing.find((o) => o.postingId === posting.id) : undefined;

  const mutation = useMutation({
    mutationFn: () =>
      createLeverOpportunity(target, {
        name: name.trim(),
        headline: headline.trim() || null,
        location: location.trim() || null,
        phone: prefill.phone,
        linkedinUrl: linkedinUrl.trim() || null,
        postingId: postingId!,
        stageId,
        tags: prefill.tags,
        sources: prefill.sources,
        note: prefill.note,
        includeResume: prefill.resume.available,
        idempotencyKey,
      }),
    onSuccess: (result) => {
      const details = [
        result.stageName && `Stage: ${result.stageName}`,
        result.resumeAttached && 'résumé attached',
        !result.noteAdded && 'note not added',
      ]
        .filter(Boolean)
        .join(' · ');
      toastSuccess(`Added ${name.trim()} to ${result.postingTitle ?? posting?.title ?? 'Lever'}`, details || undefined, {
        label: 'Open in Lever',
        onClick: () => window.open(result.leverUrl, '_blank', 'noopener,noreferrer'),
      });
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['lookup'] });
      void queryClient.invalidateQueries({ queryKey: ['lever-prefill'] });
      onDone(result);
    },
  });

  const canSubmit = prefill.createEnabled && !!name.trim() && !!posting && !sameJob && !mutation.isPending;
  const confirmLabel = `Add ${name.trim() || '…'} to ${posting?.title ?? 'a job'}`;
  const gemHint = prefill.gem.status === 'FOUND' ? null : (prefill.gem.message ?? GEM_HINT[prefill.gem.status]);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
    >
      {prefill.existing.length > 0 && (
        <div
          role="status"
          aria-label="Already in Lever"
          className="rounded-lg bg-amber-500/10 p-3 text-[12.5px] text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <ul className="space-y-0.5">
              {prefill.existing.map((o) => (
                <li key={o.id}>
                  Already in Lever on {o.postingTitle ?? 'a job with no posting'}
                  {o.archived ? ` (archived${o.archivedReason ? `: ${o.archivedReason}` : ''})` : o.stage ? ` (${o.stage})` : ''}{' '}
                  <a href={o.leverUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">
                    open <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Job</span>
        <Input
          id="atl-job-search"
          aria-label="Search jobs"
          placeholder="Search jobs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8"
        />
        <Select value={postingId ?? undefined} onValueChange={setPostingId}>
          <SelectTrigger aria-label="Job" className="w-full">
            <SelectValue>{posting?.title ?? <span className="text-fg-muted">Pick a job</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {ordered.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span>{p.title}</span>
                {p.id === prefill.suggestedPostingId && (
                  <span className="rounded bg-accent-500/10 px-1 text-[10.5px] text-accent-700 dark:text-accent-300">Suggested</span>
                )}
                <span className="text-[11px] text-fg-muted">
                  {[p.team, p.location, p.state === 'internal' ? 'internal' : null].filter(Boolean).join(' · ')}
                </span>
              </SelectItem>
            ))}
            {ordered.length === 0 && <div className="px-2 py-1.5 text-[12px] text-fg-muted">No matching jobs</div>}
          </SelectContent>
        </Select>
        {sameJob && (
          <p className="text-[12px] text-red-600 dark:text-red-400">
            {prefill.email} already has an opportunity for this job — pick another job.
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Stage</span>
        <Select value={stageId ?? undefined} onValueChange={setStageId}>
          <SelectTrigger aria-label="Stage" className="w-full">
            <SelectValue>{stage?.text ?? <span className="text-fg-muted">Lever default (New lead)</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="atl-name">Name</Label>
          <Input id="atl-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="atl-location">Location</Label>
          <Input id="atl-location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="atl-headline">Headline</Label>
          <Input id="atl-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="atl-linkedin">LinkedIn</Label>
          <Input
            id="atl-linkedin"
            type="url"
            placeholder="https://www.linkedin.com/in/…"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
          />
          {gemHint && <p className="text-[12px] text-fg-muted">{gemHint}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>
          <FileText className="h-3 w-3" />
          {prefill.resume.available ? `From Gem: ${prefill.resume.source ?? 'résumé'}` : 'No résumé'}
        </Chip>
        {prefill.sources.map((s) => (
          <Chip key={`s-${s}`}>{s}</Chip>
        ))}
        {prefill.tags.map((t) => (
          <Chip key={`t-${t}`}>{t}</Chip>
        ))}
      </div>

      <div className="grid gap-1.5">
        <span className="text-[12px] font-medium text-fg-muted">Note added to Lever</span>
        <pre
          data-testid="lever-note-preview"
          className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-fg-strong/[0.03] p-2 font-sans text-[12px] text-fg-default ring-1 ring-inset ring-fg-strong/[0.06]"
        >
          {prefill.note}
        </pre>
      </div>

      {mutation.isError && (
        <p role="alert" className="text-[13px] text-red-600 dark:text-red-400">
          {extractApiErrorMessage(mutation.error, 'Could not add to Lever.')}
        </p>
      )}

      <DialogFooter className="items-center">
        {!prefill.createEnabled && <span className="mr-auto text-[12px] text-fg-muted">Add to Lever is turned off</span>}
        <Button type="submit" disabled={!canSubmit}>
          {mutation.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

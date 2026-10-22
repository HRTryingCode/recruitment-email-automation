import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, FileText, Loader2, Sparkles } from 'lucide-react';
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
import { useGemConnectPopup } from '@/lib/gemOAuth';
import { normalizeLinkedinUrl } from '@/lib/linkedin';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Alert, AlertAction, AlertDescription } from './ui/alert';
import JobCombobox from './JobCombobox';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: LeverTarget;
  onCreated?: (result: CreateLeverResult) => void;
}

/** Muted one-liners; NOT_CONNECTED / NEEDS_REAUTH get the Connect callout instead. */
const GEM_HINT: Partial<Record<LeverPrefill['gem']['status'], string>> = {
  NOT_FOUND: 'Not found in Gem',
  UNAVAILABLE: 'Gem unavailable — paste LinkedIn manually',
};

type GemField = 'name' | 'headline' | 'location' | 'linkedinUrl';

function FilledFromGem() {
  return (
    <Badge variant="secondary" className="ml-1.5">
      <Sparkles className="size-3" />
      Filled from Gem
    </Badge>
  );
}

/** F3: confirm what goes into Lever, then create it. */
export default function AddToLeverDialog({ open, onOpenChange, target, onCreated }: Props) {
  const key = 'candidateId' in target ? `c:${target.candidateId}` : `e:${target.email}`;
  const prefillQ = useQuery({
    queryKey: ['lever-prefill', key],
    queryFn: () => fetchLeverPrefill(target),
    enabled: open,
    // Gem connection state may have changed since the last open (prod
    // 2026-10-22: a pre-connect prefill was reused) — always fetch fresh.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
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
          <p role="alert" className="text-sm text-destructive">
            {extractApiErrorMessage(loadError, 'Could not load Lever data.')}
          </p>
        ) : prefillQ.data && postingsQ.data ? (
          <AddToLeverForm
            target={target}
            prefill={prefillQ.data}
            refreshPrefill={() => void prefillQ.refetch()}
            postings={postingsQ.data.postings}
            stages={postingsQ.data.stages}
            defaultStageId={prefillQ.data.stageId ?? postingsQ.data.defaultStageId}
            onDone={(result) => {
              onCreated?.(result);
              onOpenChange(false);
            }}
          />
        ) : (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
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
  refreshPrefill,
  postings,
  stages,
  defaultStageId,
  onDone,
}: {
  target: LeverTarget;
  prefill: LeverPrefill;
  refreshPrefill: () => void;
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
  const [filledFromGem, setFilledFromGem] = useState<ReadonlySet<GemField>>(new Set());

  // A re-fetched prefill (after connecting Gem) fills only the fields the
  // recruiter left empty — never overwrites what they typed.
  const lastPrefill = useRef(prefill);
  useEffect(() => {
    if (lastPrefill.current === prefill) return;
    lastPrefill.current = prefill;
    const fields: Array<[GemField, string, (v: string) => void, string | null]> = [
      ['name', name, setName, prefill.name],
      ['headline', headline, setHeadline, prefill.headline],
      ['location', location, setLocation, prefill.location],
      ['linkedinUrl', linkedinUrl, setLinkedinUrl, prefill.linkedinUrl],
    ];
    const filled = fields.filter(([, current, , next]) => !current.trim() && !!next?.trim());
    for (const [, , set, next] of filled) set(next!);
    if (prefill.gem.status === 'FOUND' && filled.length > 0) {
      setFilledFromGem((prev) => new Set([...prev, ...filled.map(([f]) => f)]));
    }
    // Only a new prefill triggers this; the field values are read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const gemConnect = useGemConnectPopup({
    onConnected: () => {
      void queryClient.invalidateQueries({ queryKey: ['gem-status'] });
      refreshPrefill();
    },
  });

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
        linkedinUrl: normalizeLinkedinUrl(linkedinUrl),
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

  const linkedinInvalid = !!linkedinUrl.trim() && normalizeLinkedinUrl(linkedinUrl) === null;
  const canSubmit =
    prefill.createEnabled && !!name.trim() && !!posting && !sameJob && !linkedinInvalid && !mutation.isPending;
  const confirmLabel = `Add ${name.trim() || '…'} to ${posting?.title ?? 'a job'}`;
  const gemStatus = prefill.gem.status;
  const needsConnect = gemStatus === 'NOT_CONNECTED' || gemStatus === 'NEEDS_REAUTH';
  const gemHint = needsConnect ? null : (prefill.gem.message ?? GEM_HINT[gemStatus] ?? null);

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

      {needsConnect && (
        <Alert className="has-[[data-slot=alert-action]]:pr-40">
          <AlertDescription>
            {gemStatus === 'NEEDS_REAUTH'
              ? 'Gem needs reconnecting to fill in LinkedIn, title, location and résumé'
              : 'Connect Gem to fill in LinkedIn, title, location and résumé'}
            {gemConnect.error && <span className="mt-1 block text-destructive">{gemConnect.error}</span>}
          </AlertDescription>
          <AlertAction>
            <Button type="button" size="sm" variant="secondary" disabled={gemConnect.waiting} onClick={gemConnect.connect}>
              {gemConnect.waiting && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {gemConnect.waiting ? 'Waiting for Gem…' : gemStatus === 'NEEDS_REAUTH' ? 'Reconnect Gem' : 'Connect Gem'}
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div className="grid gap-1.5">
        <Label>Job</Label>
        <JobCombobox
          postings={postings}
          value={postingId}
          onChange={setPostingId}
          suggestedId={prefill.suggestedPostingId}
          invalid={!!sameJob}
        />
        {sameJob && (
          <p className="text-xs text-destructive">
            {prefill.email} already has an opportunity for this job — pick another job.
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label>Stage</Label>
        <Select value={stageId ?? undefined} onValueChange={setStageId}>
          <SelectTrigger aria-label="Stage" className="w-full">
            <SelectValue placeholder="Lever default (New lead)">{stage?.text}</SelectValue>
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
          <div className="flex items-center">
            <Label htmlFor="atl-name">Name</Label>
            {filledFromGem.has('name') && <FilledFromGem />}
          </div>
          <Input id="atl-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center">
            <Label htmlFor="atl-location">Location</Label>
            {filledFromGem.has('location') && <FilledFromGem />}
          </div>
          <Input id="atl-location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <div className="flex items-center">
            <Label htmlFor="atl-headline">Headline</Label>
            {filledFromGem.has('headline') && <FilledFromGem />}
          </div>
          <Input id="atl-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <div className="flex items-center">
            <Label htmlFor="atl-linkedin">LinkedIn</Label>
            {filledFromGem.has('linkedinUrl') && <FilledFromGem />}
          </div>
          {/* type=text: Gem and recruiters paste "www.linkedin.com/in/…" without a scheme. */}
          <Input
            id="atl-linkedin"
            inputMode="url"
            autoComplete="off"
            placeholder="linkedin.com/in/…"
            value={linkedinUrl}
            aria-invalid={linkedinInvalid || undefined}
            aria-describedby={linkedinInvalid ? 'atl-linkedin-error' : undefined}
            onChange={(e) => setLinkedinUrl(e.target.value)}
          />
          {linkedinInvalid && (
            <p id="atl-linkedin-error" className="text-xs text-destructive">
              Enter a linkedin.com URL
            </p>
          )}
          {gemHint && <p className="text-xs text-muted-foreground">{gemHint}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">
          <FileText className="size-3" />
          {prefill.resume.available ? `From Gem: ${prefill.resume.filename ?? prefill.resume.source ?? 'résumé'}` : 'No résumé'}
        </Badge>
        {prefill.sources.map((s) => (
          <Badge key={`s-${s}`} variant="outline">
            {s}
          </Badge>
        ))}
        {prefill.tags.map((t) => (
          <Badge key={`t-${t}`} variant="outline">
            {t}
          </Badge>
        ))}
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Note added to Lever</span>
        <pre
          data-testid="lever-note-preview"
          className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-muted/50 p-3 font-sans text-xs text-foreground"
        >
          {prefill.note}
        </pre>
      </div>

      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {extractApiErrorMessage(mutation.error, 'Could not add to Lever.')}
        </p>
      )}

      <DialogFooter className="items-center">
        {!prefill.createEnabled && <span className="mr-auto text-xs text-muted-foreground">Add to Lever is turned off</span>}
        <Button type="submit" disabled={!canSubmit}>
          {mutation.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

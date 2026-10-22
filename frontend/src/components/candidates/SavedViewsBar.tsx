import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, MoreHorizontal, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { createSavedView, deleteSavedView, fetchSavedViews, updateSavedView, type SavedView } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  DEFAULT_VIEWS,
  filtersFromParams,
  sameFilters,
  viewFilters,
  type CandidateFilters,
  type CandidateView,
} from '@/lib/candidates';
import { extractApiErrorMessage, toastError, toastSuccess } from '@/lib/toast';

export const SAVED_VIEWS_KEY = ['saved-views', 'candidates'] as const;

/** A stored view's filters go through the same validation as the URL. */
function toView(v: SavedView): CandidateView {
  const p = new URLSearchParams();
  for (const [k, val] of Object.entries(v.filters ?? {})) if (typeof val === 'string') p.set(k, val);
  return { id: v.id, name: v.name, filters: filtersFromParams(p), kind: v.shared ? 'team' : 'personal' };
}

interface Props {
  filters: CandidateFilters;
  viewId: string | undefined;
  onSelect: (view: CandidateView) => void;
}

/** Default + team + personal views (GET /api/views?scope=candidates) and "Save view". */
export default function SavedViewsBar({ filters, viewId, onSelect }: Props) {
  const qc = useQueryClient();
  const isAdmin = getUser()?.role === 'admin';
  const [saving, setSaving] = useState(false);

  const viewsQ = useQuery({
    queryKey: SAVED_VIEWS_KEY,
    queryFn: () => fetchSavedViews('candidates'),
    staleTime: 60_000,
  });
  const custom = (viewsQ.data?.data ?? []).map(toView);
  const views = [...DEFAULT_VIEWS, ...custom];
  // The URL names the chosen view; it stays lit while its filters match,
  // otherwise the first view with these filters does.
  const chosen = views.find((v) => v.id === viewId);
  const active = chosen && sameFilters(chosen.filters, filters) ? chosen : views.find((v) => sameFilters(v.filters, filters));
  const target = chosen ?? active;
  const editable = target && (target.kind === 'personal' || (target.kind === 'team' && isAdmin)) ? target : undefined;
  const modified = !!editable && !sameFilters(editable.filters, filters);

  const refresh = () => void qc.invalidateQueries({ queryKey: SAVED_VIEWS_KEY });
  const fail = (title: string) => (err: unknown) => toastError(title, extractApiErrorMessage(err, 'Please try again.'));

  const create = useMutation({
    mutationFn: (input: { name: string; shared: boolean }) =>
      createSavedView({ name: input.name, scope: 'candidates', filters: { ...viewFilters(filters) }, shared: input.shared }),
    onSuccess: (res) => {
      toastSuccess(`Saved view “${res.data.name}”`);
      setSaving(false);
      refresh();
      onSelect(toView(res.data));
    },
    onError: fail('Could not save the view'),
  });
  const update = useMutation({
    mutationFn: (id: string) => updateSavedView(id, { filters: { ...viewFilters(filters) } }),
    onSuccess: (res) => {
      toastSuccess(`Updated “${res.data.name}”`);
      refresh();
    },
    onError: fail('Could not update the view'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSavedView(id),
    onSuccess: () => {
      toastSuccess('View deleted');
      refresh();
      onSelect(DEFAULT_VIEWS[0]);
    },
    onError: fail('Could not delete the view'),
  });

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="no-scrollbar min-w-0 overflow-x-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Saved views"
          value={active?.id ?? ''}
          onValueChange={(id) => {
            const v = views.find((x) => x.id === id);
            if (v) onSelect(v);
          }}
        >
          {views.map((v) => (
            <ToggleGroupItem key={v.id} value={v.id} aria-label={v.name} className="whitespace-nowrap">
              {v.kind === 'team' && <Users data-icon="inline-start" />}
              {v.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {!active && (
        <Button size="sm" variant="ghost" onClick={() => setSaving(true)}>
          <BookmarkPlus data-icon="inline-start" />
          Save view
        </Button>
      )}
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Manage view ${editable.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => update.mutate(editable.id)}>
              {modified ? `Update “${editable.name}” with these filters` : `Save current sort to “${editable.name}”`}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSaving(true)}>Save as new view…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(editable.id)}>
              <Trash2 />
              Delete view
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <SaveViewDialog
        open={saving}
        canShare={isAdmin}
        pending={create.isPending}
        onOpenChange={setSaving}
        onSave={(name, shared) => create.mutate({ name, shared })}
      />
    </div>
  );
}

function SaveViewDialog({
  open,
  canShare,
  pending,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  canShare: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, shared: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('');
          setShared(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSave(name.trim(), shared);
          }}
        >
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>Saves the current filters and sort.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="view-name">Name</Label>
            <Input id="view-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {canShare && (
            <div className="flex items-center gap-2">
              <Checkbox id="view-shared" checked={shared} onCheckedChange={(v) => setShared(v === true)} />
              <Label htmlFor="view-shared">Share with the team</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || pending}>
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

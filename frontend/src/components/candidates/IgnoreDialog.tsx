import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Who an Ignore confirmation is for: one named candidate or a bulk count. */
export type IgnoreRequest = { ids: string[]; label: string } | null;

/** Confirm before ignoring (row menu, side panel, bulk bar). */
export default function IgnoreDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: IgnoreRequest;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ignore {request?.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            They'll be hidden from active lists and any pending drafts will be discarded. You can restore them at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => request && onConfirm(request.ids)}>
            Ignore
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

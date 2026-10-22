import { useQuery } from '@tanstack/react-query';
import { fetchMailboxSignatureHtml, type MailboxSyncHealth } from '../../lib/api';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Skeleton } from '../ui/skeleton';

interface Props {
  mailbox: MailboxSyncHealth | null;
  onOpenChange: (open: boolean) => void;
}

// The signature renders the way recipients see it: on a white email body,
// in a sandboxed frame with no scripts.
function srcDoc(html: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:12px;background:white;font-family:sans-serif;font-size:13px">${html}</body></html>`;
}

export default function SignaturePreviewDialog({ mailbox, onOpenChange }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['mailbox-signature', mailbox?.mailboxId],
    queryFn: () => fetchMailboxSignatureHtml(mailbox!.mailboxId),
    enabled: !!mailbox,
    retry: false,
  });

  return (
    <Dialog open={!!mailbox} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signature preview</DialogTitle>
          <DialogDescription>{mailbox?.emailAddress}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : data?.signatureHtml ? (
          <iframe
            srcDoc={srcDoc(data.signatureHtml)}
            sandbox="allow-same-origin"
            title="Signature preview"
            className="h-40 w-full border border-border"
            onLoad={(e) => {
              const body = e.currentTarget.contentDocument?.body;
              if (body) e.currentTarget.style.height = `${body.scrollHeight + 8}px`;
            }}
          />
        ) : (
          <Alert variant={isError ? 'destructive' : 'warning'}>
            <AlertTitle>{isError ? 'Could not load the signature' : 'No signature found'}</AlertTitle>
            <AlertDescription>
              Grant <code>gmail.settings.basic</code> in Google Admin Console → Security → API controls → Domain-wide
              delegation, then resync.
            </AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}

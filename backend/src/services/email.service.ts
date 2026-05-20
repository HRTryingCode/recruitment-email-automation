import { prisma } from '../db/client';
import { syncMessages as gmailSync } from './gmail.service';
import type { Mailbox, MailboxProvider } from '@prisma/client';

export function getService(mailbox: Mailbox): { sync: () => Promise<void> } {
  const provider: MailboxProvider = mailbox.provider;
  switch (provider) {
    case 'GMAIL':
      return {
        sync: () => gmailSync(mailbox.id),
      };
    case 'OUTLOOK':
      return {
        sync: async () => {
          console.warn('[Email] Outlook sync not yet implemented');
        },
      };
    case 'IMAP':
      return {
        sync: async () => {
          console.warn('[Email] IMAP sync not yet implemented');
        },
      };
    default:
      throw new Error(`Unsupported provider: ${mailbox.provider}`);
  }
}

export async function syncAllMailboxes(): Promise<void> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { isActive: true },
  });

  const results = await Promise.allSettled(
    mailboxes.map((mailbox) => {
      const service = getService(mailbox);
      return service.sync();
    })
  );

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `[Email] Sync failed for mailbox ${mailboxes[i].emailAddress}:`,
        result.reason
      );
    }
  });
}

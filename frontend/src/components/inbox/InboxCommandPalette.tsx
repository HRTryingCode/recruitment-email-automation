import { AlarmClock, Inbox, Keyboard, Pencil, Send, X } from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import type { InboxView } from '@/lib/api';
import { VIEWS } from '@/lib/inbox';

const PALETTE_TITLE = 'Inbox commands';
const PALETTE_DESCRIPTION = 'Jump to a view or act on the open reply';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onView: (view: InboxView) => void;
  /** Reply actions; omitted when no sendable reply is open. */
  reply?: { send: () => void; edit: () => void; dismiss: () => void; snooze: () => void };
  onHelp: () => void;
}

/** ⌘K inside the inbox: jump to a view or act on the open reply. */
export default function InboxCommandPalette({ open, onOpenChange, onView, reply, onHelp }: Props) {
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={PALETTE_TITLE} description={PALETTE_DESCRIPTION}>
      <Command>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          {reply && (
            <CommandGroup heading="Reply">
              <CommandItem onSelect={run(reply.send)}>
                <Send />
                Send
                <CommandShortcut>⌘↵</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={run(reply.edit)}>
                <Pencil />
                Edit draft
                <CommandShortcut>E</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={run(reply.dismiss)}>
                <X />
                Dismiss…
                <CommandShortcut>D</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={run(reply.snooze)}>
                <AlarmClock />
                Snooze…
                <CommandShortcut>S</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Views">
            {VIEWS.map((v) => (
              <CommandItem key={v.id} onSelect={run(() => onView(v.id))}>
                <Inbox />
                {`Go to ${v.label}`}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Help">
            <CommandItem onSelect={run(onHelp)}>
              <Keyboard />
              Keyboard shortcuts
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

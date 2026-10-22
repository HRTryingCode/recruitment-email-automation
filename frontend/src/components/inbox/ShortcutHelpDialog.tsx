import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { SHORTCUTS } from '@/hooks/useInboxShortcuts';

export default function ShortcutHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Only ⌘↵ and Esc work while you're typing.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2 text-sm">
          {SHORTCUTS.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4">
              <span className="text-foreground">{s.label}</span>
              <KbdGroup>
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </KbdGroup>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isTypingTarget, onOpenShortcuts } from '../../lib/shortcuts';
import { viewHref } from '../../lib/urlState';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Kbd, KbdGroup } from '../ui/kbd';
import { Separator } from '../ui/separator';
import { NAV_ITEMS } from './nav';

const SEQUENCE_MS = 1200;

const GLOBAL: Array<{ keys: string[][]; label: string }> = [
  { keys: [['⌘', 'K'], ['/']], label: 'Search an email or run a command' },
  ...NAV_ITEMS.map((n) => ({ keys: [['G', n.key.toUpperCase()]], label: `Go to ${n.label}` })),
  { keys: [['⌘', 'B']], label: 'Collapse / expand the sidebar' },
  { keys: [['?']], label: 'Show this help' },
];

/**
 * Global keyboard layer: `?` opens this help, `g` + letter jumps between
 * views. A screen with its own `?` help (the Inbox) handles the key first
 * and calls preventDefault; we yield to it.
 */
export default function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pendingG = useRef<number | null>(null);
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => onOpenShortcuts(() => setOpen(true)), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (pendingG.current !== null && Date.now() - pendingG.current < SEQUENCE_MS) {
        pendingG.current = null;
        const item = NAV_ITEMS.find((n) => n.key === e.key.toLowerCase());
        if (item) {
          e.preventDefault();
          navigate(viewHref(item.path, paramsRef.current));
        }
        return;
      }
      pendingG.current = e.key === 'g' ? Date.now() : null;
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work anywhere outside a text field. The Inbox lists its own with ? there.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {GLOBAL.map((s, i) => (
            <Fragment key={s.label}>
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{s.label}</span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {s.keys.map((combo, j) => (
                    <Fragment key={j}>
                      {j > 0 && <span>or</span>}
                      <KbdGroup>
                        {combo.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </KbdGroup>
                    </Fragment>
                  ))}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

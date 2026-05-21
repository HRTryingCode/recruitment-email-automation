import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  applyTheme,
  getInitialTheme,
  setTheme,
  subscribeToTheme,
  type Theme,
} from '../lib/theme';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface Props {
  className?: string;
}

export default function ThemeToggle({ className }: Props) {
  const [theme, setLocalTheme] = useState<Theme>(() => getInitialTheme());

  // Make sure the document class matches what we render — important when
  // ThemeToggle mounts after the inline pre-paint script (idempotent call).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // If theme changes from elsewhere (a hypothetical second toggle), stay in sync.
  useEffect(() => subscribeToTheme(setLocalTheme), []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label =
    theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            setLocalTheme(next);
            setTheme(next);
          }}
          aria-label={label}
          aria-pressed={theme === 'dark'}
          data-theme={theme}
          className={cn(
            'group relative flex size-9 items-center justify-center rounded-full border border-line bg-surface-raised/60 text-fg-muted transition-all hover:border-line-strong hover:bg-surface-elevated hover:text-fg-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/40',
            className
          )}
        >
          <Sun
            className={cn(
              'size-4 transition-all duration-300',
              theme === 'dark'
                ? 'scale-0 rotate-90 opacity-0'
                : 'scale-100 rotate-0 opacity-100'
            )}
            strokeWidth={2}
          />
          <Moon
            className={cn(
              'absolute size-4 transition-all duration-300',
              theme === 'dark'
                ? 'scale-100 rotate-0 opacity-100'
                : 'scale-0 -rotate-90 opacity-0'
            )}
            strokeWidth={2}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

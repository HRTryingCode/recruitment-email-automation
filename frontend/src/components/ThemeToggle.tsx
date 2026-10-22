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
import { Button } from './ui/button';
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setLocalTheme(next);
            setTheme(next);
          }}
          aria-label={label}
          aria-pressed={theme === 'dark'}
          data-theme={theme}
          className={cn('relative', className)}
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
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

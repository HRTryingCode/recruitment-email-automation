import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import { clearToken, clearUser, getUser } from '../../lib/auth';
import { viewHref } from '../../lib/urlState';
import GemConnect from '../GemConnect';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export function initials(name?: string, email?: string): string {
  const seed = (name || email || '?').trim();
  return (
    seed
      .split(/\s+/)
      .map((s) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

export function signOut(): void {
  clearToken();
  clearUser();
  window.location.assign('/login');
}

export default function AccountMenu() {
  const user = getUser();
  const [params] = useSearchParams();
  const label = user?.name || user?.email || 'Account';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Account menu" className="gap-2 px-1.5">
          <Avatar size="sm">
            {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={label} referrerPolicy="no-referrer" />}
            <AvatarFallback>{initials(user?.name, user?.email)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate lg:inline">{label}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {(user?.name || user?.email) && (
          <DropdownMenuLabel className="flex items-center gap-3">
            <Avatar>
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={label} referrerPolicy="no-referrer" />}
              <AvatarFallback>{initials(user?.name, user?.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              {user?.name && <p className="truncate text-sm font-medium text-foreground">{user.name}</p>}
              {user?.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
            </div>
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <GemConnect variant="menu" />
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to={viewHref('/settings', params)}>
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={signOut}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { CalendarCheck, Inbox, Settings, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Single-key shortcut after `g` (g i → Inbox). */
  key: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/inbox', label: 'Inbox', icon: Inbox, key: 'i' },
  { path: '/candidates', label: 'Candidates', icon: Users, key: 'c' },
  { path: '/today', label: 'Today', icon: CalendarCheck, key: 't' },
  { path: '/settings', label: 'Settings', icon: Settings, key: 's' },
];

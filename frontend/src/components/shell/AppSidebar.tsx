import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { viewHref } from '../../lib/urlState';
import { Avatar, AvatarFallback } from '../ui/avatar';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '../ui/sidebar';
import { NAV_ITEMS } from './nav';

interface Props {
  /** Replies waiting (needs review + interested + not interested) for the mailbox filter; badge on Inbox. */
  waitingCount: number;
}

export default function AppSidebar({ waitingCount }: Props) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" aria-label="Main navigation">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Archive Recruiting">
              <Link to={viewHref('/inbox', params)} onClick={close} aria-label="Archive Recruiting — go to Inbox">
                <Avatar>
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    <Sparkles className="size-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">Archive Recruiting</span>
                  <span className="truncate text-xs text-muted-foreground">AI email automation</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
                <SidebarMenuItem key={path}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(path)} tooltip={label}>
                    <Link
                      to={viewHref(path, params)}
                      onClick={close}
                      aria-current={pathname.startsWith(path) ? 'page' : undefined}
                    >
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {path === '/inbox' && waitingCount > 0 && (
                    <SidebarMenuBadge aria-label={`${waitingCount} waiting`}>{waitingCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

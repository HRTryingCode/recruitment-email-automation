import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Mail, Plug, Users } from 'lucide-react';
import { viewHref } from '../../lib/urlState';
import PageHeader from '../../components/shell/PageHeader';
import { Button } from '../../components/ui/button';

const SECTIONS = [
  { path: '/settings/mailboxes', label: 'Mailboxes', icon: Mail },
  { path: '/settings/integrations', label: 'Integrations', icon: Plug },
  { path: '/settings/team', label: 'Team', icon: Users },
];

export default function SettingsLayout() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Mailboxes and notifications, integrations and the team." />
      <nav aria-label="Settings sections" className="flex flex-wrap gap-1">
        {SECTIONS.map(({ path, label, icon: Icon }) => {
          const active = pathname.startsWith(path);
          return (
            <Button key={path} asChild size="sm" variant={active ? 'secondary' : 'ghost'}>
              <Link to={viewHref(path, params)} aria-current={active ? 'page' : undefined}>
                <Icon data-icon="inline-start" />
                {label}
              </Link>
            </Button>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import DesktopAlertsToggle from './DesktopAlertsToggle';

/** Settings → Notifications: desktop alerts for new Inbox replies. #notifications deep-links here. */
export default function NotificationsSettings() {
  const ref = useRef<HTMLElement | null>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#notifications') ref.current?.scrollIntoView?.({ block: 'start' });
  }, [hash]);
  return (
    <section ref={ref} id="notifications" aria-labelledby="notifications-title" className="scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle id="notifications-title">Notifications</CardTitle>
          <CardDescription>
            The Inbox tab shows how many new replies arrived while you were away. Turn on desktop alerts to also get a
            notification from your browser while the tab is in the background.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-xs">
          <DesktopAlertsToggle />
        </CardContent>
      </Card>
    </section>
  );
}

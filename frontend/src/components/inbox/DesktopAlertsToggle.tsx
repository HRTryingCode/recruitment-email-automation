import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { DESKTOP_ALERTS_KEY, desktopAlertsEnabled } from '@/hooks/useNewReplyAlerts';

function store(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DESKTOP_ALERTS_KEY, '1');
    else window.localStorage.removeItem(DESKTOP_ALERTS_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Opt in to a desktop notification when replies arrive while the tab is in
 * the background. Lives in the Inbox rail; asks the browser on first use.
 */
export default function DesktopAlertsToggle() {
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'denied');
  const [on, setOn] = useState(() => supported && Notification.permission === 'granted' && desktopAlertsEnabled());
  if (!supported) return null;

  const blocked = permission === 'denied';
  const change = async (pressed: boolean) => {
    if (!pressed) {
      store(false);
      setOn(false);
      return;
    }
    const result = permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setPermission(result);
    store(result === 'granted');
    setOn(result === 'granted');
  };

  return (
    <div className="flex flex-col gap-1">
      <Toggle
        size="sm"
        variant="outline"
        pressed={on}
        disabled={blocked}
        onPressedChange={(p) => void change(p)}
        className="w-full justify-start"
      >
        <BellRing data-icon="inline-start" />
        Desktop alerts
      </Toggle>
      <p className="px-1 text-xs text-muted-foreground">
        {blocked ? 'Blocked in browser settings' : on ? 'On while this tab is in the background' : 'Get notified about new replies'}
      </p>
    </div>
  );
}

// U1b item 5: opt in to desktop notifications for new replies (browser permission).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DesktopAlertsToggle from '../../../src/components/settings/DesktopAlertsToggle';
import { DESKTOP_ALERTS_KEY } from '../../../src/hooks/useNewReplyAlerts';

function stubNotification(permission: NotificationPermission, grant: NotificationPermission = permission) {
  const N = Object.assign(vi.fn(), {
    permission,
    requestPermission: vi.fn(async () => {
      N.permission = grant;
      return grant;
    }),
  });
  vi.stubGlobal('Notification', N);
  return N;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('DesktopAlertsToggle', () => {
  it('asks the browser for permission, then turns alerts on', async () => {
    const N = stubNotification('default', 'granted');
    render(<DesktopAlertsToggle />);
    const toggle = screen.getByRole('button', { name: /Desktop alerts/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(toggle);
    expect(N.requestPermission).toHaveBeenCalled();
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    expect(window.localStorage.getItem(DESKTOP_ALERTS_KEY)).toBe('1');
  });

  it('turns off again without asking', async () => {
    const N = stubNotification('granted');
    window.localStorage.setItem(DESKTOP_ALERTS_KEY, '1');
    render(<DesktopAlertsToggle />);
    const toggle = screen.getByRole('button', { name: /Desktop alerts/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem(DESKTOP_ALERTS_KEY)).toBeNull();
    expect(N.requestPermission).not.toHaveBeenCalled();
  });

  it('explains when the browser blocked notifications', () => {
    stubNotification('denied');
    render(<DesktopAlertsToggle />);
    expect(screen.getByRole('button', { name: /Desktop alerts/ })).toBeDisabled();
    expect(screen.getByText('Blocked in browser settings')).toBeInTheDocument();
  });

  it('renders nothing where notifications are unsupported', () => {
    vi.stubGlobal('Notification', undefined);
    const { container } = render(<DesktopAlertsToggle />);
    expect(container).toBeEmptyDOMElement();
  });
});

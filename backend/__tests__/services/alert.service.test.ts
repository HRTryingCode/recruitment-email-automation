import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendAlert, isAlertingConfigured, _resetAlertServiceForTests } from '../../src/services/alert.service';

const HOOK = 'https://hooks.slack.com/services/T000/B000/XXXX';

describe('alert.service', () => {
  const original = process.env.SLACK_ALERT_WEBHOOK_URL;
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetAlertServiceForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
    if (original === undefined) delete process.env.SLACK_ALERT_WEBHOOK_URL;
    else process.env.SLACK_ALERT_WEBHOOK_URL = original;
  });

  it('is a no-op that warns only once when SLACK_ALERT_WEBHOOK_URL is unset', async () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    expect(isAlertingConfigured()).toBe(false);

    const r1 = await sendAlert({ severity: 'critical', title: 't', text: 'x' });
    const r2 = await sendAlert({ severity: 'critical', title: 't', text: 'y' });

    expect(r1).toEqual({ sent: false, reason: 'unconfigured' });
    expect(r2).toEqual({ sent: false, reason: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('POSTs a Slack payload to the webhook', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = HOOK;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const r = await sendAlert({ severity: 'critical', title: 'Mailbox needs reconnect', text: 'a@archive.com' });

    expect(r).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(HOOK);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.text).toContain('Mailbox needs reconnect');
    expect(body.text).toContain('a@archive.com');
  });

  it('never throws on HTTP or network failure', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = HOOK;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(sendAlert({ severity: 'warning', title: 't', text: 'x' })).resolves.toEqual({
      sent: false,
      reason: 'http_error',
    });

    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(sendAlert({ severity: 'warning', title: 't', text: 'x' })).resolves.toEqual({
      sent: false,
      reason: 'network_error',
    });
  });
});

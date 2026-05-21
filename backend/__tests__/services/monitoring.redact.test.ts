import { describe, it, expect, vi } from 'vitest';

import { buildPrismaMock } from '../_setup/mockPrisma';

// safeStringify is called transitively by logEvent → systemLog.create. The
// test imports safeStringify directly for unit-level assertions on the
// serialized output. Prisma is still mocked to satisfy the module-level
// import side effects of monitoring.service.
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { safeStringify } from '../../src/services/monitoring.service';

describe('monitoring.safeStringify redaction', () => {
  it('strips multi-line Error.stack down to the first line with a redaction marker', () => {
    const err = new Error('something exploded');
    // node populates `stack` automatically, but pin it so the assertion is
    // deterministic across node versions.
    err.stack =
      'Error: something exploded\n    at Object.<anonymous> (/repo/src/foo.ts:42:9)\n    at Module._compile (node:internal/modules/cjs/loader:1234:14)';

    const out = safeStringify({ error: err });
    const parsed = JSON.parse(out);

    expect(parsed.error.name).toBe('Error');
    expect(parsed.error.message).toBe('something exploded');
    expect(parsed.error.stack).toBe('Error: something exploded …(stack redacted)');
    // No raw stack frames should survive.
    expect(out).not.toContain('/repo/src/foo.ts');
    expect(out).not.toContain('node:internal');
  });

  it('redacts secret-named fields regardless of value type', () => {
    const out = safeStringify({
      password: 'hunter2',
      apiToken: 'sk-ant-deadbeef',
      refreshTokenHash: 'abc',
      credentials: { type: 'service_account', private_key: 'PEM…' },
      mySecret: 42,
      benign: 'keep me',
    });
    const parsed = JSON.parse(out);

    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.apiToken).toBe('[REDACTED]');
    expect(parsed.refreshTokenHash).toBe('[REDACTED]');
    expect(parsed.credentials).toBe('[REDACTED]');
    expect(parsed.mySecret).toBe('[REDACTED]');
    expect(parsed.benign).toBe('keep me');
    // The nested PEM under credentials must not bleed through the replacer.
    expect(out).not.toContain('PEM');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('sk-ant-deadbeef');
  });

  it('preserves the error message — only the stack is trimmed', () => {
    const err = new Error('useful diagnostic');
    err.stack = 'Error: useful diagnostic\n    at frame1\n    at frame2';

    const out = safeStringify(err);
    const parsed = JSON.parse(out);

    expect(parsed.message).toBe('useful diagnostic');
    expect(parsed.stack).toMatch(/\(stack redacted\)$/);
    expect(parsed.stack).not.toContain('frame1');
  });

  it('redacts a stand-alone `stack` string even when no Error wrapper is involved', () => {
    const out = safeStringify({
      stack: 'fake stack\n    at sneaky/path/secret-leak.ts:1:1',
    });
    const parsed = JSON.parse(out);
    expect(parsed.stack).toBe('fake stack …(stack redacted)');
    expect(out).not.toContain('sneaky/path');
  });
});

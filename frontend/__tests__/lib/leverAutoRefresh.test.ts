import { describe, expect, it, vi } from 'vitest';
import { createLeverRefreshQueue } from '../../src/lib/leverAutoRefresh';
import type { Candidate } from '../../src/lib/api';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const cand = (id: string) => ({ id, leverState: 'NOT_FOUND' }) as Candidate;

describe('createLeverRefreshQueue', () => {
  it('runs at most 5 refreshes at once and drains the rest as slots free up', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<Candidate>>>();
    let inFlight = 0;
    let peak = 0;
    const refresh = vi.fn((id: string) => {
      const d = deferred<Candidate>();
      pending.set(id, d);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return d.promise.finally(() => {
        inFlight -= 1;
      });
    });
    const q = createLeverRefreshQueue(refresh);
    const done = vi.fn();
    for (let i = 0; i < 12; i++) q.enqueue(`c${i}`, done);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(5);

    for (let round = 0; round < 3; round++) {
      for (const [id, d] of [...pending]) {
        pending.delete(id);
        d.resolve(cand(id));
      }
      await flush();
      await flush();
    }
    expect(refresh).toHaveBeenCalledTimes(12);
    expect(peak).toBe(5);
    expect(done).toHaveBeenCalledTimes(12);
  });

  it('refreshes each candidate at most once per session, even after it finished or failed', async () => {
    const refresh = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('500');
      return cand(id);
    });
    const q = createLeverRefreshQueue(refresh);
    expect(q.enqueue('a', vi.fn())).toBe(true);
    expect(q.enqueue('a', vi.fn())).toBe(false); // in flight
    q.enqueue('bad', vi.fn());
    await flush();
    expect(q.enqueue('a', vi.fn())).toBe(false); // finished
    expect(q.enqueue('bad', vi.fn())).toBe(false); // failed — no retry storm
    await flush();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(['a', 'bad']);
  });

  it('swallows failures (sync throw or rejection) and does not call onDone', async () => {
    const onDone = vi.fn();
    const q = createLeverRefreshQueue(() => {
      throw new Error('boom');
    });
    q.enqueue('x', onDone);
    await flush();
    expect(onDone).not.toHaveBeenCalled();
  });
});

/**
 * Global per-host concurrency gate shared across requests.
 * Waiting requests can be cancelled when their browser connection closes.
 */
const PER_HOST_CONCURRENCY = 3;

interface HostWaiter {
  take: () => void;
  abort: () => void;
}

interface HostGate {
  active: number;
  waiters: HostWaiter[];
}

const hostGates = new Map<string, HostGate>();

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException('The operation was aborted', 'AbortError');
}

/** Acquire a host slot; an aborted waiter is removed from the FIFO queue immediately. */
export function acquireHostSlot(host: string, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));

  let gate = hostGates.get(host);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    hostGates.set(host, gate);
  }
  const current = gate;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', waiter.abort);

    const take = () => {
      if (settled) return;
      settled = true;
      cleanup();
      current.active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        current.active--;
        // Wake the next waiter synchronously so a new request cannot jump the FIFO queue.
        const next = current.waiters.shift();
        if (next) next.take();
        else if (current.active === 0) hostGates.delete(host);
      });
    };

    const waiter: HostWaiter = {
      take,
      abort: () => {
        if (settled) return;
        settled = true;
        const index = current.waiters.indexOf(waiter);
        if (index >= 0) current.waiters.splice(index, 1);
        cleanup();
        reject(abortError(signal));
        if (current.active === 0 && current.waiters.length === 0) hostGates.delete(host);
      },
    };

    if (current.active < PER_HOST_CONCURRENCY) {
      take();
      return;
    }

    current.waiters.push(waiter);
    signal?.addEventListener('abort', waiter.abort, { once: true });
    // Cover an abort that races with listener registration.
    if (signal?.aborted) waiter.abort();
  });
}

/** Wait time is outside the worker's own timeout; cancellation removes queued work. */
export async function withHostLimit<T>(
  url: string,
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const release = await acquireHostSlot(hostOf(url), signal);
  try {
    if (signal?.aborted) throw abortError(signal);
    return await fn();
  } finally {
    release();
  }
}

import { describe, expect, it, vi } from 'vitest';
import {
  ScreenWakeLockController,
  type ScreenWakeLockApiLike,
  type ScreenWakeLockSentinelLike,
  type VisibilityDocumentLike,
} from './screen-wake-lock';

function makeDocument() {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return doc;
}

function makeSentinel() {
  let released = false;
  const sentinel: ScreenWakeLockSentinelLike = {
    get released() { return released; },
    release: vi.fn(async () => { released = true; }),
  };
  return sentinel;
}

describe('ScreenWakeLockController', () => {
  it('acquires while visible and releases when playback stops', async () => {
    const doc = makeDocument();
    const sentinel = makeSentinel();
    const api: ScreenWakeLockApiLike = { request: vi.fn(async () => sentinel) };
    const controller = new ScreenWakeLockController(() => api, () => doc as unknown as VisibilityDocumentLike);

    await controller.start();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request).toHaveBeenCalledWith('screen');

    await controller.stop();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('does not request while hidden and reacquires when visible again', async () => {
    const doc = makeDocument();
    doc.visibilityState = 'hidden';
    const first = makeSentinel();
    const second = makeSentinel();
    const api: ScreenWakeLockApiLike = {
      request: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
    };
    const controller = new ScreenWakeLockController(() => api, () => doc as unknown as VisibilityDocumentLike);

    await controller.start();
    expect(api.request).not.toHaveBeenCalled();

    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await controller.start();
    expect(api.request).toHaveBeenCalledTimes(1);

    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await Promise.resolve();
    expect(first.release).toHaveBeenCalledTimes(1);

    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await controller.start();
    expect(api.request).toHaveBeenCalledTimes(2);
    await controller.stop();
    expect(second.release).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate locks when start is called repeatedly', async () => {
    const doc = makeDocument();
    const sentinel = makeSentinel();
    const api: ScreenWakeLockApiLike = { request: vi.fn(async () => sentinel) };
    const controller = new ScreenWakeLockController(() => api, () => doc as unknown as VisibilityDocumentLike);

    await controller.start();
    await controller.start();
    expect(api.request).toHaveBeenCalledTimes(1);
    await controller.stop();
  });

  it('releases a pending request that resolves after stop', async () => {
    const doc = makeDocument();
    const sentinel = makeSentinel();
    let resolveRequest!: (value: ScreenWakeLockSentinelLike) => void;
    const api: ScreenWakeLockApiLike = {
      request: vi.fn(() => new Promise<ScreenWakeLockSentinelLike>((resolve) => { resolveRequest = resolve; })), 
    };
    const controller = new ScreenWakeLockController(() => api, () => doc as unknown as VisibilityDocumentLike);

    const pending = controller.start();
    await controller.stop();
    resolveRequest(sentinel);
    await pending;
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op when the browser does not support Screen Wake Lock', async () => {
    const doc = makeDocument();
    const controller = new ScreenWakeLockController(() => undefined, () => doc as unknown as VisibilityDocumentLike);
    await expect(controller.start()).resolves.toBeUndefined();
    await expect(controller.stop()).resolves.toBeUndefined();
  });
});

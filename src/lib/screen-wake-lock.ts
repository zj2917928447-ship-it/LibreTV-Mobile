/**
 * Keep the display awake while a video is actively playing.
 *
 * The Screen Wake Lock API is available in secure contexts on supported browsers.
 * Unsupported browsers (including Safari versions without navigator.wakeLock) are
 * intentionally a no-op; playback itself must never depend on this enhancement.
 */

export interface ScreenWakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}

export interface ScreenWakeLockApiLike {
  request(type: 'screen'): Promise<ScreenWakeLockSentinelLike>;
}

export interface VisibilityDocumentLike {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

function defaultWakeLockApi(): ScreenWakeLockApiLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { wakeLock?: ScreenWakeLockApiLike }).wakeLock;
}

function defaultDocument(): VisibilityDocumentLike | undefined {
  if (typeof document === 'undefined') return undefined;
  return document;
}

export class ScreenWakeLockController {
  private active = false;
  private sentinel: ScreenWakeLockSentinelLike | null = null;
  private requestInFlight: Promise<void> | null = null;

  constructor(
    private readonly getApi: () => ScreenWakeLockApiLike | undefined = defaultWakeLockApi,
    private readonly getDocument: () => VisibilityDocumentLike | undefined = defaultDocument
  ) {}

  private readonly onVisibilityChange = () => {
    const doc = this.getDocument();
    if (!this.active || !doc) return;
    if (doc.visibilityState === 'visible') {
      void this.acquire();
    } else {
      void this.releaseCurrent();
    }
  };

  /** Call only after the media element actually starts playing. */
  start(): Promise<void> {
    if (!this.active) {
      this.active = true;
      this.getDocument()?.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    return this.acquire();
  }

  /** Release the lock on pause/end/error while keeping playback behavior unchanged. */
  async stop(): Promise<void> {
    if (this.active) {
      this.active = false;
      this.getDocument()?.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    await this.releaseCurrent();
  }

  dispose(): void {
    void this.stop();
  }

  private async acquire(): Promise<void> {
    const doc = this.getDocument();
    if (!this.active || !doc || doc.visibilityState !== 'visible') return;
    if (this.sentinel && !this.sentinel.released) return;
    if (this.requestInFlight) return this.requestInFlight;

    const api = this.getApi();
    if (!api) return;

    const request = api.request('screen').then(async (sentinel) => {
      // The page may have paused, hidden, or unmounted while the browser prompt was pending.
      if (!this.active || this.getDocument()?.visibilityState !== 'visible') {
        if (!sentinel.released) await sentinel.release().catch(() => {});
        return;
      }
      this.sentinel = sentinel;
    }).catch(() => {
      // Wake lock denial/unsupported hardware is non-fatal; never interrupt playback.
    });

    this.requestInFlight = request;
    try {
      await request;
    } finally {
      if (this.requestInFlight === request) this.requestInFlight = null;
    }
  }

  private async releaseCurrent(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (!sentinel || sentinel.released) return;
    await sentinel.release().catch(() => {});
  }
}

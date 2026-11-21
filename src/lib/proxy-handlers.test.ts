import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithSafeRedirects, checkLiveUrlAllowed, isBlockedByDNS, isValidProxyUrl } = vi.hoisted(() => ({
  fetchWithSafeRedirects: vi.fn(),
  checkLiveUrlAllowed: vi.fn(),
  isBlockedByDNS: vi.fn(),
  isValidProxyUrl: vi.fn(),
}));

vi.mock('@/lib/api-guard', () => ({
  guardRequest: vi.fn(() => null),
  jsonError: (message: string, status: number) => new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}));

vi.mock('@/lib/ssrf', () => ({
  checkLiveUrlAllowed,
  isBlockedByDNS,
  isValidProxyUrl,
}));

vi.mock('@/lib/fetch-utils', () => ({
  fetchWithSafeRedirects,
}));

vi.mock('@/lib/m3u8', () => ({
  LIVE_STREAM_BASE: '/api/live/stream?url=',
  PROXY_BASE: '/api/proxy?url=',
  rewriteM3u8: (value: string) => value,
}));

import { handleLiveStreamRequest, handleProxyRequest } from './proxy-handlers';

const TARGET = 'https://stream.example/live.ts';
const PROXY_TARGET = 'https://media.example/feature-film.ts';

function makeRequest(signal?: AbortSignal): Request {
  return new Request('https://app.example/api/live/stream?url=' + encodeURIComponent(TARGET), { signal });
}

function makeProxyRequest(signal?: AbortSignal): Request {
  return new Request('https://app.example/api/proxy?url=' + encodeURIComponent(PROXY_TARGET), { signal });
}

describe('handleProxyRequest streaming lifecycle', () => {
  beforeEach(() => {
    fetchWithSafeRedirects.mockReset();
    isBlockedByDNS.mockReset().mockResolvedValue(false);
    isValidProxyUrl.mockReset().mockReturnValue(true);
  });

  it('uses a header-only timeout and the browser signal for VOD/HLS segments', async () => {
    let upstreamInit: RequestInit | undefined;
    fetchWithSafeRedirects.mockImplementation(async (_url: string, init: RequestInit) => {
      upstreamInit = init;
      return {
        res: new Response('long media segment', { status: 200, headers: { 'content-type': 'video/mp2t' } }),
        finalUrl: PROXY_TARGET,
      };
    });
    const client = new AbortController();
    const request = makeProxyRequest(client.signal);
    const requestSignal = request.signal;

    const response = await handleProxyRequest(request, PROXY_TARGET);

    expect(response.status).toBe(200);
    expect(upstreamInit?.signal).toBe(requestSignal);
    expect(fetchWithSafeRedirects).toHaveBeenCalledWith(
      PROXY_TARGET,
      expect.objectContaining({ signal: requestSignal }),
      { headerTimeoutMs: expect.any(Number) }
    );
    expect(await response.text()).toBe('long media segment');
  });

  it('recognizes uppercase HLS extensions with query-string tokens', async () => {
    const target = 'https://media.example/live.M3U8?token=secret';
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response('#EXTM3U\\n#EXTINF:6,\\nsegment.ts\\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
      finalUrl: target,
    });
    const request = new Request('https://app.example/api/proxy?url=' + encodeURIComponent(target));

    const response = await handleProxyRequest(request, target);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.apple.mpegurl');
    expect(await response.text()).toContain('#EXTM3U');
  });

  it('does not rewrite or cache upstream error pages as HLS manifests', async () => {
    const target = 'https://media.example/expired.m3u8?token=expired';
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response('<html>token expired</html>', { status: 403, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }),
      finalUrl: target,
    });
    const request = new Request('https://app.example/api/proxy?url=' + encodeURIComponent(target));

    const response = await handleProxyRequest(request, target);

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: '代理上游返回 403' });
  });

  it('rejects an empty successful HLS response instead of returning a blank manifest', async () => {
    const target = 'https://media.example/empty.m3u8';
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(null, { status: 204, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }),
      finalUrl: target,
    });
    const request = new Request('https://app.example/api/proxy?url=' + encodeURIComponent(target));

    const response = await handleProxyRequest(request, target);

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('没有返回 m3u8');
  });

  it('times out a stalled HLS manifest body and cancels the upstream stream', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const target = 'https://media.example/stalled.m3u8';
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(body, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }),
      finalUrl: target,
    });
    const request = new Request('https://app.example/api/proxy?url=' + encodeURIComponent(target));

    try {
      const pending = handleProxyRequest(request, target);
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await pending;
      expect(response.status).toBe(502);
      expect(await response.text()).toContain('超时');
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects oversized HLS manifests and cancels the upstream body', async () => {
    let cancelled = false;
    const target = 'https://media.example/large.m3u8';
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    });
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(body, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }),
      finalUrl: target,
    });
    const request = new Request('https://app.example/api/proxy?url=' + encodeURIComponent(target));

    const response = await handleProxyRequest(request, target);

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('2 MiB');
    expect(cancelled).toBe(true);
  });

  it('rejects overlong VOD proxy URLs before DNS or fetch', async () => {
    const target = 'https://media.example/' + 'x'.repeat(8200);
    const request = new Request('https://app.example/api/proxy?url=too-long');

    const response = await handleProxyRequest(request, target);

    expect(response.status).toBe(414);
    expect(isValidProxyUrl).not.toHaveBeenCalled();
    expect(isBlockedByDNS).not.toHaveBeenCalled();
    expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
  });

  it('returns 499 without starting an upstream request when the VOD client is already disconnected', async () => {
    const client = new AbortController();
    client.abort();
    const response = await handleProxyRequest(makeProxyRequest(client.signal), PROXY_TARGET);
    expect(response.status).toBe(499);
    expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
  });
});

describe('handleLiveStreamRequest client lifecycle', () => {
  beforeEach(() => {
    fetchWithSafeRedirects.mockReset();
    checkLiveUrlAllowed.mockReset();
    isBlockedByDNS.mockReset();
    isValidProxyUrl.mockReset();
    checkLiveUrlAllowed.mockResolvedValue({ ok: true });
    isBlockedByDNS.mockResolvedValue(false);
    isValidProxyUrl.mockReturnValue(true);
  });

  it('rejects overlong live URLs before DNS or fetch', async () => {
    const target = 'https://stream.example/' + 'x'.repeat(8200);
    const request = new Request('https://app.example/api/live/stream?url=too-long');

    const response = await handleLiveStreamRequest(request, target);

    expect(response.status).toBe(414);
    expect(checkLiveUrlAllowed).not.toHaveBeenCalled();
    expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
  });

  it('returns 499 without DNS or upstream work when the client is already disconnected', async () => {
    const client = new AbortController();
    client.abort();

    const response = await handleLiveStreamRequest(makeRequest(client.signal), TARGET);

    expect(response.status).toBe(499);
    expect(checkLiveUrlAllowed).not.toHaveBeenCalled();
    expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
  });

  it('aborts the upstream connection when the client disconnects during connection setup', async () => {
    let upstreamSignal: AbortSignal | undefined;
    fetchWithSafeRedirects.mockImplementation((_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        if (upstreamSignal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        upstreamSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });

    const client = new AbortController();
    const pending = handleLiveStreamRequest(makeRequest(client.signal), TARGET);
    await vi.waitFor(() => expect(fetchWithSafeRedirects).toHaveBeenCalledTimes(1));
    client.abort();

    const response = await pending;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(response.status).toBe(499);
  });

  it('aborts the upstream stream when the browser cancels the returned body', async () => {
    let upstreamSignal: AbortSignal | undefined;
    fetchWithSafeRedirects.mockImplementation(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      });
      return { res: new Response(body, { status: 200, headers: { 'content-type': 'video/mp2t' } }), finalUrl: TARGET };
    });

    const response = await handleLiveStreamRequest(makeRequest(), TARGET);
    expect(response.status).toBe(200);
    await response.body?.cancel();

    expect(upstreamSignal?.aborted).toBe(true);
  });

  it('bounds live HLS manifest bodies and aborts the upstream connection when oversized', async () => {
    let upstreamSignal: AbortSignal | undefined;
    let cancelled = false;
    fetchWithSafeRedirects.mockImplementation(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
        cancel() { cancelled = true; },
      });
      return { res: new Response(body, { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }), finalUrl: 'https://stream.example/live.m3u8' };
    });

    const response = await handleLiveStreamRequest(makeRequest(), 'https://stream.example/live.m3u8');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('2 MiB') });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('maps a bodyless 304 to a gateway error instead of constructing an invalid JSON 304', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(null, { status: 304 }),
      finalUrl: TARGET,
    });

    const response = await handleLiveStreamRequest(makeRequest(), TARGET);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: '直播流上游返回 304' });
  });

  it('cancels the upstream response body when the browser disconnects after headers', async () => {
    let upstreamSignal: AbortSignal | undefined;
    let bodyCancelled = false;
    fetchWithSafeRedirects.mockImplementation(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
        cancel() { bodyCancelled = true; },
      });
      return { res: new Response(body, { status: 200, headers: { 'content-type': 'video/mp2t' } }), finalUrl: TARGET };
    });

    const client = new AbortController();
    const response = await handleLiveStreamRequest(makeRequest(client.signal), TARGET);
    expect(response.status).toBe(200);
    client.abort();
    await vi.waitFor(() => expect(bodyCancelled).toBe(true));

    expect(upstreamSignal?.aborted).toBe(true);
  });

  it('preserves an upstream error status even when the response has no body', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(null, { status: 403 }),
      finalUrl: TARGET,
    });

    const response = await handleLiveStreamRequest(makeRequest(), TARGET);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: '直播流上游返回 403' });
  });
});

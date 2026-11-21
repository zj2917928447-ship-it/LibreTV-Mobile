import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithSafeRedirects, isBlockedByDNS } = vi.hoisted(() => ({
  fetchWithSafeRedirects: vi.fn(),
  isBlockedByDNS: vi.fn(),
}));

vi.mock('@/lib/api-guard', () => ({
  guardRequest: vi.fn(() => null),
}));

vi.mock('@/lib/fetch-utils', () => ({
  fetchWithSafeRedirects,
}));

vi.mock('@/lib/ssrf', () => ({
  isBlockedByDNS,
  isValidProxyUrl: (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  },
}));

import { GET } from './route';

const targetUrl = 'https://media.example/feature-film.mp4?token=abc';

function request(url = targetUrl, headers?: HeadersInit): Request {
  return new Request(
    'https://app.example/api/download?url=' + encodeURIComponent(url) + '&filename=' + encodeURIComponent('流浪地球 2.mp4'),
    { headers }
  );
}

describe('GET /api/download', () => {
  beforeEach(() => {
    fetchWithSafeRedirects.mockReset();
    isBlockedByDNS.mockReset();
    isBlockedByDNS.mockResolvedValue(false);
  });

  it('streams a ranged upstream response and preserves media/range headers', async () => {
    const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(bytes, {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '16',
          'content-range': 'bytes 0-15/100',
          'accept-ranges': 'bytes',
          etag: '"media-v1"',
        },
      }),
      finalUrl: targetUrl,
    });

    const res = await GET(request(targetUrl, { range: 'bytes=0-15' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-range')).toBe('bytes 0-15/100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('etag')).toBe('"media-v1"');
    expect(res.headers.get('content-disposition')).toContain('filename*=UTF-8\'\'');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...bytes]);
    expect(fetchWithSafeRedirects).toHaveBeenCalledWith(
      targetUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=0-15' }),
      }),
      { headerTimeoutMs: 15_000 }
    );
  });

  it('rejects URLs with embedded credentials before making an upstream request', async () => {
    const res = await GET(request('https://user:pass@media.example/feature-film.mp4'));
    expect(res.status).toBe(400);
    expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
  });

  it('rejects playlist URLs because HLS remains in the segmented downloader', async () => {
    const res = await GET(request('https://media.example/master.m3u8'));
    expect(res.status).toBe(400);
    expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
    expect(isBlockedByDNS).not.toHaveBeenCalled();
  });

  it('rejects a target that resolves to a private or reserved address', async () => {
    isBlockedByDNS.mockResolvedValue(true);
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
  });

  it('does not turn an HTML login/error page into a downloaded movie', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response('<html>login required</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
      finalUrl: targetUrl,
    });

    const res = await GET(request());
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: '视频源返回的不是可下载的视频文件' });
  });

  it('rejects an HTML body even when the upstream falsely labels it video/mp4', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(new TextEncoder().encode('<html>login required</html>'), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      }),
      finalUrl: targetUrl,
    });

    const res = await GET(request());

    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: '视频源未返回可识别的视频文件内容' });
  });

  it('propagates upstream HTTP errors without returning an HTML body', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response('not found', { status: 404 }),
      finalUrl: targetUrl,
    });

    const res = await GET(request());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: '视频源返回 HTTP 404' });
  });

  it('ignores multipart byte ranges instead of forwarding a multipart body as video/mp4', async () => {
    const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } }),
      finalUrl: targetUrl,
    });

    const res = await GET(request(targetUrl, { range: 'bytes=0-3,8-11' }));

    expect(res.status).toBe(200);
    expect(fetchWithSafeRedirects).toHaveBeenCalledWith(
      targetUrl,
      expect.objectContaining({ headers: expect.not.objectContaining({ Range: expect.anything() }) }),
      { headerTimeoutMs: 15_000 }
    );
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...bytes]);
  });

  it('sniffs a valid MP4 when the upstream omits Content-Type and keeps the body streaming', async () => {
    const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 1, 2, 3]);
    fetchWithSafeRedirects.mockResolvedValue({ res: new Response(bytes), finalUrl: targetUrl });

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...bytes]);
  });

  it('times out when a source stalls before returning a video signature', async () => {
    vi.useFakeTimers();
    try {
      fetchWithSafeRedirects.mockResolvedValue({
        res: new Response(new ReadableStream<Uint8Array>({
          pull() { return new Promise<void>(() => {}); },
        }), { status: 200, headers: { 'content-type': 'video/mp4' } }),
        finalUrl: targetUrl,
      });

      const pending = GET(request());
      await vi.advanceTimersByTimeAsync(5_000);
      const response = await pending;

      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('等待视频文件头超时') });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an HTML error page even when the upstream omits Content-Type', async () => {
    fetchWithSafeRedirects.mockResolvedValue({ res: new Response(new TextEncoder().encode('<html>expired login</html>')), finalUrl: targetUrl });

    const res = await GET(request());

    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: '视频源未返回可识别的视频文件内容' });
  });

  it('probes a longer prefix when the initial zero-based range is too short to identify MP4', async () => {
    const firstBytes = Uint8Array.from([0, 0, 0, 24]);
    const mp4Header = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    fetchWithSafeRedirects
      .mockResolvedValueOnce({
        res: new Response(firstBytes, { status: 206, headers: { 'content-range': 'bytes 0-3/2048' } }),
        finalUrl: targetUrl,
      })
      .mockResolvedValueOnce({
        res: new Response(mp4Header, { status: 206, headers: { 'content-range': 'bytes 0-15/2048' } }),
        finalUrl: targetUrl,
      });

    const res = await GET(request(targetUrl, { range: 'bytes=0-3' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...firstBytes]);
    expect(fetchWithSafeRedirects).toHaveBeenCalledTimes(2);
  });

  it('probes byte zero before accepting a resumed generic-MIME range', async () => {
    const rangeBytes = new Uint8Array([10, 11, 12, 13]);
    const mp4Header = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    fetchWithSafeRedirects
      .mockResolvedValueOnce({
        res: new Response(rangeBytes, {
          status: 206,
          headers: { 'content-type': 'application/octet-stream', 'content-range': 'bytes 1024-1027/2048' },
        }),
        finalUrl: targetUrl,
      })
      .mockResolvedValueOnce({
        res: new Response(mp4Header, { status: 206, headers: { 'content-range': 'bytes 0-15/2048' } }),
        finalUrl: targetUrl,
      });

    const res = await GET(request(targetUrl, { range: 'bytes=1024-' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-range')).toBe('bytes 1024-1027/2048');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([10, 11, 12, 13]);
    expect(fetchWithSafeRedirects).toHaveBeenCalledTimes(2);
    expect(fetchWithSafeRedirects).toHaveBeenNthCalledWith(
      2,
      targetUrl,
      expect.objectContaining({ headers: expect.objectContaining({ Range: 'bytes=0-63' }) }),
      { headerTimeoutMs: 15_000 }
    );
  });

  it('validates suffix byte ranges using a separate byte-zero probe', async () => {
    const tail = new Uint8Array([7, 8, 9, 10]);
    const mp4Header = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    fetchWithSafeRedirects
      .mockResolvedValueOnce({
        res: new Response(tail, {
          status: 206,
          headers: { 'content-type': 'application/octet-stream', 'content-range': 'bytes 2044-2047/2048' },
        }),
        finalUrl: targetUrl,
      })
      .mockResolvedValueOnce({
        res: new Response(mp4Header, { status: 206, headers: { 'content-range': 'bytes 0-15/2048' } }),
        finalUrl: targetUrl,
      });

    const res = await GET(request(targetUrl, { range: 'bytes=-4' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...tail]);
    expect(fetchWithSafeRedirects).toHaveBeenCalledTimes(2);
  });

  it('rejects a resumed generic-MIME range if the byte-zero probe is HTML', async () => {
    fetchWithSafeRedirects
      .mockResolvedValueOnce({
        res: new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: { 'content-type': 'application/octet-stream', 'content-range': 'bytes 1024-1026/2048' },
        }),
        finalUrl: targetUrl,
      })
      .mockResolvedValueOnce({ res: new Response(new TextEncoder().encode('<html>login</html>')), finalUrl: targetUrl });

    const res = await GET(request(targetUrl, { range: 'bytes=1024-' }));

    expect(res.status).toBe(415);
    expect(fetchWithSafeRedirects).toHaveBeenCalledTimes(2);
  });

  it('does not preserve a compressed upstream content length after fetch decoding', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-encoding': 'gzip',
          'content-length': '100',
        },
      }),
      finalUrl: targetUrl,
    });

    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBeNull();
  });
});

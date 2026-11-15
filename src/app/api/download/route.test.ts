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
    const bytes = new Uint8Array([0, 1, 2, 3]);
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(bytes, {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '4',
          'content-range': 'bytes 0-3/100',
          'accept-ranges': 'bytes',
          etag: '"media-v1"',
        },
      }),
      finalUrl: targetUrl,
    });

    const res = await GET(request(targetUrl, { range: 'bytes=0-3' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-range')).toBe('bytes 0-3/100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('etag')).toBe('"media-v1"');
    expect(res.headers.get('content-disposition')).toContain('filename*=UTF-8\'\'');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 1, 2, 3]);
    expect(fetchWithSafeRedirects).toHaveBeenCalledWith(
      targetUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=0-3' }),
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

  it('propagates upstream HTTP errors without returning an HTML body', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response('not found', { status: 404 }),
      finalUrl: targetUrl,
    });

    const res = await GET(request());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: '视频源返回 HTTP 404' });
  });

  it('does not preserve a compressed upstream content length after fetch decoding', async () => {
    fetchWithSafeRedirects.mockResolvedValue({
      res: new Response(new Uint8Array([1, 2]), {
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

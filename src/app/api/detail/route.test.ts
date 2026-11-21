import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUpstream, getCache, setCache, checkUpstreamAllowed, parseDetail } = vi.hoisted(() => ({
  fetchUpstream: vi.fn(),
  getCache: vi.fn(),
  setCache: vi.fn(),
  checkUpstreamAllowed: vi.fn(),
  parseDetail: vi.fn(),
}));

vi.mock('@/lib/api-guard', () => ({
  guardRequest: vi.fn(() => null),
}));

vi.mock('@/lib/cms-parser', () => ({
  cmsRequestHeaders: () => ({ 'User-Agent': 'test' }),
  parseDetail,
  parseDetailPageHtml: vi.fn(),
}));

vi.mock('@/lib/fetch-utils', () => ({
  fetchUpstream,
  getCache,
  setCache,
}));

vi.mock('@/lib/ssrf', () => ({
  checkUpstreamAllowed,
}));

import { GET } from './route';

function request(source: Record<string, unknown>): Request {
  return new Request(
    'https://app.example/api/detail?id=123&source=' + encodeURIComponent(JSON.stringify(source))
  );
}

describe('GET /api/detail', () => {
  beforeEach(() => {
    fetchUpstream.mockReset();
    getCache.mockReset();
    setCache.mockReset();
    checkUpstreamAllowed.mockReset();
    parseDetail.mockReset();
    getCache.mockReturnValue(undefined);
    checkUpstreamAllowed.mockResolvedValue({ ok: true });
    fetchUpstream.mockImplementation(async () => new Response('{}', { status: 200 }));
    parseDetail.mockImplementation((_data, source) => ({
      episodes: ['Episode 1$https://media.example/1.m3u8'],
      videoInfo: { sourceKey: source.key, sourceName: source.name },
    }));
  });

  it('rejects malformed source fields before any upstream request', async () => {
    const response = await GET(request({
      key: 'bad',
      name: 'Bad source',
      url: 'https://cms.example/api.php',
      detail: { url: 'http://127.0.0.1' },
    }));

    expect(response.status).toBe(400);
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(checkUpstreamAllowed).not.toHaveBeenCalled();
  });

  it('rejects an invalid optional detail root before making upstream requests', async () => {
    const source = { key: 'source', name: 'Source', url: 'https://cms.example/api.php' };
    const response = await GET(new Request(
      'https://app.example/api/detail?id=123&source=' + encodeURIComponent(JSON.stringify(source)) + '&baseUrl=' + encodeURIComponent('https://user:pass@cms.example/root')
    ));

    expect(response.status).toBe(400);
    expect(fetchUpstream).not.toHaveBeenCalled();
    expect(checkUpstreamAllowed).not.toHaveBeenCalled();
  });

  it('preserves existing query-string credentials when constructing the CMS detail API URL', async () => {
    const source = { key: 'token-source', name: '令牌源', url: 'https://cms.example/api.php?token=secret&client=mobile' };

    const response = await GET(request(source));

    expect(response.status).toBe(200);
    const requested = new URL(fetchUpstream.mock.calls[0][0] as string);
    expect(requested.searchParams.get('token')).toBe('secret');
    expect(requested.searchParams.get('client')).toBe('mobile');
    expect(requested.searchParams.get('ac')).toBe('videolist');
    expect(requested.searchParams.get('ids')).toBe('123');
  });

  it('does not reuse cached detail metadata after the source key or display name changes', async () => {
    const base = { url: 'https://cms.example/api.php?token=secret' };
    const first = await GET(request({ ...base, key: 'old-key', name: '旧名称' }));
    const second = await GET(request({ ...base, key: 'new-key', name: '新名称' }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const keys = getCache.mock.calls.map(([key]) => key as string);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('accepts SeaCMS / custom VOD IDs containing colons or dots while rejecting path-traversal IDs', async () => {
    const source = { key: 'seacms', name: '海洋CMS', url: 'https://cms.example/api.php' };
    const okRes = await GET(new Request(
      'https://app.example/api/detail?id=' + encodeURIComponent('seacms:vod.1024-hd') + '&source=' + encodeURIComponent(JSON.stringify(source))
    ));
    expect(okRes.status).toBe(200);

    const badRes = await GET(new Request(
      'https://app.example/api/detail?id=' + encodeURIComponent('../etc/passwd') + '&source=' + encodeURIComponent(JSON.stringify(source))
    ));
    expect(badRes.status).toBe(400);
  });
});

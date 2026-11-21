import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUpstreamJson, getCache, setCache, withHostLimit, guardRequest } = vi.hoisted(() => ({
  fetchUpstreamJson: vi.fn(),
  getCache: vi.fn(),
  setCache: vi.fn(),
  withHostLimit: vi.fn((_url: string, fn: () => Promise<unknown>) => fn()),
  guardRequest: vi.fn(() => null),
}));

vi.mock('@/lib/api-guard', () => ({ guardRequest }));
vi.mock('@/lib/fetch-utils', () => ({ fetchUpstreamJson, getCache, setCache }));
vi.mock('@/lib/host-gate', () => ({ withHostLimit }));

import { GET } from './route';

function request(query = '蜘蛛侠', region = 'US') {
  const sp = new URLSearchParams({ q: query, region });
  return new Request(`https://app.example/api/catalog/search?${sp.toString()}`);
}

describe('GET /api/catalog/search', () => {
  beforeEach(() => {
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test-secret-token');
    fetchUpstreamJson.mockReset();
    getCache.mockReset();
    setCache.mockReset();
    withHostLimit.mockReset().mockImplementation((_url: string, fn: () => Promise<unknown>) => fn());
    guardRequest.mockReset().mockReturnValue(null);
    getCache.mockReturnValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('falls back to keyless Douban/Bangumi Chinese movie catalogue when TMDB token is unset, and returns unconfigured when unavailable', async () => {
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', '');
    fetchUpstreamJson.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const emptyResponse = await GET(request());
    expect(emptyResponse.status).toBe(200);
    await expect(emptyResponse.json()).resolves.toEqual({ configured: false, region: 'US', list: [] });

    fetchUpstreamJson.mockResolvedValueOnce({
      subjects: {
        items: [
          {
            layout: 'subject',
            target_type: 'movie',
            type_name: '电影',
            target: {
              id: '1306612',
              title: '蜘蛛侠',
              card_subtitle: '美国 / 动作 科幻 / 山姆·雷米 / 托比·马奎尔',
              cover_url: 'https://qnmob3-sign.doubanio.com/view/photo/large/public/p457050361.jpg',
              year: '2002',
              rating: { value: 8.1, count: 437286 },
            },
          },
          { layout: 'chart', target: { id: 'ECW4GKJGY', title: '蜘蛛侠系列' } },
        ],
      },
    });
    const hitResponse = await GET(request('蜘蛛侠', 'CN'));
    expect(hitResponse.status).toBe(200);
    const body = await hitResponse.json();
    expect(body).toMatchObject({
      configured: true,
      provider: 'douban',
      region: 'CN',
    });
    expect(body.list).toHaveLength(1);
    expect(body.list[0]).toMatchObject({
      id: 1306612,
      mediaType: 'movie',
      title: '蜘蛛侠',
      year: '2002',
      rating: 8.1,
      doubanUrl: 'https://movie.douban.com/subject/1306612/',
    });

    // Douban 418/timeout -> Bangumi v0 movie/anime fallback
    fetchUpstreamJson
      .mockRejectedValueOnce(new Error('douban timeout'))
      .mockResolvedValueOnce({
        data: [
          {
            id: 36150,
            type: 6,
            name: 'Spider-Man',
            name_cn: '蜘蛛侠',
            summary: '彼得·帕克英雄起源',
            date: '2002-05-03',
            images: { common: 'https://lain.bgm.tv/r/400/pic/cover/l/37/42/36150_z7j6b.jpg' },
            rating: { score: 7.3, total: 820 },
          },
        ],
      });
    const bgmResponse = await GET(request('蜘蛛侠', 'HK'));
    const bgmBody = await bgmResponse.json();
    expect(bgmBody).toMatchObject({
      configured: true,
      provider: 'bangumi',
      region: 'HK',
    });
    expect(bgmBody.list[0]).toMatchObject({
      id: 36150,
      mediaType: 'movie',
      title: '蜘蛛侠',
      originalTitle: 'Spider-Man',
      year: '2002',
      posterUrl: 'https://lain.bgm.tv/r/400/pic/cover/l/37/42/36150_z7j6b.jpg',
    });
  });

  it('does not start TMDB work when the browser has already disconnected', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await GET(new Request('https://app.example/api/catalog/search?q=Spider-Man&region=US', { signal: controller.signal }));
    expect(response.status).toBe(499);
    expect(fetchUpstreamJson).not.toHaveBeenCalled();
  });

  it('rejects empty queries and invalid region codes', async () => {
    expect((await GET(request(''))).status).toBe(400);
    expect((await GET(request('Spider-Man', 'USA'))).status).toBe(400);
    expect(fetchUpstreamJson).not.toHaveBeenCalled();
  });

  it('returns localized movie and TV metadata without waiting for watch-provider lookups', async () => {
    fetchUpstreamJson.mockImplementation(async (url: string, options: RequestInit) => {
      const parsed = new URL(url);
      expect(options.headers).toMatchObject({ Authorization: 'Bearer test-secret-token' });
      expect(parsed.pathname).toBe('/3/search/multi');
      expect(parsed.searchParams.get('query')).toBe('蜘蛛侠');
      expect(parsed.searchParams.get('language')).toBe('zh-CN');
      expect(parsed.searchParams.has('region')).toBe(false);
      expect(parsed.searchParams.get('include_adult')).toBe('false');
      return {
        results: [
          { id: 11, media_type: 'movie', adult: false, title: '蜘蛛侠', original_title: 'Spider-Man', overview: '英雄故事', poster_path: '/poster.jpg', release_date: '2002-05-03', vote_average: 7.2, vote_count: 1200 },
          { id: 22, media_type: 'tv', adult: false, name: '蜘蛛侠动画', first_air_date: '1994-11-19' },
          { id: 33, media_type: 'person', adult: false, name: '演员' },
          { id: 44, media_type: 'movie', adult: true, title: 'Adult result' },
        ],
      };
    });

    const response = await GET(request());
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.configured).toBe(true);
    expect(payload.region).toBe('US');
    expect(payload.list).toHaveLength(2);
    expect(payload.list[0]).toMatchObject({
      id: 11,
      mediaType: 'movie',
      title: '蜘蛛侠',
      originalTitle: 'Spider-Man',
      year: '2002',
      posterUrl: 'https://image.tmdb.org/t/p/w342/poster.jpg',
      tmdbUrl: 'https://www.themoviedb.org/movie/11?language=zh-CN',
    });
    expect(payload.list[0]).not.toHaveProperty('providerGroups');
    expect(JSON.stringify(payload)).not.toContain('test-secret-token');
    expect(setCache).toHaveBeenCalledWith(expect.stringContaining('catalog:tmdb:v2:US:'), expect.any(Object), 600_000);
    expect(fetchUpstreamJson).toHaveBeenCalledTimes(1);
  });

  it('uses separate cache identities for different watch regions', async () => {
    fetchUpstreamJson.mockResolvedValue({ results: [] });
    await GET(request('Spider-Man', 'US'));
    await GET(request('Spider-Man', 'GB'));
    const keys = setCache.mock.calls.map(([key]) => key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

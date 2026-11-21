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

import { POST } from './route';

function request(body: unknown, signal?: AbortSignal) {
  return new Request('https://app.example/api/catalog/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

describe('POST /api/catalog/providers', () => {
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

  it('returns unconfigured state without making upstream calls when no server token exists', async () => {
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', '');
    const response = await POST(request({ region: 'US', items: [{ id: 11, mediaType: 'movie' }] }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: false, region: 'US', list: [] });
    expect(fetchUpstreamJson).not.toHaveBeenCalled();
  });

  it('validates region and bounds the lookup list', async () => {
    expect((await POST(request({ region: 'USA', items: [{ id: 11, mediaType: 'movie' }] }))).status).toBe(400);
    expect((await POST(request({ region: 'US', items: [] }))).status).toBe(400);
    expect((await POST(request({ region: 'US', items: Array.from({ length: 11 }, (_, id) => ({ id: id + 1, mediaType: 'movie' })) }))).status).toBe(400);
    expect(fetchUpstreamJson).not.toHaveBeenCalled();
  });

  it('rejects malformed item identities and ignores duplicate movie IDs', async () => {
    const bad = await POST(request({ region: 'US', items: [{ id: 0, mediaType: 'movie' }] }));
    expect(bad.status).toBe(400);

    fetchUpstreamJson.mockResolvedValue({ results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } });
    const response = await POST(request({
      region: 'US',
      items: [
        { id: 11, mediaType: 'movie' },
        { id: 11, mediaType: 'movie' },
      ],
    }));
    expect(response.status).toBe(200);
    expect(fetchUpstreamJson).toHaveBeenCalledTimes(1);
  });

  it('maps regional JustWatch providers, returns only TMDB watch links and caches successful lookups', async () => {
    fetchUpstreamJson.mockImplementation(async (url: string, options: RequestInit) => {
      expect(options.headers).toMatchObject({ Authorization: 'Bearer test-secret-token' });
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/3/movie/11/watch/providers');
      return {
        results: {
          US: {
            link: 'https://www.themoviedb.org/movie/11/watch?locale=US',
            flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' }],
            rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/apple.png' }],
          },
        },
      };
    });

    const response = await POST(request({ region: 'US', items: [{ id: 11, mediaType: 'movie' }] }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      configured: true,
      region: 'US',
      list: [{
        id: 11,
        mediaType: 'movie',
        checked: true,
        watchUrl: 'https://www.themoviedb.org/movie/11/watch?locale=US',
        providerGroups: [
          { type: 'flatrate', label: '订阅观看', providers: [{ id: 8, name: 'Netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/netflix.png' }] },
          { type: 'rent', label: '租赁', providers: [{ id: 2, name: 'Apple TV', logoUrl: 'https://image.tmdb.org/t/p/w92/apple.png' }] },
        ],
      }],
    });
    expect(JSON.stringify(payload)).not.toContain('test-secret-token');
    expect(setCache).toHaveBeenCalledWith(
      'catalog:providers:v1:US:movie:11',
      expect.objectContaining({ checked: true }),
      1_800_000
    );
  });

  it('rejects non-TMDB watch links and distinguishes no offers from lookup failures', async () => {
    fetchUpstreamJson.mockResolvedValue({ results: { US: { link: 'https://evil.example/watch' } } });
    const response = await POST(request({ region: 'US', items: [{ id: 11, mediaType: 'movie' }] }));
    const payload = await response.json();
    expect(payload.list[0]).toMatchObject({ checked: true, providerGroups: [] });
    expect(payload.list[0].watchUrl).toBeUndefined();
  });

  it('keeps metadata lookup results available if one provider lookup fails', async () => {
    fetchUpstreamJson.mockRejectedValue(new Error('upstream timeout'));
    const response = await POST(request({ region: 'US', items: [{ id: 11, mediaType: 'movie' }] }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.list[0]).toMatchObject({ checked: false, providerGroups: [] });
  });

  it('does not start TMDB work when the browser has already disconnected', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await POST(request({ region: 'US', items: [{ id: 11, mediaType: 'movie' }] }, controller.signal));
    expect(response.status).toBe(499);
    expect(fetchUpstreamJson).not.toHaveBeenCalled();
  });
});

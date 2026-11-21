import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchUpstreamJson, getCache, setCache } from '@/lib/fetch-utils';
import { withHostLimit } from '@/lib/host-gate';
import type { CatalogSearchResponse, CatalogSearchResult } from '@/lib/types';

export const runtime = 'nodejs';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const DOUBAN_MOBILE_SEARCH = 'https://m.douban.com/rexxar/api/v2/search/subjects';
const BANGUMI_V0_SEARCH = 'https://api.bgm.tv/v0/search/subjects';
const TMDB_TIMEOUT_MS = 8_000;
const DOUBAN_TIMEOUT_MS = 1_300;
const BANGUMI_TIMEOUT_MS = 3_800;
const SEARCH_LIMIT = 10;
const SEARCH_CACHE_TTL = 10 * 60 * 1000;

const DOUBAN_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
const BANGUMI_UA = 'zj2917928447/libretv-mobile/2.33.0 (https://github.com/zj2917928447-ship-it/LibreTV-Mobile)';

interface TmdbSearchItem {
  id?: number;
  media_type?: string;
  adult?: boolean;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
}

interface TmdbSearchResponse {
  results?: TmdbSearchItem[];
}

interface DoubanSearchSubjectItem {
  layout?: string;
  target_type?: string;
  type_name?: string;
  target?: {
    id?: string | number;
    title?: string;
    card_subtitle?: string;
    abstract?: string;
    cover_url?: string;
    year?: string;
    rating?: {
      value?: number;
      count?: number;
    };
  };
}

interface DoubanMobileSearchResponse {
  subjects?: {
    items?: DoubanSearchSubjectItem[];
  };
}

interface BangumiSubjectItem {
  id?: number;
  type?: number;
  name?: string;
  name_cn?: string;
  summary?: string;
  date?: string;
  images?: { common?: string; medium?: string; large?: string };
  rating?: { score?: number; total?: number };
}

interface BangumiSearchResponse {
  data?: BangumiSubjectItem[];
}

function cleanText(value: unknown, max = 1200): string {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function safePosterUrl(path: unknown): string | undefined {
  if (typeof path !== 'string' || !/^\/[a-zA-Z0-9_/-]+\.(?:jpg|jpeg|png|webp)$/i.test(path)) return undefined;
  return `https://image.tmdb.org/t/p/w342${path}`;
}

function safeDoubanCoverUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'doubanio.com' || host.endsWith('.doubanio.com'))) {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

function buildTmdbUrl(mediaType: 'movie' | 'tv', id: number): string {
  return `https://www.themoviedb.org/${mediaType}/${id}?language=zh-CN`;
}

async function searchDoubanFallback(query: string, signal: AbortSignal): Promise<CatalogSearchResult[] | null> {
  try {
    const url = new URL(DOUBAN_MOBILE_SEARCH);
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'movie');
    url.searchParams.set('count', String(SEARCH_LIMIT));

    const data = await withHostLimit(url.href, () => fetchUpstreamJson<DoubanMobileSearchResponse>(url.href, {
      timeoutMs: DOUBAN_TIMEOUT_MS,
      retries: 0,
      signal,
      headers: {
        'User-Agent': DOUBAN_MOBILE_UA,
        Referer: 'https://m.douban.com/search/',
        Accept: 'application/json',
      },
    }), signal);

    const items = data?.subjects?.items;
    if (!Array.isArray(items)) return null;

    const results: CatalogSearchResult[] = [];
    for (const entry of items) {
      if (entry?.layout !== 'subject') continue;
      const target = entry.target;
      if (!target) continue;
      const id = Number(target.id);
      const title = cleanText(target.title, 200);
      if (!Number.isSafeInteger(id) || id <= 0 || !title) continue;

      const isTv = entry.target_type === 'tv' || entry.type_name === '电视剧' || entry.type_name === '剧集';
      const mediaType: 'movie' | 'tv' = isTv ? 'tv' : 'movie';
      const overview = cleanText(target.card_subtitle || target.abstract, 800);
      const year = cleanText(target.year, 10).match(/^\d{4}$/)?.[0];
      const ratingVal = Number(target.rating?.value);
      const voteCountVal = Number(target.rating?.count);
      const doubanUrl = `https://movie.douban.com/subject/${id}/`;

      results.push({
        id,
        mediaType,
        title,
        overview,
        year,
        posterUrl: safeDoubanCoverUrl(target.cover_url),
        rating: Number.isFinite(ratingVal) && ratingVal > 0 ? Math.round(ratingVal * 10) / 10 : undefined,
        voteCount: Number.isFinite(voteCountVal) && voteCountVal > 0 ? Math.max(0, Math.floor(voteCountVal)) : undefined,
        tmdbUrl: doubanUrl,
        doubanUrl,
      });
      if (results.length >= SEARCH_LIMIT) break;
    }
    return results;
  } catch {
    return null;
  }
}

function safeBangumiCoverUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'bgm.tv' || host.endsWith('.bgm.tv'))) {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

async function searchBangumiFallback(query: string, signal: AbortSignal): Promise<CatalogSearchResult[] | null> {
  try {
    const url = `${BANGUMI_V0_SEARCH}?limit=${SEARCH_LIMIT}`;
    const data = await withHostLimit(
      url,
      () =>
        fetchUpstreamJson<BangumiSearchResponse>(url, {
          method: 'POST',
          timeoutMs: BANGUMI_TIMEOUT_MS,
          retries: 0,
          signal,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': BANGUMI_UA,
            Accept: 'application/json',
          },
          body: JSON.stringify({
            keyword: query,
            filter: { type: [2, 6], nsfw: false },
          }),
        }),
      signal
    );

    const items = data?.data;
    if (!Array.isArray(items)) return null;

    const results: CatalogSearchResult[] = [];
    for (const entry of items) {
      const id = Number(entry?.id);
      const zhTitle = cleanText(entry?.name_cn, 200);
      const rawName = cleanText(entry?.name, 200);
      const title = zhTitle || rawName;
      if (!Number.isSafeInteger(id) || id <= 0 || !title) continue;

      const releaseDate = cleanText(entry?.date, 20);
      const year = releaseDate.match(/^\d{4}/)?.[0];
      const score = Number(entry?.rating?.score);
      const total = Number(entry?.rating?.total);
      const subjectUrl = `https://bgm.tv/subject/${id}`;

      results.push({
        id,
        mediaType: entry?.type === 2 ? 'tv' : 'movie',
        title,
        originalTitle: zhTitle && rawName && rawName !== zhTitle ? rawName : undefined,
        overview: cleanText(entry?.summary, 800),
        releaseDate: releaseDate || undefined,
        year,
        posterUrl: safeBangumiCoverUrl(entry?.images?.common || entry?.images?.medium || entry?.images?.large),
        rating: Number.isFinite(score) && score > 0 ? Math.round(score * 10) / 10 : undefined,
        voteCount: Number.isFinite(total) && total > 0 ? Math.max(0, Math.floor(total)) : undefined,
        tmdbUrl: subjectUrl,
      });
      if (results.length >= SEARCH_LIMIT) break;
    }
    return results;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  if (req.signal.aborted) return new Response(null, { status: 499 });

  const requestUrl = new URL(req.url);
  const query = (requestUrl.searchParams.get('q') || '').trim().slice(0, 100);
  const region = (requestUrl.searchParams.get('region') || 'CN').trim().toUpperCase();

  if (!query) return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
  if (!/^[A-Z]{2}$/.test(region)) return NextResponse.json({ error: '观看地区代码无效' }, { status: 400 });

  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) {
    const doubanCacheKey = `catalog:douban:v1:${region}:${query.toLowerCase()}`;
    const cachedDouban = getCache<CatalogSearchResponse>(doubanCacheKey);
    if (cachedDouban) return NextResponse.json(cachedDouban, { headers: { 'Cache-Control': 'private, max-age=60' } });

    const doubanList = await searchDoubanFallback(query, req.signal);
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (doubanList && doubanList.length > 0) {
      const response: CatalogSearchResponse = {
        configured: true,
        provider: 'douban',
        region,
        list: doubanList,
      };
      setCache(doubanCacheKey, response, SEARCH_CACHE_TTL);
      return NextResponse.json(response, { headers: { 'Cache-Control': 'private, max-age=60' } });
    }

    const bangumiList = await searchBangumiFallback(query, req.signal);
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (bangumiList && bangumiList.length > 0) {
      const response: CatalogSearchResponse = {
        configured: true,
        provider: 'bangumi',
        region,
        list: bangumiList,
      };
      setCache(doubanCacheKey, response, SEARCH_CACHE_TTL);
      return NextResponse.json(response, { headers: { 'Cache-Control': 'private, max-age=60' } });
    }

    const response: CatalogSearchResponse = { configured: false, region, list: [] };
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  }

  const cacheKey = `catalog:tmdb:v2:${region}:${query.toLowerCase()}`;
  const cached = getCache<CatalogSearchResponse>(cacheKey);
  if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=60' } });

  try {
    const searchUrl = new URL(`${TMDB_API_BASE}/search/multi`);
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('language', 'zh-CN');
    searchUrl.searchParams.set('include_adult', 'false');
    searchUrl.searchParams.set('page', '1');

    const search = await withHostLimit(searchUrl.href, () => fetchUpstreamJson<TmdbSearchResponse>(searchUrl.href, {
      timeoutMs: TMDB_TIMEOUT_MS,
      retries: 0,
      signal: req.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }), req.signal);

    if (req.signal.aborted) return new Response(null, { status: 499 });

    const list: CatalogSearchResult[] = (search.results ?? [])
      .filter((item) => (item.media_type === 'movie' || item.media_type === 'tv') && item.adult !== true)
      .filter((item) => Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0)
      .slice(0, SEARCH_LIMIT)
      .map((item) => {
        const mediaType = item.media_type as 'movie' | 'tv';
        const id = Number(item.id);
        const title = cleanText(item.title ?? item.name, 200);
        const originalTitle = cleanText(item.original_title ?? item.original_name, 200);
        const releaseDate = cleanText(item.release_date ?? item.first_air_date, 20);
        return {
          id,
          mediaType,
          title,
          originalTitle: originalTitle || undefined,
          overview: cleanText(item.overview, 1200),
          releaseDate: releaseDate || undefined,
          year: releaseDate.match(/^\d{4}/)?.[0],
          posterUrl: safePosterUrl(item.poster_path),
          rating: typeof item.vote_average === 'number' && Number.isFinite(item.vote_average)
            ? Math.round(item.vote_average * 10) / 10
            : undefined,
          voteCount: typeof item.vote_count === 'number' && Number.isFinite(item.vote_count)
            ? Math.max(0, item.vote_count)
            : undefined,
          tmdbUrl: buildTmdbUrl(mediaType, id),
        };
      })
      .filter((item) => item.title);

    const response: CatalogSearchResponse = { configured: true, provider: 'tmdb', region, list };
    setCache(cacheKey, response, SEARCH_CACHE_TTL);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.warn('[catalog] TMDB catalogue search failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: '影视资料搜索暂时不可用，请检查 TMDB API Read Access Token 或稍后重试' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

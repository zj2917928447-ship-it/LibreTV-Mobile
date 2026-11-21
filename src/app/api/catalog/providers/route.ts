import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchUpstreamJson, getCache, setCache } from '@/lib/fetch-utils';
import { withHostLimit } from '@/lib/host-gate';
import { readJsonBodyLimited, RequestBodyTooLargeError } from '@/lib/request-body';
import type {
  CatalogMediaType,
  CatalogProviderGroup,
  CatalogProviderLookupItem,
  CatalogProviderAvailability,
  CatalogProvidersResponse,
} from '@/lib/types';

export const runtime = 'nodejs';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const PROVIDER_TIMEOUT_MS = 5_000;
const PROVIDER_CACHE_TTL = 30 * 60 * 1000;
const MAX_ITEMS = 10;

interface TmdbProvider {
  provider_id?: number;
  provider_name?: string;
  logo_path?: string | null;
}

interface TmdbRegionProviders {
  link?: string;
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
}

interface TmdbWatchProvidersResponse {
  results?: Record<string, TmdbRegionProviders | undefined>;
}

const PROVIDER_GROUPS: { key: keyof TmdbRegionProviders; label: string }[] = [
  { key: 'flatrate', label: '订阅观看' },
  { key: 'free', label: '免费观看' },
  { key: 'ads', label: '含广告' },
  { key: 'rent', label: '租赁' },
  { key: 'buy', label: '购买' },
];

function cleanText(value: unknown, max = 120): string {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function safeLogoUrl(path: unknown): string | undefined {
  if (typeof path !== 'string' || !/^\/[a-zA-Z0-9_/-]+\.(?:jpg|jpeg|png|webp)$/i.test(path)) return undefined;
  return `https://image.tmdb.org/t/p/w92${path}`;
}

function safeTmdbLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.themoviedb.org', 'themoviedb.org'].includes(url.hostname)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function buildProviderGroups(data: TmdbRegionProviders | undefined): CatalogProviderGroup[] {
  if (!data) return [];
  return PROVIDER_GROUPS.flatMap(({ key, label }) => {
    const raw = data[key];
    if (!Array.isArray(raw)) return [];
    const providers = raw.flatMap((item) => {
      const id = Number(item.provider_id);
      const name = cleanText(item.provider_name, 80);
      if (!Number.isSafeInteger(id) || id <= 0 || !name) return [];
      return [{ id, name, logoUrl: safeLogoUrl(item.logo_path) }];
    });
    return providers.length ? [{ type: key as CatalogProviderGroup['type'], label, providers }] : [];
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeLookupItems(value: unknown): CatalogProviderLookupItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) return null;
  const seen = new Set<string>();
  const items: CatalogProviderLookupItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const id = Number(item.id);
    const mediaType = item.mediaType;
    if (!Number.isSafeInteger(id) || id <= 0 || (mediaType !== 'movie' && mediaType !== 'tv')) return null;
    const key = `${mediaType}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id, mediaType: mediaType as CatalogMediaType });
  }
  return items.length > 0 ? items : null;
}

async function getProviderData(
  item: CatalogProviderLookupItem,
  region: string,
  token: string,
  signal: AbortSignal
): Promise<CatalogProviderAvailability> {
  const cacheKey = `catalog:providers:v1:${region}:${item.mediaType}:${item.id}`;
  const cached = getCache<CatalogProviderAvailability>(cacheKey);
  if (cached) return cached;

  const result: CatalogProviderAvailability = {
    ...item,
    providerGroups: [],
    checked: false,
  };

  try {
    const url = new URL(`${TMDB_API_BASE}/${item.mediaType}/${item.id}/watch/providers`);
    const response = await withHostLimit(url.href, () => fetchUpstreamJson<TmdbWatchProvidersResponse>(url.href, {
      timeoutMs: PROVIDER_TIMEOUT_MS,
      retries: 0,
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }), signal);
    const regional = response.results?.[region];
    result.providerGroups = buildProviderGroups(regional);
    result.watchUrl = result.providerGroups.length ? safeTmdbLink(regional?.link) : undefined;
    result.checked = true;
    setCache(cacheKey, result, PROVIDER_CACHE_TTL);
  } catch (error) {
    if (!signal.aborted) {
      console.warn('[catalog] TMDB watch-provider lookup failed:', error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  if (req.signal.aborted) return new Response(null, { status: 499 });

  let body: unknown;
  try {
    body = await readJsonBodyLimited(req, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: '正版观看渠道查询请求过大' }, { status: 413 });
    }
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const region = typeof raw.region === 'string' ? raw.region.trim().toUpperCase() : 'US';
  const items = normalizeLookupItems(raw.items);

  if (!/^[A-Z]{2}$/.test(region)) return NextResponse.json({ error: '观看地区代码无效' }, { status: 400 });
  if (!items) return NextResponse.json({ error: `影片查询列表必须为 1 至 ${MAX_ITEMS} 条有效记录` }, { status: 400 });

  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  if (!token) {
    const response: CatalogProvidersResponse = { configured: false, region, list: [] };
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const list = await mapWithConcurrency(items, 3, (item) => getProviderData(item, region, token, req.signal));
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const response: CatalogProvidersResponse = { configured: true, region, list };
    return NextResponse.json(response, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.warn('[catalog] TMDB watch-provider batch failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: '正版观看渠道暂时无法查询，请稍后重试' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

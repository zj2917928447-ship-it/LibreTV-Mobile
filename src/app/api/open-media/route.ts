import { NextResponse } from 'next/server';
import { fetchUpstreamJson, getCache, setCache } from '@/lib/fetch-utils';
import {
  commonsMetaText,
  decodeOpenMediaId,
  encodeOpenMediaId,
  extractNasaAssetUrls,
  hasExplicitCopyright,
  isAllowedCommonsLicence,
  isAllowedPeerTubeLicence,
  isArchiveRightsAllowed,
  selectArchiveVideoFile,
  selectCommonsVideoFile,
  selectNasaVideoUrl,
  selectPeerTubeStreamUrl,
  type CommonsLicenseMetadata,
  type OpenMediaProvider,
} from '@/lib/open-media';

export const runtime = 'nodejs';

const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const DETAIL_CACHE_TTL = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 6500;
const MAX_RESULTS_PER_PROVIDER = 6;
const MAX_ARCHIVE_CANDIDATES = 12;
const MAX_FEDERATED_CANDIDATES = 24;

interface CmsVod {
  vod_id: string;
  vod_name: string;
  vod_pic?: string;
  type_name: string;
  vod_year?: string;
  vod_remarks?: string;
  vod_content?: string;
  vod_play_from?: string;
  vod_play_url?: string;
}

interface ArchiveSearchResponse {
  response?: { numFound?: number; docs?: Array<Record<string, unknown>> };
}

interface ArchiveMetadataResponse {
  metadata?: Record<string, unknown>;
  files?: Array<{ name?: string; format?: string; size?: string | number }>;
}

interface NasaAssetResponse {
  collection?: {
    items?: Array<{ href?: string }>;
  };
}

interface NasaSearchResponse {
  collection?: {
    items?: Array<{
      data?: Array<Record<string, unknown>>;
      links?: Array<{ rel?: string; href?: string }>;
    }>;
  };
}

interface CommonsSearchResponse {
  query?: {
    pages?: Array<{
      pageid?: number;
      title?: string;
      imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        mime?: string;
        descriptionurl?: string;
        extmetadata?: CommonsLicenseMetadata;
      }>;
    }>;
  };
}

interface PeerTubeSearchResponse {
  data?: Array<{
    uuid?: string;
    name?: string;
    description?: string;
    duration?: number;
    thumbnailUrl?: string;
    url?: string;
    account?: { host?: string; displayName?: string };
    licence?: { id?: number; label?: string } | null;
    originallyPublishedAt?: string;
    publishedAt?: string;
    isLive?: boolean;
    nsfw?: boolean;
  }>;
}

interface PeerTubeVideoResponse {
  name?: string;
  description?: string;
  duration?: number;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  account?: { host?: string; displayName?: string };
  licence?: { id?: number; label?: string } | null;
  streamingPlaylists?: Array<{ playlistUrl?: string }>;
  files?: Array<{ fileUrl?: string; resolution?: { id?: number } }>;
}

function cleanText(value: unknown, max = 1800): string {
  if (Array.isArray(value)) return value.map((part) => cleanText(part, max)).filter(Boolean).join(' ').slice(0, max);
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function solrQuote(value: string): string {
  return `"${value.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

function getYear(value: unknown): string | undefined {
  const match = String(value ?? '').match(/\b(18|19|20)\d{2}\b/);
  return match?.[0];
}

function cmsItem(
  provider: OpenMediaProvider,
  externalId: string,
  title: string,
  options: {
    picture?: string;
    year?: string;
    remarks?: string;
    description?: string;
  } = {}
): CmsVod {
  return {
    vod_id: encodeOpenMediaId(provider, externalId),
    vod_name: title,
    vod_pic: options.picture,
    type_name:
      provider === 'archive' ? 'Internet Archive · 公共领域/CC' :
      provider === 'nasa' ? 'NASA 影音资料（需核对单项权利）' :
      provider === 'commons' ? 'Wikimedia Commons · Public Domain / CC' :
        'PeerTube · Creative Commons',
    vod_year: options.year,
    vod_remarks: options.remarks,
    vod_content: options.description,
  };
}

async function searchArchive(query: string): Promise<CmsVod[]> {
  const terms = solrQuote(query);
  const rights = [
    'rights:"Public Domain"',
    'rights:"Public domain in the USA."',
    'rights:"No known copyright restrictions"',
    'licenseurl:"https://creativecommons.org/publicdomain/mark/1.0/"',
    'licenseurl:"https://creativecommons.org/publicdomain/zero/1.0/"',
    'licenseurl:"https://creativecommons.org/licenses/by/4.0/"',
    'licenseurl:"https://creativecommons.org/licenses/by-sa/4.0/"',
  ].join(' OR ');
  const params = new URLSearchParams({
    q: `mediatype:movies AND (${rights}) AND title:${terms}`,
    rows: String(MAX_ARCHIVE_CANDIDATES),
    page: '1',
    output: 'json',
    sort: 'downloads desc',
  });
  for (const field of ['identifier', 'title', 'year', 'description', 'licenseurl', 'rights']) {
    params.append('fl[]', field);
  }
  const result = await fetchUpstreamJson<ArchiveSearchResponse>(
    `https://archive.org/advancedsearch.php?${params.toString()}`,
    { timeoutMs: PROVIDER_TIMEOUT_MS }
  );
  const docs = result.response?.docs ?? [];
  const resolved = await Promise.allSettled(docs.slice(0, MAX_ARCHIVE_CANDIDATES).map(async (doc) => {
    const identifier = String(doc.identifier ?? '');
    if (!/^[\w.-]+$/.test(identifier)) return null;
    const metadata = await fetchUpstreamJson<ArchiveMetadataResponse>(
      `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
      { timeoutMs: PROVIDER_TIMEOUT_MS }
    );
    const record = metadata.metadata ?? {};
    if (String(record.mediatype ?? '') !== 'movies') return null;
    if (!isArchiveRightsAllowed({
      rights: record.rights ?? doc.rights,
      licenseurl: record.licenseurl ?? doc.licenseurl,
    })) return null;
    const file = selectArchiveVideoFile(metadata.files ?? []);
    if (!file?.name) return null;
    const title = cleanText(record.title ?? doc.title, 200);
    if (!title) return null;
    const rightsLabel = cleanText(record.rights ?? record.licenseurl ?? doc.rights ?? doc.licenseurl, 120);
    const description = cleanText(record.description ?? doc.description);
    return cmsItem('archive', identifier, title, {
      picture: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      year: getYear(record.year ?? doc.year),
      remarks: rightsLabel || '公开权利声明，播放详情中保留原始出处',
      description: [description, `来源：Internet Archive（${identifier}）`, `权利声明：${rightsLabel || '未提供详细许可名称'}`].filter(Boolean).join('\n'),
    });
  }));
  return resolved
    .filter((entry): entry is PromiseFulfilledResult<CmsVod | null> => entry.status === 'fulfilled')
    .map((entry) => entry.value)
    .filter((entry): entry is CmsVod => entry !== null)
    .slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function searchNasa(query: string): Promise<CmsVod[]> {
  const params = new URLSearchParams({ q: query, media_type: 'video', page_size: String(MAX_RESULTS_PER_PROVIDER) });
  const result = await fetchUpstreamJson<NasaSearchResponse>(
    `https://images-api.nasa.gov/search?${params.toString()}`,
    { timeoutMs: PROVIDER_TIMEOUT_MS }
  );
  return (result.collection?.items ?? []).flatMap((item) => {
    const data = item.data?.[0];
    const nasaId = String(data?.nasa_id ?? '');
    const title = cleanText(data?.title, 200);
    if (!/^[\w-]+$/.test(nasaId) || !title || data?.media_type !== 'video') return [];
    // NASA sometimes republishes third-party material; do not include records with an explicit copyright field.
    if (hasExplicitCopyright(data.copyright) || /all rights reserved|copyrighted/i.test(String(data.rights ?? ''))) return [];
    const preview = item.links?.find((link) => link.rel === 'preview')?.href;
    const center = cleanText(data.center, 40);
    return [cmsItem('nasa', `${nasaId}|${center}`, title, {
      picture: preview?.replace(/^http:/, 'https:'),
      year: getYear(data.date_created),
      remarks: 'NASA 媒体库 · 请核对单项版权与使用说明',
      description: [
        cleanText(data.description),
        `来源：NASA Image and Video Library（${center || 'NASA'}）`,
        `原始条目：https://images.nasa.gov/details/${nasaId}`,
        'NASA 内容通常不受美国版权保护，但第三方版权素材、可识别人物肖像权及 NASA 标识有额外限制；请查看原始条目说明。',
      ].filter(Boolean).join('\n'),
    })];
  });
}

async function searchCommons(query: string): Promise<CmsVod[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:video ${query}`,
    gsrnamespace: '6',
    gsrlimit: String(MAX_FEDERATED_CANDIDATES),
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '480',
    format: 'json',
    formatversion: '2',
  });
  const result = await fetchUpstreamJson<CommonsSearchResponse>(
    `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
    {
      timeoutMs: PROVIDER_TIMEOUT_MS,
      headers: { 'User-Agent': 'LibreTV/2.23.2 (open-media adapter)', Accept: 'application/json' },
    }
  );
  return (result.query?.pages ?? []).flatMap((page) => {
    const pageId = Number(page.pageid ?? 0);
    const info = page.imageinfo?.[0];
    const media = selectCommonsVideoFile(info);
    const licence = info?.extmetadata;
    if (!Number.isSafeInteger(pageId) || pageId <= 0 || !media || !isAllowedCommonsLicence(licence)) return [];
    const title = cleanText(page.title?.replace(/^File:/i, ''), 200);
    if (!title) return [];
    const licenceName = cleanText(commonsMetaText(licence?.LicenseShortName) || commonsMetaText(licence?.UsageTerms), 100);
    const artist = cleanText(commonsMetaText(licence?.Artist) || commonsMetaText(licence?.Credit), 160);
    const description = cleanText(commonsMetaText(licence?.ImageDescription) || commonsMetaText(licence?.Description), 1200);
    return [cmsItem('commons', String(pageId), title, {
      picture: media.thumbnail,
      year: getYear(title),
      remarks: licenceName || '开放许可',
      description: [
        description,
        artist ? `作者/来源：${artist}` : '',
        `许可：${licenceName || '开放许可'}`,
        info?.descriptionurl ? `原始条目：${info.descriptionurl}` : '',
      ].filter(Boolean).join('\n'),
    })];
  }).slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function searchPeerTube(query: string): Promise<CmsVod[]> {
  const params = new URLSearchParams({ search: query, count: String(MAX_FEDERATED_CANDIDATES), nsfw: 'false' });
  const result = await fetchUpstreamJson<PeerTubeSearchResponse>(
    `https://sepiasearch.org/api/v1/search/videos?${params.toString()}`,
    { timeoutMs: PROVIDER_TIMEOUT_MS }
  );
  return (result.data ?? []).flatMap((item) => {
    const host = String(item.account?.host ?? '').toLowerCase();
    const uuid = String(item.uuid ?? '');
    const title = cleanText(item.name, 200);
    if (!/^[a-z0-9.-]+$/.test(host) || !/^[0-9a-f-]{36}$/i.test(uuid) || !title) return [];
    if (!isAllowedPeerTubeLicence(item.licence) || item.isLive || item.nsfw) return [];
    const licence = item.licence?.label || '开放许可';
    const channel = cleanText(item.account?.displayName, 100);
    return [cmsItem('peertube', `${host}|${uuid}`, title, {
      picture: item.thumbnailUrl,
      year: getYear(item.originallyPublishedAt ?? item.publishedAt),
      remarks: licence,
      description: [
        cleanText(item.description),
        channel ? `作者/频道：${channel}` : '',
        `托管实例：${host}`,
        `许可：${licence}`,
        '请遵守该视频页面列出的署名、相同方式共享及其他许可要求。',
      ].filter(Boolean).join('\n'),
    })];
  }).slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function searchAll(query: string): Promise<CmsVod[]> {
  const providerNames = ['Internet Archive', 'NASA', 'PeerTube', 'Wikimedia Commons'];
  const results = await Promise.allSettled([
    searchArchive(query),
    searchNasa(query),
    searchPeerTube(query),
    searchCommons(query),
  ]);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`[open-media] ${providerNames[index]} search failed:`, result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  });
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<CmsVod[]> => result.status === 'fulfilled');
  if (fulfilled.length === 0) throw new Error('所有公开媒体服务暂时不可用');
  return fulfilled.flatMap((result) => result.value);
}

async function getArchiveDetail(identifier: string): Promise<CmsVod | null> {
  if (!/^[\w.-]+$/.test(identifier)) return null;
  const metadata = await fetchUpstreamJson<ArchiveMetadataResponse>(
    `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
    { timeoutMs: 10000 }
  );
  const record = metadata.metadata ?? {};
  if (String(record.mediatype ?? '') !== 'movies') return null;
  if (!isArchiveRightsAllowed({ rights: record.rights, licenseurl: record.licenseurl })) return null;
  const file = selectArchiveVideoFile(metadata.files ?? []);
  if (!file?.name) return null;
  const title = cleanText(record.title, 200);
  if (!title) return null;
  const mediaUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
  const rightsLabel = cleanText(record.rights ?? record.licenseurl, 120);
  return {
    ...cmsItem('archive', identifier, title, {
      picture: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      year: getYear(record.year),
      remarks: rightsLabel || 'Public Domain / CC',
      description: [cleanText(record.description), `来源：Internet Archive（${identifier}）`, `权利声明：${rightsLabel}`].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'Internet Archive',
    vod_play_url: `在线播放$${mediaUrl}`,
  };
}

async function getNasaDetail(externalId: string): Promise<CmsVod | null> {
  const [nasaId] = externalId.split('|');
  if (!/^[\w-]+$/.test(nasaId)) return null;
  const assetResponse = await fetchUpstreamJson<NasaAssetResponse>(
    `https://images-api.nasa.gov/asset/${encodeURIComponent(nasaId)}`,
    { timeoutMs: 10000 }
  );
  const assets = extractNasaAssetUrls(assetResponse);
  if (assets.length === 0) return null;
  const metadataUrl = assets.find((url) => /metadata\.json$/i.test(url));
  const record: Record<string, unknown> = metadataUrl
    ? await fetchUpstreamJson<Record<string, unknown>>(metadataUrl.replace(/^http:/, 'https:'), { timeoutMs: 8000 }).catch(() => ({} as Record<string, unknown>))
    : {};
  const copyright = record['AVAIL:Copyright'] ?? record.Copyright ?? record.copyright;
  if (hasExplicitCopyright(copyright)) return null;
  const mediaUrl = selectNasaVideoUrl(assets);
  if (!mediaUrl) return null;
  const title = cleanText(record['AVAIL:Title'], 200) || nasaId;
  const poster = assets.find((asset) => /~(?:mobile|small|medium|large)\.jpg$/i.test(asset))?.replace(/^http:/, 'https:');
  const description = cleanText(record['AVAIL:Description']);
  return {
    ...cmsItem('nasa', externalId, title, {
      picture: poster,
      remarks: 'NASA 影音资料 · 请核对单项权利',
      description: [description, `来源：NASA Image and Video Library（${nasaId}）`, `原始条目：https://images.nasa.gov/details/${nasaId}`, 'NASA 内容通常不受美国版权保护，但第三方版权素材、可识别人物肖像权及 NASA 标识有额外限制；请核对原始媒体说明。'].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'NASA',
    vod_play_url: `在线播放$${mediaUrl}`,
  };
}

async function getCommonsDetail(externalId: string): Promise<CmsVod | null> {
  if (!/^\d+$/.test(externalId)) return null;
  const params = new URLSearchParams({
    action: 'query',
    pageids: externalId,
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '480',
    format: 'json',
    formatversion: '2',
  });
  const result = await fetchUpstreamJson<CommonsSearchResponse>(
    `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
    {
      timeoutMs: 10000,
      headers: { 'User-Agent': 'LibreTV/2.23.2 (open-media adapter)', Accept: 'application/json' },
    }
  );
  const page = result.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  const media = selectCommonsVideoFile(info);
  const licence = info?.extmetadata;
  if (!page || !media || !isAllowedCommonsLicence(licence)) return null;
  const title = cleanText(page.title?.replace(/^File:/i, ''), 200);
  if (!title) return null;
  const licenceName = cleanText(commonsMetaText(licence?.LicenseShortName) || commonsMetaText(licence?.UsageTerms), 100);
  const artist = cleanText(commonsMetaText(licence?.Artist) || commonsMetaText(licence?.Credit), 160);
  const description = cleanText(commonsMetaText(licence?.ImageDescription) || commonsMetaText(licence?.Description), 1200);
  return {
    ...cmsItem('commons', externalId, title, {
      picture: media.thumbnail,
      year: getYear(title),
      remarks: licenceName || '开放许可',
      description: [description, artist ? `作者/来源：${artist}` : '', `许可：${licenceName || '开放许可'}`, info?.descriptionurl ? `原始条目：${info.descriptionurl}` : ''].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'Wikimedia Commons',
    vod_play_url: `在线播放$${media.url}`,
  };
}

async function getPeerTubeDetail(externalId: string): Promise<CmsVod | null> {
  const [host, uuid] = externalId.split('|');
  if (!/^[a-z0-9.-]+$/i.test(host || '') || !/^[0-9a-f-]{36}$/i.test(uuid || '')) return null;
  const video = await fetchUpstreamJson<PeerTubeVideoResponse>(
    `https://${host}/api/v1/videos/${uuid}`,
    { timeoutMs: 10000 }
  );
  if (!isAllowedPeerTubeLicence(video.licence)) return null;
  const mediaUrl = selectPeerTubeStreamUrl(video);
  if (!mediaUrl) return null;
  const title = cleanText(video.name, 200);
  if (!title) return null;
  const licence = video.licence?.label || '开放许可';
  const description = [
    cleanText(video.description),
    video.account?.displayName ? `作者/频道：${cleanText(video.account.displayName, 100)}` : '',
    `托管实例：${host}`,
    `原始条目：https://${host}/videos/watch/${uuid}`,
    `许可：${licence}`,
  ].filter(Boolean).join('\n');
  return {
    ...cmsItem('peertube', externalId, title, {
      picture: video.thumbnailUrl || (video.thumbnailPath ? `https://${host}${video.thumbnailPath}` : undefined),
      remarks: licence,
      description,
    }),
    vod_play_from: 'PeerTube',
    vod_play_url: `在线播放$${mediaUrl}`,
  };
}

async function getDetail(id: string): Promise<CmsVod | null> {
  const decoded = decodeOpenMediaId(id);
  if (!decoded) return null;
  switch (decoded.provider) {
    case 'archive': return getArchiveDetail(decoded.externalId);
    case 'nasa': return getNasaDetail(decoded.externalId);
    case 'peertube': return getPeerTubeDetail(decoded.externalId);
    case 'commons': return getCommonsDetail(decoded.externalId);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('ac') !== 'videolist') {
    return NextResponse.json({ code: 0, msg: '仅支持 Apple CMS 兼容的 videolist 操作' }, { status: 400 });
  }

  const id = (url.searchParams.get('ids') || '').trim();
  if (id) {
    const cacheKey = `open-media:detail:${id}`;
    const cached = getCache<CmsVod>(cacheKey);
    if (cached) return NextResponse.json({ code: 1, list: [cached] });
    try {
      const detail = await getDetail(id);
      if (!detail) return NextResponse.json({ code: 1, list: [] });
      setCache(cacheKey, detail, DETAIL_CACHE_TTL);
      return NextResponse.json({ code: 1, list: [detail] });
    } catch (error) {
      console.warn('[open-media] detail lookup failed:', error instanceof Error ? error.message : String(error));
      return NextResponse.json({ code: 1, list: [] });
    }
  }

  const query = (url.searchParams.get('wd') || '').trim().slice(0, 100);
  if (!query) return NextResponse.json({ code: 0, msg: '缺少搜索关键词' }, { status: 400 });
  const cacheKey = `open-media:search:${query.toLowerCase()}`;
  const cached = getCache<CmsVod[]>(cacheKey);
  if (cached) return NextResponse.json({ code: 1, page: 1, pagecount: 1, limit: cached.length, total: cached.length, list: cached });

  try {
    const list = await searchAll(query);
    setCache(cacheKey, list, SEARCH_CACHE_TTL);
    return NextResponse.json({ code: 1, page: 1, pagecount: 1, limit: list.length, total: list.length, list }, {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
    });
  } catch (error) {
    console.warn('[open-media] search failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ code: 0, msg: '公开影视资料库暂时不可用，请稍后重试', list: [] }, { status: 502 });
  }
}

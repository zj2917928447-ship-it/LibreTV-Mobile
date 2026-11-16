import { NextResponse } from 'next/server';
import { fetchUpstreamJson, getCache, setCache } from '@/lib/fetch-utils';
import {
  commonsMetaText,
  decodeOpenMediaId,
  encodeOpenMediaId,
  extractNasaAssetUrls,
  hasContradictoryCopyrightClaim,
  hasExplicitCopyright,
  isOpenMediaAdult,
  isOpenMediaNonFeatureContent,
  isOpenMediaTitleRelevant,
  isFeatureLengthMedia,
  parseMediaDurationSeconds,
  parseNasaDurationSeconds,
  extractMediaDurationSecondsFromText,
  formatMediaDuration,
  isAllowedCommonsLicence,
  isAllowedPeerTubeLicence,
  isArchiveRightsAllowed,
  selectArchiveVideoFile,
  selectCommonsVideoFile,
  resolveOpenMediaQuery,
  selectNasaVideoUrl,
  selectPeerTubeStreamUrl,
  type CommonsVideoInfo,
  type CommonsVideoDerivative,
  type OpenMediaProvider,
} from '@/lib/open-media';

export const runtime = 'nodejs';

const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const DETAIL_CACHE_TTL = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 12_000;
const MAX_RESULTS_PER_PROVIDER = 6;
const MAX_ARCHIVE_CANDIDATES = 24;
const MAX_FEDERATED_CANDIDATES = 24;
const MAX_NASA_METADATA_CANDIDATES = 12;

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
  files?: Array<{ name?: string; format?: string; size?: string | number; length?: string | number }>;
}

interface NasaAssetResponse {
  collection?: {
    items?: Array<{ href?: string }>;
  };
}

interface NasaSearchResponse {
  collection?: {
    items?: Array<{
      data?: Array<Record<string, unknown> & { duration?: unknown }>;
      links?: Array<{ rel?: string; href?: string }>;
    }>;
  };
}

interface CommonsSearchResponse {
  query?: {
    pages?: Array<{
      pageid?: number;
      title?: string;
      imageinfo?: CommonsVideoInfo[];
      videoinfo?: Array<{ derivatives?: CommonsVideoDerivative[]; duration?: unknown; size?: number }>;
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

function archiveRightsLabel(rights: unknown, licenseurl: unknown): string {
  const url = typeof licenseurl === 'string' ? licenseurl.trim().replace(/^http:/i, 'https:').toLowerCase() : '';
  if (url.includes('/publicdomain/mark/1.0/')) return 'Public Domain Mark 1.0';
  if (url.includes('/publicdomain/zero/1.0/')) return 'CC0 1.0';
  if (url.includes('/licenses/by-sa/4.0/')) return 'CC BY-SA 4.0';
  if (url.includes('/licenses/by/4.0/')) return 'CC BY 4.0';
  return cleanText(rights, 120) || (url ? '开放许可' : '公开权利声明');
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
    durationSeconds?: number;
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
    vod_remarks: [options.durationSeconds ? formatMediaDuration(options.durationSeconds) : '', options.remarks || ''].filter(Boolean).join(' · ') || undefined,
    vod_content: [options.description || '', options.durationSeconds ? `片长：${formatMediaDuration(options.durationSeconds)}` : ''].filter(Boolean).join('\n') || undefined,
  };
}

async function searchArchive(query: string): Promise<CmsVod[]> {
  const terms = solrQuote(query);
  const licenseUrls = [
    'https://creativecommons.org/publicdomain/mark/1.0/',
    'https://creativecommons.org/publicdomain/zero/1.0/',
    'https://creativecommons.org/licenses/by/4.0/',
    'https://creativecommons.org/licenses/by-sa/4.0/',
  ];
  const rights = [
    'rights:"Public Domain"',
    'rights:"Public domain in the USA."',
    'rights:"No known copyright restrictions"',
    ...licenseUrls.flatMap((license) => [license, license.replace(/^https:/, 'http:')])
      .map((license) => `licenseurl:${solrQuote(license)}`),
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
    const description = cleanText(record.description ?? doc.description);
    // For a selected video file, files[].length is duration seconds and files[].size is bytes.
    // Prefer the exact file runtime because it describes the media URL we actually return.
    const durationSeconds = parseMediaDurationSeconds(file.length)
      ?? parseMediaDurationSeconds(record.runtime ?? record.duration ?? record.runtime_seconds ?? record.run_time ?? record.TRT)
      ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
    if (!isFeatureLengthMedia(durationSeconds)) return null;
    if (
      !isOpenMediaTitleRelevant(title, query)
      || isOpenMediaAdult(title, description)
      || isOpenMediaNonFeatureContent(title, description)
      || hasContradictoryCopyrightClaim(description)
    ) return null;
    const rightsValue = record.rights ?? doc.rights;
    const licenseUrl = record.licenseurl ?? doc.licenseurl;
    const rightsLabel = archiveRightsLabel(rightsValue, licenseUrl);
    return cmsItem('archive', identifier, title, {
      picture: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      year: getYear(record.year ?? doc.year),
      remarks: rightsLabel || '公开权利声明，播放详情中保留原始出处',
      durationSeconds,
      description: [description, `来源：Internet Archive（${identifier}）`, `权利声明：${rightsLabel}`, licenseUrl ? `许可链接：${cleanText(licenseUrl, 240)}` : ''].filter(Boolean).join('\n'),
    });
  }));
  return resolved
    .filter((entry): entry is PromiseFulfilledResult<CmsVod | null> => entry.status === 'fulfilled')
    .map((entry) => entry.value)
    .filter((entry): entry is CmsVod => entry !== null)
    .slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function getNasaAssetMetadata(nasaId: string): Promise<{ assets: string[]; metadata: Record<string, unknown> }> {
  const assetResponse = await fetchUpstreamJson<NasaAssetResponse>(
    `https://images-api.nasa.gov/asset/${encodeURIComponent(nasaId)}`,
    { timeoutMs: PROVIDER_TIMEOUT_MS }
  );
  const assets = extractNasaAssetUrls(assetResponse);
  const metadataUrl = assets.find((url) => /\/metadata\.json(?:\?|$)/i.test(url));
  if (!metadataUrl) return { assets, metadata: {} };
  try {
    const metadata = await fetchUpstreamJson<Record<string, unknown>>(metadataUrl, { timeoutMs: PROVIDER_TIMEOUT_MS });
    return { assets, metadata };
  } catch {
    // Keep usable asset URLs when NASA's optional metadata document is temporarily unavailable.
    return { assets, metadata: {} };
  }
}

async function searchNasa(query: string): Promise<CmsVod[]> {
  const params = new URLSearchParams({ q: query, media_type: 'video', page_size: String(MAX_FEDERATED_CANDIDATES) });
  const result = await fetchUpstreamJson<NasaSearchResponse>(
    `https://images-api.nasa.gov/search?${params.toString()}`,
    { timeoutMs: PROVIDER_TIMEOUT_MS }
  );
  const candidates = (result.collection?.items ?? []).slice(0, MAX_FEDERATED_CANDIDATES).flatMap((item) => {
    const data = item.data?.[0];
    const nasaId = String(data?.nasa_id ?? '');
    const title = cleanText(data?.title, 200);
    const description = cleanText(data?.description);
    if (!/^[\w-]+$/.test(nasaId) || !title || data?.media_type !== 'video') return [];
    if (
      !isOpenMediaTitleRelevant(title, query)
      || isOpenMediaAdult(title, description)
      || isOpenMediaNonFeatureContent(title, description)
    ) return [];
    // NASA sometimes republishes third-party material; do not include records with an explicit copyright field.
    if (hasExplicitCopyright(data.copyright) || /all rights reserved|copyrighted/i.test(String(data.rights ?? ''))) return [];
    return [{ item, data, nasaId, title, description }];
  }).slice(0, MAX_NASA_METADATA_CANDIDATES);

  const resolved = await Promise.all(candidates.map(async ({ item, data, nasaId, title, description }) => {
    let assets: string[] = [];
    let metadata: Record<string, unknown> = {};
    let durationSeconds = parseMediaDurationSeconds(data.duration);
    if (durationSeconds === null) {
      try {
        const fetched = await getNasaAssetMetadata(nasaId);
        assets = fetched.assets;
        metadata = fetched.metadata;
      } catch {
        // The labelled TRT in NASA's search description remains a last-resort fallback.
      }
      durationSeconds = parseNasaDurationSeconds(metadata)
        ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
    }
    if (!isFeatureLengthMedia(durationSeconds)) return null;
    if (hasExplicitCopyright(metadata['AVAIL:Copyright'] ?? metadata.Copyright ?? metadata.copyright)) return null;

    const preview = item.links?.find((link) => link.rel === 'preview')?.href
      ?? assets.find((url) => /~(?:large|medium|small)\.jpg(?:$|\?)/i.test(url));
    const center = cleanText(data.center, 40);
    return cmsItem('nasa', `${nasaId}|${center}`, title, {
      picture: preview?.replace(/^http:/, 'https:'),
      year: getYear(data.date_created),
      remarks: 'NASA 媒体库 · 请核对单项版权与使用说明',
      durationSeconds,
      description: [
        description,
        `来源：NASA Image and Video Library（${center || 'NASA'}）`,
        `原始条目：https://images.nasa.gov/details/${nasaId}`,
        'NASA 内容通常不受美国版权保护，但第三方版权素材、可识别人物肖像权及 NASA 标识有额外限制；请查看原始条目说明。',
      ].filter(Boolean).join('\n'),
    });
  }));
  return resolved.filter((item): item is CmsVod => item !== null).slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function searchCommons(query: string): Promise<CmsVod[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: 'filetype:video ' + query,
    gsrnamespace: '6',
    gsrlimit: String(MAX_FEDERATED_CANDIDATES),
    prop: 'imageinfo|videoinfo',
    iiprop: 'url|mime|extmetadata',
    viprop: 'derivatives|size',
    iiurlwidth: '480',
    format: 'json',
    formatversion: '2',
  });
  const result = await fetchUpstreamJson<CommonsSearchResponse>(
    'https://commons.wikimedia.org/w/api.php?' + params.toString(),
    {
      timeoutMs: PROVIDER_TIMEOUT_MS,
      headers: { 'User-Agent': 'LibreTV-Mobile/2.23.2 (+https://github.com/zj2917928447-ship-it/LibreTV-Mobile)', Accept: 'application/json' },
    }
  );
  return (result.query?.pages ?? []).flatMap((page) => {
    const pageId = Number(page.pageid ?? 0);
    const info = page.imageinfo?.[0];
    const videoInfo = page.videoinfo?.[0];
    const media = selectCommonsVideoFile(info ? { ...info, derivatives: videoInfo?.derivatives } : undefined);
    const licence = info?.extmetadata;
    const title = cleanText(page.title?.replace(/^File:/i, ''), 200);
    const description = cleanText(commonsMetaText(licence?.ImageDescription) || commonsMetaText(licence?.Description), 1200);
    const durationSeconds = parseMediaDurationSeconds(videoInfo?.duration ?? info?.duration ?? commonsMetaText(licence?.Duration))
      ?? extractMediaDurationSecondsFromText(title + ' ' + description);
    if (!Number.isSafeInteger(pageId) || pageId <= 0 || !media || !isAllowedCommonsLicence(licence) || !isFeatureLengthMedia(durationSeconds)) return [];
    if (!title) return [];
    const licenceName = cleanText(commonsMetaText(licence?.LicenseShortName) || commonsMetaText(licence?.UsageTerms), 100);
    const artist = cleanText(commonsMetaText(licence?.Artist) || commonsMetaText(licence?.Credit), 160);
    if (
      !isOpenMediaTitleRelevant(title, query)
      || isOpenMediaAdult(title, description)
      || isOpenMediaNonFeatureContent(title, description)
    ) return [];
    return [cmsItem('commons', String(pageId), title, {
      picture: media.thumbnail,
      year: getYear(title),
      remarks: licenceName || '\u5f00\u653e\u8bb8\u53ef',
      durationSeconds,
      description: [
        description,
        artist ? '\u4f5c\u8005/\u6765\u6e90\uff1a' + artist : '',
        '\u8bb8\u53ef\uff1a' + (licenceName || '\u5f00\u653e\u8bb8\u53ef'),
        info?.descriptionurl ? '\u539f\u59cb\u6761\u76ee\uff1a' + info.descriptionurl : '',
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
    const description = cleanText(item.description);
    const durationSeconds = parseMediaDurationSeconds(item.duration)
      ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
    if (!/^[a-z0-9.-]+$/.test(host) || !/^[0-9a-f-]{36}$/i.test(uuid) || !title || !isFeatureLengthMedia(durationSeconds)) return [];
    if (
      !isOpenMediaTitleRelevant(title, query)
      || isOpenMediaAdult(title, description)
      || isOpenMediaNonFeatureContent(title, description)
    ) return [];
    if (!isAllowedPeerTubeLicence(item.licence) || item.isLive || item.nsfw) return [];
    const licence = item.licence?.label || '开放许可';
    const channel = cleanText(item.account?.displayName, 100);
    return [cmsItem('peertube', `${host}|${uuid}`, title, {
      picture: item.thumbnailUrl,
      year: getYear(item.originallyPublishedAt ?? item.publishedAt),
      remarks: licence,
      durationSeconds,
      description: [
        description,
        channel ? `作者/频道：${channel}` : '',
        `托管实例：${host}`,
        `许可：${licence}`,
        '请遵守该视频页面列出的署名、相同方式共享及其他许可要求。',
      ].filter(Boolean).join('\n'),
    })];
  }).slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function searchAll(query: string): Promise<CmsVod[]> {
  // Provider catalogs mostly index English original titles; resolve known Chinese release aliases first.
  const providerQuery = resolveOpenMediaQuery(query);
  const providerNames = ['Internet Archive', 'NASA', 'PeerTube', 'Wikimedia Commons'];
  const results = await Promise.allSettled([
    searchArchive(providerQuery),
    searchNasa(providerQuery),
    searchPeerTube(providerQuery),
    searchCommons(providerQuery),
  ]);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`[open-media] ${providerNames[index]} search failed:`, result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  });
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<CmsVod[]> => result.status === 'fulfilled');
  if (fulfilled.length === 0) throw new Error('所有公开媒体服务暂时不可用');
  const combined = fulfilled.flatMap((result) => result.value);
  const seen = new Set<string>();
  const unique = combined.filter((item) => {
    const title = item.vod_name.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    const year = item.vod_year || '';
    const key = `${title}:${year}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const normalizedQuery = providerQuery.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const score = (title: string) => {
    const normalizedTitle = title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    if (normalizedTitle === normalizedQuery) return 3;
    if (normalizedTitle.startsWith(normalizedQuery)) return 2;
    return 1;
  };
  return unique.sort((a, b) => score(b.vod_name) - score(a.vod_name));
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
  const description = cleanText(record.description);
  // The selected video file's length is its runtime in seconds; size is the byte count.
  const durationSeconds = parseMediaDurationSeconds(file.length)
    ?? parseMediaDurationSeconds(record.runtime ?? record.duration ?? record.runtime_seconds ?? record.run_time ?? record.TRT)
    ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
  if (
    !title
    || !isFeatureLengthMedia(durationSeconds)
    || isOpenMediaAdult(title, description)
    || isOpenMediaNonFeatureContent(title, description)
    || hasContradictoryCopyrightClaim(description)
  ) return null;
  const mediaUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
  const rightsLabel = archiveRightsLabel(record.rights, record.licenseurl);
  const licenseUrl = cleanText(record.licenseurl, 240);
  return {
    ...cmsItem('archive', identifier, title, {
      picture: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      year: getYear(record.year),
      remarks: rightsLabel || 'Public Domain / CC',
      durationSeconds,
      description: [description, `来源：Internet Archive（${identifier}）`, `权利声明：${rightsLabel}`, licenseUrl ? `许可链接：${licenseUrl}` : ''].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'Internet Archive',
    vod_play_url: `在线播放$${mediaUrl}`,
  };
}

async function getNasaDetail(externalId: string): Promise<CmsVod | null> {
  const [nasaId] = externalId.split('|');
  if (!/^[\w-]+$/.test(nasaId)) return null;
  const { assets, metadata: record } = await getNasaAssetMetadata(nasaId);
  if (assets.length === 0) return null;
  const copyright = record['AVAIL:Copyright'] ?? record.Copyright ?? record.copyright;
  const title = cleanText(record['AVAIL:Title'] ?? record['QuickTime:Title'] ?? record['XMP:Title'], 200) || nasaId;
  const description = cleanText(record['AVAIL:Description'] ?? record['XMP:Description']);
  const durationSeconds = parseNasaDurationSeconds(record)
    ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
  if (
    hasExplicitCopyright(copyright)
    || !isFeatureLengthMedia(durationSeconds)
    || isOpenMediaAdult(title, description)
    || isOpenMediaNonFeatureContent(title, description)
  ) return null;
  const mediaUrl = selectNasaVideoUrl(assets);
  if (!mediaUrl) return null;
  const poster = assets.find((asset) => /~(?:mobile|small|medium|large)\.jpg$/i.test(asset))?.replace(/^http:/, 'https:');
  return {
    ...cmsItem('nasa', externalId, title, {
      picture: poster,
      remarks: 'NASA 影音资料 · 请核对单项权利',
      durationSeconds,
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
    prop: 'imageinfo|videoinfo',
    iiprop: 'url|mime|extmetadata',
    viprop: 'derivatives|size',
    iiurlwidth: '480',
    format: 'json',
    formatversion: '2',
  });
  const result = await fetchUpstreamJson<CommonsSearchResponse>(
    'https://commons.wikimedia.org/w/api.php?' + params.toString(),
    {
      timeoutMs: 10000,
      headers: { 'User-Agent': 'LibreTV-Mobile/2.23.2 (+https://github.com/zj2917928447-ship-it/LibreTV-Mobile)', Accept: 'application/json' },
    }
  );
  const page = result.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  const videoInfo = page?.videoinfo?.[0];
  const media = selectCommonsVideoFile(info ? { ...info, derivatives: videoInfo?.derivatives } : undefined);
  const licence = info?.extmetadata;
  const title = cleanText(page?.title?.replace(/^File:/i, ''), 200);
  const description = cleanText(commonsMetaText(licence?.ImageDescription) || commonsMetaText(licence?.Description), 1200);
  const durationSeconds = parseMediaDurationSeconds(videoInfo?.duration ?? info?.duration ?? commonsMetaText(licence?.Duration))
    ?? extractMediaDurationSecondsFromText(title + ' ' + description);
  if (!page || !media || !isAllowedCommonsLicence(licence) || !isFeatureLengthMedia(durationSeconds) || !title) return null;
  const licenceName = cleanText(commonsMetaText(licence?.LicenseShortName) || commonsMetaText(licence?.UsageTerms), 100);
  const artist = cleanText(commonsMetaText(licence?.Artist) || commonsMetaText(licence?.Credit), 160);
  if (isOpenMediaAdult(title, description) || isOpenMediaNonFeatureContent(title, description)) return null;
  return {
    ...cmsItem('commons', externalId, title, {
      picture: media.thumbnail,
      year: getYear(title),
      remarks: licenceName || '\u5f00\u653e\u8bb8\u53ef',
      durationSeconds,
      description: [
        description,
        artist ? '\u4f5c\u8005/\u6765\u6e90\uff1a' + artist : '',
        '\u8bb8\u53ef\uff1a' + (licenceName || '\u5f00\u653e\u8bb8\u53ef'),
        media.isTranscode ? '\u624b\u673a\u4f18\u5148\u8f6c\u7801\uff1a' + media.height + 'p' + (media.bandwidth ? ' · ' + (media.bandwidth / 1000).toFixed(0) + ' kbps' : '') : '\u672a\u63d0\u4f9b\u53ef\u7528\u8f6c\u7801\uff0c\u4f7f\u7528\u539f\u59cb\u5a92\u4f53\u6587\u4ef6',
        info?.descriptionurl ? '\u539f\u59cb\u6761\u76ee\uff1a' + info.descriptionurl : '',
      ].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'Wikimedia Commons',
    vod_play_url: '在线播放$' + media.url,
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
  const sourceDescription = cleanText(video.description);
  const durationSeconds = parseMediaDurationSeconds(video.duration)
    ?? extractMediaDurationSecondsFromText(`${title} ${sourceDescription}`);
  if (
    !isFeatureLengthMedia(durationSeconds)
    || isOpenMediaAdult(title, sourceDescription)
    || isOpenMediaNonFeatureContent(title, sourceDescription)
  ) return null;
  const licence = video.licence?.label || '开放许可';
  const description = [
    sourceDescription,
    video.account?.displayName ? `作者/频道：${cleanText(video.account.displayName, 100)}` : '',
    `托管实例：${host}`,
    `原始条目：https://${host}/videos/watch/${uuid}`,
    `许可：${licence}`,
  ].filter(Boolean).join('\n');
  return {
    ...cmsItem('peertube', externalId, title, {
      picture: video.thumbnailUrl || (video.thumbnailPath ? `https://${host}${video.thumbnailPath}` : undefined),
      remarks: licence,
      durationSeconds,
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

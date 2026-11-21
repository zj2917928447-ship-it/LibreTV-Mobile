import { NextResponse } from 'next/server';
import { fetchUpstreamJson, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { convertSubtitleToVtt, decodeSubtitleBytes } from '@/lib/subtitles';
import { resolveDynamicBilingualMeta, type DynamicBilingualMeta } from '@/lib/bilingual-resolver';
import {
  browseCuratedOpenVideos,
  findCuratedOpenVideoBySlug,
  OPEN_BROWSE_CATEGORIES,
  searchCuratedOpenVideos,
  toCuratedCmsItem,
  type OpenBrowseCategory,
} from '@/lib/curated-open-video';
import type { SubtitleTrack } from '@/lib/types';
import {
  commonsMetaText,
  mapWithConcurrency,
  buildOpenMediaSearchCacheKey,
  decodeOpenMediaId,
  encodeOpenMediaId,
  extractArchiveSubtitleFiles,
  extractNasaAssetUrls,
  hasStaticOpenMediaAlias,
  normalizeNasaAssetUrl,
  hasContradictoryCopyrightClaim,
  hasExplicitCopyright,
  isOpenMediaAdult,
  isOpenMediaNonFeatureContent,
  isOpenMediaTitleRelevant,
  isLocPublicDomainFilmTitle,
  isPlayableOpenMediaDuration,
  localizeOpenMediaItem,
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
  normalizePeerTubeMediaUrl,
  type CommonsVideoInfo,
  type CommonsVideoDerivative,
  type OpenMediaProvider,
} from '@/lib/open-media';

export const runtime = 'nodejs';

const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const DETAIL_CACHE_TTL = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 12_000;
const ENHANCED_PROVIDER_TIMEOUT_MS = 3_800;
const PROVIDER_COOLDOWN_MS = 3 * 60 * 1000;
const providerCooldownUntil = new Map<string, number>();

function isProviderCoolingDown(key: string, enhanced: boolean): boolean {
  if (!enhanced || process.env.VITEST) return false;
  const until = providerCooldownUntil.get(key) ?? 0;
  return Date.now() < until;
}

function recordProviderFailure(key: string, enhanced: boolean): void {
  if (!enhanced || process.env.VITEST) return;
  providerCooldownUntil.set(key, Date.now() + PROVIDER_COOLDOWN_MS);
}

function recordProviderSuccess(key: string, enhanced: boolean): void {
  if (!enhanced || process.env.VITEST) return;
  providerCooldownUntil.delete(key);
}
const MAX_RESULTS_PER_PROVIDER = 6;
const MAX_ARCHIVE_CANDIDATES = 24;
const MAX_ARCHIVE_METADATA_CONCURRENCY = 8;
const MAX_FEDERATED_CANDIDATES = 24;
const MAX_NASA_METADATA_CANDIDATES = 12;
const MAX_NASA_METADATA_CONCURRENCY = 4;
const MAX_LOC_CANDIDATES = 5;

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
  vod_subtitles?: SubtitleTrack[];
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

interface LocSearchItem {
  title?: string;
  url?: string;
  access_restricted?: boolean;
  group?: string[];
  date?: string;
  description?: string[] | string;
  image_url?: string[];
  resources?: Array<{
    video?: string;
    video_stream?: string;
    image?: string;
    poster?: string;
    duration?: number | string;
  }>;
}

interface LocSearchResponse {
  content?: { results?: LocSearchItem[] };
  results?: LocSearchItem[];
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

/** NASA IDs may contain spaces and punctuation; encode them as one path segment at the fetch boundary. */
function isValidNasaId(value: string): boolean {
  return value.length > 0
    && value.length <= 256
    && value !== '.'
    && value !== '..'
    && !/[\\/\u0000-\u001f\u007f|]/.test(value);
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
      provider === 'loc' ? 'Library of Congress · 美国公共领域' :
      provider === 'curated' ? '自由影视 · 精选开放片库' :
        'PeerTube · Creative Commons',
    vod_year: options.year,
    vod_remarks: [options.durationSeconds ? formatMediaDuration(options.durationSeconds) : '', options.remarks || ''].filter(Boolean).join(' · ') || undefined,
    vod_content: [options.description || '', options.durationSeconds ? `片长：${formatMediaDuration(options.durationSeconds)}` : ''].filter(Boolean).join('\n') || undefined,
  };
}

async function searchArchive(query: string, allowShort = false, enhanced = false): Promise<CmsVod[]> {
  if (isProviderCoolingDown('archive', enhanced)) return [];
  const terms = solrQuote(query);
  const licenseUrls = [
    'https://creativecommons.org/licenses/publicdomain/',
    'https://creativecommons.org/publicdomain/mark/1.0/',
    'https://creativecommons.org/publicdomain/zero/1.0/',
    'https://creativecommons.org/licenses/by/4.0/',
    'https://creativecommons.org/licenses/by-sa/4.0/',
    'https://creativecommons.org/licenses/by/3.0/',
    'https://creativecommons.org/licenses/by-sa/3.0/',
  ];
  const rights = [
    'rights:"Public Domain"',
    'rights:"Public domain in the USA."',
    'rights:"No known copyright restrictions"',
    ...licenseUrls.flatMap((license) => [license, license.replace(/^https:/, 'http:')])
      .map((license) => `licenseurl:${solrQuote(license)}`),
  ].join(' OR ');
  const collectionClause = enhanced
    ? ' OR collection:(feature_films OR SciFi_Horror OR comedy_films OR film_noir OR silent_films OR animationandcartoons)'
    : '';
  const params = new URLSearchParams({
    q: `mediatype:movies AND (${rights}${collectionClause}) AND title:${terms}`,
    rows: String(MAX_ARCHIVE_CANDIDATES),
    page: '1',
    output: 'json',
    sort: 'downloads desc',
  });
  const fields = enhanced
    ? ['identifier', 'title', 'year', 'description', 'licenseurl', 'rights', 'collection']
    : ['identifier', 'title', 'year', 'description', 'licenseurl', 'rights'];
  for (const field of fields) {
    params.append('fl[]', field);
  }
  let result: ArchiveSearchResponse;
  try {
    result = await fetchUpstreamJson<ArchiveSearchResponse>(
      `https://archive.org/advancedsearch.php?${params.toString()}`,
      { timeoutMs: enhanced ? ENHANCED_PROVIDER_TIMEOUT_MS : PROVIDER_TIMEOUT_MS }
    );
    recordProviderSuccess('archive', enhanced);
  } catch (err) {
    recordProviderFailure('archive', enhanced);
    throw err;
  }
  const docs = (result.response?.docs ?? []).slice(0, MAX_ARCHIVE_CANDIDATES).filter((doc) => {
    const title = cleanText(doc.title, 200);
    const description = cleanText(doc.description);
    // Reject obvious false positives from the lightweight search response before fetching full metadata.
    return !title || (
      isOpenMediaTitleRelevant(title, query)
      && !isOpenMediaAdult(title, description)
      && !isOpenMediaNonFeatureContent(title, description)
      && !hasContradictoryCopyrightClaim(description)
    );
  });
  const resolved = await mapWithConcurrency(docs, MAX_ARCHIVE_METADATA_CONCURRENCY, async (doc) => {
    const identifier = String(doc.identifier ?? '');
    if (!/^[\w.-]+$/.test(identifier)) return null;
    try {
      const metadata = await fetchUpstreamJson<ArchiveMetadataResponse>(
        `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
        { timeoutMs: enhanced ? ENHANCED_PROVIDER_TIMEOUT_MS : PROVIDER_TIMEOUT_MS }
      );
      const record = metadata.metadata ?? {};
      if (String(record.mediatype ?? '') !== 'movies') return null;
      if (!isArchiveRightsAllowed({
        rights: record.rights ?? doc.rights,
        licenseurl: record.licenseurl ?? doc.licenseurl,
        collection: record.collection ?? doc.collection,
        allowCuratedCollections: enhanced,
      })) return null;
      const file = selectArchiveVideoFile(metadata.files ?? []);
      if (!file?.name) return null;
      const title = cleanText(record.title ?? doc.title, 200);
      if (!title) return null;
      const description = cleanText(record.description ?? doc.description);
      // For a selected video file, files[].length is runtime seconds and files[].size is bytes.
      const durationSeconds = parseMediaDurationSeconds(file.length)
        ?? parseMediaDurationSeconds(record.runtime ?? record.duration ?? record.runtime_seconds ?? record.run_time ?? record.TRT)
        ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
      if (!isPlayableOpenMediaDuration(durationSeconds, allowShort)) return null;
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
    } catch (error) {
      console.warn(`[open-media] Archive metadata failed for ${identifier}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  });
  return resolved.filter((entry): entry is CmsVod => entry !== null).slice(0, enhanced ? 14 : MAX_RESULTS_PER_PROVIDER);
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

async function searchNasa(query: string, allowShort = false, enhanced = false): Promise<CmsVod[]> {
  if (isProviderCoolingDown('nasa', enhanced)) return [];
  const params = new URLSearchParams({ q: query, media_type: 'video', page_size: String(MAX_FEDERATED_CANDIDATES) });
  let result: NasaSearchResponse;
  try {
    result = await fetchUpstreamJson<NasaSearchResponse>(
      `https://images-api.nasa.gov/search?${params.toString()}`,
      { timeoutMs: enhanced ? ENHANCED_PROVIDER_TIMEOUT_MS : PROVIDER_TIMEOUT_MS }
    );
    recordProviderSuccess('nasa', enhanced);
  } catch (err) {
    recordProviderFailure('nasa', enhanced);
    throw err;
  }
  const candidates = (result.collection?.items ?? []).slice(0, MAX_FEDERATED_CANDIDATES).flatMap((item) => {
    const data = item.data?.[0];
    const nasaId = String(data?.nasa_id ?? '');
    const title = cleanText(data?.title, 200);
    const description = cleanText(data?.description);
    if (!isValidNasaId(nasaId) || !title || data?.media_type !== 'video') return [];
    if (
      !isOpenMediaTitleRelevant(title, query)
      || isOpenMediaAdult(title, description)
      || isOpenMediaNonFeatureContent(title, description)
    ) return [];
    // NASA sometimes republishes third-party material; do not include records with an explicit copyright/rights restriction.
    if (hasExplicitCopyright(data.copyright) || hasExplicitCopyright(data.rights)) return [];
    return [{ item, data, nasaId, title, description }];
  }).slice(0, MAX_NASA_METADATA_CANDIDATES);

  const resolved = await mapWithConcurrency(candidates, MAX_NASA_METADATA_CONCURRENCY, async ({ item, data, nasaId, title, description }) => {
    try {
      // Always verify the asset manifest before publishing a search hit: search metadata alone
      // does not prove that a browser-playable MP4 exists or that item-level copyright is clear.
      const { assets, metadata } = await getNasaAssetMetadata(nasaId);
      if (!selectNasaVideoUrl(assets)) return null;
      const copyright = metadata['AVAIL:Copyright'] ?? metadata.Copyright ?? metadata.copyright;
      const rights = metadata['AVAIL:Rights'] ?? metadata.Rights ?? metadata.rights;
      if (hasExplicitCopyright(copyright) || hasExplicitCopyright(rights)) return null;
      const durationSeconds = parseMediaDurationSeconds(data.duration)
        ?? parseNasaDurationSeconds(metadata)
        ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
      if (!isPlayableOpenMediaDuration(durationSeconds, allowShort)) return null;

      const preview = item.links?.find((link) => link.rel === 'preview')?.href
        ?? assets.find((url) => /~(?:large|medium|small)\.jpg(?:$|\?)/i.test(url));
      const center = cleanText(data.center, 40);
      return cmsItem('nasa', `${nasaId}|${center}`, title, {
        picture: normalizeNasaAssetUrl(preview) ?? undefined,
        year: getYear(data.date_created),
        remarks: 'NASA 媒体库 · 请核对单项版权与使用说明',
        durationSeconds,
        description: [
          description,
          `来源：NASA Image and Video Library（${center || 'NASA'}）`,
          `原始条目：https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
          'NASA 内容通常不受美国版权保护，但第三方版权素材、可识别人物肖像权及 NASA 标识有额外限制；请查看原始条目说明。',
        ].filter(Boolean).join('\n'),
      });
    } catch (error) {
      console.warn(`[open-media] NASA metadata failed for ${nasaId}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  });
  return resolved.filter((item): item is CmsVod => item !== null).slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function searchCommons(query: string, allowShort = false, enhanced = false): Promise<CmsVod[]> {
  if (isProviderCoolingDown('commons', enhanced)) return [];
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
  let result: CommonsSearchResponse;
  try {
    result = await fetchUpstreamJson<CommonsSearchResponse>(
      'https://commons.wikimedia.org/w/api.php?' + params.toString(),
      {
        timeoutMs: enhanced ? ENHANCED_PROVIDER_TIMEOUT_MS : PROVIDER_TIMEOUT_MS,
        headers: { 'User-Agent': 'LibreTV-Mobile/2.25.0 (+https://github.com/zj2917928447-ship-it/LibreTV-Mobile)', Accept: 'application/json' },
      }
    );
    recordProviderSuccess('commons', enhanced);
  } catch (err) {
    recordProviderFailure('commons', enhanced);
    throw err;
  }
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
    if (!Number.isSafeInteger(pageId) || pageId <= 0 || !media || !isAllowedCommonsLicence(licence) || !isPlayableOpenMediaDuration(durationSeconds, allowShort)) return [];
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

async function searchPeerTube(query: string, allowShort = false, enhanced = false): Promise<CmsVod[]> {
  const params = new URLSearchParams({ search: query, count: String(MAX_FEDERATED_CANDIDATES), nsfw: 'false' });
  let items: NonNullable<PeerTubeSearchResponse['data']> = [];
  if (!enhanced) {
    const result = await fetchUpstreamJson<PeerTubeSearchResponse>(
      `https://search.joinpeertube.org/api/v1/search/videos?${params.toString()}`,
      { timeoutMs: PROVIDER_TIMEOUT_MS }
    );
    items = result.data ?? [];
  } else {
    let sepFailed = isProviderCoolingDown('sepia', true);
    if (!sepFailed) {
      try {
        const primary = await fetchUpstreamJson<PeerTubeSearchResponse>(
          `https://search.joinpeertube.org/api/v1/search/videos?${params.toString()}`,
          { timeoutMs: ENHANCED_PROVIDER_TIMEOUT_MS }
        );
        items = primary.data ?? [];
        recordProviderSuccess('sepia', true);
      } catch {
        recordProviderFailure('sepia', true);
        sepFailed = true;
      }
    }
    if (sepFailed) {
      // 国内直连环境下 Sepia 全局索引可能超时，自动回退至直连实测可达的 Blender、Framatube 与 TILvids 节点
      const mirrors = await Promise.allSettled([
        fetchUpstreamJson<PeerTubeSearchResponse>(
          `https://video.blender.org/api/v1/search/videos?${params.toString()}`,
          { timeoutMs: ENHANCED_PROVIDER_TIMEOUT_MS }
        ),
        fetchUpstreamJson<PeerTubeSearchResponse>(
          `https://framatube.org/api/v1/search/videos?${params.toString()}`,
          { timeoutMs: ENHANCED_PROVIDER_TIMEOUT_MS }
        ),
        fetchUpstreamJson<PeerTubeSearchResponse>(
          `https://tilvids.com/api/v1/search/videos?${params.toString()}`,
          { timeoutMs: ENHANCED_PROVIDER_TIMEOUT_MS }
        ),
      ]);
      for (const m of mirrors) {
        if (m.status === 'fulfilled' && Array.isArray(m.value.data)) {
          items.push(...m.value.data);
        }
      }
    }
  }
  return items.flatMap((item) => {
    const host = String(item.account?.host ?? '').toLowerCase();
    const uuid = String(item.uuid ?? '');
    const title = cleanText(item.name, 200);
    const description = cleanText(item.description);
    const durationSeconds = parseMediaDurationSeconds(item.duration)
      ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
    if (!/^[a-z0-9.-]+$/.test(host) || !/^[0-9a-f-]{36}$/i.test(uuid) || !title || !isPlayableOpenMediaDuration(durationSeconds, allowShort)) return [];
    if (
      !isOpenMediaTitleRelevant(title, query)
      || isOpenMediaAdult(title, description)
      || isOpenMediaNonFeatureContent(title, description)
    ) return [];
    const officialBlenderOpen = enhanced && host === 'video.blender.org' && !hasContradictoryCopyrightClaim(description);
    if ((!isAllowedPeerTubeLicence(item.licence) && !officialBlenderOpen) || item.isLive || item.nsfw) return [];
    const licence = item.licence?.label && item.licence.label !== 'Unknown'
      ? item.licence.label
      : officialBlenderOpen
        ? 'CC BY · Blender Studio'
        : '开放许可';
    const channel = cleanText(item.account?.displayName, 100);
    const rawThumb = item.thumbnailUrl
      ? normalizePeerTubeMediaUrl(item.thumbnailUrl)
      : undefined;
    return [cmsItem('peertube', `${host}|${uuid}`, title, {
      picture: rawThumb ?? undefined,
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
  }).slice(0, enhanced ? 12 : MAX_RESULTS_PER_PROVIDER);
}

function isAllowedLocVideoUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'tile.loc.gov' && /\.mp4$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Search the National Film Registry facet, then allowlist the titles on LOC's public-domain set page. */
async function searchLoc(query: string, allowShort = false, enhanced = false): Promise<CmsVod[]> {
  if (isProviderCoolingDown('loc', enhanced)) return [];
  // LOC's search endpoint treats '+' in these facet/query values inconsistently; use percent-encoding for spaces.
  const locSearchUrl = 'https://www.loc.gov/film-and-videos/?fo=json&q=' + encodeURIComponent(query)
    + '&c=' + String(MAX_LOC_CANDIDATES)
    + '&at=results&fa=' + encodeURIComponent('partof:selections from the national film registry');
  let result: LocSearchResponse;
  try {
    result = await fetchUpstreamJson<LocSearchResponse>(
      locSearchUrl,
      {
        timeoutMs: enhanced ? ENHANCED_PROVIDER_TIMEOUT_MS : PROVIDER_TIMEOUT_MS,
        headers: { 'User-Agent': 'LibreTV-Mobile/2.25.0 (free public-domain film search)', Accept: 'application/json' },
      }
    );
    recordProviderSuccess('loc', enhanced);
  } catch (err) {
    recordProviderFailure('loc', enhanced);
    throw err;
  }
  const records = result.content?.results ?? result.results ?? [];
  return records.flatMap((record) => {
    const title = cleanText(record.title, 200);
    const itemUrl = typeof record.url === 'string' ? record.url : '';
    const match = itemUrl.match(/^https:\/\/www\.loc\.gov\/item\/([\w.-]+)\/?$/i);
    const itemId = match?.[1] ?? '';
    const resource = record.resources?.find((candidate) => isAllowedLocVideoUrl(candidate.video));
    const mediaUrl = resource?.video;
    const durationSeconds = parseMediaDurationSeconds(resource?.duration);
    const groups = record.group ?? [];
    const descText = cleanText(record.description);
    const allowTitle = isLocPublicDomainFilmTitle(title)
      || (allowShort && isOpenMediaTitleRelevant(title, query) && !hasContradictoryCopyrightClaim(descText));
    if (
      !title
      || !itemId
      || record.access_restricted !== false
      || !groups.includes('selections-from-the-national-film-registry')
      || !allowTitle
      || !mediaUrl
      || !durationSeconds
      || durationSeconds < 60
      || durationSeconds > 24 * 60 * 60
      || isOpenMediaAdult(title, descText)
      || isOpenMediaNonFeatureContent(title, descText)
    ) return [];
    return [{
      ...cmsItem('loc', itemId + '|' + title, title, {
        picture: record.image_url?.[0] || resource?.poster || resource?.image,
        year: getYear(record.date),
        remarks: 'Public Domain · 免费使用',
        durationSeconds,
        description: [
          descText,
          '来源：Library of Congress · Public Domain Films from the National Film Registry',
          '权利说明：该影片列入美国国会图书馆明确标注的公共领域电影精选集。',
          '原始条目：' + itemUrl,
        ].filter(Boolean).join('\n'),
      }),
      vod_play_from: 'Library of Congress',
      vod_play_url: '在线播放$' + mediaUrl,
    }];
  }).slice(0, MAX_RESULTS_PER_PROVIDER);
}

async function searchAll(
  query: string,
  allowShort = false,
  resolvedOverride?: string,
  enhanced = false
): Promise<CmsVod[]> {
  // Provider catalogs mostly index English original titles; resolve known Chinese release aliases first.
  const providerQuery = resolvedOverride || resolveOpenMediaQuery(query);
  const providerNames = ['Internet Archive', 'NASA', 'PeerTube', 'Wikimedia Commons', 'Library of Congress'];
  const results = await Promise.allSettled([
    searchArchive(providerQuery, allowShort, enhanced),
    searchNasa(providerQuery, allowShort, enhanced),
    searchPeerTube(providerQuery, allowShort, enhanced),
    searchCommons(providerQuery, allowShort, enhanced),
    searchLoc(providerQuery, allowShort, enhanced),
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
  // Keep same-title entries from different providers: they may have different cuts, codecs and licences.
  // Only collapse duplicate provider records that resolve to the exact same external ID.
  const unique = combined.filter((item) => {
    if (seen.has(item.vod_id)) return false;
    seen.add(item.vod_id);
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

function applyChineseLocalization(
  list: CmsVod[],
  userQuery: string,
  forceChinese: boolean,
  dynamicMeta?: DynamicBilingualMeta | null
): CmsVod[] {
  const shouldLocalizeTitle = forceChinese || /[\u3400-\u9fff]/u.test(userQuery);
  if (!shouldLocalizeTitle) return list;
  return list.map((item) => {
    const { displayTitle, chineseSummary } = localizeOpenMediaItem(item.vod_name, userQuery);
    const effectiveTitle =
      displayTitle === item.vod_name && dynamicMeta && !/[\u3400-\u9fff]/u.test(item.vod_name)
        ? `${dynamicMeta.zhTitle} / ${item.vod_name}`
        : displayTitle;
    const summaryText = chineseSummary || dynamicMeta?.zhSummary;
    const nextContent = summaryText && !(item.vod_content || '').includes('中文导览：')
      ? [`中文导览：${summaryText}`, item.vod_content || ''].filter(Boolean).join('\n')
      : item.vod_content;
    return {
      ...item,
      vod_name: effectiveTitle,
      ...(nextContent ? { vod_content: nextContent } : {}),
    };
  });
}

async function getArchiveDetail(identifier: string, allowShort = false, enhanced = false): Promise<CmsVod | null> {
  if (!/^[\w.-]+$/.test(identifier)) return null;
  const metadata = await fetchUpstreamJson<ArchiveMetadataResponse>(
    `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
    { timeoutMs: 10000 }
  );
  const record = metadata.metadata ?? {};
  if (String(record.mediatype ?? '') !== 'movies') return null;
  if (!isArchiveRightsAllowed({
    rights: record.rights,
    licenseurl: record.licenseurl,
    collection: record.collection,
    allowCuratedCollections: enhanced,
  })) return null;
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
    || !isPlayableOpenMediaDuration(durationSeconds, allowShort)
    || isOpenMediaAdult(title, description)
    || isOpenMediaNonFeatureContent(title, description)
    || hasContradictoryCopyrightClaim(description)
  ) return null;
  const mediaUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
  const rightsLabel = archiveRightsLabel(record.rights, record.licenseurl);
  const licenseUrl = cleanText(record.licenseurl, 240);
  const vodId = encodeOpenMediaId('archive', identifier);
  const subtitles: SubtitleTrack[] = extractArchiveSubtitleFiles(metadata.files ?? []).map((sub) => ({
    label: sub.label,
    lang: sub.lang,
    format: sub.format,
    url: `/api/open-media?ac=subtitle&id=${encodeURIComponent(vodId)}&file=${encodeURIComponent(sub.fileName)}`,
  }));
  const { chineseSummary } = localizeOpenMediaItem(title);
  return {
    ...cmsItem('archive', identifier, title, {
      picture: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      year: getYear(record.year),
      remarks: rightsLabel || 'Public Domain / CC',
      durationSeconds,
      description: [
        chineseSummary ? `中文导览：${chineseSummary}` : '',
        description,
        `来源：Internet Archive（${identifier}）`,
        `权利声明：${rightsLabel}`,
        licenseUrl ? `许可链接：${licenseUrl}` : '',
      ].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'Internet Archive',
    vod_play_url: `在线播放$${mediaUrl}`,
    ...(subtitles.length > 0 ? { vod_subtitles: subtitles } : {}),
  };
}

async function getNasaDetail(externalId: string, allowShort = false): Promise<CmsVod | null> {
  const [nasaId] = externalId.split('|');
  if (!isValidNasaId(nasaId)) return null;
  const { assets, metadata: record } = await getNasaAssetMetadata(nasaId);
  if (assets.length === 0) return null;
  const copyright = record['AVAIL:Copyright'] ?? record.Copyright ?? record.copyright;
  const rights = record['AVAIL:Rights'] ?? record.Rights ?? record.rights;
  const title = cleanText(record['AVAIL:Title'] ?? record['QuickTime:Title'] ?? record['XMP:Title'], 200) || nasaId;
  const description = cleanText(record['AVAIL:Description'] ?? record['XMP:Description']);
  const durationSeconds = parseNasaDurationSeconds(record)
    ?? extractMediaDurationSecondsFromText(`${title} ${description}`);
  if (
    hasExplicitCopyright(copyright)
    || hasExplicitCopyright(rights)
    || !isPlayableOpenMediaDuration(durationSeconds, allowShort)
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
      description: [description, `来源：NASA Image and Video Library（${nasaId}）`, `原始条目：https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`, 'NASA 内容通常不受美国版权保护，但第三方版权素材、可识别人物肖像权及 NASA 标识有额外限制；请核对原始媒体说明。'].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'NASA',
    vod_play_url: `在线播放$${mediaUrl}`,
  };
}

async function fetchCommonsTimedTextTracks(vodId: string, rawFileTitle: string): Promise<SubtitleTrack[]> {
  try {
    const cleanFile = rawFileTitle.replace(/^File:/i, '').trim();
    if (!cleanFile || cleanFile.length > 200) return [];
    const params = new URLSearchParams({
      action: 'query',
      list: 'allpages',
      apnamespace: '102', // TimedText namespace on Wikimedia Commons
      apprefix: `${cleanFile}.`,
      aplimit: '20',
      format: 'json',
    });
    const data = await fetchUpstreamJson<{
      query?: { allpages?: Array<{ title?: string }> };
    }>(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
      timeoutMs: 4_000,
      headers: { 'User-Agent': 'LibreTV-Mobile/2.24.0 (+https://github.com/zj2917928447-ship-it/LibreTV-Mobile)', Accept: 'application/json' },
    });
    const pages = data.query?.allpages ?? [];
    const scored: Array<SubtitleTrack & { priority: number }> = [];
    for (const entry of pages) {
      const pageTitle = typeof entry.title === 'string' ? entry.title.trim() : '';
      // Match TimedText:<filename>.<lang>.srt
      const m = pageTitle.match(/^TimedText:(.+)\.([a-zA-Z0-9-]+)\.srt$/);
      if (!m) continue;
      const langCode = m[2].toLowerCase();
      let label = `字幕 (${langCode})`;
      let priority = 3;
      if (langCode === 'zh' || langCode === 'zh-cn' || langCode === 'zh-hans' || langCode === 'zh-sg') {
        label = '简体中文字幕 (官方)';
        priority = 0;
      } else if (langCode === 'zh-tw' || langCode === 'zh-hk' || langCode === 'zh-hant') {
        label = '繁体中文字幕 (官方)';
        priority = 1;
      } else if (langCode === 'en' || langCode === 'en-us' || langCode === 'en-gb') {
        label = '英文字幕 (可一键汉化)';
        priority = 2;
      }
      scored.push({
        label,
        lang: langCode,
        format: 'vtt',
        url: `/api/open-media?ac=subtitle&id=${encodeURIComponent(vodId)}&page=${encodeURIComponent(pageTitle)}`,
        priority,
      });
    }
    return scored
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 6)
      .map(({ label, lang, format, url }) => ({ label, lang, format, url }));
  } catch {
    return [];
  }
}

async function getCommonsDetail(externalId: string, allowShort = false, fetchSubtitles = false): Promise<CmsVod | null> {
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
      headers: { 'User-Agent': 'LibreTV-Mobile/2.24.0 (+https://github.com/zj2917928447-ship-it/LibreTV-Mobile)', Accept: 'application/json' },
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
  if (!page || !media || !isAllowedCommonsLicence(licence) || !isPlayableOpenMediaDuration(durationSeconds, allowShort) || !title) return null;
  const licenceName = cleanText(commonsMetaText(licence?.LicenseShortName) || commonsMetaText(licence?.UsageTerms), 100);
  const artist = cleanText(commonsMetaText(licence?.Artist) || commonsMetaText(licence?.Credit), 160);
  if (isOpenMediaAdult(title, description) || isOpenMediaNonFeatureContent(title, description)) return null;
  const vodId = encodeOpenMediaId('commons', externalId);
  const subtitles = fetchSubtitles && page.title
    ? await fetchCommonsTimedTextTracks(vodId, page.title)
    : [];
  const { chineseSummary } = localizeOpenMediaItem(title);
  return {
    ...cmsItem('commons', externalId, title, {
      picture: media.thumbnail,
      year: getYear(title),
      remarks: licenceName || '\u5f00\u653e\u8bb8\u53ef',
      durationSeconds,
      description: [
        chineseSummary ? `中文导览：${chineseSummary}` : '',
        description,
        artist ? '\u4f5c\u8005/\u6765\u6e90\uff1a' + artist : '',
        '\u8bb8\u53ef\uff1a' + (licenceName || '\u5f00\u653e\u8bb8\u53ef'),
        media.isTranscode ? '\u624b\u673a\u4f18\u5148\u8f6c\u7801\uff1a' + media.height + 'p' + (media.bandwidth ? ' · ' + (media.bandwidth / 1000).toFixed(0) + ' kbps' : '') : '\u672a\u63d0\u4f9b\u53ef\u7528\u8f6c\u7801\uff0c\u4f7f\u7528\u539f\u59cb\u5a92\u4f53\u6587\u4ef6',
        info?.descriptionurl ? '\u539f\u59cb\u6761\u76ee\uff1a' + info.descriptionurl : '',
      ].filter(Boolean).join('\n'),
    }),
    vod_play_from: 'Wikimedia Commons',
    vod_play_url: '在线播放$' + media.url,
    ...(subtitles.length > 0 ? { vod_subtitles: subtitles } : {}),
  };
}

async function getLocDetail(externalId: string, allowShort = false): Promise<CmsVod | null> {
  const [itemId, title] = externalId.split('|');
  if (!/^[\w.-]+$/.test(itemId || '') || (!allowShort && !isLocPublicDomainFilmTitle(title || '')) || !(title || '').trim()) return null;
  const matches = await searchLoc(title, allowShort);
  const expectedId = encodeOpenMediaId('loc', itemId + '|' + title);
  const item = matches.find((candidate) => candidate.vod_id === expectedId);
  if (!item?.vod_play_url) return null;
  const mediaUrl = item.vod_play_url.split('$').slice(1).join('$');
  if (!isAllowedLocVideoUrl(mediaUrl)) return null;
  return {
    ...item,
    vod_play_from: 'Library of Congress',
    vod_play_url: '在线播放$' + mediaUrl,
  };
}

async function getPeerTubeDetail(externalId: string, allowShort = false, enhanced = false): Promise<CmsVod | null> {
  const [host, uuid] = externalId.split('|');
  if (!/^[a-z0-9.-]+$/i.test(host || '') || !/^[0-9a-f-]{36}$/i.test(uuid || '')) return null;
  const video = await fetchUpstreamJson<PeerTubeVideoResponse>(
    `https://${host}/api/v1/videos/${uuid}`,
    { timeoutMs: 10000 }
  );
  const officialBlenderOpen = enhanced && host.toLowerCase() === 'video.blender.org' && !hasContradictoryCopyrightClaim(cleanText(video.description));
  if (!isAllowedPeerTubeLicence(video.licence) && !officialBlenderOpen) return null;
  const mediaUrl = selectPeerTubeStreamUrl(video);
  if (!mediaUrl) return null;
  // Federated instances may return media hosted on an unrelated CDN; preflight its DNS
  // and reject private/reserved destinations before exposing the URL to the browser.
  const mediaVerdict = await checkUpstreamAllowed(mediaUrl);
  if (!mediaVerdict.ok) return null;
  const title = cleanText(video.name, 200);
  if (!title) return null;
  const sourceDescription = cleanText(video.description);
  const durationSeconds = parseMediaDurationSeconds(video.duration)
    ?? extractMediaDurationSecondsFromText(`${title} ${sourceDescription}`);
  if (
    !isPlayableOpenMediaDuration(durationSeconds, allowShort)
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
      picture: normalizePeerTubeMediaUrl(video.thumbnailUrl)
        ?? normalizePeerTubeMediaUrl(video.thumbnailPath ? new URL(video.thumbnailPath, `https://${host}`).href : undefined)
        ?? undefined,
      remarks: licence,
      durationSeconds,
      description,
    }),
    vod_play_from: 'PeerTube',
    vod_play_url: `在线播放$${mediaUrl}`,
  };
}

async function getDetail(id: string, allowShort = false, enhanced = false): Promise<CmsVod | null> {
  const decoded = decodeOpenMediaId(id);
  if (!decoded) return null;
  switch (decoded.provider) {
    case 'curated': {
      const curated = findCuratedOpenVideoBySlug(decoded.externalId);
      return curated ? toCuratedCmsItem(curated, true) : null;
    }
    case 'archive': return getArchiveDetail(decoded.externalId, allowShort, enhanced);
    case 'nasa': return getNasaDetail(decoded.externalId, allowShort);
    case 'peertube': return getPeerTubeDetail(decoded.externalId, allowShort, enhanced);
    case 'commons': return getCommonsDetail(decoded.externalId, allowShort, enhanced);
    case 'loc': return getLocDetail(decoded.externalId, allowShort);
  }
}

async function handleSubtitleRequest(url: URL): Promise<Response> {
  const id = (url.searchParams.get('id') || '').trim();
  const file = (url.searchParams.get('file') || '').trim();
  const page = (url.searchParams.get('page') || '').trim();
  const decoded = decodeOpenMediaId(id);
  if (!decoded) {
    return NextResponse.json({ code: 0, msg: '无效的字幕条目参数' }, { status: 400 });
  }

  let targetUrl = '';
  let cacheKey = '';
  if (decoded.provider === 'archive' && /^[\w.-]+$/.test(decoded.externalId)) {
    if (!file || file.length > 240 || file.includes('..') || /[\u0000-\u001f\\]/.test(file) || !/\.(?:srt|vtt)$/i.test(file)) {
      return NextResponse.json({ code: 0, msg: '无效的字幕文件名' }, { status: 400 });
    }
    const encodedPath = file.split('/').map((part) => encodeURIComponent(part)).join('/');
    targetUrl = `https://archive.org/download/${encodeURIComponent(decoded.externalId)}/${encodedPath}`;
    cacheKey = `open-media:subtitle:archive:${decoded.externalId}:${file}`;
  } else if (decoded.provider === 'commons' && /^\d+$/.test(decoded.externalId)) {
    if (!/^TimedText:[^?#\u0000-\u001f\\]{1,220}\.srt$/i.test(page) || page.includes('..')) {
      return NextResponse.json({ code: 0, msg: '无效的维基字幕页参数' }, { status: 400 });
    }
    const params = new URLSearchParams({ title: page, action: 'raw' });
    targetUrl = `https://commons.wikimedia.org/w/index.php?${params.toString()}`;
    cacheKey = `open-media:subtitle:commons:${decoded.externalId}:${page}`;
  } else {
    return NextResponse.json({ code: 0, msg: '不支持该来源的内置字幕读取' }, { status: 400 });
  }

  const cached = getCache<string>(cacheKey);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  try {
    const { fetchUpstream } = await import('@/lib/fetch-utils');
    const upstream = await fetchUpstream(targetUrl, {
      timeoutMs: 10000,
      headers: { 'User-Agent': 'LibreTV-Mobile/2.24.0 (+https://github.com/zj2917928447-ship-it/LibreTV-Mobile)' },
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ code: 0, msg: '上游字幕加载失败' }, { status: 502 });
    }
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const maxBytes = 1024 * 1024;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return NextResponse.json({ code: 0, msg: '字幕文件体积超出限制' }, { status: 413 });
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const vtt = convertSubtitleToVtt(decodeSubtitleBytes(merged));
    setCache(cacheKey, vtt, DETAIL_CACHE_TTL);
    return new Response(vtt, {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ code: 0, msg: '字幕获取失败' }, { status: 502 });
  }
}

async function browseDynamicOnlinePage(category: OpenBrowseCategory, page: number): Promise<CmsVod[]> {
  const safePage = Math.min(30, Math.max(2, Math.floor(page)));
  const cacheKey = `open-media:browse:v2:${category}:p${safePage}`;
  const cached = getCache<CmsVod[]>(cacheKey);
  if (cached) return cached;

  const offset = (safePage - 2) * 16;
  const tasks: Promise<CmsVod[]>[] = [];

  // 1) 国内高速可达的 PeerTube 电影(2)/喜剧(9)/娱乐(10)/科教(13/15)/少儿动画(17) 节点分页拉取（按 CC-BY/SA/公版过滤）
  {
    const ptCategoryParams =
      category === 'animation'
        ? '&categoryOneOf[]=2&categoryOneOf[]=17'
        : category === 'comedy'
          ? '&categoryOneOf[]=9&categoryOneOf[]=10'
          : category === 'thriller'
            ? '&categoryOneOf[]=2'
            : category === 'space'
              ? '&categoryOneOf[]=15&categoryOneOf[]=13'
              : '&categoryOneOf[]=2&categoryOneOf[]=9&categoryOneOf[]=15';
    const ptHosts =
      category === 'animation'
        ? ['video.blender.org', 'framatube.org', 'tilvids.com']
        : category === 'space'
          ? ['tilvids.com', 'framatube.org']
          : ['framatube.org', 'tilvids.com', 'makertube.net'];
    for (const host of ptHosts) {
      tasks.push(
        (async () => {
          try {
            const licenceFilter = host === 'video.blender.org' ? '' : '&licenceOneOf[]=1&licenceOneOf[]=2&licenceOneOf[]=7';
            const listUrl = `https://${host}/api/v1/videos?start=${offset}&count=16&sort=-views&nsfw=false${licenceFilter}${ptCategoryParams}`;
            const res = await fetchUpstreamJson<PeerTubeSearchResponse>(listUrl, {
              timeoutMs: ENHANCED_PROVIDER_TIMEOUT_MS,
            });
            return (res.data ?? []).flatMap((item) => {
              const itemHost = String(item.account?.host ?? host).toLowerCase();
              const uuid = String(item.uuid ?? '');
              const title = cleanText(item.name, 200);
              const description = cleanText(item.description);
              const durationSeconds = parseMediaDurationSeconds(item.duration);
              if (
                !/^[a-z0-9.-]+$/.test(itemHost) ||
                !/^[0-9a-f-]{36}$/i.test(uuid) ||
                !title ||
                !isPlayableOpenMediaDuration(durationSeconds, true) ||
                isOpenMediaAdult(title, description) ||
                item.isLive ||
                item.nsfw
              ) {
                return [];
              }
              const officialBlender = itemHost === 'video.blender.org' && !hasContradictoryCopyrightClaim(description);
              if (!isAllowedPeerTubeLicence(item.licence) && !officialBlender) return [];
              const licence =
                item.licence?.label && item.licence.label !== 'Unknown'
                  ? item.licence.label
                  : officialBlender
                    ? 'CC BY · Blender Studio'
                    : 'CC 开放许可';
              const thumbUrl = item.thumbnailUrl
                ? normalizePeerTubeMediaUrl(item.thumbnailUrl)
                : undefined;
              return [
                cmsItem('peertube', `${itemHost}|${uuid}`, title, {
                  picture: thumbUrl ?? undefined,
                  year: getYear(item.originallyPublishedAt ?? item.publishedAt),
                  remarks: licence,
                  durationSeconds: durationSeconds ?? undefined,
                  description: [description, `托管节点：${itemHost}`, `许可：${licence}`].filter(Boolean).join('\n'),
                }),
              ];
            });
          } catch {
            return [];
          }
        })()
      );
    }
  }

  // 2) NASA 官方影音资料库动态分页（国内直连约 750ms）
  if (category === 'all' || category === 'space') {
    const nasaTopics = ['space documentary', 'planet earth', 'mars', 'moon', 'galaxy', 'astronaut', 'solar system'];
    const topic = nasaTopics[(safePage - 2) % nasaTopics.length];
    const nasaPage = Math.floor((safePage - 2) / nasaTopics.length) + 1;
    tasks.push(
      (async () => {
        if (isProviderCoolingDown('nasa', true)) return [];
        try {
          const params = new URLSearchParams({
            q: topic,
            media_type: 'video',
            page: String(nasaPage),
            page_size: '10',
          });
          const res = await fetchUpstreamJson<NasaSearchResponse>(
            `https://images-api.nasa.gov/search?${params.toString()}`,
            { timeoutMs: ENHANCED_PROVIDER_TIMEOUT_MS }
          );
          const cands = (res.collection?.items ?? []).slice(0, 8);
          const resolved = await mapWithConcurrency(cands, 4, async (item) => {
            const data = item.data?.[0];
            const nasaId = String(data?.nasa_id ?? '');
            const title = cleanText(data?.title, 200);
            const description = cleanText(data?.description);
            if (!isValidNasaId(nasaId) || !title || hasExplicitCopyright(data?.copyright)) return null;
            try {
              const { assets, metadata } = await getNasaAssetMetadata(nasaId);
              if (!selectNasaVideoUrl(assets)) return null;
              const durationSeconds =
                parseMediaDurationSeconds(data?.duration) ??
                parseNasaDurationSeconds(metadata) ??
                extractMediaDurationSecondsFromText(`${title} ${description}`) ??
                240;
              if (durationSeconds < 90) return null;
              const preview =
                item.links?.find((l) => l.rel === 'preview')?.href ??
                assets.find((u) => /~(?:medium|small|thumb)\.jpg(?:$|\?)/i.test(u));
              return cmsItem('nasa', `${nasaId}|${cleanText(data?.center, 40)}`, title, {
                picture: normalizeNasaAssetUrl(preview) ?? undefined,
                year: getYear(data?.date_created),
                remarks: 'NASA 官方档案',
                durationSeconds,
                description: description || 'NASA 官方航天纪实影像',
              });
            } catch {
              return null;
            }
          });
          return resolved.filter((x): x is CmsVod => x !== null);
        } catch {
          return [];
        }
      })()
    );
  }

  // 3) Internet Archive 经典公版馆藏动态分页（Render / 海外网络下解锁上万部长片）
  if (!isProviderCoolingDown('archive', true) && category !== 'space') {
    tasks.push(
      (async () => {
        try {
          const archiveCollection =
            category === 'animation'
              ? 'collection:animationandcartoons'
              : category === 'comedy'
                ? 'collection:comedy_films'
                : category === 'thriller'
                  ? 'collection:(SciFi_Horror OR film_noir)'
                  : category === 'chinese'
                    ? 'collection:feature_films AND (chinese OR china OR shanghai)'
                    : 'collection:feature_films';
          const params = new URLSearchParams({
            q: `mediatype:movies AND ${archiveCollection}`,
            rows: '12',
            page: String(safePage - 1),
            output: 'json',
            sort: 'downloads desc',
          });
          for (const f of ['identifier', 'title', 'year', 'description', 'licenseurl', 'rights', 'collection']) {
            params.append('fl[]', f);
          }
          const searchRes = await fetchUpstreamJson<ArchiveSearchResponse>(
            `https://archive.org/advancedsearch.php?${params.toString()}`,
            { timeoutMs: ENHANCED_PROVIDER_TIMEOUT_MS }
          );
          recordProviderSuccess('archive', true);
          const docs = (searchRes.response?.docs ?? []).slice(0, 10);
          const resolved = await mapWithConcurrency(docs, 5, async (doc) => {
            const identifier = String(doc.identifier ?? '');
            const title = cleanText(doc.title, 200);
            const description = cleanText(doc.description);
            if (
              !/^[\w.-]+$/.test(identifier) ||
              !title ||
              isOpenMediaAdult(title, description) ||
              hasContradictoryCopyrightClaim(description)
            ) {
              return null;
            }
            if (
              !isArchiveRightsAllowed({
                rights: doc.rights,
                licenseurl: doc.licenseurl,
                collection: doc.collection,
                allowCuratedCollections: true,
              })
            ) {
              return null;
            }
            return cmsItem('archive', identifier, title, {
              picture: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
              year: getYear(doc.year),
              remarks: 'Archive 公版馆藏',
              description: description || `Internet Archive 馆藏影片（${identifier}）`,
            });
          });
          return resolved.filter((x): x is CmsVod => x !== null);
        } catch {
          recordProviderFailure('archive', true);
          return [];
        }
      })()
    );
  }

  const settled = await Promise.allSettled(tasks);
  const combined = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const localized = applyChineseLocalization(combined, '', true);
  const deduped = mergeUniqueVodItems([], localized);
  if (deduped.length > 0) {
    setCache(cacheKey, deduped, SEARCH_CACHE_TTL);
  }
  return deduped;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get('ac');
  if (action === 'subtitle') {
    return handleSubtitleRequest(url);
  }
  if (action === 'browse') {
    const rawCat = (url.searchParams.get('category') || 'all').trim();
    const validCat = OPEN_BROWSE_CATEGORIES.some((c) => c.id === rawCat)
      ? (rawCat as OpenBrowseCategory)
      : 'all';
    const rawPage = Number.parseInt(url.searchParams.get('pg') || '1', 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(30, rawPage) : 1;

    if (page === 1) {
      const items = browseCuratedOpenVideos(validCat).map((item) => toCuratedCmsItem(item, false));
      return NextResponse.json(
        {
          code: 1,
          category: validCat,
          categories: OPEN_BROWSE_CATEGORIES,
          page: 1,
          pagecount: 20,
          hasMore: true,
          limit: items.length,
          total: items.length,
          list: items,
        },
        { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' } }
      );
    }

    const dynamicItems = await browseDynamicOnlinePage(validCat, page);
    return NextResponse.json(
      {
        code: 1,
        category: validCat,
        categories: OPEN_BROWSE_CATEGORIES,
        page,
        pagecount: 20,
        hasMore: dynamicItems.length > 0 && page < 20,
        limit: dynamicItems.length,
        total: dynamicItems.length,
        list: dynamicItems,
      },
      { headers: dynamicItems.length > 0 ? { 'Cache-Control': 'public, max-age=120' } : { 'Cache-Control': 'no-store' } }
    );
  }
  if (action && action !== 'videolist' && action !== 'detail' && action !== 'list') {
    return NextResponse.json({ code: 0, msg: '仅支持 Apple CMS 兼容的 videolist、detail、list 或 browse 操作' }, { status: 400 });
  }

  const rawCatParam = (url.searchParams.get('cat') || url.searchParams.get('t') || '').trim();
  const numericCatMap: Record<string, OpenBrowseCategory> = {
    '1': 'animation',
    '2': 'comedy',
    '3': 'thriller',
    '4': 'space',
    '5': 'chinese',
  };
  const scopedCat: OpenBrowseCategory = OPEN_BROWSE_CATEGORIES.some((c) => c.id === rawCatParam)
    ? (rawCatParam as OpenBrowseCategory)
    : numericCatMap[rawCatParam] || 'all';
  const cmsClassList = OPEN_BROWSE_CATEGORIES.filter((c) => c.id !== 'all').map((c, idx) => ({
    type_id: idx + 1,
    type_pid: 0,
    type_name: c.label,
    type_en: c.id,
  }));

  const allowShort = url.searchParams.get('short') === '1';
  const forceChinese = url.searchParams.get('zh') === '1';
  const onlySeries = url.searchParams.get('series') === '1';
  const onlyDirect = url.searchParams.get('direct') === '1';
  const enhanced = allowShort || forceChinese;
  const id = (url.searchParams.get('ids') || '').trim();
  if (id) {
    const cacheKey = enhanced ? `open-media:detail:enhanced:${id}` : `open-media:detail:${id}`;
    const cached = getCache<CmsVod>(cacheKey);
    if (cached) {
      const list = applyChineseLocalization([cached], '', forceChinese);
      return NextResponse.json({ code: 1, list });
    }
    try {
      const detail = await getDetail(id, allowShort, enhanced);
      if (!detail) return NextResponse.json({ code: 1, list: [] });
      setCache(cacheKey, detail, DETAIL_CACHE_TTL);
      const list = applyChineseLocalization([detail], '', forceChinese);
      return NextResponse.json({ code: 1, list });
    } catch (error) {
      console.warn('[open-media] detail lookup failed:', error instanceof Error ? error.message : String(error));
      return NextResponse.json({ code: 1, list: [] });
    }
  }

  const query = (url.searchParams.get('wd') || '').trim().slice(0, 100);
  // 兼容标准 Apple CMS v10 / TVBox 分类列表请求（ac=list 或无 wd 的 ac=videolist&pg=1）
  if (!query) {
    const rawPg = Number.parseInt(url.searchParams.get('pg') || '1', 10);
    const pg = Number.isFinite(rawPg) && rawPg >= 1 ? rawPg : 1;
    const pageSize = 24;
    const allCurated = browseCuratedOpenVideos(scopedCat).filter((item) => {
      if (onlySeries && !(item.episodes && item.episodes.length > 0)) return false;
      if (onlyDirect && !(item.directPlayUrl || (item.episodes && item.episodes.length > 0))) return false;
      return true;
    });
    const total = allCurated.length;
    const pagecount = Math.max(1, Math.ceil(total / pageSize));
    const slice = allCurated
      .slice((pg - 1) * pageSize, pg * pageSize)
      .map((item) => toCuratedCmsItem(item, action === 'videolist'));
    return NextResponse.json(
      {
        code: 1,
        msg: '数据列表',
        page: pg,
        pagecount,
        limit: pageSize,
        total,
        class: cmsClassList,
        list: slice,
      },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' } }
    );
  }

  const allCuratedMatches = enhanced ? searchCuratedOpenVideos(query, allowShort) : [];
  const rawCuratedMatches = allCuratedMatches.filter((item) => {
    if (scopedCat !== 'all' && item.category !== scopedCat) return false;
    if (onlySeries && !(item.episodes && item.episodes.length > 0)) return false;
    if (onlyDirect && !(item.directPlayUrl || (item.episodes && item.episodes.length > 0))) return false;
    return true;
  });
  const curatedHits = rawCuratedMatches.map((item) => toCuratedCmsItem(item, false));
  // 专馆子源（?cat=... / ?series=1 / ?direct=1）仅返回该专馆精选库命中，零额外外网请求开销
  if (scopedCat !== 'all' || onlySeries || onlyDirect) {
    return NextResponse.json({
      code: 1,
      page: 1,
      pagecount: 1,
      limit: curatedHits.length,
      total: curatedHits.length,
      list: curatedHits,
    });
  }

  // 动态跨语种增强：若内置精选库已命中中文词，直接复用其英文原名检索在线库，免去 2 次外部串行豆瓣请求延迟；
  // 仅当静态词典与内置精选库均未命中时，才调用动态豆瓣解析原名与简介。
  const curatedFallbackEnQuery = rawCuratedMatches[0]?.enTitle;
  const dynamicMeta =
    forceChinese && /[\u3400-\u9fff]/u.test(query) && !hasStaticOpenMediaAlias(query) && !curatedFallbackEnQuery
      ? await resolveDynamicBilingualMeta(query)
      : null;
  const effectiveEnOverride = dynamicMeta?.enQuery || curatedFallbackEnQuery;
  const effectiveQueryKey = effectiveEnOverride || query;
  const cacheKey = `${buildOpenMediaSearchCacheKey(effectiveQueryKey, allowShort)}${enhanced ? ':enh' : ''}`;
  const cached = getCache<CmsVod[]>(cacheKey);
  if (cached) {
    const localized = applyChineseLocalization(cached, query, forceChinese, dynamicMeta);
    const merged = mergeUniqueVodItems(curatedHits, localized);
    return NextResponse.json({ code: 1, page: 1, pagecount: 1, limit: merged.length, total: merged.length, list: merged });
  }

  try {
    const rawList = await searchAll(query, allowShort, effectiveEnOverride, enhanced);
    // Empty results are short-lived and not CDN-cached: provider outages or stale alias
    // cache entries must not make a previously empty Chinese search appear permanently broken.
    setCache(cacheKey, rawList, rawList.length > 0 ? SEARCH_CACHE_TTL : 30_000);
    const localized = applyChineseLocalization(rawList, query, forceChinese, dynamicMeta);
    const list = mergeUniqueVodItems(curatedHits, localized);
    return NextResponse.json({ code: 1, page: 1, pagecount: 1, limit: list.length, total: list.length, list }, {
      headers: list.length > 0
        ? { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
        : { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (curatedHits.length > 0) {
      return NextResponse.json({
        code: 1,
        page: 1,
        pagecount: 1,
        limit: curatedHits.length,
        total: curatedHits.length,
        list: curatedHits,
      });
    }
    console.warn('[open-media] search failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ code: 0, msg: '公开影视资料库暂时不可用，请稍后重试', list: [] }, { status: 502 });
  }
}

function mergeUniqueVodItems(primary: CmsVod[], secondary: CmsVod[]): CmsVod[] {
  if (primary.length === 0) return secondary;
  const seen = new Set<string>();
  const out: CmsVod[] = [];
  for (const item of [...primary, ...secondary]) {
    if (seen.has(item.vod_id)) continue;
    seen.add(item.vod_id);
    out.push(item);
  }
  return out;
}

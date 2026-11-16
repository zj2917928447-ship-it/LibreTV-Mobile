import { Buffer } from 'node:buffer';
import { isPrivateIP } from './network-address';

export type OpenMediaProvider = 'archive' | 'nasa' | 'peertube' | 'commons';

/** Run independent provider metadata lookups with a fixed concurrency ceiling. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive finite number');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const SEARCH_STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at']);

/** Common Chinese release titles mapped to the English metadata used by open-media indexes. */
const OPEN_MEDIA_QUERY_ALIASES = new Map<string, string>([
  ['蜘蛛侠', 'Spider-Man'],
  ['蜘蛛俠', 'Spider-Man'],
  ['蜘蛛人', 'Spider-Man'],
  ['超凡蜘蛛俠', 'The Amazing Spider-Man'],
  ['蜘蛛俠英雄歸來', 'Spider-Man: Homecoming'],
  ['蜘蛛俠英雄遠征', 'Spider-Man: Far From Home'],
  ['蜘蛛俠英雄無歸', 'Spider-Man: No Way Home'],
  ['小蜘蛛', 'Spider-Man'],
  ['蜘蛛侠英雄归来', 'Spider-Man: Homecoming'],
  ['蜘蛛侠英雄远征', 'Spider-Man: Far From Home'],
  ['蜘蛛侠英雄无归', 'Spider-Man: No Way Home'],
  ['超凡蜘蛛侠', 'The Amazing Spider-Man'],
  ['超凡蜘蛛侠2', 'The Amazing Spider-Man 2'],
  ['蜘蛛侠2', 'Spider-Man 2'],
  ['蜘蛛侠3', 'Spider-Man 3'],
]);
const ADULT_MEDIA_PATTERN = /\b(?:porn(?:ography)?|erotic|xxx|hentai|adult\s+(?:film|video|content)|sexually\s+explicit|nudity|nude\s+(?:film|video)|striptease|onlyfans)\b|色情|情色|成人视频|成人影片|裸露|裸体|福利片|伦理片/i;
const CONTRADICTORY_RIGHTS_PATTERN = /all rights reserved|copyright(?:ed)?\s*(?:©|\(c\)|:|by\b|\d{4})|©\s*\d{4}/i;

/** Reject obviously adult material even when an uploader labels it public domain. */
export function isOpenMediaAdult(title: string, description = ''): boolean {
  return ADULT_MEDIA_PATTERN.test(`${title} ${description}`);
}

/** Reject contradictory copyright claims in descriptive metadata even if licence fields disagree. */
export function hasContradictoryCopyrightClaim(description: string): boolean {
  return CONTRADICTORY_RIGHTS_PATTERN.test(description);
}

/** Minimum verified runtime for a feature-length film search. */
export const MIN_FEATURE_DURATION_SECONDS = 20 * 60;
export const MAX_FEATURE_DURATION_SECONDS = 24 * 60 * 60;

const NON_FEATURE_TITLE_PATTERN = /\b(?:trailer|teaser|tv\s*spot|promo(?:tional)?|preview|clip|excerpt|highlight\s*reel|highlights?|behind\s+the\s+scenes|making\s+of|interview|review|reaction|recap|gameplay|walkthrough|demo|tutorial|music\s+video|concert|vr\s+experience|virtual\s+reality|b-?roll|short\s+film|webisode|fan\s+edit|compilation|commercial|video\s+diary|vlog|web\s+series|tv\s+series|animated\s+series|complete\s+series|season\s+\d+|episode\s+\d+)\b|预告片|预告|花絮|访谈|影评|解说|混剪|片段|短片|短视频|音乐视频|演示|体验|游戏实况|幕后|制作特辑|宣传片|集锦|精彩片段|试玩|测评|反应视频|第\d+季|第\d+集|剧集/i;
const NON_FEATURE_DESCRIPTION_PATTERN = /\b(?:original\s+song|original\s+music|music\s+demo|music\s+app|music\s+performance|music\s+video|performed\s+on\s+[\w-]+|concert\s+performance|vr\s+experience|virtual\s+reality\s+experience|gameplay\s+footage|trailer\s+for|teaser\s+for|interview\s+with|review\s+of|reaction\s+to|behind\s+the\s+scenes|making\s+of|fan\s+edit|compilation\s+of\s+clips|nanoloop|htc\s+vive)\b|原唱|原创歌曲|音乐演示|音乐应用|游戏实况|预告片|访谈|幕后花絮/i;

/** Reject trailers, music demos, interviews, clips and other non-feature material. */
export function isOpenMediaNonFeatureContent(title: string, description = ''): boolean {
  return NON_FEATURE_TITLE_PATTERN.test(title) || NON_FEATURE_DESCRIPTION_PATTERN.test(description);
}

/** Parse a duration value in seconds, MM:SS, HH:MM:SS or ISO-8601 PT form. */
export function parseMediaDurationSeconds(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const part of value) {
      const parsed = parseMediaDurationSeconds(part);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const seconds = Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  const clock = raw.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/);
  if (clock) {
    const first = Number(clock[1]);
    const second = Number(clock[2]);
    const third = clock[3] === undefined ? null : Number(clock[3]);
    if (second >= 60 || (third !== null && third >= 60)) return null;
    const seconds = third === null ? first * 60 + second : first * 3600 + second * 60 + third;
    return seconds > 0 ? seconds : null;
  }

  const units = raw.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟))?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|秒))?$/i);
  if (units && (units[1] || units[2] || units[3])) {
    const seconds = Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }
  return null;
}

/** Read the real runtime fields returned by NASA asset metadata.json. */
export function parseNasaDurationSeconds(record: Record<string, unknown>): number | null {
  for (const value of [
    record['AVAIL:Duration'],
    record['QuickTime:Duration'],
    record['QuickTime:MediaDuration'],
    record['QuickTime:TrackDuration'],
    record.Duration,
    record.duration,
    record.runtime,
    record.TRT,
  ]) {
    const parsed = parseMediaDurationSeconds(value);
    if (parsed !== null) return parsed;
  }

  const xmp = record['XMP:Duration'];
  if (xmp && typeof xmp === 'object') {
    const value = Number((xmp as { Value?: unknown }).Value);
    const scale = Number((xmp as { Scale?: unknown }).Scale);
    const seconds = value * scale;
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

/** Extract labelled running times such as "TRT: 00:48:22" from NASA descriptions. */
export function extractMediaDurationSecondsFromText(value: string): number | null {
  const patterns = [
    /(?:TRT|total\s+run(?:ning)?\s*time|running\s*time|runtime|duration|playtime)\s*[:=]?\s*(\d{1,3}:\d{2}(?::\d{2}(?:\.\d+)?)?)/i,
    /(?:TRT|total\s+run(?:ning)?\s*time|running\s*time|runtime|duration|playtime)\s*[:=]?\s*(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|小时)(?:\s*\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|分钟))?(?:\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|秒))?|\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|分钟)(?:\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|秒))?|\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|秒))/i,
    /(?:片长|时长|总时长)\s*[:：]?\s*(\d{1,3}:\d{2}(?::\d{2}(?:\.\d+)?)?)/,
    /(?:片长|时长|总时长)\s*[:：]?\s*(\d+(?:\.\d+)?\s*小时(?:\s*\d+(?:\.\d+)?\s*分钟)?(?:\s*\d+(?:\.\d+)?\s*秒)?|\d+(?:\.\d+)?\s*分钟(?:\s*\d+(?:\.\d+)?\s*秒)?|\d+(?:\.\d+)?\s*秒)/,
    /[\[(（]\s*(\d{1,3}:\d{2}:\d{2})\s*[\])）]/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      const seconds = parseMediaDurationSeconds(match[1]);
      if (seconds !== null) return seconds;
    }
  }
  return null;
}

export function isFeatureLengthMedia(durationSeconds: number | null | undefined): durationSeconds is number {
  return typeof durationSeconds === 'number'
    && Number.isFinite(durationSeconds)
    && durationSeconds >= MIN_FEATURE_DURATION_SECONDS
    && durationSeconds <= MAX_FEATURE_DURATION_SECONDS;
}

export function formatMediaDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (part: number) => String(part).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Resolve a Chinese localized title to the English phrase indexed by public-media providers. */
export function resolveOpenMediaQuery(query: string): string {
  const raw = query.trim();
  const normalized = raw.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  return OPEN_MEDIA_QUERY_ALIASES.get(normalized) ?? raw;
}

/**
 * Require a contiguous multi-word title phrase. Single-word searches must match
 * the first or last title token, preventing "Spider" from matching "Dienamite
 * ... spider mites ..." while retaining titles such as "Earth Vs. The Spider".
 */
export function isOpenMediaTitleRelevant(title: string, query: string): boolean {
  const rawQuery = query.trim();
  if (!rawQuery || !title.trim()) return false;
  if (/[\u3400-\u9fff]/u.test(rawQuery)) {
    const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    return normalize(title).includes(normalize(rawQuery));
  }
  const words = (value: string): string[] => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const queryWords = words(rawQuery);
  const titleWords = words(title);
  if (queryWords.length === 0 || titleWords.length === 0 || queryWords.every((word) => SEARCH_STOP_WORDS.has(word))) return false;

  if (queryWords.length > 1) {
    const titlePrefix = title.trim().toLowerCase();
    const queryPrefix = rawQuery.toLowerCase();
    const suffix = titlePrefix.slice(queryPrefix.length).trimStart();
    if (titlePrefix.startsWith(queryPrefix) && [':', '：', '-', '–', '—', '(', '['].some((separator) => suffix.startsWith(separator))) return true;
  }

  if (queryWords.length === 1) {
    const last = titleWords[titleWords.length - 1];
    const terminal = /^\d{4}$/.test(last) ? titleWords[titleWords.length - 2] : last;
    return titleWords[0] === queryWords[0] || terminal === queryWords[0];
  }

  const wordMatches = (titleWord: string, queryWord: string) =>
    titleWord === queryWord || titleWord === `${queryWord}s` || queryWord === `${titleWord}s`;
  for (let i = 0; i <= titleWords.length - queryWords.length; i++) {
    if (i !== 0) continue;
    if (!queryWords.every((word, offset) => wordMatches(titleWords[i + offset], word))) continue;
    const next = titleWords[i + queryWords.length];
    if (!queryWords.some((word) => SEARCH_STOP_WORDS.has(word))) return true;
    const allowedSubtitleWords = new Set(['the', 'a', 'an']);
    if (!next || /^\d{4}$/.test(next) || allowedSubtitleWords.has(next)) return true;
  }
  return false;
}

export interface ArchiveVideoFile {
  name?: string;
  format?: string;
  size?: string | number;
  length?: string | number;
}

export interface NasaAssetManifest {
  collection?: { items?: Array<{ href?: unknown }> };
}

export function hasExplicitCopyright(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase().replace(/[.。]+$/g, '');
  if (!text) return false;
  if (/^(?:false|no|none|n\/a|na|0)$/.test(text)) return false;
  if (/^(?:not copyrighted|uncopyrighted|public domain(?: in the [a-z ]+)?|no copyright(?: restrictions?)?|no known copyright restrictions)$/.test(text)) return false;
  return true;
}

export function normalizeNasaAssetUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.hostname.toLowerCase() !== 'images-assets.nasa.gov'
      || url.username || url.password) return null;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

/** NASA /asset returns collection.items[].href, not a bare string array. */
export function extractNasaAssetUrls(manifest: NasaAssetManifest): string[] {
  return (manifest.collection?.items ?? [])
    .map((item) => normalizeNasaAssetUrl(item.href))
    .filter((href): href is string => href !== null);
}

export interface CommonsLicenseMetadata {
  LicenseShortName?: unknown;
  LicenseUrl?: unknown;
  UsageTerms?: unknown;
  Duration?: unknown;
  Copyrighted?: unknown;
  Artist?: unknown;
  Credit?: unknown;
  ImageDescription?: unknown;
  Description?: unknown;
}

/** MediaWiki extmetadata values are objects such as { value, source, hidden }, not plain strings. */
export function commonsMetaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || !('value' in value)) return '';
  const inner = (value as { value?: unknown }).value;
  return typeof inner === 'string' ? inner : '';
}

export interface CommonsVideoDerivative {
  src?: unknown;
  type?: unknown;
  transcodekey?: unknown;
  width?: unknown;
  height?: unknown;
  bandwidth?: unknown;
}

export interface CommonsVideoInfo {
  url?: unknown;
  thumburl?: unknown;
  mime?: unknown;
  duration?: unknown;
  descriptionurl?: unknown;
  extmetadata?: CommonsLicenseMetadata;
  derivatives?: CommonsVideoDerivative[];
}

/** Accept explicit public-domain, CC0, CC BY, CC BY-SA and CC BY-ND declarations only. */
export function isAllowedCommonsLicence(metadata?: CommonsLicenseMetadata): boolean {
  if (!metadata) return false;
  const copyrighted = commonsMetaText(metadata.Copyrighted).trim().toLowerCase();
  if (copyrighted === 'true' || copyrighted === 'yes') return false;
  const shortName = commonsMetaText(metadata.LicenseShortName || metadata.UsageTerms).trim().toLowerCase();
  const licenseUrl = commonsMetaText(metadata.LicenseUrl).trim().toLowerCase();
  if (/by-nc|non.?commercial|all rights reserved/.test(`${shortName} ${licenseUrl}`)) return false;
  if (/public domain|no known copyright restrictions/.test(shortName)) return true;
  if (/creativecommons\.org\/publicdomain\/zero\/1\.0/.test(licenseUrl)) return true;
  return /creativecommons\.org\/licenses\/(by|by-sa|by-nd)\//.test(licenseUrl);
}

/**
 * Return a browser-supported HTTPS video from Wikimedia's official upload CDN.
 * Prefer an available transcode at or below 720p and roughly 900 kbps. If no
 * derivative meets that mobile budget, use the smallest available one instead
 * of sending a phone the multi-gigabyte original. DASH-only
 * derivatives are skipped because this app currently uses hls.js/native HTML5.
 */
export function selectCommonsVideoFile(info?: CommonsVideoInfo): {
  url: string;
  thumbnail?: string;
  mime: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  isTranscode: boolean;
} | null {
  if (!info || typeof info.url !== 'string' || typeof info.mime !== 'string') return null;
  const allowedMime = new Set(['video/mp4', 'video/webm', 'video/ogg']);
  const originalMime = info.mime.split(';', 1)[0].trim().toLowerCase();
  if (!allowedMime.has(originalMime)) return null;

  const trustedMediaUrl = (value: unknown): URL | null => {
    if (typeof value !== 'string') return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.hostname === 'upload.wikimedia.org' ? parsed : null;
    } catch {
      return null;
    }
  };

  const original = trustedMediaUrl(info.url);
  if (!original) return null;
  let thumbnailUrl: string | undefined;
  if (typeof info.thumburl === 'string') {
    try {
      const thumbnail = new URL(info.thumburl);
      const allowedThumbnailHost = thumbnail.hostname === 'upload.wikimedia.org' || thumbnail.hostname === 'thumb.wikimedia.org';
      if (thumbnail.protocol === 'https:' && allowedThumbnailHost) thumbnailUrl = thumbnail.href;
    } catch {
      // A malformed optional thumbnail must not hide an otherwise valid video.
    }
  }

  const derivatives = (Array.isArray(info.derivatives) ? info.derivatives : []).flatMap((derivative) => {
    if (!derivative || typeof derivative !== 'object') return [];
    const url = trustedMediaUrl(derivative.src);
    const mime = typeof derivative.type === 'string' ? derivative.type.split(';', 1)[0].trim().toLowerCase() : '';
    const height = Number(derivative.height);
    const width = Number(derivative.width);
    const bandwidth = Number(derivative.bandwidth);
    if (!url || !allowedMime.has(mime) || !Number.isFinite(height) || height <= 0) return [];
    return [{
      url: url.href,
      mime,
      height,
      width: Number.isFinite(width) && width > 0 ? width : undefined,
      bandwidth: Number.isFinite(bandwidth) && bandwidth > 0 ? bandwidth : undefined,
    }];
  });

  if (derivatives.length > 0) {
    const mobileCandidates = derivatives.filter((item) => item.height <= 720);
    const underBandwidthBudget = mobileCandidates.filter((item) => item.bandwidth !== undefined && item.bandwidth <= 900_000);
    const pool = underBandwidthBudget.length > 0
      ? underBandwidthBudget
      : mobileCandidates.length > 0
        ? mobileCandidates
        : derivatives;
    pool.sort((a, b) => {
      if (underBandwidthBudget.length > 0) {
        return b.height - a.height || (a.bandwidth ?? Number.MAX_SAFE_INTEGER) - (b.bandwidth ?? Number.MAX_SAFE_INTEGER);
      }
      return a.height - b.height || (a.bandwidth ?? Number.MAX_SAFE_INTEGER) - (b.bandwidth ?? Number.MAX_SAFE_INTEGER);
    });
    const selected = pool[0];
    return {
      url: selected.url,
      thumbnail: thumbnailUrl,
      mime: selected.mime,
      width: selected.width,
      height: selected.height,
      bandwidth: selected.bandwidth,
      isTranscode: true,
    };
  }

  return { url: original.href, thumbnail: thumbnailUrl, mime: originalMime, isTranscode: false };
}

const ARCHIVE_ALLOWED_LICENSES = new Set([
  'https://creativecommons.org/publicdomain/mark/1.0/',
  'https://creativecommons.org/publicdomain/zero/1.0/',
  'https://creativecommons.org/licenses/by/4.0/',
  'https://creativecommons.org/licenses/by-sa/4.0/',
]);

/** Encode external IDs into the URL-safe ID shape accepted by LibreTV's detail route. */
export function encodeOpenMediaId(provider: OpenMediaProvider, externalId: string): string {
  return `om-${Buffer.from(`${provider}|${externalId}`, 'utf8').toString('base64url')}`;
}

export function decodeOpenMediaId(id: string): { provider: OpenMediaProvider; externalId: string } | null {
  if (!/^om-[\w-]+$/.test(id)) return null;
  try {
    const decoded = Buffer.from(id.slice(3), 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator < 1) return null;
    const provider = decoded.slice(0, separator);
    const externalId = decoded.slice(separator + 1);
    if (!externalId || !['archive', 'nasa', 'peertube', 'commons'].includes(provider)) return null;
    return { provider: provider as OpenMediaProvider, externalId };
  } catch {
    return null;
  }
}

/** Keep only explicit, reusable PeerTube declarations; unknown and All Rights Reserved are excluded. */
export function isAllowedPeerTubeLicence(licence: unknown): boolean {
  if (!licence || typeof licence !== 'object') return false;
  const id = Number((licence as { id?: unknown }).id);
  return [1, 2, 3, 7, 8].includes(id);
}

/** Archive.org rights metadata is uploader-supplied; only explicit open/public-domain claims pass. */
export function isArchiveRightsAllowed(metadata: {
  rights?: unknown;
  licenseurl?: unknown;
}): boolean {
  const rawLicense = typeof metadata.licenseurl === 'string' ? metadata.licenseurl.trim() : '';
  const rights = typeof metadata.rights === 'string' ? metadata.rights.trim().toLowerCase().replace(/[.。]+$/g, '') : '';
  const clearlyUnrestricted = /^(?:not copyrighted|uncopyrighted|public domain(?: in the usa)?|no known copyright restrictions|no copyright restrictions)$/i.test(rights);
  if (!clearlyUnrestricted && /all rights reserved|copyrighted|copyright\s*(?:©|\(c\)|:|by\b|\d{4})|permission required|not for reuse|copyright status unknown/.test(rights)) return false;
  if (rawLicense) {
    try {
      const parsed = new URL(rawLicense);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== 'creativecommons.org') return false;
      const normalized = `https://creativecommons.org${parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`}`;
      return ARCHIVE_ALLOWED_LICENSES.has(normalized);
    } catch {
      return false;
    }
  }
  if (clearlyUnrestricted) return true;
  if (!rights) return false;
  return /public\s*domain|no known copyright restrictions/.test(rights);
}

/** Prefer small MP4 derivatives suitable for mobile playback; never select captions or thumbnails. */
export function selectArchiveVideoFile(files: ArchiveVideoFile[]): ArchiveVideoFile | null {
  const candidates = files.filter((file) => {
    const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
    const format = typeof file.format === 'string' ? file.format.toLowerCase() : '';
    return name.endsWith('.mp4') && (format.includes('mpeg4') || format.includes('h.264') || format.includes('mp4') || !format);
  });
  const withKnownDuration = candidates.filter((file) => parseMediaDurationSeconds(file.length) !== null);
  const verifiedFeatureFiles = withKnownDuration.filter((file) => isFeatureLengthMedia(parseMediaDurationSeconds(file.length)));
  // If the item contains both a short preview and a full film, never let a small preview win on size/resolution.
  const pool = verifiedFeatureFiles.length > 0
    ? verifiedFeatureFiles
    : withKnownDuration.length > 0
      ? withKnownDuration
      : candidates;
  const rank = (file: ArchiveVideoFile): number => {
    const name = (file.name || '').toLowerCase();
    if (name.includes('~mobile')) return 0;
    if (/640x480|480p|512kb/.test(name)) return 1;
    if (/720p|1280x720/.test(name)) return 2;
    const size = Number(file.size || 0);
    if (size > 0 && size <= 250 * 1024 * 1024) return 3;
    return 4;
  };
  return pool.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** NASA manifests contain mixed media; select an official NASA MP4 and prefer the mobile derivative. */
export function selectNasaVideoUrl(urls: string[]): string | null {
  const candidates = urls
    .map(normalizeNasaAssetUrl)
    .filter((url): url is string => url !== null && /\.mp4(?:$|\?)/i.test(url));
  const rank = (url: string): number => {
    if (/~mobile\.mp4(?:$|\?)/i.test(url)) return 0;
    if (/~medium\.mp4(?:$|\?)/i.test(url)) return 1;
    if (/~small\.mp4(?:$|\?)/i.test(url)) return 2;
    if (/~large\.mp4(?:$|\?)/i.test(url)) return 3;
    if (/~orig\.mp4(?:$|\?)/i.test(url)) return 4;
    return 5;
  };
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Reject private/local media URLs returned by federated instances before exposing them to browsers. */
export function normalizePeerTubeMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const rawHostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const hostname = rawHostname.replace(/\.+$/, '');
    if (url.protocol !== 'https:' || url.username || url.password
      || hostname === 'localhost' || hostname.endsWith('.localhost')
      || hostname.endsWith('.local') || hostname.endsWith('.internal')
      || hostname.endsWith('.test') || hostname.endsWith('.invalid')
      || isPrivateIP(hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** PeerTube exposes HLS playlists and direct files on the detail endpoint. */
export function selectPeerTubeStreamUrl(video: {
  streamingPlaylists?: Array<{ playlistUrl?: unknown }>;
  files?: Array<{ fileUrl?: unknown; resolution?: { id?: unknown } }>;
}): string | null {
  const playlist = video.streamingPlaylists?.map((item) => normalizePeerTubeMediaUrl(item.playlistUrl))
    .find((url): url is string => url !== null);
  if (playlist) return playlist;

  const files = (video.files ?? []).flatMap((item) => {
    const fileUrl = normalizePeerTubeMediaUrl(item.fileUrl);
    return fileUrl ? [{ ...item, fileUrl }] : [];
  });
  const rank = (item: { resolution?: { id?: unknown } }): number => {
    const resolution = Number(item.resolution?.id || 0);
    if (resolution === 480) return 0;
    if (resolution === 720) return 1;
    if (resolution > 0) return 2;
    return 3;
  };
  files.sort((a, b) => rank(a) - rank(b));
  return typeof files[0]?.fileUrl === 'string' ? files[0].fileUrl : null;
}

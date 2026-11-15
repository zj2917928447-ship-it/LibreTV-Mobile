import { Buffer } from 'node:buffer';

export type OpenMediaProvider = 'archive' | 'nasa' | 'peertube' | 'commons';

const SEARCH_STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at']);
const ADULT_MEDIA_PATTERN = /\b(?:porn(?:ography)?|erotic|xxx|hentai|adult\s+(?:film|video|content)|sexually\s+explicit|nudity|nude\s+(?:film|video)|striptease|onlyfans)\b|色情|情色|成人视频|成人影片|裸露|裸体|福利片|伦理片/i;
const CONTRADICTORY_RIGHTS_PATTERN = /all rights reserved|copyright\s*(?:©|\(c\)|:|by\b)|©\s*\d{4}/i;

/** Reject obviously adult material even when an uploader labels it public domain. */
export function isOpenMediaAdult(title: string, description = ''): boolean {
  return ADULT_MEDIA_PATTERN.test(`${title} ${description}`);
}

/** Reject contradictory copyright claims in descriptive metadata even if licence fields disagree. */
export function hasContradictoryCopyrightClaim(description: string): boolean {
  return CONTRADICTORY_RIGHTS_PATTERN.test(description);
}

/**
 * Keep search results relevant to the requested title. For queries containing common
 * stop-words (e.g. "The General"), require a contiguous title phrase and reject a
 * following unrelated word such as "Index". Year suffixes and subtitle separators pass.
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
  if (queryWords.length === 0 || titleWords.length === 0) return false;
  if (queryWords.some((word) => SEARCH_STOP_WORDS.has(word))) {
    for (let i = 0; i <= titleWords.length - queryWords.length; i++) {
      if (!queryWords.every((word, offset) => titleWords[i + offset] === word)) continue;
      const next = titleWords[i + queryWords.length];
      if (!next || /^\d{4}$/.test(next) || next === 'the' || next === 'a' || next === 'an') return true;
    }
    return false;
  }
  return queryWords.every((word) => titleWords.includes(word));
}

export interface ArchiveVideoFile {
  name?: string;
  format?: string;
  size?: string | number;
}

export interface NasaAssetManifest {
  collection?: { items?: Array<{ href?: unknown }> };
}

export function hasExplicitCopyright(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  return Boolean(text) && !['false', 'no', 'none', 'n/a', 'na', '0', 'not copyrighted'].includes(text);
}

/** NASA /asset returns collection.items[].href, not a bare string array. */
export function extractNasaAssetUrls(manifest: NasaAssetManifest): string[] {
  return (manifest.collection?.items ?? [])
    .map((item) => item.href)
    .filter((href): href is string => typeof href === 'string' && (href.startsWith('https://') || href.startsWith('http://')))
    .map((href) => href.replace(/^http:/i, 'https:'));
}

export interface CommonsLicenseMetadata {
  LicenseShortName?: unknown;
  LicenseUrl?: unknown;
  UsageTerms?: unknown;
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

export interface CommonsVideoInfo {
  url?: unknown;
  thumburl?: unknown;
  mime?: unknown;
  descriptionurl?: unknown;
  extmetadata?: CommonsLicenseMetadata;
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

/** Return only HTTPS files hosted by Wikimedia's official upload CDN and encoded as video. */
export function selectCommonsVideoFile(info?: CommonsVideoInfo): { url: string; thumbnail?: string; mime: string } | null {
  if (!info || typeof info.url !== 'string' || typeof info.mime !== 'string') return null;
  if (!['video/mp4', 'video/webm', 'video/ogg'].includes(info.mime.toLowerCase())) return null;
  try {
    const url = new URL(info.url);
    if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org') return null;
    const thumbnail = typeof info.thumburl === 'string' ? new URL(info.thumburl) : null;
    const allowedThumbnailHost = thumbnail?.hostname === 'upload.wikimedia.org' || thumbnail?.hostname === 'thumb.wikimedia.org';
    return {
      url: url.href,
      thumbnail: thumbnail?.protocol === 'https:' && allowedThumbnailHost ? thumbnail.href : undefined,
      mime: info.mime.toLowerCase(),
    };
  } catch {
    return null;
  }
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
  const license = typeof metadata.licenseurl === 'string' ? metadata.licenseurl.trim() : '';
  const rights = typeof metadata.rights === 'string' ? metadata.rights.trim().toLowerCase() : '';
  if (/all rights reserved|copyrighted|permission required|not for reuse|copyright status unknown/.test(rights)) return false;
  if (license) return ARCHIVE_ALLOWED_LICENSES.has(license);
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
  const rank = (file: ArchiveVideoFile): number => {
    const name = (file.name || '').toLowerCase();
    if (name.includes('~mobile')) return 0;
    if (/640x480|480p|512kb/.test(name)) return 1;
    if (/720p|1280x720/.test(name)) return 2;
    const size = Number(file.size || 0);
    if (size > 0 && size <= 250 * 1024 * 1024) return 3;
    return 4;
  };
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** NASA manifests contain mixed media; select an MP4 and prefer the mobile derivative. */
export function selectNasaVideoUrl(urls: string[]): string | null {
  const candidates = urls
    .filter((url) => /^https?:\/\//i.test(url) && /\.mp4(?:$|\?)/i.test(url))
    .map((url) => url.replace(/^http:/i, 'https:'));
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

/** PeerTube exposes HLS playlists and direct files on the detail endpoint. */
export function selectPeerTubeStreamUrl(video: {
  streamingPlaylists?: Array<{ playlistUrl?: unknown }>;
  files?: Array<{ fileUrl?: unknown; resolution?: { id?: unknown } }>;
}): string | null {
  const playlist = video.streamingPlaylists?.find(
    (item) => typeof item.playlistUrl === 'string' && /^https:\/\//i.test(item.playlistUrl)
  )?.playlistUrl;
  if (typeof playlist === 'string') return playlist;

  const files = (video.files ?? []).filter(
    (item) => typeof item.fileUrl === 'string' && /^https:\/\//i.test(item.fileUrl)
  );
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

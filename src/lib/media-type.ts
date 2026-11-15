export type DownloadFormat = 'TS' | 'MP4' | 'WEBM' | 'OGV';

const DIRECT_MEDIA_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'ogv', 'ogg']);

/**
 * Read the media extension from a direct URL or LibreTV's same-origin proxy URL.
 * ArtPlayer's own extension detection strips query/hash strings, so mirror that
 * behavior while also unwrapping /api/proxy?url=... for retries and saved tasks.
 */
export function getMediaExtension(rawUrl: string, depth = 0): string {
  const value = rawUrl.trim();
  if (!value || depth > 3) return '';

  try {
    const parsed = new URL(value, 'https://libretv.invalid');
    const isProxyPath = parsed.pathname === '/api/proxy' || parsed.pathname.startsWith('/api/proxy/');
    const isDownloadPath = parsed.pathname === '/api/download';
    const nestedUrl = isProxyPath || isDownloadPath ? parsed.searchParams.get('url') : null;
    if (nestedUrl) return getMediaExtension(nestedUrl, depth + 1);

    const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
    return pathname.match(/\.([a-z0-9]{2,5})$/)?.[1] ?? '';
  } catch {
    const path = value.split(/[?#]/, 1)[0].toLowerCase();
    return path.match(/\.([a-z0-9]{2,5})$/)?.[1] ?? '';
  }
}

/** Explicit HLS detection; unknown extensions retain the app's legacy HLS fallback. */
export function isHlsMediaUrl(url: string): boolean {
  return getMediaExtension(url) === 'm3u8';
}

/** Direct files are assigned to the native HTMLVideoElement instead of hls.js. */
export function isDirectMediaUrl(url: string): boolean {
  return DIRECT_MEDIA_EXTENSIONS.has(getMediaExtension(url));
}

/** ArtPlayer infers native file types from the URL when type is the empty string. */
export function getArtPlayerMediaType(url: string): 'm3u8' | '' {
  return isDirectMediaUrl(url) ? '' : 'm3u8';
}

/** HLS downloads are remuxed to MP4 by default; direct files keep their source container. */
export function getDownloadFormat(url: string): DownloadFormat {
  const extension = getMediaExtension(url);
  if (extension === 'webm') return 'WEBM';
  if (extension === 'ogv' || extension === 'ogg') return 'OGV';
  return 'MP4';
}

/** Direct files download through a same-origin streaming route, not fetch -> Blob. */
export function getDownloadUrl(url: string, title: string): string {
  if (!isDirectMediaUrl(url)) return url;
  const extension = getMediaExtension(url);
  return `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(`${title}.${extension}`)}`;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

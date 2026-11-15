const INVALID_FILENAME_CHARS = /[\u0000-\u001f\u007f\\/:*?"<>|]+/g;

export function sanitizeDownloadFilename(value: string): string {
  const cleaned = value.normalize('NFKC')
    .replace(INVALID_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 160);
  return cleaned || 'video';
}

export function buildDownloadContentDisposition(value: string): string {
  const filename = sanitizeDownloadFilename(value);
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_').slice(0, 120) || 'video';
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase()
  );
  return 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + encoded;
}

/** Only accept bounded public HTTP(S) URLs without embedded credentials. DNS/IP checks run separately. */
export function isSafeDownloadTarget(value: string): boolean {
  if (!value || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isDownloadableVideoContentType(contentType: string): boolean {
  const type = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!type) return true;
  if (type === 'text/html' || type === 'application/json' || type.includes('mpegurl') ||
      type === 'text/plain' || type === 'application/xml' || type === 'text/xml') return false;
  return type.startsWith('video/') || type === 'application/octet-stream' ||
    type === 'application/mp4' || type === 'application/ogg' || type === 'application/webm';
}

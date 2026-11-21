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
  if (!type) return false;
  if (type === 'text/html' || type === 'application/json' || type.includes('mpegurl') ||
      type === 'text/plain' || type === 'application/xml' || type === 'text/xml') return false;
  return type.startsWith('video/') || type === 'application/octet-stream' ||
    type === 'application/mp4' || type === 'application/ogg' || type === 'application/webm';
}

/** Detect a direct media container without trusting the URL extension or response MIME. */
export function detectVideoFileContentType(bytes: Uint8Array): string | null {
  const ascii = (offset: number, value: string) => {
    if (bytes.length < offset + value.length) return false;
    for (let i = 0; i < value.length; i++) {
      if (bytes[offset + i] !== value.charCodeAt(i)) return false;
    }
    return true;
  };
  const uint32 = (offset: number) =>
    bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];

  // ISO Base Media / QuickTime (MP4, M4V, MOV): walk small leading boxes so a
  // legal `free`/`wide` atom before `ftyp` does not reject a valid video file.
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size = uint32(offset);
    const isFileTypeBox = ascii(offset + 4, 'ftyp') || ascii(offset + 4, 'styp');
    if (size === 0) break; // box extends to EOF; no following top-level box
    if (size === 1) {
      if (offset + 16 > bytes.length) break;
      const high = uint32(offset + 8);
      const low = uint32(offset + 12);
      const extendedSize = high * 0x100000000 + low;
      if (!Number.isSafeInteger(extendedSize) || extendedSize < 16) break;
      if (isFileTypeBox) return 'video/mp4';
      if (offset + extendedSize > bytes.length) break;
      offset += extendedSize;
      continue;
    }
    if (size >= 16 && isFileTypeBox) return 'video/mp4';
    if (size < 8 || offset + size > bytes.length) break;
    offset += size;
  }

  // Matroska / WebM EBML header, Ogg page header and Flash Video signature.
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  if (ascii(0, 'OggS')) return 'video/ogg';
  if (ascii(0, 'FLV')) return 'video/x-flv';
  // AVI is a RIFF container with the AVI form type at offset 8.
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'AVI ')) return 'video/x-msvideo';
  return null;
}

export function isLikelyVideoFileHeader(bytes: Uint8Array): boolean {
  return detectVideoFileContentType(bytes) !== null;
}

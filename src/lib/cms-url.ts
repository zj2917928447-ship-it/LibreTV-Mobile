import type { SourceConfig } from './types';

/** Normalize a public HTTP(S) URL and reject embedded credentials before server-side requests. */
export function normalizePublicHttpUrl(value: unknown, maxLength = 2048): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > maxLength) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Normalize untrusted client-supplied CMS source configuration before using it in API routes. */
export function normalizeCmsSourceConfig(value: unknown): SourceConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.key !== 'string' || typeof source.name !== 'string' || typeof source.url !== 'string') return null;
  const key = source.key.trim();
  const name = source.name.trim();
  const rawUrl = source.url.trim();
  if (!key || key.length > 128 || !name || name.length > 128 || !rawUrl || rawUrl.length > 2048) return null;

  const normalizedUrl = normalizePublicHttpUrl(rawUrl);
  if (!normalizedUrl) return null;
  const url = new URL(normalizedUrl);

  let detail: string | undefined;
  const rawDetail = typeof source.detail === 'string' ? source.detail.trim() : source.detail;
  if (rawDetail !== undefined && rawDetail !== null && rawDetail !== '') {
    if (typeof rawDetail !== 'string' || rawDetail.length > 2048) return null;
    try {
      const normalizedDetail = normalizePublicHttpUrl(rawDetail);
      if (!normalizedDetail) return null;
      detail = normalizedDetail;
    } catch {
      return null;
    }
  }

  return {
    key,
    name,
    url: url.href,
    ...(detail ? { detail } : {}),
    ...(typeof source.isAdult === 'boolean' ? { isAdult: source.isAdult } : {}),
  };
}

/** Build Apple CMS endpoints without discarding existing query-string credentials/options. */
export function buildCmsApiUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

/** Append the standard CMS HTML detail path while retaining query-string tokens on the root URL. */
export function buildCmsDetailPageUrl(rootUrl: string, id: string): string {
  const url = new URL(rootUrl);
  const rootPath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${rootPath}/index.php/vod/detail/id/${encodeURIComponent(id)}.html`;
  return url.href;
}

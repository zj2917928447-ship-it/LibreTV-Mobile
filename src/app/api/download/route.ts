import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchWithSafeRedirects } from '@/lib/fetch-utils';
import { buildDownloadContentDisposition, isDownloadableVideoContentType, isSafeDownloadTarget } from '@/lib/download-route';
import { isDirectMediaUrl } from '@/lib/media-type';
import { isBlockedByDNS, isValidProxyUrl } from '@/lib/ssrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADER_TIMEOUT_MS = 15_000;
const USER_AGENT =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36';

/**
 * Native browser download relay for MP4/WebM/OGV direct files.
 *
 * Unlike fetch -> Blob downloads, this pipes the upstream body straight to the
 * browser's download manager, so large files do not accumulate in Android memory.
 * Range headers are forwarded to support browser-managed resume where the source
 * advertises byte ranges. The response-header timeout ends once headers arrive;
 * the media body itself is not cut off by an 8-second API timeout.
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const requestUrl = new URL(req.url);
  const rawTarget = (requestUrl.searchParams.get('url') || '').trim();
  const filename = (requestUrl.searchParams.get('filename') || 'video').trim();

  if (!isSafeDownloadTarget(rawTarget) || !isValidProxyUrl(rawTarget) || !isDirectMediaUrl(rawTarget)) {
    return NextResponse.json({ error: '无效的直链视频下载地址' }, { status: 400 });
  }
  if (await isBlockedByDNS(rawTarget)) {
    return NextResponse.json({ error: '不允许访问私有或保留网络地址' }, { status: 403 });
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
  };
  const range = req.headers.get('range');
  if (range) headers.Range = range;

  try {
    const { res } = await fetchWithSafeRedirects(
      rawTarget,
      { headers, signal: req.signal },
      { headerTimeoutMs: HEADER_TIMEOUT_MS }
    );

    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return NextResponse.json(
        { error: `视频源返回 HTTP ${res.status}` },
        { status: res.status >= 400 && res.status <= 599 ? res.status : 502 }
      );
    }

    const contentType = res.headers.get('content-type') || '';
    if (!isDownloadableVideoContentType(contentType)) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return NextResponse.json({ error: '视频源返回的不是可下载的视频文件' }, { status: 415 });
    }
    if (!res.body) {
      return NextResponse.json({ error: '视频源没有返回文件内容' }, { status: 502 });
    }

    const outputHeaders = new Headers({
      'Content-Disposition': buildDownloadContentDisposition(filename),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['content-type', 'accept-ranges', 'content-range', 'etag', 'last-modified']) {
      const value = res.headers.get(name);
      if (value) outputHeaders.set(name, value);
    }
    // fetch may transparently decompress encoded responses. Preserve Content-Length
    // only when no content-encoding was applied, otherwise it would be incorrect.
    if (!res.headers.get('content-encoding')) {
      const length = res.headers.get('content-length');
      if (length) outputHeaders.set('Content-Length', length);
    }

    return new NextResponse(res.body, {
      status: res.status,
      headers: outputHeaders,
    });
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: `视频下载中转失败：${message}` }, { status: 502 });
  }
}

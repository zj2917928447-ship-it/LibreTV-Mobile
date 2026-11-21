import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchWithSafeRedirects } from '@/lib/fetch-utils';
import {
  buildDownloadContentDisposition,
  detectVideoFileContentType,
  isDownloadableVideoContentType,
  isSafeDownloadTarget,
} from '@/lib/download-route';
import { isDirectMediaUrl } from '@/lib/media-type';
import { isBlockedByDNS, isValidProxyUrl } from '@/lib/ssrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADER_TIMEOUT_MS = 15_000;
const USER_AGENT =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36';
const VIDEO_SIGNATURE_BYTES = 64;
const VIDEO_SIGNATURE_TIMEOUT_MS = 5_000;

async function readPrefixChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('下载已取消', 'AbortError');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DOMException('等待视频文件头超时', 'TimeoutError')), timeoutMs);
    if (signal) {
      onAbort = () => reject(signal.reason ?? new DOMException('下载已取消', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([reader.read(), interrupted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

/** Read a small prefix under a short deadline, then rebuild a streaming body without buffering the file. */
async function inspectVideoStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<{
  contentType: string | null;
  stream: ReadableStream<Uint8Array>;
}> {
  const reader = body.getReader();
  const buffered: Uint8Array[] = [];
  const prefix = new Uint8Array(VIDEO_SIGNATURE_BYTES);
  let prefixLength = 0;
  const deadline = Date.now() + VIDEO_SIGNATURE_TIMEOUT_MS;

  try {
    while (prefixLength < VIDEO_SIGNATURE_BYTES) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new DOMException('等待视频文件头超时', 'TimeoutError');
      const { done, value } = await readPrefixChunk(reader, remainingMs, signal);
      if (done) break;
      buffered.push(value);
      const length = Math.min(value.byteLength, VIDEO_SIGNATURE_BYTES - prefixLength);
      prefix.set(value.subarray(0, length), prefixLength);
      prefixLength += length;
    }

    const contentType = detectVideoFileContentType(prefix.subarray(0, prefixLength));
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const first = buffered.shift();
        if (first) {
          controller.enqueue(first);
          return;
        }
        try {
          const result = await reader.read();
          if (result.done) {
            controller.close();
            reader.releaseLock();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          controller.error(error);
          try { reader.releaseLock(); } catch { /* ignore */ }
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
    return { contentType, stream };
  } catch (error) {
    try { await reader.cancel(error); } catch { /* ignore */ }
    throw error;
  }
}

function getRangeStart(requestRange: string | null, contentRange: string | null): number | null {
  const responseMatch = contentRange?.match(/^bytes\s+(\d+)-/i);
  if (responseMatch) return Number(responseMatch[1]);
  const requestMatch = requestRange?.match(/^bytes=(\d+)-/i);
  if (requestMatch) return Number(requestMatch[1]);
  // Suffix ranges (bytes=-500) start at an origin-dependent offset; probe byte zero.
  if (requestRange && /^bytes=-\d+$/i.test(requestRange.trim())) return null;
  return 0;
}

function isShortZeroRange(requestRange: string | null, contentRange: string | null): boolean {
  const responseMatch = contentRange?.match(/^bytes\s+0-(\d+)\//i);
  if (responseMatch) return Number(responseMatch[1]) + 1 < VIDEO_SIGNATURE_BYTES;
  const requestMatch = requestRange?.match(/^bytes=0-(\d+)/i);
  return requestMatch ? Number(requestMatch[1]) + 1 < VIDEO_SIGNATURE_BYTES : false;
}

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

  if (rawTarget.length > 8192 || !isSafeDownloadTarget(rawTarget) || !isValidProxyUrl(rawTarget) || !isDirectMediaUrl(rawTarget)) {
    return NextResponse.json({ error: '无效的直链视频下载地址' }, { status: 400 });
  }
  if (await isBlockedByDNS(rawTarget)) {
    return NextResponse.json({ error: '不允许访问私有或保留网络地址' }, { status: 403 });
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
  };
  const rawRange = req.headers.get('range');
  // Multipart ranges would return multipart/byteranges, not a video container. The browser
  // download path only needs one range for resume; ignore malformed/multi-range requests.
  const range = rawRange && /^bytes=(?:\d+-\d*|-\d+)$/i.test(rawRange.trim())
    ? rawRange.trim()
    : null;
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

    let contentType = res.headers.get('content-type') || '';
    if (contentType.trim() && !isDownloadableVideoContentType(contentType)) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return NextResponse.json({ error: '视频源返回的不是可下载的视频文件' }, { status: 415 });
    }
    if (!res.body) {
      return NextResponse.json({ error: '视频源没有返回文件内容' }, { status: 502 });
    }

    let outputBody: ReadableStream<Uint8Array> = res.body;
    const rangeStart = getRangeStart(range, res.headers.get('content-range'));
    let detectedContentType: string | null = null;
    if (rangeStart === 0) {
      const inspected = await inspectVideoStream(res.body, req.signal);
      detectedContentType = inspected.contentType;
      outputBody = inspected.stream;
    }

    // A resumed range (or a tiny 0-based range) may not contain enough bytes to
    // identify the container. Probe only the first 64 bytes through the same redirect +
    // SSRF checks; the requested response body remains untouched for the download.
    if (!detectedContentType && (rangeStart !== 0 || isShortZeroRange(range, res.headers.get('content-range')))) {
      try {
        const probe = await fetchWithSafeRedirects(
          rawTarget,
          { headers: { ...headers, Range: `bytes=0-${VIDEO_SIGNATURE_BYTES - 1}` }, signal: req.signal },
          { headerTimeoutMs: HEADER_TIMEOUT_MS }
        );
        if (probe.res.body) {
          const inspected = await inspectVideoStream(probe.res.body, req.signal);
          detectedContentType = probe.res.ok ? inspected.contentType : null;
          try { await inspected.stream.cancel(); } catch { /* ignore */ }
        }
      } catch (error) {
        try { await outputBody.cancel(); } catch { /* ignore */ }
        throw error;
      }
    }

    if (!detectedContentType) {
      try { await outputBody.cancel(); } catch { /* ignore */ }
      return NextResponse.json({ error: '视频源未返回可识别的视频文件内容' }, { status: 415 });
    }
    contentType = detectedContentType;

    const outputHeaders = new Headers({
      'Content-Disposition': buildDownloadContentDisposition(filename),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['content-type', 'accept-ranges', 'content-range', 'etag', 'last-modified']) {
      const value = res.headers.get(name);
      if (value) outputHeaders.set(name, value);
    }
    outputHeaders.set('Content-Type', contentType);
    // fetch may transparently decompress encoded responses. Preserve Content-Length
    // only when no content-encoding was applied, otherwise it would be incorrect.
    if (!res.headers.get('content-encoding')) {
      const length = res.headers.get('content-length');
      if (length) outputHeaders.set('Content-Length', length);
    }

    return new NextResponse(outputBody, {
      status: res.status,
      headers: outputHeaders,
    });
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: `视频下载中转失败：${message}` }, { status: 502 });
  }
}

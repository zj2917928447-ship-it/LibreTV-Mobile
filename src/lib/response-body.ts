import { parseCmsXmlPayload } from './cms-parser';

/** Bounded readers for untrusted upstream response bodies. */
export class ResponseBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`上游响应体超过 ${maxBytes} 字节上限`);
    this.name = 'ResponseBodyTooLargeError';
  }
}

/** Read a response stream with a hard byte ceiling, including when Content-Length is absent or false. */
export async function readResponseBytesLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    try { await response.body?.cancel(); } catch { /* ignore */ }
    throw new ResponseBodyTooLargeError(maxBytes);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ResponseBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(error); } catch { /* ignore */ }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  const bytes = await readResponseBytesLimited(response, maxBytes);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function readResponseJsonLimited<T = unknown>(response: Response, maxBytes: number): Promise<T> {
  return JSON.parse(await readResponseTextLimited(response, maxBytes)) as T;
}

/** 同时兼容 Apple CMS JSON 与 Maccms/SeaCMS `<rss><list><video>` XML 响应的有界解析器 */
export async function readCmsPayloadLimited<T = unknown>(response: Response, maxBytes: number): Promise<T> {
  const text = await readResponseTextLimited(response, maxBytes);
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!DOCTYPE[\s\S]*?>\s*)?<(?:rss|list)\b/i.test(trimmed)) {
    return parseCmsXmlPayload(trimmed) as T;
  }
  return JSON.parse(text) as T;
}

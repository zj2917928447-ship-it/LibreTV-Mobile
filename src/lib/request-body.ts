export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`请求体超过 ${maxBytes} 字节上限`);
    this.name = 'RequestBodyTooLargeError';
  }
}

/** Read a request body with a hard byte ceiling, even when Content-Length is absent or false. */
export async function readRequestBytesLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }

  const contentLength = req.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes);
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

/** Parse bounded UTF-8 JSON without first buffering an unbounded request body. */
export async function readJsonBodyLimited<T = unknown>(req: Request, maxBytes: number): Promise<T> {
  const bytes = await readRequestBytesLimited(req, maxBytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as T;
}

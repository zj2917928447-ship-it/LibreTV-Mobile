import { describe, expect, it } from 'vitest';
import {
  readResponseBytesLimited,
  readResponseJsonLimited,
  readResponseTextLimited,
  ResponseBodyTooLargeError,
} from './response-body';

describe('bounded upstream response readers', () => {
  it('parses bounded UTF-8 JSON and text responses', async () => {
    const json = new Response(JSON.stringify({ title: '测试影片' }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    await expect(readResponseJsonLimited(json, 1024)).resolves.toEqual({ title: '测试影片' });

    const text = new Response('频道一\nhttps://example.com/live.m3u8');
    await expect(readResponseTextLimited(text, 1024)).resolves.toContain('频道一');
  });

  it('rejects Content-Length over the limit and cancels the stream before reading', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancelled = true; },
    });
    const response = new Response(body, { headers: { 'content-length': '4096' } });

    await expect(readResponseBytesLimited(response, 8)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
    expect(cancelled).toBe(true);
  });

  it('enforces the byte limit when Content-Length is absent or lies', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(9)); },
      cancel() { cancelled = true; },
    });
    const response = new Response(body, { headers: { 'content-length': '1' } });

    await expect(readResponseBytesLimited(response, 8)).rejects.toMatchObject({
      name: 'ResponseBodyTooLargeError',
      maxBytes: 8,
    });
    expect(cancelled).toBe(true);
  });

  it('returns empty bytes for a bodyless response and rejects malformed JSON', async () => {
    await expect(readResponseBytesLimited(new Response(null), 0)).resolves.toEqual(new Uint8Array());
    await expect(readResponseJsonLimited(new Response('{'), 16)).rejects.toThrow();
  });
});

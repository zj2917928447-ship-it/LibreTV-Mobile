import { describe, expect, it } from 'vitest';
import { readJsonBodyLimited, RequestBodyTooLargeError } from './request-body';

describe('bounded request body parsing', () => {
  it('parses valid UTF-8 JSON within the byte limit', async () => {
    const request = new Request('https://app.example/api', {
      method: 'POST',
      body: JSON.stringify({ title: '中文', count: 2 }),
    });
    await expect(readJsonBodyLimited(request, 128)).resolves.toEqual({ title: '中文', count: 2 });
  });

  it('rejects an oversized declared Content-Length before reading the body', async () => {
    const request = new Request('https://app.example/api', {
      method: 'POST',
      headers: { 'Content-Length': '4096' },
      body: '{}',
    });
    await expect(readJsonBodyLimited(request, 32)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it('enforces the limit against actual streamed bytes when Content-Length is absent', async () => {
    const request = new Request('https://app.example/api', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(256) }),
    });
    await expect(readJsonBodyLimited(request, 32)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it('rejects malformed JSON and invalid UTF-8', async () => {
    const malformed = new Request('https://app.example/api', { method: 'POST', body: '{' });
    await expect(readJsonBodyLimited(malformed, 32)).rejects.toThrow();

    const invalidUtf8 = new Request('https://app.example/api', {
      method: 'POST',
      body: new Uint8Array([0xff, 0xfe, 0xfd]),
    });
    await expect(readJsonBodyLimited(invalidUtf8, 32)).rejects.toThrow();
  });
});

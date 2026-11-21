import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/auth request limits', () => {
  beforeEach(() => {
    process.env.PASSWORD = 'test-password';
    delete process.env.PROXY_SECRET;
  });

  afterEach(() => {
    delete process.env.PASSWORD;
    delete process.env.PROXY_SECRET;
  });

  it('rejects oversized login payloads before hashing the supplied password', async () => {
    const request = new Request('https://app.example/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(9000) }),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ success: false, error: '登录请求体过大' });
  });
});

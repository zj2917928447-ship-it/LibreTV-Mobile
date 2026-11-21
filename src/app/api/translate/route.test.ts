import { beforeEach, describe, expect, it, vi } from 'vitest';

const { translateLinesToChinese } = vi.hoisted(() => ({
  translateLinesToChinese: vi.fn(),
}));

vi.mock('@/lib/translator', () => ({ translateLinesToChinese }));

import { POST } from './route';

describe('POST /api/translate', () => {
  beforeEach(() => {
    translateLinesToChinese.mockReset();
  });

  it('rejects cross-origin requests to prevent open translation abuse', async () => {
    const req = new Request('https://app.example/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ lines: ['Hello'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(translateLinesToChinese).not.toHaveBeenCalled();
  });

  it('translates valid same-origin subtitle batches and rejects oversized line arrays', async () => {
    translateLinesToChinese.mockResolvedValue({
      translations: ['你好，世界'],
      translatedCount: 1,
    });

    const okReq = new Request('https://app.example/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://app.example',
      },
      body: JSON.stringify({ lines: ['Hello world'] }),
    });
    const okRes = await POST(okReq);
    expect(okRes.status).toBe(200);
    await expect(okRes.json()).resolves.toEqual({
      translations: ['你好，世界'],
      translatedCount: 1,
    });

    const tooManyReq = new Request('https://app.example/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://app.example',
      },
      body: JSON.stringify({ lines: Array.from({ length: 55 }, () => 'line') }),
    });
    expect((await POST(tooManyReq)).status).toBe(400);
  });
});

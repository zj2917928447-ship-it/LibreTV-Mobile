import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUpstream, checkUpstreamAllowed, parseSearchList } = vi.hoisted(() => ({
  fetchUpstream: vi.fn(),
  checkUpstreamAllowed: vi.fn(),
  parseSearchList: vi.fn(),
}));

vi.mock('@/lib/api-guard', () => ({
  guardRequest: vi.fn(() => null),
}));

vi.mock('@/lib/ssrf', () => ({
  checkUpstreamAllowed,
}));

vi.mock('@/lib/fetch-utils', () => ({
  fetchUpstream,
}));

vi.mock('@/lib/cms-parser', () => ({
  parseSearchList,
}));

import { POST } from './route';

function request(body: unknown): Request {
  return new Request('https://app.example/api/source/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/source/test', () => {
  beforeEach(() => {
    fetchUpstream.mockReset();
    checkUpstreamAllowed.mockReset();
    parseSearchList.mockReset();
    checkUpstreamAllowed.mockResolvedValue({ ok: true });
    fetchUpstream.mockImplementation(async () => new Response('{}', { status: 200 }));
    parseSearchList.mockReturnValue([]);
  });

  it.each([null, [], { url: 123 }, { url: 'file:///etc/passwd' }, { url: 'https://user:pass@cms.example/api.php' }])(
    'rejects malformed or credential-bearing source URLs before any upstream request',
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(checkUpstreamAllowed).not.toHaveBeenCalled();
      expect(fetchUpstream).not.toHaveBeenCalled();
    }
  );

  it('rejects oversized source-test requests before validating or probing the URL', async () => {
    const response = await POST(new Request('https://app.example/api/source/test', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://cms.example/' + 'x'.repeat(9000) }),
    }));

    expect(response.status).toBe(413);
    expect(checkUpstreamAllowed).not.toHaveBeenCalled();
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('preserves existing query-string credentials when probing an Apple CMS source', async () => {
    const response = await POST(request({
      url: 'https://cms.example/api.php?token=secret&client=mobile',
    }));

    expect(response.status).toBe(200);
    const requested = new URL(fetchUpstream.mock.calls[0][0] as string);
    expect(requested.searchParams.get('token')).toBe('secret');
    expect(requested.searchParams.get('client')).toBe('mobile');
    expect(requested.searchParams.get('ac')).toBe('videolist');
    expect(requested.searchParams.get('wd')).toBe('test');
  });

  it('falls back to ac=videolist&pg=1 when a Chinese CMS returns 0 items for wd=test', async () => {
    parseSearchList
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ vod_id: '101', vod_name: '蜘蛛侠：纵横宇宙' }]);

    const response = await POST(request({
      url: 'https://cms.example/api.php/provide/vod/',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
    const fallbackUrl = new URL(fetchUpstream.mock.calls[1][0] as string);
    expect(fallbackUrl.searchParams.get('ac')).toBe('videolist');
    expect(fallbackUrl.searchParams.get('pg')).toBe('1');
  });
});

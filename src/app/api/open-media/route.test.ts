import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUpstreamJson, getCache, setCache } = vi.hoisted(() => ({
  fetchUpstreamJson: vi.fn(),
  getCache: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock('@/lib/fetch-utils', () => ({
  fetchUpstreamJson,
  getCache,
  setCache,
}));

import { GET } from './route';
import { encodeOpenMediaId } from '@/lib/open-media';

describe('GET /api/open-media Commons mobile transcodes', () => {
  beforeEach(() => {
    fetchUpstreamJson.mockReset();
    getCache.mockReset();
    setCache.mockReset();
    getCache.mockReturnValue(undefined);
  });

  it('requests MediaWiki videoinfo derivatives and returns the mobile-sized transcode', async () => {
    fetchUpstreamJson.mockResolvedValue({
      query: {
        pages: [{
          pageid: 33073725,
          title: 'File:The General (1926).webm',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/e/ee/The_General_%281926%29.webm',
            mime: 'video/webm',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:The_General_(1926).webm',
            extmetadata: {
              LicenseShortName: { value: 'Public domain' },
              Copyrighted: { value: 'False' },
              Artist: { value: 'Unknown' },
              ImageDescription: { value: 'Silent film from 1926.' },
            },
          }],
          videoinfo: [{
            derivatives: [
              {
                src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/e/ee/The_General_%281926%29.webm/The_General_%281926%29.webm.240p.vp9.webm',
                type: 'video/webm; codecs="vp9, opus"',
                width: 320,
                height: 240,
                bandwidth: 288112,
              },
              {
                src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/e/ee/The_General_%281926%29.webm/The_General_%281926%29.webm.480p.vp9.webm',
                type: 'video/webm; codecs="vp9, opus"',
                width: 640,
                height: 480,
                bandwidth: 1010328,
              },
              {
                src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/e/ee/The_General_%281926%29.webm/The_General_%281926%29.webm.3x1080p.vp9.mpd',
                type: 'application/dash+xml',
                width: 1440,
                height: 1080,
                bandwidth: -1,
              },
            ],
          }],
        }],
      },
    });

    const id = encodeOpenMediaId('commons', '33073725');
    const response = await GET(new Request(`https://app.example/api/open-media?ac=videolist&ids=${id}`));
    const body = await response.json() as { list?: Array<{ vod_play_url?: string; vod_content?: string }> };
    const detail = body.list?.[0];

    expect(response.status).toBe(200);
    expect(detail?.vod_play_url).toContain('.240p.vp9.webm');
    expect(detail?.vod_play_url).not.toContain('.webm?');
    expect(detail?.vod_content).toContain('手机优先转码：240p');
    expect(fetchUpstreamJson).toHaveBeenCalledTimes(1);

    const requestedUrl = new URL(fetchUpstreamJson.mock.calls[0][0] as string);
    expect(requestedUrl.searchParams.get('prop')).toBe('imageinfo|videoinfo');
    expect(requestedUrl.searchParams.get('viprop')).toBe('derivatives');
  });
});

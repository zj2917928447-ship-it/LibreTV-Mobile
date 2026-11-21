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

const peerTubeVideo = (name: string, duration: number, description = 'Feature-length film.') => ({
  uuid: duration === 228 ? '92f94629-54b2-4601-82f3-03d2fdcbf878' : duration === 3600 ? 'a2f94629-54b2-4601-82f3-03d2fdcbf878' : 'b2f94629-54b2-4601-82f3-03d2fdcbf878',
  name,
  description,
  duration,
  thumbnailUrl: 'https://spectra.video/static/thumbnails/video.jpg',
  account: { host: 'spectra.video', displayName: 'Test channel' },
  licence: { id: 1, label: 'CC BY 4.0' },
  publishedAt: '2020-01-01T00:00:00.000Z',
});

const commonsVideo = (title: string, duration: number, description: string) => ({
  pageid: duration === 228 ? 1001 : 1002,
  title: 'File:' + title,
  imageinfo: [{
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/' + title.replaceAll(' ', '_') + '.webm',
    mime: 'video/webm',
    thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/a/ab/thumb.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(title),
    extmetadata: {
      LicenseShortName: { value: 'Public domain' },
      Copyrighted: { value: 'False' },
      Artist: { value: 'Public domain archive' },
      ImageDescription: { value: description },
    },
  }],
  videoinfo: [{
    duration,
    size: 1024 * 1024 * 100,
    derivatives: [{
      src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/' + title.replaceAll(' ', '_') + '.webm/' + title.replaceAll(' ', '_') + '.240p.vp9.webm',
      type: 'video/webm; codecs="vp9, opus"',
      width: 320,
      height: 240,
      bandwidth: 288112,
    }],
  }],
});

describe('GET /api/open-media feature-film quality gate', () => {
  beforeEach(() => {
    fetchUpstreamJson.mockReset();
    getCache.mockReset();
    setCache.mockReset();
    getCache.mockReturnValue(undefined);
  });

  it('requests Commons videoinfo only and returns duration plus a mobile transcode', async () => {
    fetchUpstreamJson.mockResolvedValue({
      query: {
        pages: [{
          pageid: 33073725,
          title: 'File:The General (1926).webm',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/e/ee/The_General_%281926%29.webm',
            mime: 'video/webm',
            thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/general.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:The_General_(1926).webm',
            extmetadata: {
              LicenseShortName: { value: 'Public domain' },
              Copyrighted: { value: 'False' },
              Artist: { value: 'Unknown' },
              ImageDescription: { value: 'Silent feature film from 1926.' },
            },
          }],
          videoinfo: [{
            duration: 4551.713,
            size: 1089704550,
            derivatives: [
              {
                src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/e/ee/The_General.webm/The_General.webm.240p.vp9.webm',
                type: 'video/webm; codecs="vp9, opus"',
                width: 320,
                height: 240,
                bandwidth: 288112,
              },
              {
                src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/e/ee/The_General.webm/The_General.webm.480p.vp9.webm',
                type: 'video/webm; codecs="vp9, opus"',
                width: 640,
                height: 480,
                bandwidth: 1010328,
              },
            ],
          }],
        }],
      },
    });

    const id = encodeOpenMediaId('commons', '33073725');
    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&ids=' + id));
    const body = await response.json() as { list?: Array<{ vod_play_url?: string; vod_content?: string; vod_remarks?: string }> };
    const detail = body.list?.[0];
    expect(response.status).toBe(200);
    expect(detail?.vod_play_url).toContain('.240p.vp9.webm');
    expect(detail?.vod_content).toContain('手机优先转码：240p');
    expect(detail?.vod_content).toContain('片长：1:15:52');
    expect(detail?.vod_remarks).toContain('1:15:52');
    expect(fetchUpstreamJson).toHaveBeenCalledTimes(1);

    const requestedUrl = new URL(fetchUpstreamJson.mock.calls[0][0] as string);
    expect(requestedUrl.searchParams.get('prop')).toBe('imageinfo|videoinfo');
    expect(requestedUrl.searchParams.get('iiprop')).toBe('url|mime|extmetadata');
    expect(requestedUrl.searchParams.get('viprop')).toContain('derivatives');
    expect(requestedUrl.searchParams.get('viprop')).toContain('size');
  });

  it('filters short Commons music clips using actual MediaWiki duration metadata', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'commons.wikimedia.org') {
        return { query: { pages: [
          commonsVideo('Spider.webm', 228, 'Original song by Doctor Popular, performed on Nanoloop.'),
          commonsVideo('Spider-Man Feature Film.webm', 3600, 'A complete feature film.'),
        ] } };
      }
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=Spider'));
    const body = await response.json() as { list?: Array<{ vod_name?: string; vod_remarks?: string }> };
    const requested = fetchUpstreamJson.mock.calls
      .map(([input]) => new URL(input as string))
      .find((url) => url.hostname === 'commons.wikimedia.org');

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_name).toBe('Spider-Man Feature Film.webm');
    expect(body.list?.[0].vod_remarks).toContain('1:00:00');
    expect(requested?.searchParams.get('prop')).toBe('imageinfo|videoinfo');
    expect(requested?.searchParams.get('iiprop')).toBe('url|mime|extmetadata');
    expect(requested?.searchParams.get('viprop')).toContain('derivatives');
    expect(requested?.searchParams.get('viprop')).toContain('size');
  });

  it('uses Archive video files[].length as seconds, never files[].size as runtime, and accepts HTTP CC license URLs', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'archive.org' && url.pathname === '/advancedsearch.php') {
        return { response: { docs: [
          { identifier: 'spider-short-runtime', title: 'Spider', year: '2010' },
          { identifier: 'spider-size-only', title: 'Spider Archive', year: '2011' },
          { identifier: 'earth-vs-the-spider-1958', title: 'Earth Vs. The Spider', year: '1958' },
        ] } };
      }
      if (url.hostname === 'archive.org' && url.pathname.startsWith('/metadata/')) {
        const identifier = url.pathname.split('/').pop();
        if (identifier === 'spider-short-runtime') {
          return {
            metadata: { mediatype: 'movies', title: 'Spider', rights: 'Public Domain', runtime: '1:12:39', description: 'An archival motion picture from 2010.' },
            files: [{ name: 'spider.mp4', format: 'MPEG4', size: '708672423', length: '228' }],
          };
        }
        if (identifier === 'spider-size-only') {
          return {
            metadata: { mediatype: 'movies', title: 'Spider Archive', rights: 'Public Domain', description: 'An archival film.' },
            files: [{ name: 'spider-archive.mp4', format: 'MPEG4', size: '1089704550' }],
          };
        }
        return {
          metadata: { mediatype: 'movies', title: 'Earth Vs. The Spider', licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/', description: '1958 science-fiction feature film.' },
          files: [{ name: 'earth-vs-spider_640x480.mp4', format: 'MPEG4', length: '4359.4', size: '1089704550' }],
        };
      }
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=Spider'));
    const body = await response.json() as { list?: Array<{ vod_name?: string; vod_remarks?: string }> };
    const archiveSearch = fetchUpstreamJson.mock.calls
      .map(([input]) => new URL(input as string))
      .find((url) => url.hostname === 'archive.org' && url.pathname === '/advancedsearch.php');

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_name).toBe('Earth Vs. The Spider');
    expect(body.list?.[0].vod_remarks).toContain('1:12:39');
    expect(body.list?.[0].vod_remarks).toContain('Public Domain Mark 1.0');
    expect(archiveSearch?.searchParams.get('q')).toContain('http://creativecommons.org/publicdomain/mark/1.0/');
  });

  it('keeps same-title feature films from different providers so users can compare source and licence', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'archive.org' && url.pathname === '/advancedsearch.php') {
        return { response: { docs: [{ identifier: 'the-general-archive', title: 'The General (1926)', year: '1926', licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/' }] } };
      }
      if (url.hostname === 'archive.org' && url.pathname.startsWith('/metadata/')) {
        return {
          metadata: { mediatype: 'movies', title: 'The General (1926)', year: '1926', licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/', description: 'A silent feature film.' },
          files: [{ name: 'the-general.mp4', format: 'MPEG4', length: '4551.7', size: '400000000' }],
        };
      }
      if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/search') {
        return { collection: { items: [{ data: [{ nasa_id: 'NASA-GENERAL-001', title: 'The General (1926)', media_type: 'video', duration: 4551.7, date_created: '1926-01-01T00:00:00Z' }], links: [] }] } };
      }
      if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/asset/NASA-GENERAL-001') {
        return { collection: { items: [
          { href: 'https://images-assets.nasa.gov/video/NASA-GENERAL-001/NASA-GENERAL-001~mobile.mp4' },
          { href: 'https://images-assets.nasa.gov/video/NASA-GENERAL-001/metadata.json' },
        ] } };
      }
      if (url.hostname === 'images-assets.nasa.gov' && url.pathname.endsWith('/metadata.json')) return {};
      if (url.hostname === 'search.joinpeertube.org') return { data: [] };
      if (url.hostname === 'commons.wikimedia.org') return { query: { pages: [] } };
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=The%20General'));
    const body = await response.json() as { list?: Array<{ vod_name?: string; type_name?: string }> };

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(2);
    expect(body.list?.map((item) => item.type_name)).toEqual(expect.arrayContaining([
      'Internet Archive · 公共领域/CC',
      'NASA 影音资料（需核对单项权利）',
    ]));
  });

  it('returns Archive detail with the selected MP4 file runtime, not its byte size', async () => {
    fetchUpstreamJson.mockResolvedValue({
      metadata: {
        mediatype: 'movies',
        title: 'The General (complete & clearer) (1926) sub esp',
        licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/',
        description: 'A complete silent comedy feature film.',
      },
      files: [{ name: 'TheGeneralSubEsp.mp4', format: 'h.264', length: '4723.85', size: '412278845' }],
    });

    const id = encodeOpenMediaId('archive', 'TheGeneralcompleteClearer1926SubEsp');
    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&ids=' + id));
    const body = await response.json() as { list?: Array<{ vod_remarks?: string; vod_content?: string; vod_play_url?: string }> };

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_remarks).toContain('1:18:44');
    expect(body.list?.[0].vod_remarks).toContain('Public Domain Mark 1.0');
    expect(body.list?.[0].vod_content).toContain('来源：Internet Archive');
    expect(body.list?.[0].vod_play_url).toContain('TheGeneralSubEsp.mp4');
  });

  it('excludes short PeerTube music videos and VR experiences even when their title matches', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'search.joinpeertube.org') {
        return {
          data: [
            peerTubeVideo('Spider', 228, 'Original song by Doctor Popular, performed on Nanoloop for iOS.'),
            peerTubeVideo('Spider-Man: Far From Home - VR Experience (HTC Vive)', 3600, 'Virtual reality experience.'),
            peerTubeVideo('Spider-Man: Full Feature Film', 3600, 'A complete feature-length film.'),
          ],
        };
      }
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=Spider'));
    const body = await response.json() as { list?: Array<{ vod_name?: string; vod_remarks?: string }> };

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_name).toBe('Spider-Man: Full Feature Film');
    expect(body.list?.[0].vod_remarks).toContain('1:00:00');
  });

  it('rejects a direct PeerTube detail link when the upstream duration is only 3:48', async () => {
    fetchUpstreamJson.mockResolvedValue({
      name: 'Spider',
      description: 'Original song by Doctor Popular, performed on Nanoloop for iOS.',
      duration: 228,
      licence: { id: 1, label: 'CC BY 4.0' },
      streamingPlaylists: [{ playlistUrl: 'https://media.example/short.m3u8' }],
    });

    const id = encodeOpenMediaId('peertube', 'spectra.video|92f94629-54b2-4601-82f3-03d2fdcbf878');
    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&ids=' + id));
    const body = await response.json() as { list?: unknown[] };

    expect(response.status).toBe(200);
    expect(body.list).toEqual([]);
  });

  it('parses NASA TRT metadata and excludes short clips with no verified feature runtime', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/search') {
        return {
          collection: {
            items: [
              {
                data: [{
                  nasa_id: 'NASA-FEATURE-001',
                  title: 'Apollo Mission Control Documentary',
                  media_type: 'video',
                  description: 'A complete documentary. TRT: 00:48:22',
                  date_created: '1969-01-01T00:00:00Z',
                  center: 'KSC',
                }],
                links: [{ rel: 'preview', href: 'https://images-assets.nasa.gov/video/poster.jpg' }],
              },
              {
                data: [{
                  nasa_id: 'NASA-CLIP-001',
                  title: 'Apollo Mission Control Clip',
                  media_type: 'video',
                  description: 'Short launch excerpt.',
                  date_created: '1969-01-01T00:00:00Z',
                  center: 'KSC',
                }],
                links: [],
              },
            ],
          },
        };
      }
      if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/asset/NASA-FEATURE-001') {
        return { collection: { items: [
          { href: 'http://images-assets.nasa.gov/video/NASA-FEATURE-001/NASA-FEATURE-001~mobile.mp4' },
          { href: 'http://images-assets.nasa.gov/video/NASA-FEATURE-001/metadata.json' },
        ] } };
      }
      if (url.hostname === 'images-assets.nasa.gov' && url.pathname.endsWith('/metadata.json')) {
        return { 'AVAIL:Copyright': 'Public Domain' };
      }
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=Apollo%20Mission'));
    const body = await response.json() as { list?: Array<{ vod_name?: string; vod_remarks?: string }> };

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_name).toBe('Apollo Mission Control Documentary');
    expect(body.list?.[0].vod_remarks).toContain('48:22');
  });

  it('excludes NASA search hits without a playable MP4 or with explicit third-party copyright', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/search') {
        return { collection: { items: [
          { data: [{ nasa_id: 'NASA-UNPLAYABLE-001', title: 'Apollo Mission Control Documentary Unplayable', media_type: 'video', duration: 3600, description: 'A complete documentary.' }], links: [] },
          { data: [{ nasa_id: 'NASA-COPYRIGHT-001', title: 'Apollo Mission Control Documentary Copyright', media_type: 'video', duration: 3600, description: 'A complete documentary.' }], links: [] },
        ] } };
      }
      if (url.hostname === 'images-api.nasa.gov' && url.pathname.startsWith('/asset/')) {
        const nasaId = url.pathname.split('/').pop();
        const items = nasaId === 'NASA-UNPLAYABLE-001'
          ? [{ href: 'https://images-assets.nasa.gov/video/NASA-UNPLAYABLE-001/poster.jpg' }]
          : [
            { href: 'https://images-assets.nasa.gov/video/NASA-COPYRIGHT-001/NASA-COPYRIGHT-001~mobile.mp4' },
            { href: 'https://images-assets.nasa.gov/video/NASA-COPYRIGHT-001/metadata.json' },
          ];
        return { collection: { items } };
      }
      if (url.hostname === 'images-assets.nasa.gov' && url.pathname.endsWith('/metadata.json')) {
        return { 'AVAIL:Copyright': 'Third-party copyright' };
      }
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=Apollo%20Mission'));
    const body = await response.json() as { list?: unknown[] };

    expect(response.status).toBe(200);
    expect(body.list).toEqual([]);
    expect(fetchUpstreamJson.mock.calls.some(([input]) => String(input).includes('/asset/NASA-UNPLAYABLE-001'))).toBe(true);
    expect(fetchUpstreamJson.mock.calls.some(([input]) => String(input).includes('/asset/NASA-COPYRIGHT-001'))).toBe(true);
  });

  it('uses NASA QuickTime:Duration from the asset metadata when the search response omits duration', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/search') {
        return {
          collection: {
            items: [
              {
                data: [{ nasa_id: 'NASA-FEATURE-001', title: 'Apollo Mission Control Documentary', media_type: 'video', description: 'A complete documentary.', date_created: '1969-01-01T00:00:00Z' }],
                links: [],
              },
              {
                data: [{ nasa_id: 'NASA-SHORT-001', title: 'Apollo Mission Control Archival Footage', media_type: 'video', description: 'Historic footage from Mission Control.', date_created: '1969-01-01T00:00:00Z' }],
                links: [],
              },
            ],
          },
        };
      }
      if (url.hostname === 'images-api.nasa.gov' && url.pathname.startsWith('/asset/')) {
        const nasaId = url.pathname.split('/').pop();
        return { collection: { items: [
          { href: `http://images-assets.nasa.gov/video/${nasaId}/${nasaId}~mobile.mp4` },
          { href: `http://images-assets.nasa.gov/video/${nasaId}/metadata.json` },
        ] } };
      }
      if (url.hostname === 'images-assets.nasa.gov' && url.pathname.endsWith('/metadata.json')) {
        return url.pathname.includes('NASA-FEATURE-001')
          ? { 'QuickTime:Duration': '0:48:22', 'AVAIL:Title': 'Apollo Mission Control Documentary', 'AVAIL:Description': 'A complete documentary.' }
          : { 'QuickTime:Duration': '0:05:29', 'AVAIL:Title': 'Apollo Mission Control Archival Footage', 'AVAIL:Description': 'Historic footage from Mission Control.' };
      }
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=Apollo%20Mission'));
    const body = await response.json() as { list?: Array<{ vod_name?: string; vod_remarks?: string }> };

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_name).toBe('Apollo Mission Control Documentary');
    expect(body.list?.[0].vod_remarks).toContain('48:22');
    expect(fetchUpstreamJson.mock.calls.some(([input]) => String(input).includes('/asset/NASA-FEATURE-001'))).toBe(true);
  });

  it('returns NASA detail using QuickTime runtime metadata and the mobile MP4 asset', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'images-api.nasa.gov' && url.pathname.startsWith('/asset/')) {
        return { collection: { items: [
          { href: 'http://images-assets.nasa.gov/video/NASA-FEATURE-001/NASA-FEATURE-001~mobile.mp4' },
          { href: 'http://images-assets.nasa.gov/video/NASA-FEATURE-001/metadata.json' },
        ] } };
      }
      if (url.hostname === 'images-assets.nasa.gov' && url.pathname.endsWith('/metadata.json')) {
        return {
          'AVAIL:Title': 'Apollo Mission Control Documentary',
          'AVAIL:Description': 'A complete NASA documentary.',
          'QuickTime:Duration': '0:48:22',
        };
      }
      return {};
    });

    const id = encodeOpenMediaId('nasa', 'NASA-FEATURE-001|KSC');
    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&ids=' + id));
    const body = await response.json() as { list?: Array<{ vod_remarks?: string; vod_content?: string; vod_play_url?: string }> };

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_remarks).toContain('48:22');
    expect(body.list?.[0].vod_content).toContain('来源：NASA Image and Video Library');
    expect(body.list?.[0].vod_play_url).toContain('~mobile.mp4');
  });

  it('supports NASA asset IDs containing spaces in search and detail requests', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'images-api.nasa.gov' && url.pathname === '/search') {
        return {
          collection: {
            items: [{
              data: [{
                nasa_id: 'Apollo 14 Launch Coverage',
                title: 'Apollo 14 Launch Coverage',
                media_type: 'video',
                description: 'A complete archival NASA documentary.',
                date_created: '1971-02-05T00:00:00Z',
                center: 'KSC',
              }],
              links: [],
            }],
          },
        };
      }
      if (url.hostname === 'images-api.nasa.gov' && url.pathname.startsWith('/asset/')) {
        return { collection: { items: [
          { href: 'http://images-assets.nasa.gov/video/Apollo 14 Launch Coverage/Apollo 14 Launch Coverage~mobile.mp4' },
          { href: 'http://images-assets.nasa.gov/video/Apollo 14 Launch Coverage/metadata.json' },
        ] } };
      }
      if (url.hostname === 'images-assets.nasa.gov' && url.pathname.endsWith('/metadata.json')) {
        return {
          'AVAIL:Title': 'Apollo 14 Launch Coverage',
          'AVAIL:Description': 'A complete archival NASA documentary.',
          'QuickTime:Duration': '0:48:22',
        };
      }
      return {};
    });

    const searchResponse = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=Apollo'));
    const searchBody = await searchResponse.json() as { list?: Array<{ vod_id?: string; vod_name?: string; vod_remarks?: string }> };
    expect(searchResponse.status).toBe(200);
    expect(searchBody.list).toHaveLength(1);
    expect(searchBody.list?.[0].vod_name).toBe('Apollo 14 Launch Coverage');
    expect(searchBody.list?.[0].vod_remarks).toContain('48:22');

    const id = searchBody.list?.[0].vod_id;
    expect(id).toBeTruthy();
    const detailResponse = await GET(new Request('https://app.example/api/open-media?ac=videolist&ids=' + encodeURIComponent(id!)));
    const detailBody = await detailResponse.json() as { list?: Array<{ vod_remarks?: string; vod_play_url?: string; vod_content?: string }> };
    expect(detailResponse.status).toBe(200);
    expect(detailBody.list).toHaveLength(1);
    expect(detailBody.list?.[0].vod_remarks).toContain('48:22');
    expect(detailBody.list?.[0].vod_content).toContain('https://images.nasa.gov/details/Apollo%2014%20Launch%20Coverage');
    expect(detailBody.list?.[0].vod_play_url).toContain('Apollo%2014%20Launch%20Coverage~mobile.mp4');
    expect(fetchUpstreamJson.mock.calls.some(([value]) => String(value).includes('/asset/Apollo%2014%20Launch%20Coverage'))).toBe(true);
  });

  it('adds only allowlisted Library of Congress public-domain films with official MP4 playback', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'www.loc.gov' && url.pathname === '/film-and-videos/') {
        return {
          content: {
            results: [
              {
                title: 'The great train robbery',
                url: 'https://www.loc.gov/item/00694220/',
                access_restricted: false,
                group: ['selections-from-the-national-film-registry'],
                date: '1903',
                description: ['Silent film from 1903.'],
                image_url: ['https://tile.loc.gov/poster.jpg'],
                resources: [{ video: 'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00000765/00000765.mp4', duration: 701 }],
              },
              {
                title: 'Spider-Man (2002)',
                url: 'https://www.loc.gov/item/99999999/',
                access_restricted: false,
                group: ['selections-from-the-national-film-registry'],
                resources: [{ video: 'https://tile.loc.gov/spiderman.mp4', duration: 7200 }],
              },
              {
                title: 'The Cry of Jazz',
                url: 'https://www.loc.gov/item/2022602507/',
                access_restricted: false,
                group: ['selections-from-the-national-film-registry'],
                resources: [{ video: 'https://tile.loc.gov/cry-of-jazz.mp4', duration: 2000 }],
              },
              {
                title: 'The great train robbery',
                url: 'https://www.loc.gov/item/11111111/',
                access_restricted: true,
                group: ['selections-from-the-national-film-registry'],
                resources: [{ video: 'https://tile.loc.gov/restricted.mp4', duration: 701 }],
              },
              {
                title: 'The great train robbery',
                url: 'https://www.loc.gov/item/22222222/',
                access_restricted: false,
                group: ['selections-from-the-national-film-registry'],
                resources: [{ video: 'https://media.example/unauthorized.mp4', duration: 701 }],
              },
            ],
          },
        };
      }
      return {};
    });

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=The%20great%20train%20robbery'));
    const body = await response.json() as { list?: Array<{ vod_id?: string; vod_name?: string; type_name?: string; vod_play_url?: string }> };
    const locRequest = fetchUpstreamJson.mock.calls
      .map(([input]) => new URL(input as string))
      .find((url) => url.hostname === 'www.loc.gov');

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_name).toBe('The great train robbery');
    expect(body.list?.[0].type_name).toContain('Library of Congress');
    expect(body.list?.[0].vod_play_url).toContain('tile.loc.gov');
    expect(locRequest?.searchParams.get('fa')).toBe('partof:selections from the national film registry');
  });

  it('returns direct Library of Congress MP4 playback only for an allowlisted film detail', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'www.loc.gov' && url.pathname === '/film-and-videos/') {
        return {
          content: {
            results: [{
              title: 'The great train robbery',
              url: 'https://www.loc.gov/item/00694220/',
              access_restricted: false,
              group: ['selections-from-the-national-film-registry'],
              date: '1903',
              resources: [{ video: 'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00000765/00000765.mp4', duration: 701 }],
            }],
          },
        };
      }
      return {};
    });

    const id = encodeOpenMediaId('loc', '00694220|The great train robbery');
    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&ids=' + id));
    const body = await response.json() as { list?: Array<{ vod_name?: string; vod_play_from?: string; vod_play_url?: string }> };

    expect(response.status).toBe(200);
    expect(body.list).toHaveLength(1);
    expect(body.list?.[0].vod_name).toBe('The great train robbery');
    expect(body.list?.[0].vod_play_from).toBe('Library of Congress');
    expect(body.list?.[0].vod_play_url).toBe('在线播放$https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00000765/00000765.mp4');
  });

  it('resolves Chinese Spider-Man searches to English provider metadata terms', async () => {
    fetchUpstreamJson.mockResolvedValue({});

    const response = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=%E8%9C%98%E8%9B%9B%E4%BE%A0'));
    const body = await response.json() as { code?: number; list?: unknown[] };
    const requestedUrls = fetchUpstreamJson.mock.calls.map(([url]) => new URL(url as string));

    expect(response.status).toBe(200);
    expect(body.code).toBe(1);
    expect(body.list).toEqual([]);
    expect(requestedUrls).toHaveLength(5);
    expect(requestedUrls.some((url) => url.hostname === 'archive.org' && url.searchParams.get('q')?.includes('Spider-Man'))).toBe(true);
    expect(requestedUrls.some((url) => url.hostname === 'images-api.nasa.gov' && url.searchParams.get('q') === 'Spider-Man')).toBe(true);
    expect(requestedUrls.some((url) => url.hostname === 'search.joinpeertube.org' && url.searchParams.get('search') === 'Spider-Man')).toBe(true);
    expect(requestedUrls.some((url) => url.hostname === 'commons.wikimedia.org' && url.searchParams.get('gsrsearch') === 'filetype:video Spider-Man')).toBe(true);
    expect(requestedUrls.some((url) => url.hostname === 'www.loc.gov' && url.searchParams.get('q') === 'Spider-Man')).toBe(true);
  });

  it('serves instant curated poster wall via ac=browse and resolves curated direct streams', async () => {
    const browseRes = await GET(new Request('https://app.example/api/open-media?ac=browse&category=animation'));
    const browseBody = await browseRes.json() as {
      code?: number;
      category?: string;
      list?: Array<{ vod_id?: string; vod_name?: string; vod_pic?: string }>;
    };
    expect(browseRes.status).toBe(200);
    expect(browseBody.code).toBe(1);
    expect(browseBody.category).toBe('animation');
    expect((browseBody.list ?? []).length).toBeGreaterThanOrEqual(5);

    const sintel = browseBody.list?.find((item) => item.vod_name?.includes('辛特尔'));
    expect(sintel?.vod_id).toBeTruthy();

    const detailRes = await GET(
      new Request(`https://app.example/api/open-media?ac=videolist&ids=${encodeURIComponent(sintel!.vod_id!)}&zh=1&short=1`)
    );
    const detailBody = await detailRes.json() as {
      code?: number;
      list?: Array<{ vod_play_url?: string; vod_content?: string }>;
    };
    expect(detailRes.status).toBe(200);
    expect(detailBody.list?.[0]?.vod_play_url).toContain('video.blender.org');
    expect(detailBody.list?.[0]?.vod_content).toContain('中文导览：');
  });

  it('returns curated playable hits in enhanced zh=1&short=1 mode even if all external providers fail', async () => {
    fetchUpstreamJson.mockRejectedValue(new Error('Upstream timeout in direct network'));

    const res = await GET(new Request('https://app.example/api/open-media?ac=videolist&wd=%E8%BE%9B%E7%89%B9%E5%B0%94&zh=1&short=1'));
    const body = await res.json() as { code?: number; list?: Array<{ vod_name?: string }> };
    expect(res.status).toBe(200);
    expect(body.code).toBe(1);
    expect((body.list ?? []).length).toBeGreaterThanOrEqual(1);
    expect(body.list?.[0]?.vod_name).toContain('辛特尔');
  });

  it('supports dynamic online multi-page browsing via ac=browse&pg=2', async () => {
    fetchUpstreamJson.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'tilvids.com') {
        return {
          data: [
            peerTubeVideo('Classic Cinema Storytelling Essay', 900, 'An open film analysis.'),
          ],
        };
      }
      return {};
    });

    const res = await GET(new Request('https://app.example/api/open-media?ac=browse&category=all&pg=2'));
    const body = await res.json() as { code?: number; page?: number; list?: Array<{ vod_name?: string }> };
    expect(res.status).toBe(200);
    expect(body.code).toBe(1);
    expect(body.page).toBe(2);
    expect((body.list ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('supports Apple CMS v10 ac=list category browsing and specialized ?cat=chinese sub-galleries', async () => {
    const listRes = await GET(new Request('https://app.example/api/open-media?ac=list&t=5&pg=1'));
    const listBody = await listRes.json() as {
      code?: number;
      class?: Array<{ type_id: number; type_name: string }>;
      list?: Array<{ vod_name?: string }>;
    };
    expect(listRes.status).toBe(200);
    expect(listBody.code).toBe(1);
    expect((listBody.class ?? []).length).toBe(5);
    expect((listBody.list ?? []).length).toBeGreaterThanOrEqual(10);

    const subSearch = await GET(
      new Request('https://app.example/api/open-media?ac=videolist&wd=%E5%B0%8F%E5%9F%8E%E4%B9%8B%E6%98%A5&short=1&zh=1&cat=chinese')
    );
    const subBody = await subSearch.json() as { code?: number; list?: Array<{ vod_name?: string }> };
    expect(subSearch.status).toBe(200);
    expect(subBody.code).toBe(1);
    expect(subBody.list?.[0]?.vod_name).toContain('小城之春');
  });
});

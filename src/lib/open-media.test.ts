import { describe, expect, it } from 'vitest';
import {
  commonsMetaText,
  decodeOpenMediaId,
  encodeOpenMediaId,
  extractNasaAssetUrls,
  hasExplicitCopyright,
  isAllowedCommonsLicence,
  isAllowedPeerTubeLicence,
  isArchiveRightsAllowed,
  selectArchiveVideoFile,
  selectCommonsVideoFile,
  selectNasaVideoUrl,
  selectPeerTubeStreamUrl,
} from './open-media';

describe('open media identifiers', () => {
  it('round-trips provider IDs without characters rejected by LibreTV detail routing', () => {
    const id = encodeOpenMediaId('peertube', 'instance.example|f03ea6c6-f3b1-4566-a0e1-9b5edaaeadb0');
    expect(id).toMatch(/^om-[\w-]+$/);
    expect(decodeOpenMediaId(id)).toEqual({
      provider: 'peertube',
      externalId: 'instance.example|f03ea6c6-f3b1-4566-a0e1-9b5edaaeadb0',
    });
  });

  it('rejects malformed or unsupported IDs', () => {
    expect(decodeOpenMediaId('not-an-open-media-id')).toBeNull();
    expect(decodeOpenMediaId('om-%%%')).toBeNull();
  });
});

describe('open media rights filters', () => {
  it('accepts only explicit PeerTube open licences and public-domain declarations', () => {
    for (const id of [1, 2, 3, 7, 8]) expect(isAllowedPeerTubeLicence({ id, label: 'Declared open licence' })).toBe(true);
    for (const id of [4, 5, 6, 9]) expect(isAllowedPeerTubeLicence({ id, label: 'Restricted licence' })).toBe(false);
    expect(isAllowedPeerTubeLicence(null)).toBe(false);
    expect(isAllowedPeerTubeLicence({ id: null, label: 'Unknown' })).toBe(false);
  });

  it('accepts Archive.org public-domain rights or an explicit approved licence only', () => {
    expect(isArchiveRightsAllowed({ rights: 'Public Domain' })).toBe(true);
    expect(isArchiveRightsAllowed({ licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' })).toBe(true);
    expect(isArchiveRightsAllowed({ licenseurl: 'https://creativecommons.org/licenses/by/4.0/' })).toBe(true);
    expect(isArchiveRightsAllowed({ rights: 'All Rights Reserved' })).toBe(false);
    expect(isArchiveRightsAllowed({ rights: 'Public domain in the USA.' })).toBe(true);
    expect(isArchiveRightsAllowed({ rights: 'Copyright status unknown.' })).toBe(false);
    expect(isArchiveRightsAllowed({ rights: 'Public Domain', licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' })).toBe(false);
    expect(isArchiveRightsAllowed({ rights: 'All Rights Reserved', licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' })).toBe(false);
    expect(isArchiveRightsAllowed({})).toBe(false);
  });
});

describe('Wikimedia Commons licence and file filtering', () => {
  it('unwraps MediaWiki extmetadata value objects', () => {
    expect(commonsMetaText({ value: 'Public domain', source: 'commons-templates' })).toBe('Public domain');
    expect(commonsMetaText({ value: 42 })).toBe('');
    expect(commonsMetaText('CC BY 4.0')).toBe('CC BY 4.0');
  });

  it('accepts explicit public-domain and CC BY-family licences but rejects NC and copyrighted items', () => {
    expect(isAllowedCommonsLicence({ LicenseShortName: { value: 'Public domain' }, Copyrighted: { value: 'False' } })).toBe(true);
    expect(isAllowedCommonsLicence({ LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } })).toBe(true);
    expect(isAllowedCommonsLicence({ LicenseShortName: 'Public domain', Copyrighted: 'False' })).toBe(true);
    expect(isAllowedCommonsLicence({ LicenseUrl: 'https://creativecommons.org/licenses/by/4.0/' })).toBe(true);
    expect(isAllowedCommonsLicence({ LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' })).toBe(true);
    expect(isAllowedCommonsLicence({ LicenseUrl: 'https://creativecommons.org/licenses/by-nd/4.0/' })).toBe(true);
    expect(isAllowedCommonsLicence({ LicenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' })).toBe(false);
    expect(isAllowedCommonsLicence({ LicenseShortName: 'Public domain', LicenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' })).toBe(false);
    expect(isAllowedCommonsLicence({ LicenseShortName: 'Public domain', Copyrighted: 'True' })).toBe(false);
    expect(isAllowedCommonsLicence(undefined)).toBe(false);
  });

  it('accepts only HTTPS video files from Wikimedia upload CDN', () => {
    expect(selectCommonsVideoFile({ url: 'https://upload.wikimedia.org/a.webm', mime: 'video/webm' })?.url)
      .toBe('https://upload.wikimedia.org/a.webm');
    expect(selectCommonsVideoFile({ url: 'https://upload.wikimedia.org/a.webm', mime: 'video/webm', thumburl: 'https://thumb.wikimedia.org/a.jpg' })?.thumbnail)
      .toBe('https://thumb.wikimedia.org/a.jpg');
    expect(selectCommonsVideoFile({ url: 'http://upload.wikimedia.org/a.webm', mime: 'video/webm' })).toBeNull();
    expect(selectCommonsVideoFile({ url: 'https://evil.example/a.mp4', mime: 'video/mp4' })).toBeNull();
    expect(selectCommonsVideoFile({ url: 'https://upload.wikimedia.org/a.jpg', mime: 'image/jpeg' })).toBeNull();
  });
});

describe('NASA rights metadata', () => {
  it('does not mistake false-like copyright flags for an actual copyright notice', () => {
    for (const value of [false, 0, 'False', 'no', 'none', 'not copyrighted', null, undefined]) {
      expect(hasExplicitCopyright(value)).toBe(false);
    }
    for (const value of [true, 1, 'Copyright NASA', 'Third-party copyright']) {
      expect(hasExplicitCopyright(value)).toBe(true);
    }
  });
});

describe('NASA asset manifest parsing', () => {
  it('extracts href values from collection.items and upgrades legacy HTTP URLs', () => {
    expect(extractNasaAssetUrls({
      collection: {
        items: [
          { href: 'http://images-assets.nasa.gov/video/id/mobile.mp4' },
          { href: 'https://images-assets.nasa.gov/video/id/metadata.json' },
          { href: 'javascript:alert(1)' },
          { href: null },
        ],
      },
    })).toEqual([
      'https://images-assets.nasa.gov/video/id/mobile.mp4',
      'https://images-assets.nasa.gov/video/id/metadata.json',
    ]);
  });
});

describe('open media playback file selection', () => {
  it('prefers a mobile-friendly Archive.org MP4 derivative over a huge original', () => {
    const file = selectArchiveVideoFile([
      { name: 'film_orig.mp4', format: 'MPEG4', size: '900000000' },
      { name: 'film_1080p.mp4', format: 'MPEG4', size: '500000000' },
      { name: 'film_640x480.mp4', format: 'MPEG4', size: '100000000' },
      { name: 'film.srt', format: 'SubRip', size: '1000' },
    ]);
    expect(file?.name).toBe('film_640x480.mp4');
  });

  it('prefers NASA mobile MP4 assets and upgrades legacy HTTP URLs to HTTPS', () => {
    expect(selectNasaVideoUrl([
      'http://images-assets.nasa.gov/video/id/id~orig.mp4',
      'http://images-assets.nasa.gov/video/id/id~mobile.mp4',
      'http://images-assets.nasa.gov/video/id/id.srt',
    ])).toBe('https://images-assets.nasa.gov/video/id/id~mobile.mp4');
  });

  it('prefers PeerTube HLS master playlist and falls back to a direct MP4', () => {
    expect(selectPeerTubeStreamUrl({
      streamingPlaylists: [{ playlistUrl: 'https://video.example/hls/master.m3u8' }],
      files: [{ fileUrl: 'https://video.example/720.mp4', resolution: { id: 720 } }],
    })).toBe('https://video.example/hls/master.m3u8');
    expect(selectPeerTubeStreamUrl({
      streamingPlaylists: [],
      files: [{ fileUrl: 'https://video.example/720.mp4', resolution: { id: 720 } }],
    })).toBe('https://video.example/720.mp4');
  });
});

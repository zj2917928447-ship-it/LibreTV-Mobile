import { describe, expect, it } from 'vitest';
import { buildCmsApiUrl, buildCmsDetailPageUrl, normalizeCmsSourceConfig } from './cms-url';

describe('normalizeCmsSourceConfig', () => {
  it('accepts valid source details and canonicalizes URL values', () => {
    expect(normalizeCmsSourceConfig({
      key: ' source ',
      name: ' Source ',
      url: 'https://cms.example/api.php?token=secret',
      detail: 'https://cms.example/root/',
      isAdult: false,
    })).toEqual({
      key: 'source',
      name: 'Source',
      url: 'https://cms.example/api.php?token=secret',
      detail: 'https://cms.example/root/',
      isAdult: false,
    });
  });

  it.each([
    null,
    [],
    { key: 'x', name: 'x', url: 'javascript:alert(1)' },
    { key: 'x', name: 'x', url: 'https://user:pass@cms.example/api.php' },
    { key: 'x', name: 'x', url: 'https://cms.example/api.php', detail: { url: 'http://127.0.0.1' } },
    { key: 'x', name: 'x', url: 'https://cms.example/api.php', detail: 'file:///etc/passwd' },
  ])('rejects malformed or credential-bearing source configs', (value) => {
    expect(normalizeCmsSourceConfig(value)).toBeNull();
  });
});

describe('buildCmsApiUrl', () => {
  it('preserves existing authentication and source query parameters', () => {
    const url = new URL(buildCmsApiUrl('https://cms.example/api.php?token=secret&client=mobile', {
      ac: 'videolist',
      wd: '摔跤吧！爸爸',
      pg: '2',
    }));
    expect(url.searchParams.get('token')).toBe('secret');
    expect(url.searchParams.get('client')).toBe('mobile');
    expect(url.searchParams.get('ac')).toBe('videolist');
    expect(url.searchParams.get('wd')).toBe('摔跤吧！爸爸');
    expect(url.searchParams.get('pg')).toBe('2');
  });

  it('appends the HTML detail path before preserving root query-string tokens', () => {
    const url = new URL(buildCmsDetailPageUrl('https://cms.example/root/?token=secret&client=mobile', '123'));
    expect(url.pathname).toBe('/root/index.php/vod/detail/id/123.html');
    expect(url.searchParams.get('token')).toBe('secret');
    expect(url.searchParams.get('client')).toBe('mobile');
  });

  it('replaces an existing CMS parameter instead of appending a malformed second query', () => {
    const url = new URL(buildCmsApiUrl('https://cms.example/api.php?ac=old&wd=old', {
      ac: 'videolist',
      wd: 'new',
    }));
    expect(url.searchParams.getAll('ac')).toEqual(['videolist']);
    expect(url.searchParams.getAll('wd')).toEqual(['new']);
  });
});

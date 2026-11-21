import { describe, expect, it } from 'vitest';
import { buildChinesePlatformLinks, justWatchSearchUrl } from './catalog-links';

describe('justWatchSearchUrl & buildChinesePlatformLinks', () => {
  it('builds 16 safe domestic legal streaming search links for Chinese titles', () => {
    const links = buildChinesePlatformLinks('蜘蛛侠：纵横宇宙');
    expect(links).toHaveLength(16);
    expect(links.every((item) => item.url.startsWith('https://'))).toBe(true);
    expect(links.some((item) => item.name === '咪咕视频')).toBe(true);
    expect(links.some((item) => item.name === '1905电影网')).toBe(true);
    expect(links.some((item) => item.name === '西瓜视频')).toBe(true);
    expect(links.some((item) => item.name === '好看视频')).toBe(true);
    expect(links.some((item) => item.name === '抖音影视')).toBe(true);
  });
  it('uses the US catalogue by default and safely encodes Chinese titles', () => {
    const url = new URL(justWatchSearchUrl('蜘蛛侠'));
    expect(url.origin).toBe('https://www.justwatch.com');
    expect(url.pathname).toBe('/us/search');
    expect(url.searchParams.get('q')).toBe('蜘蛛侠');
  });

  it('uses the requested two-letter region', () => {
    const url = new URL(justWatchSearchUrl('Spider-Man', 'GB'));
    expect(url.pathname).toBe('/gb/search');
    expect(url.searchParams.get('q')).toBe('Spider-Man');
  });

  it('falls back to US for malformed region values', () => {
    const url = new URL(justWatchSearchUrl('Spider-Man', 'USA/../evil'));
    expect(url.pathname).toBe('/us/search');
    expect(url.hostname).toBe('www.justwatch.com');
  });
});

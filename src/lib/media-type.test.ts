import { describe, expect, it } from 'vitest';
import {
  formatByteSize,
  getArtPlayerMediaType,
  getDownloadFormat,
  getDownloadUrl,
  getMediaExtension,
  isDirectMediaUrl,
  isHlsMediaUrl,
} from './media-type';

describe('media URL type detection', () => {
  it('recognizes direct MP4, WebM and Ogg files despite query strings', () => {
    expect(getMediaExtension('https://archive.org/download/film.mp4?token=abc')).toBe('mp4');
    expect(getMediaExtension('https://upload.wikimedia.org/film.webm?utm_source=commons')).toBe('webm');
    expect(getMediaExtension('https://upload.wikimedia.org/film.ogv')).toBe('ogv');
    expect(isDirectMediaUrl('https://archive.org/download/film.mp4?token=abc')).toBe(true);
    expect(isDirectMediaUrl('https://upload.wikimedia.org/film.webm')).toBe(true);
    expect(isDirectMediaUrl('https://upload.wikimedia.org/film.ogv')).toBe(true);
  });

  it('recognizes HLS URLs, including a same-origin proxy URL wrapping the playlist', () => {
    const playlist = 'https://video.example/hls/master.m3u8?token=one';
    expect(isHlsMediaUrl(playlist)).toBe(true);
    expect(getMediaExtension(`/api/proxy?url=${encodeURIComponent(playlist)}`)).toBe('m3u8');
    expect(isHlsMediaUrl(`/api/proxy?url=${encodeURIComponent(playlist)}`)).toBe(true);
  });

  it('uses native ArtPlayer source handling for direct files and HLS.js for playlists', () => {
    expect(getArtPlayerMediaType('https://cdn.example/movie.mp4')).toBe('');
    expect(getArtPlayerMediaType('https://cdn.example/movie.webm')).toBe('');
    expect(getArtPlayerMediaType('https://cdn.example/index.m3u8')).toBe('m3u8');
    // Unknown extensions preserve the existing HLS fallback for legacy source providers.
    expect(getArtPlayerMediaType('https://cdn.example/stream')).toBe('m3u8');
  });

  it('routes direct media through the same-origin streaming download endpoint', () => {
    const url = 'https://archive.org/download/film.mp4?token=abc';
    const downloadUrl = getDownloadUrl(url, '流浪地球 2');
    const parsed = new URL(downloadUrl, 'https://libretv.example');
    expect(parsed.pathname).toBe('/api/download');
    expect(parsed.searchParams.get('url')).toBe(url);
    expect(parsed.searchParams.get('filename')).toBe('流浪地球 2.mp4');
    expect(getDownloadUrl('https://video.example/master.m3u8', '电影')).toBe('https://video.example/master.m3u8');
    expect(new URL(getDownloadUrl('https://cdn.example/movie.ogg', '音轨'), 'https://libretv.example').searchParams.get('filename')).toBe('音轨.ogg');
    expect(new URL(getDownloadUrl('https://cdn.example/movie.m4v', '影片'), 'https://libretv.example').searchParams.get('filename')).toBe('影片.m4v');
  });

  it('preserves the original file container when downloading direct media', () => {
    expect(getDownloadFormat('https://cdn.example/movie.mp4')).toBe('MP4');
    expect(getDownloadFormat('https://cdn.example/movie.webm')).toBe('WEBM');
    expect(getDownloadFormat('https://cdn.example/movie.ogv')).toBe('OGV');
    expect(getDownloadFormat('https://cdn.example/index.m3u8')).toBe('MP4');
  });
});

describe('formatByteSize', () => {
  it('formats streamed byte counts for download progress', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(1024)).toBe('1.0 KB');
    expect(formatByteSize(1024 * 1024 * 2)).toBe('2.0 MB');
  });
});

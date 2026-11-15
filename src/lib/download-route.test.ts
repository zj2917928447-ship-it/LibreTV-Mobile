import { describe, expect, it } from 'vitest';
import {
  buildDownloadContentDisposition,
  isDownloadableVideoContentType,
  isSafeDownloadTarget,
  sanitizeDownloadFilename,
} from './download-route';

describe('download target validation', () => {
  it('accepts public HTTP(S) URLs without embedded credentials and rejects unsafe input', () => {
    expect(isSafeDownloadTarget('https://media.example/movie.mp4')).toBe(true);
    expect(isSafeDownloadTarget('http://media.example/movie.mp4')).toBe(true);
    expect(isSafeDownloadTarget('https://user:pass@media.example/movie.mp4')).toBe(false);
    expect(isSafeDownloadTarget('file:///C:/movie.mp4')).toBe(false);
    expect(isSafeDownloadTarget('not a URL')).toBe(false);
    expect(isSafeDownloadTarget('https://media.example/' + 'a'.repeat(8200))).toBe(false);
  });
});

describe('download filename safety', () => {
  it('removes path traversal and filesystem-reserved characters', () => {
    expect(sanitizeDownloadFilename('../../movie\\evil:name?.mp4')).toBe('_.._movie_evil_name_.mp4');
    expect(sanitizeDownloadFilename('  ')).toBe('video');
  });

  it('keeps Chinese names in RFC 6266 UTF-8 filename* while providing an ASCII fallback', () => {
    const header = buildDownloadContentDisposition('流浪地球 2.mp4');
    expect(header).toContain('attachment;');
    expect(header).toContain('filename="____ 2.mp4"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain('%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83%202.mp4');
  });

  it('rejects HTML, JSON and playlist responses instead of downloading error pages', () => {
    expect(isDownloadableVideoContentType('text/html; charset=utf-8')).toBe(false);
    expect(isDownloadableVideoContentType('application/json')).toBe(false);
    expect(isDownloadableVideoContentType('application/vnd.apple.mpegurl')).toBe(false);
    expect(isDownloadableVideoContentType('video/mp4')).toBe(true);
    expect(isDownloadableVideoContentType('video/webm')).toBe(true);
    expect(isDownloadableVideoContentType('application/octet-stream')).toBe(true);
    expect(isDownloadableVideoContentType('application/webm')).toBe(true);
    expect(isDownloadableVideoContentType('')).toBe(true);
  });
});

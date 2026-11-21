import { describe, expect, it } from 'vitest';
import {
  convertSubtitleToVtt,
  decodeSubtitleBytes,
  findActiveSubtitleText,
  formatVttTimestamp,
  parseSubtitleCues,
  parseSubtitleTimestamp,
} from './subtitles';

describe('subtitle decoding and conversion', () => {
  it('decodes UTF-8 and GB18030/GBK Chinese subtitle bytes without garbled text', () => {
    const utf8Bytes = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:03,000\n能力越大，责任越大\n');
    expect(decodeSubtitleBytes(utf8Bytes)).toContain('能力越大，责任越大');

    // GBK bytes for "蜘蛛侠" (D6 A9 D6 EB CF C0)
    const gbkBytes = new Uint8Array([0xd6, 0xa9, 0xd6, 0xeb, 0xcf, 0xc0]);
    expect(decodeSubtitleBytes(gbkBytes)).toBe('蜘蛛侠');
  });

  it('parses and formats SRT, VTT and ASS timestamps accurately', () => {
    expect(parseSubtitleTimestamp('01:02:03,450')).toBeCloseTo(3723.45, 3);
    expect(parseSubtitleTimestamp('02:05.800')).toBeCloseTo(125.8, 3);
    expect(parseSubtitleTimestamp('0:01:12.34')).toBeCloseTo(72.34, 3);
    expect(parseSubtitleTimestamp('invalid')).toBeNull();
    expect(formatVttTimestamp(3723.45)).toBe('01:02:03.450');
  });

  it('converts SRT subtitles with HTML tags and timing offset to clean WebVTT', () => {
    const srt = [
      '1',
      '00:00:02,500 --> 00:00:05,000',
      '<font color="#ffff00">你好，彼得·帕克</font>',
      '',
      '2',
      '00:00:06,000 --> 00:00:08,200',
      '欢迎来到纽约\\N雙語字幕',
    ].join('\r\n');

    const vtt = convertSubtitleToVtt(srt, 0.5);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:03.000 --> 00:00:05.500\n你好，彼得·帕克');
    expect(vtt).toContain('00:00:06.500 --> 00:00:08.700\n欢迎来到纽约\n雙語字幕');
  });

  it('converts ASS/SSA Dialogue events and strips override tags', () => {
    const ass = [
      '[Script Info]',
      'Title: Chinese Subtitle',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:10.00,0:00:13.50,Default,,0,0,0,,{\\an8\\pos(192,220)}中文字幕第一行\\NEnglish line, with comma',
    ].join('\n');

    const cues = parseSubtitleCues(ass);
    expect(cues).toEqual([
      {
        start: 10,
        end: 13.5,
        text: '中文字幕第一行\nEnglish line, with comma',
      },
    ]);
  });

  it('finds overlapping bilingual cues at the current playback position', () => {
    const cues = [
      { start: 1, end: 4, text: '蜘蛛侠归来' },
      { start: 1, end: 4, text: 'Spider-Man Returns' },
      { start: 5, end: 8, text: '下一句台词' },
    ];
    expect(findActiveSubtitleText(cues, 2.5)).toBe('蜘蛛侠归来\nSpider-Man Returns');
    expect(findActiveSubtitleText(cues, 4.5)).toBe('');
    expect(findActiveSubtitleText(cues, 6)).toBe('下一句台词');
  });
});

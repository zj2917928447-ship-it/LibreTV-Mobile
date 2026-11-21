import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUpstreamJson, getCache, setCache } = vi.hoisted(() => ({
  fetchUpstreamJson: vi.fn(),
  getCache: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock('./fetch-utils', () => ({
  fetchUpstreamJson,
  getCache,
  setCache,
}));

import { needsChineseTranslation, resetTranslatorCircuitBreaker, translateLinesToChinese } from './translator';

describe('subtitle and overview translator', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetTranslatorCircuitBreaker();
    fetchUpstreamJson.mockReset();
    getCache.mockReset().mockReturnValue(undefined);
    setCache.mockReset();
  });

  it('identifies foreign lines while skipping already-Chinese or numeric strings', () => {
    expect(needsChineseTranslation('With great power comes great responsibility.')).toBe(true);
    expect(needsChineseTranslation('能力越大，责任越大。')).toBe(false);
    expect(needsChineseTranslation('蜘蛛侠 Spider-Man 2002')).toBe(false);
    expect(needsChineseTranslation('12345')).toBe(false);
  });

  it('falls back smoothly from GTX failure to MyMemory and caches translated lines', async () => {
    fetchUpstreamJson.mockImplementation(async (url: string) => {
      if (url.includes('translate.googleapis.com')) {
        throw new Error('GTX timeout');
      }
      if (url.includes('api.mymemory.translated.net')) {
        return {
          responseStatus: 200,
          quotaFinished: false,
          responseData: { translatedText: '权力越大，责任也越大。' },
        };
      }
      return {};
    });

    const res = await translateLinesToChinese([
      'With great power comes great responsibility.',
      '已经是中文台词',
    ]);
    expect(res.translations).toEqual(['权力越大，责任也越大。', '已经是中文台词']);
    expect(res.translatedCount).toBe(1);
    expect(setCache).toHaveBeenCalledTimes(1);
  });

  it('falls back to SimplyTranslate ICIBA when MyMemory daily quota is exhausted', async () => {
    fetchUpstreamJson.mockImplementation(async (url: string) => {
      if (url.includes('translate.googleapis.com')) throw new Error('GTX blocked');
      if (url.includes('api.mymemory.translated.net')) {
        return {
          responseStatus: 429,
          responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' },
        };
      }
      if (url.includes('simplytranslate.org')) {
        return { 'translated-text': '穿越狼蛛星云的飞行之旅。' };
      }
      return {};
    });

    const res = await translateLinesToChinese(['Flight through the Tarantula Nebula.']);
    expect(res.translations).toEqual(['穿越狼蛛星云的飞行之旅。']);
    expect(res.translatedCount).toBe(1);
  });
});

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

import { pickLatinSearchTitle, resolveDynamicBilingualMeta } from './bilingual-resolver';

describe('dynamic bilingual movie title resolver', () => {
  beforeEach(() => {
    fetchUpstreamJson.mockReset();
    getCache.mockReset().mockReturnValue(undefined);
    setCache.mockReset();
  });

  it('extracts clean English search titles from original_title or aka annotations', () => {
    expect(pickLatinSearchTitle('Spider-Man: Across the Spider-Verse')).toBe('Spider-Man: Across the Spider-Verse');
    expect(pickLatinSearchTitle('Das Cabinet des Dr. Caligari', ['The Cabinet of Dr. Caligari(英)', '卡里加里博士的小屋'])).toBe('Das Cabinet des Dr. Caligari');
    expect(pickLatinSearchTitle('千と千尋の神隠し', ['Spirited Away(美)', '神隐少女(台)'])).toBe('Spirited Away');
    expect(pickLatinSearchTitle('纯中文标题', ['另一个中文名'])).toBeNull();
  });

  it('resolves unindexed Chinese film titles to English queries and Chinese plot summaries', async () => {
    fetchUpstreamJson
      .mockResolvedValueOnce({
        subjects: {
          items: [
            {
              layout: 'subject',
              target_type: 'movie',
              target: { id: '1293318', title: '狂欢之魂', year: '1962' },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        title: '狂欢之魂',
        original_title: 'Carnival of Souls',
        intro: '一场车祸幸存后的管风琴师被神秘幻象缠绕的经典独立惊悚片。',
        year: '1962',
      });

    const resolved = await resolveDynamicBilingualMeta('狂欢之魂');
    expect(resolved).toEqual({
      zhTitle: '狂欢之魂',
      enQuery: 'Carnival of Souls',
      zhSummary: '一场车祸幸存后的管风琴师被神秘幻象缠绕的经典独立惊悚片。',
      year: '1962',
    });
  });
});

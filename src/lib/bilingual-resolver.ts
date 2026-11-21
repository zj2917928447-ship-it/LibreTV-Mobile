import { fetchUpstreamJson, getCache, setCache } from './fetch-utils';

/**
 * 动态跨语种片名与中文剧情简介解析器：
 * 当用户输入静态词典未收录的任意中文影视名称时，通过公开豆瓣移动端接口
 * 动态查询对应的外文原名（original_title / aka）与简体中文剧情简介（intro），
 * 打通“任意中文片名 -> 全球英文开放片库检索 -> 中文标题与简介回填”完整闭环。
 */

export interface DynamicBilingualMeta {
  zhTitle: string;
  enQuery: string;
  zhSummary?: string;
  year?: string;
}

const DYNAMIC_META_TTL_MS = 6 * 60 * 60 * 1000;
const DYNAMIC_EMPTY_TTL_MS = 10 * 60 * 1000;
const DOUBAN_SEARCH_URL = 'https://m.douban.com/rexxar/api/v2/search/subjects';
const DOUBAN_DETAIL_BASE = 'https://m.douban.com/rexxar/api/v2';
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

interface DoubanSubjectSearchPayload {
  subjects?: {
    items?: Array<{
      layout?: string;
      target_type?: string;
      target?: {
        id?: string | number;
        title?: string;
        year?: string;
        card_subtitle?: string;
      };
    }>;
  };
}

interface DoubanSubjectDetailPayload {
  title?: string;
  original_title?: string;
  aka?: unknown[];
  intro?: string;
  year?: string;
}

/** 从原名或别名列表中提取可用于英文开放片库检索的拉丁字母片名 */
export function pickLatinSearchTitle(originalTitle?: unknown, akaList?: unknown): string | null {
  const candidates: string[] = [];
  if (typeof originalTitle === 'string' && originalTitle.trim()) {
    candidates.push(originalTitle.trim());
  }
  if (Array.isArray(akaList)) {
    for (const item of akaList) {
      if (typeof item === 'string' && item.trim()) {
        // 剥离豆瓣别名尾部的地区注释，例如 "The Cabinet of Dr. Caligari(英)" -> "The Cabinet of Dr. Caligari"
        const stripped = item.replace(/\s*[(（][^()（）]{1,10}[)）]\s*$/u, '').trim();
        if (stripped) candidates.push(stripped);
      }
    }
  }

  for (const candidate of candidates) {
    // 要求包含拉丁字母且不含中日韩文字，长度合理
    if (
      /[A-Za-z]{2,}/.test(candidate) &&
      !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(candidate) &&
      candidate.length <= 120
    ) {
      return candidate.replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

export async function resolveDynamicBilingualMeta(query: string): Promise<DynamicBilingualMeta | null> {
  const clean = query.trim().slice(0, 80);
  if (!clean || !/[\u3400-\u9fff]/u.test(clean)) return null;

  const cacheKey = `bilingual:dynamic:v1:${clean.toLowerCase()}`;
  const cached = getCache<DynamicBilingualMeta | 'NONE'>(cacheKey);
  if (cached === 'NONE') return null;
  if (cached) return cached;

  try {
    const searchUrl = new URL(DOUBAN_SEARCH_URL);
    searchUrl.searchParams.set('q', clean);
    searchUrl.searchParams.set('type', 'movie');
    searchUrl.searchParams.set('count', '5');

    const searchData = await fetchUpstreamJson<DoubanSubjectSearchPayload>(searchUrl.href, {
      timeoutMs: 2_500,
      retries: 0,
      headers: {
        'User-Agent': MOBILE_UA,
        Referer: 'https://m.douban.com/search/',
        Accept: 'application/json',
      },
    });

    const hit = (searchData?.subjects?.items ?? []).find(
      (item) => item?.layout === 'subject' && Number.isSafeInteger(Number(item?.target?.id)) && Number(item?.target?.id) > 0
    );
    if (!hit?.target?.id) {
      setCache(cacheKey, 'NONE', DYNAMIC_EMPTY_TTL_MS);
      return null;
    }

    const id = Number(hit.target.id);
    const kind = hit.target_type === 'tv' ? 'tv' : 'movie';
    const detail = await fetchUpstreamJson<DoubanSubjectDetailPayload>(
      `${DOUBAN_DETAIL_BASE}/${kind}/${id}`,
      {
        timeoutMs: 2_500,
        retries: 0,
        headers: {
          'User-Agent': MOBILE_UA,
          Referer: `https://m.douban.com/${kind}/`,
          Accept: 'application/json',
        },
      }
    );

    const enQuery = pickLatinSearchTitle(detail?.original_title, detail?.aka);
    if (!enQuery) {
      setCache(cacheKey, 'NONE', DYNAMIC_EMPTY_TTL_MS);
      return null;
    }

    const intro = typeof detail?.intro === 'string'
      ? detail.intro.replace(/\s+/g, ' ').trim().slice(0, 500)
      : '';
    const subtitle = typeof hit.target.card_subtitle === 'string' ? hit.target.card_subtitle.trim() : '';
    const meta: DynamicBilingualMeta = {
      zhTitle: (typeof detail?.title === 'string' && detail.title.trim()) || hit.target.title || clean,
      enQuery,
      zhSummary: intro || subtitle || undefined,
      year: detail?.year || hit.target.year,
    };
    setCache(cacheKey, meta, DYNAMIC_META_TTL_MS);
    return meta;
  } catch {
    return null;
  }
}

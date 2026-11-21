import type { SearchResultItem, SubtitleTrack, VideoDetail, VideoPlayRoute } from './types';

/**
 * Apple CMS（苹果CMS）资源站响应解析
 * 与旧版 js/api.js 逻辑对齐，迁移为纯函数以便单元测试。
 */

const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

const UA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json, application/xml, text/xml, */*;q=0.8',
};

export function cmsRequestHeaders(): Record<string, string> {
  return { ...UA_HEADERS };
}

function decodeXmlEntities(raw: string): string {
  const cdataStripped = raw.trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1');
  return cdataStripped
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d{1,7});/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function readXmlTagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = block.match(re);
  return match ? decodeXmlEntities(match[1]) : '';
}

/**
 * 将苹果 CMS / 海洋 CMS（type=0）标准 `<rss><list><video>...</video></list></rss>` XML 响应
 * 归一化为与 JSON 接口一致的 `{ code, page, pagecount, list }` 结构。
 */
export function parseCmsXmlPayload(xml: string): {
  code: number;
  page: number;
  pagecount: number;
  list: Record<string, unknown>[];
} {
  const clean = xml.replace(/^\uFEFF/, '').trim();
  if (!/<(?:rss|list)\b/i.test(clean)) {
    throw new Error('API返回的数据格式无效');
  }

  const listOpen = clean.match(/<list\b([^>]*)>/i)?.[1] ?? '';
  const page = Number.parseInt(listOpen.match(/\bpage=["']?(\d+)/i)?.[1] ?? '1', 10) || 1;
  const pagecount = Number.parseInt(listOpen.match(/\bpagecount=["']?(\d+)/i)?.[1] ?? '1', 10) || 1;

  const list: Record<string, unknown>[] = [];
  const videoRegex = /<video\b[^>]*>([\s\S]*?)<\/video>/gi;
  let match: RegExpExecArray | null;
  while ((match = videoRegex.exec(clean)) !== null && list.length < 200) {
    const block = match[1];
    const vodId = readXmlTagText(block, 'id');
    const vodName = readXmlTagText(block, 'name');
    const playFlags: string[] = [];
    const playGroups: string[] = [];
    const dlContent = block.match(/<dl\b[^>]*>([\s\S]*?)<\/dl>/i)?.[1] ?? block;
    const ddRegex = /<dd\b([^>]*)>([\s\S]*?)<\/dd>/gi;
    let ddMatch: RegExpExecArray | null;
    while ((ddMatch = ddRegex.exec(dlContent)) !== null) {
      const attrs = ddMatch[1] ?? '';
      const flag = attrs.match(/\bflag=["']([^"']*)["']/i)?.[1]?.trim() || `线路${playGroups.length + 1}`;
      const urlGroup = decodeXmlEntities(ddMatch[2]);
      if (urlGroup) {
        playFlags.push(flag);
        playGroups.push(urlGroup);
      }
    }

    list.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: readXmlTagText(block, 'pic') || undefined,
      type_name: readXmlTagText(block, 'type') || undefined,
      vod_year: readXmlTagText(block, 'year') || undefined,
      vod_area: readXmlTagText(block, 'area') || undefined,
      vod_director: readXmlTagText(block, 'director') || undefined,
      vod_actor: readXmlTagText(block, 'actor') || undefined,
      vod_remarks: readXmlTagText(block, 'note') || readXmlTagText(block, 'state') || undefined,
      vod_content: readXmlTagText(block, 'des') || undefined,
      ...(playFlags.length > 0 ? { vod_play_from: playFlags.join('$$$') } : {}),
      ...(playGroups.length > 0 ? { vod_play_url: playGroups.join('$$$') } : {}),
    });
  }

  return { code: 1, page, pagecount, list };
}

/** 搜索响应 → 统一结果列表 */
export function parseSearchList(
  data: unknown,
  source: { key: string; name: string; url: string; isAdult?: boolean }
): SearchResultItem[] {
  if (!data || typeof data !== 'object') throw new Error('API返回的数据格式无效');
  const list = (data as { list?: unknown }).list;
  // 部分源站无结果时返回 list: null（而非 []），视为空结果而非格式错误
  if (list !== null && list !== undefined && !Array.isArray(list)) {
    throw new Error('API返回的数据格式无效');
  }
  return (Array.isArray(list) ? list : []).map((item) => {
    const vod = item as Record<string, unknown>;
    return {
      sourceKey: source.key,
      sourceName: source.name,
      vodId: String(vod.vod_id ?? ''),
      name: String(vod.vod_name ?? ''),
      pic: typeof vod.vod_pic === 'string' ? vod.vod_pic : undefined,
      typeName: typeof vod.type_name === 'string' ? vod.type_name : undefined,
      year: typeof vod.vod_year === 'string' ? vod.vod_year : undefined,
      area: typeof vod.vod_area === 'string' ? vod.vod_area : undefined,
      remarks: typeof vod.vod_remarks === 'string' ? vod.vod_remarks : undefined,
      sourceUrl: source.url,
      isAdult: source.isAdult,
    };
  });
}

const PLAY_FROM_LABELS: Record<string, string> = {
  lzm3u8: '量子 M3U8',
  ffm3u8: '非凡 M3U8',
  bfzym3u8: '暴风 M3U8',
  ikm3u8: '爱坤 M3U8',
  snm3u8: '索尼 M3U8',
  wjm3u8: '无尽 M3U8',
  hnzym3u8: '红牛 M3U8',
  dyttm3u8: '电影天堂 M3U8',
  jsm3u8: '极速 M3U8',
  subm3u8: '光速 M3U8',
  ukm3u8: 'U酷 M3U8',
  kuaikan: '快看直连',
  m3u8: 'M3U8 直连',
  mp4: 'MP4 直连',
};

const NUMERIC_EPISODE_LABEL = /^(?:第\s*0*\d+\s*[集话期章节回]?|0*\d+|ep?\.?\s*0*\d+)$/iu;

export function formatPlayRouteName(raw: string | undefined, index: number): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return `线路 ${index + 1}`;
  const mapped = PLAY_FROM_LABELS[trimmed.toLowerCase()];
  return mapped ?? trimmed;
}

/** 判断分集名是否包含描述性标题（如「HD国语」「第01集 · 创生之柱」「花絮」，而非纯集号） */
export function hasDescriptiveEpisodeNames(episodeNames?: readonly string[]): boolean {
  if (!episodeNames || episodeNames.length === 0) return false;
  return episodeNames.some((name) => {
    const trimmed = name.trim();
    return Boolean(trimmed) && !NUMERIC_EPISODE_LABEL.test(trimmed);
  });
}

/**
 * 解析苹果CMS `vod_play_url` 与 `vod_play_from` 的 `$$$` 多线路及 `#`/`$` 分集名称：
 * 1. 自动识别并保留真实的集名标签（如「HD国语」「HD粤语」「第01集 · 宇宙悬崖」）；
 * 2. 当存在直连流媒体线路（.m3u8 / .mp4 / .webm 等）时，自动剔除不可直接播放的 `/share/` 网页中转壳线路，
 *    并将直连媒体线路排在最前。
 */
export function extractPlayRoutes(playUrl: string, playFrom?: string): VideoPlayRoute[] {
  if (!playUrl) return [];
  const fromParts = (playFrom ?? '').split('$$$');
  const parsedGroups = playUrl
    .split('$$$')
    .map((group, groupIdx) => {
      const entries = group
        .split('#')
        .map((ep) => {
          const trimmedEp = ep.trim();
          if (!trimmedEp) return null;
          const parts = trimmedEp.split('$');
          if (parts.length > 1) {
            const label = parts[0].trim();
            const url = parts.slice(1).join('$').trim();
            return url.startsWith('http://') || url.startsWith('https://') ? { label, url } : null;
          }
          return /^https?:\/\//i.test(trimmedEp) ? { label: '', url: trimmedEp } : null;
        })
        .filter((entry): entry is { label: string; url: string } => entry !== null);

      if (entries.length === 0) return null;
      const episodes = entries.map((e) => e.url);
      const episodeNames = entries.map((e, idx) => e.label || (entries.length === 1 ? '正片' : `第${idx + 1}集`));
      const isDirectStream = episodes.some((u) =>
        /\.(?:m3u8|mp4|webm|mkv|m4v|ogg|mov|ts)(?:$|[?#])/i.test(u) || u.includes('.m3u8')
      );
      const isHtmlShareWrapper =
        !isDirectStream && episodes.every((u) => /\/share\/[A-Za-z0-9_-]+$/i.test(u));

      return {
        rawFrom: fromParts[groupIdx],
        episodes,
        episodeNames,
        isDirectStream,
        isHtmlShareWrapper,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  if (parsedGroups.length === 0) return [];

  const hasNonWrapper = parsedGroups.some((g) => !g.isHtmlShareWrapper);
  const filtered = hasNonWrapper
    ? parsedGroups.filter((g) => !g.isHtmlShareWrapper)
    : parsedGroups;

  const sorted = [...filtered].sort((a, b) => Number(b.isDirectStream) - Number(a.isDirectStream));

  // 去重完全相同首集 URL 的镜像重复线路，保持界面清爽
  const seenSignature = new Set<string>();
  const uniqueRoutes: VideoPlayRoute[] = [];
  for (const item of sorted) {
    const sig = item.episodes.join('|');
    if (seenSignature.has(sig)) continue;
    seenSignature.add(sig);
    uniqueRoutes.push({
      name: formatPlayRouteName(item.rawFrom, uniqueRoutes.length),
      episodes: item.episodes,
      episodeNames: item.episodeNames,
    });
  }
  return uniqueRoutes;
}

/**
 * 从 vod_play_url 中提取主线路分集地址：格式 源1$$$源2，集1$URL1#集2$URL2。
 * 部分源（如量子 lziapi、非凡 ffzy）第一条线路是网页中转页（…/share/xxx，不可播），
 * 真实 m3u8 在后面的线路里，因此优先取包含直连流媒体的线路；均无时回退第一条。
 */
export function extractEpisodesFromPlayUrl(playUrl: string): string[] {
  return extractPlayRoutes(playUrl)[0]?.episodes ?? [];
}

/** 从简介文本中兜底提取 m3u8 链接 */
export function extractM3u8FromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(M3U8_PATTERN) || [];
  return matches.map((link) => link.replace(/^\$/, ''));
}

function parseSubtitles(raw: unknown): SubtitleTrack[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tracks: SubtitleTrack[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const label = str(rec.label);
    const lang = str(rec.lang) || 'und';
    const url = str(rec.url);
    const format = rec.format === 'vtt' || rec.format === 'srt' || rec.format === 'ass' ? rec.format : undefined;
    if (!label || !url || (!url.startsWith('/') && !/^https?:\/\//i.test(url))) continue;
    tracks.push({ label, lang, url, format });
  }
  return tracks.length > 0 ? tracks : undefined;
}

/** 详情 JSON 响应 → 统一详情 */
export function parseDetail(
  data: unknown,
  source: { key: string; name: string; url: string }
): VideoDetail {
  const d = data as { list?: Record<string, unknown>[] };
  if (!d || !Array.isArray(d.list) || d.list.length === 0) {
    throw new Error('获取到的详情内容无效');
  }
  const vod = d.list[0];
  let playRoutes = extractPlayRoutes(String(vod.vod_play_url ?? ''), str(vod.vod_play_from));
  let episodes = playRoutes[0]?.episodes ?? [];
  if (episodes.length === 0) {
    episodes = extractM3u8FromText(String(vod.vod_content ?? ''));
    if (episodes.length > 0) {
      const episodeNames = episodes.map((_, idx) => (episodes.length === 1 ? '正片' : `第${idx + 1}集`));
      playRoutes = [{ name: formatPlayRouteName(str(vod.vod_play_from), 0), episodes, episodeNames }];
    }
  }
  const episodeNames = playRoutes[0]?.episodeNames;
  const subtitles = parseSubtitles(vod.vod_subtitles);
  return {
    episodes,
    ...(episodeNames && episodeNames.length > 0 ? { episodeNames } : {}),
    ...(playRoutes.length > 0 ? { playRoutes } : {}),
    ...(subtitles ? { subtitles } : {}),
    videoInfo: {
      title: str(vod.vod_name),
      cover: str(vod.vod_pic),
      desc: str(vod.vod_content),
      typeName: str(vod.type_name),
      year: str(vod.vod_year),
      area: str(vod.vod_area),
      director: str(vod.vod_director),
      actor: str(vod.vod_actor),
      remarks: str(vod.vod_remarks),
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
}

/**
 * 部分源的列表接口不返回播放地址，需要爬详情页 HTML 提取 m3u8。
 * 与旧版 handleSpecialSourceDetail 对齐。
 */
export function parseDetailPageHtml(
  html: string,
  source: { key: string; name: string; url: string }
): VideoDetail {
  // 先尝试通用模式，再尝试非凡影视的日期哈希特征路径
  let matches = html.match(/\$(https?:\/\/[^"'\s]+?\.m3u8)/g) || [];
  if (matches.length === 0) {
    matches = html.match(/\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g) || [];
  }
  // 去重并清理尾缀
  const episodes = [...new Set(matches)].map((link) => {
    let u = link.substring(1);
    const parenIndex = u.indexOf('(');
    if (parenIndex > 0) u = u.substring(0, parenIndex);
    return u;
  });

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);

  return {
    episodes,
    videoInfo: {
      title: titleMatch ? titleMatch[1].trim() : undefined,
      desc: descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : undefined,
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

/** 敏感分类过滤（成人内容过滤，关键词与旧版保持一致） */
const ADULT_KEYWORDS = [
  '伦理片', '福利', '倫理片', '福利片', '日本伦理', '日本福利', '日本福利片', '日本伦理片', '擦边短剧', '擦边', '韩国伦理','里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒',
  'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'SWAG',
  '网红主播', '色情片', '同性片', '福利视频', '无码高清', '有码高清', '91视频', '自拍偷拍', 'mini传媒', '福利片',
];

export function isAdultContent(typeName: string | undefined): boolean {
  if (!typeName) return false;
  return ADULT_KEYWORDS.some((k) => typeName.includes(k));
}

export function filterAdultResults<T extends { typeName?: string }>(items: T[], enabled: boolean): T[] {
  if (!enabled) return items;
  return items.filter((item) => !isAdultContent(item.typeName));
}

/**
 * 归一化标题/关键词：去空白、标点与符号，转小写。
 * 用于跨标点差异匹配（源站存「摔跤吧!爸爸」而用户搜「摔跤吧！爸爸」）。
 */
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * 仅将独立数字或明确的「第 N 季」后缀作为季数别名。
 *
 * `bareNeedsSpace` 区分两侧：
 * - 查询侧传 false：用户习惯直接输入「庆余年2」，数字前没有空格也得认成季数
 * - 标题侧保持 true：必须有空格，避免把片名自带的数字（「电影2」）误判成第二季
 */
function parseSeasonSuffix(
  title: string,
  allowAnnotations = false,
  bareNeedsSpace = true
): { base: string; season: number; explicit: boolean } | undefined {
  // 标题侧允许「第二季」后跟任意附注：粤语、预告片、【影视解说】、无分隔符的「第二季粤语」都算
  const explicitPattern = allowAnnotations
    ? /^(.*?)\s*第\s*([1-9]\d?|[一二两三四五六七八九十]{1,3})\s*季.*$/u
    : /^(.*?)\s*第\s*([1-9]\d?|[一二两三四五六七八九十]{1,3})\s*季$/u;
  const explicit = title.trim().match(explicitPattern);
  const bare = title.trim().match(bareNeedsSpace ? /^(.*?)\s+([1-9]\d?)$/u : /^(.*?)\s*([1-9]\d?)$/u);
  const match = explicit ?? bare;
  if (!match || !normalizeTitle(match[1])) return undefined;
  const value = match[2];
  const digits = '零一二三四五六七八九';
  let season = Number(value);
  if (!Number.isFinite(season)) {
    const chinese = value.replace('两', '二');
    if (/^[一二三四五六七八九]$/u.test(chinese)) {
      season = digits.indexOf(chinese);
    } else if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/u.test(chinese)) {
      const [tens, units] = chinese.split('十');
      season = (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0);
    }
  }
  if (!Number.isFinite(season)) return undefined;
  return { base: match[1], season, explicit: Boolean(explicit) };
}

/** 数字必须完整命中，避免第 2 季误匹配 12 或 20。 */
function includesKeyword(title: string, keyword: string): boolean {
  if (!title || !keyword) return false;
  let index = title.indexOf(keyword);
  while (index >= 0) {
    const before = title[index - 1] ?? '';
    const after = title[index + keyword.length] ?? '';
    if ((!/^\d/u.test(keyword) || !/\d/u.test(before)) &&
        (!/\d$/u.test(keyword) || !/\d/u.test(after))) return true;
    index = title.indexOf(keyword, index + 1);
  }
  return false;
}

/**
 * 关键词只解析一次。
 * filterRelevantResults 会对同一个查询过滤几百上千条结果，
 * 关键词的归一化、季数解析、分词结果对每条都相同，没必要重复算。
 */
interface PreparedQuery {
  normalized: string;
  season?: { base: string; season: number; explicit: boolean };
  tokens: string[];
}

function prepareQuery(wd: string): PreparedQuery | undefined {
  const normalized = normalizeTitle(wd);
  if (!normalized) return undefined;
  return {
    normalized,
    // 查询侧允许「庆余年2」这种无空格写法
    season: parseSeasonSuffix(wd, false, false),
    tokens: wd.trim().split(/\s+/).map(normalizeTitle).filter(Boolean),
  };
}

function matchesPrepared(nName: string, query: PreparedQuery): boolean {
  if (includesKeyword(nName, query.normalized)) return true;
  return query.tokens.length > 1 && query.tokens.every((token) => includesKeyword(nName, token));
}

function isRelevantPrepared(name: string, query: PreparedQuery): boolean {
  const nName = normalizeTitle(name);
  if (!nName) return false;
  const titleSeason = parseSeasonSuffix(name, true);
  if (query.season && titleSeason) {
    if (query.season.season !== titleSeason.season) return false;
    if (query.season.explicit || titleSeason.explicit) {
      const baseQuery = prepareQuery(query.season.base);
      if (baseQuery) return matchesPrepared(normalizeTitle(titleSeason.base), baseQuery);
    }
  }
  return matchesPrepared(nName, query);
}

/**
 * 忽略标点和大小写，多词查询要求每个词都命中。
 * 独立的末尾数字也可匹配明确的中文季数后缀；
 * 标题内部的数字与四位年份不作为季数别名。
 */
export function isRelevant(name: string, wd: string): boolean {
  const query = prepareQuery(wd);
  if (!query) return true;
  return isRelevantPrepared(name, query);
}

/** 丢弃无关结果；即使全部不相关，也不能返回源站的原始目录。支持传入双语等价别名以保留跨语种译名命中。 */
export function filterRelevantResults<T extends { name?: string }>(
  items: T[],
  wd: string,
  aliases: readonly string[] = []
): T[] {
  const queries = [wd, ...aliases]
    .map(prepareQuery)
    .filter((q): q is PreparedQuery => Boolean(q));
  if (queries.length === 0) return items;
  return items.filter((item) => queries.some((query) => isRelevantPrepared(item.name || '', query)));
}

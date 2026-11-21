export interface DomesticWatchLink {
  name: string;
  url: string;
}

/** Build a region-scoped JustWatch search link without relying on a server API token. */
export function justWatchSearchUrl(query: string, region = 'US'): string {
  const normalizedRegion = region.trim().toUpperCase();
  const safeRegion = /^[A-Z]{2}$/.test(normalizedRegion) ? normalizedRegion.toLowerCase() : 'us';
  const url = new URL(`https://www.justwatch.com/${safeRegion}/search`);
  url.searchParams.set('q', query.trim());
  return url.toString();
}

/** Build safe official search links for mainstream Chinese legal streaming platforms. */
export function buildChinesePlatformLinks(title: string): DomesticWatchLink[] {
  const clean = title.trim().slice(0, 100);
  if (!clean) return [];
  const encoded = encodeURIComponent(clean);
  return [
    { name: '哔哩哔哩', url: `https://search.bilibili.com/pgc?keyword=${encoded}` },
    { name: '腾讯视频', url: `https://v.qq.com/x/search/?q=${encoded}` },
    { name: '爱奇艺', url: `https://so.iqiyi.com/so/q_${encoded}` },
    { name: '优酷', url: `https://so.youku.com/search_video/q_${encoded}` },
    { name: '芒果TV', url: `https://so.mgtv.com/so?k=${encoded}` },
    { name: '央视频', url: `https://www.yangshipin.cn/search/result?query=${encoded}` },
    { name: '1905电影网', url: `https://www.1905.com/search/?q=${encoded}` },
    { name: '咪咕视频', url: `https://www.miguvideo.com/p/search/?k=${encoded}` },
    { name: '搜狐视频', url: `https://so.tv.sohu.com/mts?wd=${encoded}` },
    { name: '西瓜视频', url: `https://www.ixigua.com/search/${encoded}/` },
    { name: '央视网', url: `https://search.cctv.com/search.php?qtext=${encoded}&type=video` },
    { name: '风行网', url: `https://www.fun.tv/search/?word=${encoded}` },
    { name: '好看视频', url: `https://haokan.baidu.com/web/search/page?query=${encoded}` },
    { name: '微博视频', url: `https://s.weibo.com/video?q=${encoded}` },
    { name: '抖音影视', url: `https://www.douyin.com/search/${encoded}` },
    { name: '快手放映厅', url: `https://www.kuaishou.com/search/video?searchKey=${encoded}` },
  ];
}

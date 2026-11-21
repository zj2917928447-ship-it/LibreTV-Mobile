import { describe, expect, it } from 'vitest';
import {
  browseCuratedOpenVideos,
  CURATED_OPEN_VIDEOS,
  encodeCuratedVideoVodId,
  expandCuratedQueryAliases,
  findCuratedOpenVideoBySlug,
  OPEN_BROWSE_CATEGORIES,
  searchCuratedOpenVideos,
  toCuratedCmsItem,
} from './curated-open-video';
import { decodeOpenMediaId } from './open-media';

describe('curated-open-video', () => {
  it('所有内置精选影片均具备中英文标题、分类与可解码 vod_id', () => {
    expect(CURATED_OPEN_VIDEOS.length).toBeGreaterThanOrEqual(5472);
    const slugs = new Set<string>();
    let directCount = 0;
    let seriesCount = 0;
    let dualRouteCount = 0;
    for (const item of CURATED_OPEN_VIDEOS) {
      expect(slugs.has(item.slug)).toBe(false);
      slugs.add(item.slug);
      expect(item.zhTitle.trim()).not.toBe('');
      expect(item.enTitle.trim()).not.toBe('');
      expect(item.durationSeconds).toBeGreaterThan(60);
      const vodId = encodeCuratedVideoVodId(item);
      const decoded = decodeOpenMediaId(vodId);
      expect(decoded).not.toBeNull();
      const cms = toCuratedCmsItem(item, true);
      expect(cms.vod_name).toContain(item.zhTitle);
      if (item.directPlayUrl) {
        directCount++;
        expect(cms.vod_play_url).toContain('https://');
        if (item.backupDirectPlayUrl) {
          dualRouteCount++;
          expect(cms.vod_play_url).toContain('$$$');
          expect(cms.vod_play_from).toContain('$$$');
        }
      }
      if (item.episodes && item.episodes.length > 0) {
        directCount++;
        seriesCount++;
        expect(cms.vod_direct).toBe(true);
        const parts = (cms.vod_play_url || '').split('#');
        expect(parts.length).toBe(item.episodes.length);
        for (const p of parts) {
          expect(p).toMatch(/^[^#$]+\$https:\/\//);
        }
      }
    }
    expect(directCount).toBe(CURATED_OPEN_VIDEOS.length);
    expect(seriesCount).toBeGreaterThanOrEqual(100);
    expect(dualRouteCount).toBeGreaterThanOrEqual(10);
  });

  it('分类浏览覆盖全部 6 个频道并准确筛选', () => {
    const all = browseCuratedOpenVideos('all');
    expect(all.length).toBe(CURATED_OPEN_VIDEOS.length);
    for (const cat of OPEN_BROWSE_CATEGORIES) {
      const list = browseCuratedOpenVideos(cat.id);
      expect(list.length).toBeGreaterThan(0);
    }
  });

  it('支持中文片名、英文原名与中文题材词双向检索', () => {
    expect(searchCuratedOpenVideos('辛特尔').some((v) => v.slug === 'sintel')).toBe(true);
    expect(searchCuratedOpenVideos('Tears of Steel').some((v) => v.slug === 'tears-of-steel')).toBe(true);
    expect(searchCuratedOpenVideos('动画').length).toBeGreaterThanOrEqual(8);
    expect(searchCuratedOpenVideos('太空').length).toBeGreaterThanOrEqual(5);
    expect(expandCuratedQueryAliases('三体星系行星').some((t) => t.includes('比邻星b'))).toBe(true);
    expect(expandCuratedQueryAliases('科幻').length).toBeGreaterThanOrEqual(15);
    expect(searchCuratedOpenVideos('马路天使').some((v) => v.slug === 'street-angel-malu-tianshi-1937')).toBe(true);
    expect(searchCuratedOpenVideos('球幕电影全集').some((v) => v.slug === 'eso-planetarium-fulldome-masterpieces-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('1917定格动画恐龙').some((v) => v.slug === 'loc-origins-of-american-animation-dinosaurs-krazy-kat-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('孤军浴血记1919').some((v) => v.slug === 'loc-silent-epic-features-lost-battalion-buffalo-bill-7ep')).toBe(true);
    expect(searchCuratedOpenVideos('远大前程1946大卫里恩').some((v) => v.slug === 'world-noir-mystery-sherlock-great-expectations-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('罗曼太空望远镜2026发射').some((v) => v.slug === 'nasa-roman-space-telescope-2026-launch-4k-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('超人1941彩色动画全集').some((v) => v.slug === 'fleischer-superman-1941-technicolor-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('乞力马扎罗的雪1952派克').some((v) => v.slug === 'hollywood-oscar-hitchcock-masterpieces-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('巴斯特基顿将军号1926').some((v) => v.slug === 'keaton-chaplin-silent-comedy-pantheon-9ep')).toBe(true);
    expect(searchCuratedOpenVideos('阿耳忒弥斯2026载人绕月发射').some((v) => v.slug === 'nasa-artemis-moon-ingenuity-mars-4k-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('骄傲的将军1956上海美影厂').some((v) => v.slug === 'enchanted-animated-features-snow-queen-gulliver-conceited-general-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('小报妙冤家女友礼拜五1940').some((v) => v.slug === 'golden-age-screwball-romance-his-girl-friday-pygmalion-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('巴斯特基顿新婚一周拼装屋').some((v) => v.slug === 'buster-keaton-ingenious-comedies-9ep')).toBe(true);
    expect(searchCuratedOpenVideos('007皇家赌场1954初代邦德').some((v) => v.slug === 'sherlock-007-noir-detective-pantheon-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('新女性').some((v) => v.slug === 'archive-newwomen')).toBe(true);
    expect(searchCuratedOpenVideos('奥逊威尔斯陌生人1946').some((v) => v.slug === 'orson-welles-fritz-lang-noir-pantheon-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('青蜂侠1940初代真人剧').some((v) => v.slug === 'green-hornet-1940-cliffhanger-serial-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('2024日全食NASA望远镜实拍').some((v) => v.slug === 'nasa-crew-dragon-2024-solar-eclipse-4k-8ep')).toBe(true);
    expect(findCuratedOpenVideoBySlug('night-of-the-living-dead-1968')?.directPlayUrl).toContain('https://');
  });
});

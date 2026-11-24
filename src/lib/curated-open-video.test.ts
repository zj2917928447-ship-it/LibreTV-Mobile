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
    expect(CURATED_OPEN_VIDEOS.length).toBeGreaterThanOrEqual(9228);
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
    expect(seriesCount).toBeGreaterThanOrEqual(179);
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
    expect(searchCuratedOpenVideos('姊妹花').some((v) => v.slug === 'archive-twinsisters')).toBe(true);
    expect(searchCuratedOpenVideos('浮华世界1935首部彩色电影').some((v) => v.slug === 'hollywood-technicolor-drama-becky-sharp-our-town-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('狗舍谋杀案1933密室推理').some((v) => v.slug === 'locked-room-noir-he-walked-by-night-kennel-murder-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('反诈重案组1951探案剧').some((v) => v.slug === 'racket-squad-con-artist-detective-cases-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('门户号月球轨道空间站').some((v) => v.slug === 'nasa-lunar-gateway-viper-moon-rover-sls-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('铁扇公主').some((v) => v.slug === 'archive-tieshangongzhu')).toBe(true);
    expect(searchCuratedOpenVideos('风云儿女').some((v) => v.slug === 'archive-childrenoftroubledtimes')).toBe(true);
    expect(searchCuratedOpenVideos('夜半歌声').some((v) => v.slug === 'archive-song-at-midnight')).toBe(true);
    expect(searchCuratedOpenVideos('桃李劫').some((v) => v.slug === 'archive-plunderofpeachandplum')).toBe(true);
    expect(searchCuratedOpenVideos('亨利八世的私生活1933').some((v) => v.slug === 'oscar-british-hollywood-legends-henry-viii-cyrano-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('福尔摩斯与秘密武器1080p').some((v) => v.slug === 'sherlock-holmes-secret-weapon-1954-baker-street-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('飞侠哥顿1936太空歌剧').some((v) => v.slug === 'flash-gordon-1936-1955-space-opera-chronicles-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('独行侠1949原版西部剧').some((v) => v.slug === 'lone-ranger-bonanza-western-legends-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('恋爱与义务1931阮玲玉').some((v) => v.slug === 'early-chinese-lianhua-golden-age-love-duty-daybreak-7ep')).toBe(true);
    expect(searchCuratedOpenVideos('都市风光').some((v) => v.slug === 'archive-scenesofcitylife-dushifengguang')).toBe(true);
    expect(searchCuratedOpenVideos('体育皇后').some((v) => v.slug === 'archive-queenofsports')).toBe(true);
    expect(searchCuratedOpenVideos('白毛女').some((v) => v.slug === 'archive-the-white-haired-girl')).toBe(true);
    expect(searchCuratedOpenVideos('首届奥斯卡最佳影片翼1927').some((v) => v.slug === 'first-oscar-wings-1927-hitchcock-lodger-silent-titans-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('弗兰克卡普拉群氓1941').some((v) => v.slug === 'capra-wellman-golden-classics-meet-john-doe-algiers-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('波士顿布莱基侠盗神探').some((v) => v.slug === 'boston-blackie-gentleman-sleuth-chronicles-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('隐形奇侠1958英伦科幻剧').some((v) => v.slug === 'invisible-man-1958-british-espionage-scifi-7ep')).toBe(true);
    expect(searchCuratedOpenVideos('我这一辈子1950石挥').some((v) => v.slug === 'early-chinese-cinema-pantheon-this-life-three-women-waves-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('盘丝洞1927西游记默片').some((v) => v.slug === 'early-chinese-wuxia-silent-animation-pioneers-cave-silken-web-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('超人1941国语配音版').some((v) => v.slug === 'fleischer-superman-1941-chinese-dub-collection-9ep')).toBe(true);
    expect(searchCuratedOpenVideos('M就是凶手1931高清修复').some((v) => v.slug === 'lang-hitchcock-kubrick-classic-thriller-comedy-pantheon-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('阿波罗11号登月16mm原片').some((v) => v.slug === 'nasa-apollo-7-to-17-16mm-onboard-lunar-films-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('我这一辈子').some((v) => v.slug === 'archive-this-life-of-mine')).toBe(true);
    expect(searchCuratedOpenVideos('丽人行').some((v) => v.slug === 'archive-threegirls')).toBe(true);
    expect(searchCuratedOpenVideos('红楼梦').some((v) => v.slug === 'archive-dreamred')).toBe(true);
    expect(searchCuratedOpenVideos('幽灵潜行者1939全集').some((v) => v.slug === 'phantom-creeps-1939-bela-lugosi-complete-12ep')).toBe(true);
    expect(searchCuratedOpenVideos('罗宾汉历险记1955英剧').some((v) => v.slug === 'robin-hood-1955-richard-greene-sherwood-vol1-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('超越一步1959超自然悬疑剧').some((v) => v.slug === 'one-step-beyond-1959-paranormal-anthology-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('玛莎艾弗斯的奇异爱情1946').some((v) => v.slug === 'karloff-mr-wong-dick-tracy-martha-ivers-noir-pantheon-9ep')).toBe(true);
    expect(searchCuratedOpenVideos('乐一通公版经典动画合集').some((v) => v.slug === 'looney-tunes-merrie-melodies-pd-treasures-corny-concerto-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('友谊7号约翰格伦太空飞行').some((v) => v.slug === 'nasa-friendship7-skylab-apollo-soyuz-apollo-onboard-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('威利号汽船1928初代米老鼠1080p').some((v) => v.slug === 'steamboat-willie-1928-1080p-ub-iwerks-comicolor-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('三个火枪手1921蓝光1080p').some((v) => v.slug === 'three-musketeers-1921-1080p-john-wayne-1933-serial-12ep')).toBe(true);
    expect(searchCuratedOpenVideos('杰克贝尼秀好莱坞巨星特辑').some((v) => v.slug === 'jack-benny-hollywood-superstars-comedy-vol1-10ep')).toBe(true);
    expect(searchCuratedOpenVideos('哈罗德劳埃德猫爪1934').some((v) => v.slug === 'lloyd-cats-paw-milky-way-laurel-hardy-oxford-pantheon-8ep')).toBe(true);
    expect(searchCuratedOpenVideos('NASA阿波罗官方彩色纪录片全集').some((v) => v.slug === 'nasa-apollo-10-to-17-jsc-official-mission-films-9ep')).toBe(true);
    expect(searchCuratedOpenVideos('神女1934阮玲玉').some((v) => v.slug === 'archive-thegoddess')).toBe(true);
    expect(searchCuratedOpenVideos('飞机迷1928米老鼠首秀').some((v) => v.slug === 'disney-1927-1930-mickey-silly-symphony-oswald-pd-12ep')).toBe(true);
    expect(searchCuratedOpenVideos('大力水手大战辛巴达1080p').some((v) => v.slug === 'fleischer-popeye-1080p-sindbad-aladdin-betty-boop-9ep')).toBe(true);
    expect(searchCuratedOpenVideos('西线无战事1930奥斯卡原版').some((v) => v.slug === 'world-cinema-1930-oscar-landmarks-all-quiet-blue-angel-7ep')).toBe(true);
    expect(searchCuratedOpenVideos('小津安二郎晚春1949原节子').some((v) => v.slug === 'ozu-mizoguchi-yamanaka-japanese-golden-age-pantheon-7ep')).toBe(true);
    expect(searchCuratedOpenVideos('低语暗影1933贝拉卢戈西全集').some((v) => v.slug === 'bela-lugosi-whispering-shadow-1933-complete-12ep')).toBe(true);
    expect(findCuratedOpenVideoBySlug('night-of-the-living-dead-1968')?.directPlayUrl).toContain('https://');
  });
});

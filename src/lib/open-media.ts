import { Buffer } from 'node:buffer';
import { isPrivateIP } from './network-address';

export type OpenMediaProvider = 'archive' | 'nasa' | 'peertube' | 'commons' | 'loc' | 'curated';

/** Run independent provider metadata lookups with a fixed concurrency ceiling. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive finite number');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const SEARCH_STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at']);

export interface BilingualFilmEntry {
  /** 标准简体中文展示名 */
  zhTitle: string;
  /** 上游开放片库检索用的英文/原版主词条 */
  enQuery: string;
  /** 其他中英文/简繁体同义输入词 */
  aliases: readonly string[];
  /** 可选：中文看点或剧情导览（用于汉化纯英文公版片简介） */
  zhSummary?: string;
}

/**
 * 中英双向影视片名与公版名片词典：
 * 1. 将中文搜索词解析为欧美开放片库使用的英文索引名；
 * 2. 为 /api/search 聚合过滤提供等价双语同义词，修复中文搜英文源被误杀为 0 条的缺陷；
 * 3. 为搜出的纯英文公版经典影片补充中文译名与中文导览简介。
 */
export const BILINGUAL_FILM_LEXICON: readonly BilingualFilmEntry[] = [
  // —— 蜘蛛侠及热门商业系列（保障中文搜索双向匹配） ——
  { zhTitle: '蜘蛛侠', enQuery: 'Spider-Man', aliases: ['蜘蛛俠', '蜘蛛人', '小蜘蛛', 'Spiderman'] },
  { zhTitle: '蜘蛛侠2', enQuery: 'Spider-Man 2', aliases: ['蜘蛛俠2', '蜘蛛人2'] },
  { zhTitle: '蜘蛛侠3', enQuery: 'Spider-Man 3', aliases: ['蜘蛛俠3', '蜘蛛人3'] },
  { zhTitle: '超凡蜘蛛侠', enQuery: 'The Amazing Spider-Man', aliases: ['超凡蜘蛛俠', '蜘蛛人惊奇再起'] },
  { zhTitle: '超凡蜘蛛侠2', enQuery: 'The Amazing Spider-Man 2', aliases: ['超凡蜘蛛俠2'] },
  { zhTitle: '蜘蛛侠：英雄归来', enQuery: 'Spider-Man: Homecoming', aliases: ['蜘蛛侠英雄归来', '蜘蛛俠英雄歸來', '蜘蛛人返校日'] },
  { zhTitle: '蜘蛛侠：英雄远征', enQuery: 'Spider-Man: Far From Home', aliases: ['蜘蛛侠英雄远征', '蜘蛛俠英雄遠征', '蜘蛛人离家日'] },
  { zhTitle: '蜘蛛侠：英雄无归', enQuery: 'Spider-Man: No Way Home', aliases: ['蜘蛛侠英雄无归', '蜘蛛俠英雄無歸', '蜘蛛人无家日'] },
  { zhTitle: '蜘蛛侠：平行宇宙', enQuery: 'Spider-Man: Into the Spider-Verse', aliases: ['蜘蛛侠平行宇宙', '蜘蛛俠新宇宙'] },
  { zhTitle: '蜘蛛侠：纵横宇宙', enQuery: 'Spider-Man: Across the Spider-Verse', aliases: ['蜘蛛侠纵横宇宙'] },
  { zhTitle: '钢铁侠', enQuery: 'Iron Man', aliases: ['鋼鐵俠', '鋼鐵人'] },
  { zhTitle: '蝙蝠侠', enQuery: 'Batman', aliases: ['蝙蝠俠'] },
  { zhTitle: '超人', enQuery: 'Superman', aliases: ['超人动画', '弗莱舍尔超人'], zhSummary: '经典超人动画与影视档案，含 1940 年代派拉蒙公共领域高水准手绘动画系列。' },
  { zhTitle: '复仇者联盟', enQuery: 'The Avengers', aliases: ['復仇者聯盟'] },
  { zhTitle: '星际穿越', enQuery: 'Interstellar', aliases: ['星際穿越', '星際效應'] },
  { zhTitle: '盗梦空间', enQuery: 'Inception', aliases: ['盜夢空間', '全面啟動'] },
  { zhTitle: '泰坦尼克号', enQuery: 'Titanic', aliases: ['泰坦尼克號', '鐵達尼號'] },
  { zhTitle: '黑客帝国', enQuery: 'The Matrix', aliases: ['駭客任務', '黑客帝國'] },
  { zhTitle: '阿凡达', enQuery: 'Avatar', aliases: ['阿凡達'] },
  { zhTitle: '哈利·波特', enQuery: 'Harry Potter', aliases: ['哈利波特'] },
  { zhTitle: '指环王', enQuery: 'The Lord of the Rings', aliases: ['魔戒', '指環王'] },
  { zhTitle: '星球大战', enQuery: 'Star Wars', aliases: ['星際大戰', '星战'] },
  { zhTitle: '变形金刚', enQuery: 'Transformers', aliases: ['變形金剛'] },
  { zhTitle: '速度与激情', enQuery: 'Fast & Furious', aliases: ['玩命關頭', '速激'] },
  { zhTitle: '碟中谍', enQuery: 'Mission: Impossible', aliases: ['不可能的任務', '职业特工队'] },
  { zhTitle: '侏罗纪公园', enQuery: 'Jurassic Park', aliases: ['侏羅紀公園', '侏罗纪世界'] },
  { zhTitle: '终结者', enQuery: 'The Terminator', aliases: ['魔鬼終結者', '未来战士'] },
  { zhTitle: '异形', enQuery: 'Alien', aliases: ['異形'] },
  { zhTitle: '教父', enQuery: 'The Godfather', aliases: ['教父1', '教父2'] },
  { zhTitle: '肖申克的救赎', enQuery: 'The Shawshank Redemption', aliases: ['刺激1995', '月黑高飞'] },
  { zhTitle: '阿甘正传', enQuery: 'Forrest Gump', aliases: ['阿甘正傳'] },
  { zhTitle: '楚门的世界', enQuery: 'The Truman Show', aliases: ['真人Show'] },
  { zhTitle: '当幸福来敲门', enQuery: 'The Pursuit of Happyness', aliases: ['尋找快樂的故事'] },
  { zhTitle: '绿皮书', enQuery: 'Green Book', aliases: ['綠皮書'] },
  { zhTitle: '疯狂动物城', enQuery: 'Zootopia', aliases: ['優獸大都會', '动物方城市'] },
  { zhTitle: '寻梦环游记', enQuery: 'Coco', aliases: ['玩轉極樂園', '可可夜总会'] },
  { zhTitle: '冰雪奇缘', enQuery: 'Frozen', aliases: ['魔雪奇緣'] },
  { zhTitle: '狮子王', enQuery: 'The Lion King', aliases: ['獅子王'] },
  { zhTitle: '功夫熊猫', enQuery: 'Kung Fu Panda', aliases: ['功夫熊貓'] },
  { zhTitle: '千与千寻', enQuery: 'Spirited Away', aliases: ['神隱少女', '千與千尋'] },
  { zhTitle: '龙猫', enQuery: 'My Neighbor Totoro', aliases: ['龍貓'] },
  { zhTitle: '天空之城', enQuery: 'Castle in the Sky', aliases: ['天空之城拉普达'] },
  { zhTitle: '罗生门', enQuery: 'Rashomon', aliases: ['羅生門', '黑泽明罗生门'] },
  { zhTitle: '七武士', enQuery: 'Seven Samurai', aliases: ['黑泽明七武士'] },
  { zhTitle: '公民凯恩', enQuery: 'Citizen Kane', aliases: ['大国民'] },
  { zhTitle: '卡萨布兰卡', enQuery: 'Casablanca', aliases: ['北非谍影'] },
  { zhTitle: '罗马假日', enQuery: 'Roman Holiday', aliases: ['金枝玉叶', '羅馬假期'] },
  { zhTitle: '雨中曲', enQuery: 'Singin in the Rain', aliases: ['万花嬉春'] },
  { zhTitle: '惊魂记', enQuery: 'Psycho', aliases: ['精神病患者', '希区柯克惊魂记'] },
  { zhTitle: '迷魂记', enQuery: 'Vertigo', aliases: ['眩晕'] },
  { zhTitle: '后窗', enQuery: 'Rear Window', aliases: ['希区柯克后窗'] },
  { zhTitle: '三十九级台阶', enQuery: 'The 39 Steps', aliases: ['39级台阶', '国防大机密'], zhSummary: '阿尔弗雷德·希区柯克 1935 年英国时期悬疑逃亡惊悚名作。' },
  { zhTitle: '德古拉', enQuery: 'Dracula', aliases: ['吸血鬼德古拉'], zhSummary: '经典吸血鬼哥特惊悚电影银幕改编系列。' },
  { zhTitle: '金刚', enQuery: 'King Kong', aliases: ['金剛'] },
  { zhTitle: '哥斯拉', enQuery: 'Godzilla', aliases: ['哥吉拉'] },

  // —— 开放片库可直接观看的世界公版经典长片 ——
  { zhTitle: '将军号', enQuery: 'The General', aliases: ['將軍號', '巴斯特基顿将军号'], zhSummary: '巴斯特·基顿 1926 年影史动作喜剧巅峰杰作，围绕南北战争火车追逐展开，节奏紧凑、笑点密集。' },
  { zhTitle: '淘金记', enQuery: 'The Gold Rush', aliases: ['卓别林淘金记'], zhSummary: '查理·卓别林代表作，流浪汉夏尔洛在阿拉斯加淘金热中的悲喜奇遇，含经典“吃皮鞋”与悬崖木屋名场面。' },
  { zhTitle: '摩登时代', enQuery: 'Modern Times', aliases: ['摩登時代', '卓别林摩登时代'], zhSummary: '卓别林讽刺工业流水线时代的影史不朽经典。' },
  { zhTitle: '城市之光', enQuery: 'City Lights', aliases: ['卓别林城市之光'], zhSummary: '流浪汉为盲女筹钱治眼的温情喜剧杰作。' },
  { zhTitle: '寻子遇仙记', enQuery: 'The Kid', aliases: ['卓别林寻子遇仙记'], zhSummary: '卓别林首部长片，流浪汉与弃儿相依为命的感人喜剧。' },
  { zhTitle: '安全至下', enQuery: 'Safety Last', aliases: ['哈罗德劳埃德安全至下'], zhSummary: '默片喜剧三大师之一哈罗德·劳埃德代表作，大楼挂钟惊险攀爬场面载入影史。' },
  { zhTitle: '福尔摩斯二世', enQuery: 'Sherlock Jr', aliases: ['基顿福尔摩斯二世'], zhSummary: '巴斯特·基顿走入电影银幕破案的天才奇幻喜剧。' },
  { zhTitle: '谜中谜', enQuery: 'Charade', aliases: ['謎中謎', '奥黛丽赫本谜中谜'], zhSummary: '奥黛丽·赫本与加里·格兰特主演的 1963 年经典悬疑爱情喜剧，被称为“希区柯克未曾拍出的最佳希区柯克电影”。' },
  { zhTitle: '女友礼拜五', enQuery: 'His Girl Friday', aliases: ['女友禮拜五'], zhSummary: '霍华德·霍克斯执导的高语速神经喜剧经典，报社主编与王牌女记者的妙语交锋。' },
  { zhTitle: '活死人之夜', enQuery: 'Night of the Living Dead', aliases: ['活死人之夜1968'], zhSummary: '乔治·罗梅罗 1968 年开创现代丧尸电影先河的惊悚经典。' },
  { zhTitle: '猛鬼屋', enQuery: 'House on Haunted Hill', aliases: ['古堡惊魂'], zhSummary: '文森特·普莱斯主演的 1959 年经典悬疑惊悚片，富豪悬赏邀人共度古堡惊魂夜。' },
  { zhTitle: '恐怖小店', enQuery: 'The Little Shop of Horrors', aliases: ['异形奇花1960'], zhSummary: '罗杰·科曼 1960 年黑色幽默经典，花店学徒培育出嗜血食人花的荒诞故事。' },
  { zhTitle: '大都会', enQuery: 'Metropolis', aliases: ['大都會1927', '弗里茨朗大都会'], zhSummary: '弗里茨·朗 1927 年科幻电影开山巨作，展现未来阶层都市与机械姬的震撼视觉奇观。' },
  { zhTitle: '诺斯费拉图', enQuery: 'Nosferatu', aliases: ['吸血鬼诺斯费拉图'], zhSummary: '茂瑙 1922 年德国表现主义奇幻恐怖经典。' },
  { zhTitle: '歌剧魅影', enQuery: 'The Phantom of the Opera', aliases: ['歌劇魅影1925'], zhSummary: '朗·钱尼主演的 1925 年巴黎歌剧院悬疑经典。' },
  { zhTitle: '外太空九号计划', enQuery: 'Plan 9 from Outer Space', aliases: ['外太空九號計劃'], zhSummary: '艾德·伍德执导的影史传奇邪典科幻片。' },
  { zhTitle: '地球大战蜘蛛', enQuery: 'Earth vs the Spider', aliases: ['巨蛛袭城'], zhSummary: '1958 年美国经典怪兽科幻老电影。' },
  { zhTitle: '火车大劫案', enQuery: 'The Great Train Robbery', aliases: ['火車大劫案'], zhSummary: '1903 年西部片鼻祖，美国国会图书馆国家影片登记部首批入选经典。' },
  { zhTitle: '格列佛游记', enQuery: 'Gulliver Travels', aliases: ['小人国历险记'], zhSummary: '弗莱舍尔工作室 1939 年全彩长篇经典动画电影。' },
  { zhTitle: '大力水手', enQuery: 'Popeye the Sailor Meets Sindbad the Sailor', aliases: ['波派大战辛巴达', '水手波派'], zhSummary: '经典立体景深彩色动画名作，大力水手波派迎战辛巴达。' },
  { zhTitle: '孟菲斯美女号', enQuery: 'The Memphis Belle: A Story of a Flying Fortress', aliases: ['孟菲斯美女號'], zhSummary: '威廉·惠勒执导的二战真实空战彩色纪录长片。' },
  { zhTitle: '搭便车的人', enQuery: 'The Hitch-Hiker', aliases: ['搭车惊魂1953'], zhSummary: '艾达·卢皮诺执导的 1953 年经典黑色公路悬疑电影。' },
  { zhTitle: '门内', enQuery: 'Within Our Gates', aliases: ['在我们的门内'], zhSummary: '奥斯卡·米肖 1920 年影史重要经典剧情长片。' },
  { zhTitle: '卡里加里博士的小屋', enQuery: 'The Cabinet of Dr. Caligari', aliases: ['卡里加里博士'], zhSummary: '罗伯特·维内 1920 年表现主义悬疑心理惊悚开山鼻祖，结尾反转影响后世无数悬疑片。' },
  { zhTitle: '月球旅行记', enQuery: 'A Trip to the Moon', aliases: ['梅里爱月球旅行记'], zhSummary: '乔治·梅里爱 1902 年世界影史首部科幻奇幻名作，炮弹飞船射中月亮之眼成为永恒经典。' },
  { zhTitle: '科学怪人', enQuery: 'Frankenstein', aliases: ['弗兰肯斯坦'], zhSummary: '玛丽·雪莱同名科幻哥特小说改编的早期影史经典。' },
  { zhTitle: '化身博士', enQuery: 'Dr. Jekyll and Mr. Hyde', aliases: ['奇异的杰基尔博士'], zhSummary: '双重人格惊悚题材经典银幕改编杰作。' },
  { zhTitle: '狂欢之魂', enQuery: 'Carnival of Souls', aliases: ['灵魂狂欢节'], zhSummary: '1962 年悬疑心理惊悚经典，营造出梦魇般迷离诡谲的视听氛围。' },
  { zhTitle: '绕道', enQuery: 'Detour', aliases: ['歧路1945'], zhSummary: '埃德加·乌尔默 1945 年黑色电影神作，命运无常的公路惊魂故事。' },
  { zhTitle: '陌生人', enQuery: 'The Stranger', aliases: ['奥森威尔斯陌生人'], zhSummary: '奥森·威尔斯自导自演的 1946 年悬疑黑色电影名作。' },
  { zhTitle: '地球最后一人', enQuery: 'The Last Man on Earth', aliases: ['我是传奇1964'], zhSummary: '文森特·普莱斯主演，改编自《我是传奇》原著小说的末日科幻经典。' },
  { zhTitle: '大鼻子情圣', enQuery: 'Cyrano de Bergerac', aliases: ['西哈诺德贝热拉克'], zhSummary: '何塞·费勒凭本片斩获奥斯卡最佳男主角的 1950 年古典浪漫剑侠名片。' },
  { zhTitle: '皇家婚礼', enQuery: 'Royal Wedding', aliases: ['龙凤香车'], zhSummary: '弗雷德·阿斯泰尔主演的 1951 年彩色歌舞爱情经典，含著名的天花板旋转舞。' },
  { zhTitle: '星海浮沉录', enQuery: 'A Star Is Born', aliases: ['一个明星的诞生1937'], zhSummary: '1937 年奥斯卡获奖好莱坞励志爱情经典原版。' },
  { zhTitle: '丛林之书', enQuery: 'Jungle Book', aliases: ['奇幻森林1942', '森林王子'], zhSummary: '科达兄弟出品的 1942 年特艺彩色奇幻冒险经典大片。' },

  // —— 全球顶级开源 CG 动画电影（Blender Open Movies 等） ——
  { zhTitle: '辛特尔', enQuery: 'Sintel', aliases: ['寻龙少女辛特尔', 'Blender Sintel'], zhSummary: 'Blender 基金会出品的高分奇幻开源 CG 动画电影，少女辛特尔踏上寻找幼龙的感人旅程。' },
  { zhTitle: '大白兔', enQuery: 'Big Buck Bunny', aliases: ['巨兔邦尼', '开源大白兔'], zhSummary: 'Blender 基金会轻松欢乐的 3D 森林喜剧开源动画电影。' },
  { zhTitle: '钢铁之泪', enQuery: 'Tears of Steel', aliases: ['鋼鐵之淚'], zhSummary: '阿姆斯特丹实景与高水准 CG 结合的科幻机甲开源电影。' },
  { zhTitle: '春（开源动画）', enQuery: 'Spring', aliases: ['牧羊女与树灵'], zhSummary: '视效惊艳的奇幻自然开源 CG 动画短片。' },
  { zhTitle: '宇宙洗衣店', enQuery: 'Cosmos Laundromat', aliases: ['太空洗衣店'], zhSummary: '充满哲思与荒诞幽默的获奖开源 3D 动画电影。' },
  { zhTitle: '大象之梦', enQuery: 'Elephants Dream', aliases: ['大象的梦'], zhSummary: '世界首部开源 3D 电脑动画短片经典。' },
  { zhTitle: '精灵惊魂', enQuery: 'Sprite Fright', aliases: ['森林精灵惊魂'], zhSummary: 'Blender Studio 出品的 80 年代复古奇幻恐怖喜剧动画。' },
  { zhTitle: '极限充能', enQuery: 'Charge', aliases: ['充能'], zhSummary: 'Blender Studio 高水准赛博朋克写实动作视效短片。' },
  { zhTitle: '奇点', enQuery: 'Singularity', aliases: ['深空奇点'], zhSummary: '油画笔触渲染的科幻太空黑洞探险开源动画。' },
  { zhTitle: '特工327', enQuery: 'Agent 327', aliases: ['理发店行动'], zhSummary: '荷兰经典特工漫画改编的爆笑动作开源动画。' },
  { zhTitle: '飞天企鹅', enQuery: 'Wing It', aliases: ['飞天企鹅与小猫'], zhSummary: '农场小猫与企鹅共造火箭的欢乐卡通动画。' },
  { zhTitle: '咖啡记忆之旅', enQuery: 'Coffee Run', aliases: ['咖啡之旅'], zhSummary: '串联人生悲欢记忆的温暖治愈开源动画。' },
  { zhTitle: '美洲驼历险记', enQuery: 'Caminandes', aliases: ['羊驼历险记'], zhSummary: '冰原呆萌美洲驼爆笑无对白喜剧动画。' },
  { zhTitle: '韦伯望远镜', enQuery: 'Webb Journey to Space', aliases: ['詹姆斯韦伯', '韦伯太空望远镜'], zhSummary: 'NASA 詹姆斯·韦伯太空望远镜探索宇宙深空官方纪录片。' },
  { zhTitle: '毅力号火星车', enQuery: 'Mars 2020 Perseverance', aliases: ['毅力号', '火星着陆'], zhSummary: 'NASA 毅力号火星探测器着陆全过程官方实录。' },

  // —— 太空探索与科学历史纪录片 ——
  { zhTitle: '阿波罗11号登月', enQuery: 'Apollo 11', aliases: ['阿波罗11号', '人类登月纪录片'], zhSummary: 'NASA 官方历史影像档案，记录人类首次登月任务全程。' },
  { zhTitle: '阿波罗17号', enQuery: 'Apollo 17', aliases: ['阿波罗17号任务'], zhSummary: '阿波罗计划最后一次载人登月科学考察官方纪录长片。' },
  { zhTitle: '从太空看地球', enQuery: 'Earth from Space', aliases: ['太空看地球', '地球轨道影像'], zhSummary: '宇航员与轨道卫星视角下的壮丽蓝色星球超清影像。' },

  // —— 早期华语公共领域经典电影（中英检索兼顾） ——
  { zhTitle: '马路天使', enQuery: 'Street Angel', aliases: ['馬路天使', '周璇马路天使'], zhSummary: '袁牧之执导、周璇与赵丹主演的 1937 年中国影史经典名作。' },
  { zhTitle: '十字街头', enQuery: 'Crossroads', aliases: ['十字街頭', '赵丹白杨十字街头'], zhSummary: '沈西苓执导，赵丹、白杨主演的 1937 年都市青年悲喜剧经典。' },
  { zhTitle: '神女', enQuery: 'The Goddess', aliases: ['阮玲玉神女'], zhSummary: '吴永刚执导、阮玲玉演技巅峰代表作，中国无声电影瑰宝。' },
  { zhTitle: '小城之春', enQuery: 'Spring in a Small Town', aliases: ['费穆小城之春'], zhSummary: '费穆 1948 年执导的中国诗意电影巅峰杰作。' },
  { zhTitle: '一江春水向东流', enQuery: 'The Spring River Flows East', aliases: ['一江春水向東流'], zhSummary: '蔡楚生、郑君里执导的中国影史史诗级经典剧情片。' },
  { zhTitle: '铁扇公主', enQuery: 'Princess Iron Fan', aliases: ['鐵扇公主', '万氏兄弟铁扇公主'], zhSummary: '1941 年万氏兄弟执导的亚洲首部动画长片经典。' },
];

function normalizeAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** Check whether a query already matches the offline static bilingual dictionary. */
export function hasStaticOpenMediaAlias(query: string): boolean {
  return OPEN_MEDIA_QUERY_ALIASES.has(normalizeAliasKey(query));
}

/** Common Chinese release titles mapped to the English metadata used by open-media indexes. */
const OPEN_MEDIA_QUERY_ALIASES = (() => {
  const map = new Map<string, string>();
  for (const entry of BILINGUAL_FILM_LEXICON) {
    map.set(normalizeAliasKey(entry.zhTitle), entry.enQuery);
    for (const alias of entry.aliases) {
      if (/[\u3400-\u9fff]/u.test(alias)) {
        map.set(normalizeAliasKey(alias), entry.enQuery);
      }
    }
  }
  return map;
})();
const LOC_PUBLIC_DOMAIN_FILM_TITLES = new Set([
  'st louis blues',
  'popeye the sailor meets sindbad the sailor',
  'the house i live in',
  'the middleton family at the new york worlds fair',
  'modesta',
  'master hands',
  'the memphis belle a story of a flying fortress',
  'all my babies a midwife s own story',
  'under western stars',
  'duck and cover',
  'the hitch hiker',
  'trance and dance in bali',
  'within our gates',
  'san francisco earthquake and fire april 18 1906',
  'president mckinley taking the oath',
  'the great train robbery',
  'panorama of machine co aisle westinghouse co works',
  'may irwin kiss',
]);

function normalizeLocFilmTitle(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Exact allowlist from the Library of Congress Free to Use and Reuse public-domain film set. */
export function isLocPublicDomainFilmTitle(title: string): boolean {
  return LOC_PUBLIC_DOMAIN_FILM_TITLES.has(normalizeLocFilmTitle(title));
}

const ADULT_MEDIA_PATTERN = /\b(?:porn(?:ography)?|erotic|xxx|hentai|adult\s+(?:film|video|content)|sexually\s+explicit|nudity|nude\s+(?:film|video)|striptease|onlyfans)\b|色情|情色|成人视频|成人影片|裸露|裸体|福利片|伦理片/i;
const CONTRADICTORY_RIGHTS_PATTERN = /all rights reserved|copyright(?:ed)?\s*(?:©|\(c\)|:|by\b|\d{4})|©\s*\d{4}/i;

/** Reject obviously adult material even when an uploader labels it public domain. */
export function isOpenMediaAdult(title: string, description = ''): boolean {
  return ADULT_MEDIA_PATTERN.test(`${title} ${description}`);
}

/** Reject contradictory copyright claims in descriptive metadata even if licence fields disagree. */
export function hasContradictoryCopyrightClaim(description: string): boolean {
  return CONTRADICTORY_RIGHTS_PATTERN.test(description);
}

/** Minimum verified runtime for a feature-length film search. */
export const MIN_FEATURE_DURATION_SECONDS = 20 * 60;
export const MIN_SHORT_MEDIA_DURATION_SECONDS = 2 * 60;
export const MAX_FEATURE_DURATION_SECONDS = 24 * 60 * 60;

const NON_FEATURE_TITLE_PATTERN = /\b(?:trailer|teaser|tv\s*spot|promo(?:tional)?|preview|clip|excerpt|highlight\s*reel|highlights?|behind\s+the\s+scenes|making\s+of|interview|review|reaction|recap|gameplay|walkthrough|demo|tutorial|music\s+video|concert|vr\s+experience|virtual\s+reality|b-?roll|short\s+film|webisode|fan\s+edit|compilation|commercial|video\s+diary|vlog|web\s+series|tv\s+series|animated\s+series|complete\s+series|season\s+\d+|episode\s+\d+)\b|预告片|预告|花絮|访谈|影评|解说|混剪|片段|短片|短视频|音乐视频|演示|体验|游戏实况|幕后|制作特辑|宣传片|集锦|精彩片段|试玩|测评|反应视频|第\d+季|第\d+集|剧集/i;
const NON_FEATURE_DESCRIPTION_PATTERN = /\b(?:original\s+song|original\s+music|music\s+demo|music\s+app|music\s+performance|music\s+video|performed\s+on\s+[\w-]+|concert\s+performance|vr\s+experience|virtual\s+reality\s+experience|gameplay\s+footage|trailer\s+for|teaser\s+for|interview\s+with|review\s+of|reaction\s+to|behind\s+the\s+scenes|making\s+of|fan\s+edit|compilation\s+of\s+clips|nanoloop|htc\s+vive)\b|原唱|原创歌曲|音乐演示|音乐应用|游戏实况|预告片|访谈|幕后花絮/i;

/** Reject trailers, music demos, interviews, clips and other non-feature material. */
export function isOpenMediaNonFeatureContent(title: string, description = ''): boolean {
  return NON_FEATURE_TITLE_PATTERN.test(title) || NON_FEATURE_DESCRIPTION_PATTERN.test(description);
}

/** Parse a duration value in seconds, MM:SS, HH:MM:SS or ISO-8601 PT form. */
export function parseMediaDurationSeconds(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const part of value) {
      const parsed = parseMediaDurationSeconds(part);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const seconds = Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  const clock = raw.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/);
  if (clock) {
    const first = Number(clock[1]);
    const second = Number(clock[2]);
    const third = clock[3] === undefined ? null : Number(clock[3]);
    if (second >= 60 || (third !== null && third >= 60)) return null;
    const seconds = third === null ? first * 60 + second : first * 3600 + second * 60 + third;
    return seconds > 0 ? seconds : null;
  }

  const units = raw.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟))?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|秒))?$/i);
  if (units && (units[1] || units[2] || units[3])) {
    const seconds = Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }
  return null;
}

/** Read the real runtime fields returned by NASA asset metadata.json. */
export function parseNasaDurationSeconds(record: Record<string, unknown>): number | null {
  for (const value of [
    record['AVAIL:Duration'],
    record['QuickTime:Duration'],
    record['QuickTime:MediaDuration'],
    record['QuickTime:TrackDuration'],
    record.Duration,
    record.duration,
    record.runtime,
    record.TRT,
  ]) {
    const parsed = parseMediaDurationSeconds(value);
    if (parsed !== null) return parsed;
  }

  const xmp = record['XMP:Duration'];
  if (xmp && typeof xmp === 'object') {
    const value = Number((xmp as { Value?: unknown }).Value);
    const scale = Number((xmp as { Scale?: unknown }).Scale);
    const seconds = value * scale;
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

/** Extract labelled running times such as "TRT: 00:48:22" from NASA descriptions. */
export function extractMediaDurationSecondsFromText(value: string): number | null {
  const patterns = [
    /(?:TRT|total\s+run(?:ning)?\s*time|running\s*time|runtime|duration|playtime)\s*[:=]?\s*(\d{1,3}:\d{2}(?::\d{2}(?:\.\d+)?)?)/i,
    /(?:TRT|total\s+run(?:ning)?\s*time|running\s*time|runtime|duration|playtime)\s*[:=]?\s*(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|小时)(?:\s*\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|分钟))?(?:\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|秒))?|\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|分钟)(?:\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|秒))?|\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|秒))/i,
    /(?:片长|时长|总时长)\s*[:：]?\s*(\d{1,3}:\d{2}(?::\d{2}(?:\.\d+)?)?)/,
    /(?:片长|时长|总时长)\s*[:：]?\s*(\d+(?:\.\d+)?\s*小时(?:\s*\d+(?:\.\d+)?\s*分钟)?(?:\s*\d+(?:\.\d+)?\s*秒)?|\d+(?:\.\d+)?\s*分钟(?:\s*\d+(?:\.\d+)?\s*秒)?|\d+(?:\.\d+)?\s*秒)/,
    /[\[(（]\s*(\d{1,3}:\d{2}:\d{2})\s*[\])）]/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      const seconds = parseMediaDurationSeconds(match[1]);
      if (seconds !== null) return seconds;
    }
  }
  return null;
}

export function isFeatureLengthMedia(durationSeconds: number | null | undefined): durationSeconds is number {
  return typeof durationSeconds === 'number'
    && Number.isFinite(durationSeconds)
    && durationSeconds >= MIN_FEATURE_DURATION_SECONDS
    && durationSeconds <= MAX_FEATURE_DURATION_SECONDS;
}

/** Allow curated open movies/shorts (>= 2 min) when short-form open media is enabled. */
export function isPlayableOpenMediaDuration(
  durationSeconds: number | null | undefined,
  allowShort = false
): durationSeconds is number {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds)) return false;
  const minSeconds = allowShort ? MIN_SHORT_MEDIA_DURATION_SECONDS : MIN_FEATURE_DURATION_SECONDS;
  return durationSeconds >= minSeconds && durationSeconds <= MAX_FEATURE_DURATION_SECONDS;
}

export function formatMediaDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (part: number) => String(part).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Resolve a Chinese localized title to the English phrase indexed by public-media providers. */
export function resolveOpenMediaQuery(query: string): string {
  const raw = query.trim();
  const normalized = normalizeAliasKey(raw);
  return OPEN_MEDIA_QUERY_ALIASES.get(normalized) ?? raw;
}

/**
 * Return all equivalent Chinese/English aliases for a search term so `/api/search`
 * relevance filtering keeps legitimate translated hits without dropping strict filtering.
 */
export function expandBilingualQueryAliases(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  const norm = normalizeAliasKey(raw);
  const out = new Set<string>([raw]);
  const resolved = OPEN_MEDIA_QUERY_ALIASES.get(norm);
  if (resolved) out.add(resolved);

  for (const entry of BILINGUAL_FILM_LEXICON) {
    const candidateForms = [entry.zhTitle, entry.enQuery, ...entry.aliases];
    if (candidateForms.some((form) => normalizeAliasKey(form) === norm)) {
      for (const form of candidateForms) {
        if (form.trim()) out.add(form.trim());
      }
    }
  }
  return [...out];
}

/**
 * Attach a localized Chinese title and optional summary to English open-media items
 * so Chinese users can read titles and plot overviews directly.
 */
export function localizeOpenMediaItem(
  title: string,
  userQuery?: string
): { displayTitle: string; chineseSummary?: string } {
  const cleanTitle = title.trim();
  if (!cleanTitle) return { displayTitle: '' };
  const hasChineseInTitle = /[\u3400-\u9fff]/u.test(cleanTitle);

  for (const entry of BILINGUAL_FILM_LEXICON) {
    if (isOpenMediaTitleRelevant(cleanTitle, entry.enQuery)) {
      const displayTitle = hasChineseInTitle
        ? cleanTitle
        : `${entry.zhTitle} / ${cleanTitle}`;
      return { displayTitle, chineseSummary: entry.zhSummary };
    }
  }

  if (!hasChineseInTitle && userQuery && /[\u3400-\u9fff]/u.test(userQuery)) {
    const cleanQuery = userQuery.trim();
    const resolved = resolveOpenMediaQuery(cleanQuery);
    if (resolved !== cleanQuery && isOpenMediaTitleRelevant(cleanTitle, resolved)) {
      return { displayTitle: `${cleanQuery} · ${cleanTitle}` };
    }
  }

  return { displayTitle: cleanTitle };
}

/**
 * Cache aliases by their resolved provider query, not the user's localized spelling.
 * The version segment invalidates stale zero-result entries created before alias fixes.
 */
export function buildOpenMediaSearchCacheKey(query: string, allowShort = false): string {
  const resolved = resolveOpenMediaQuery(query).toLowerCase();
  return allowShort
    ? `open-media:search:v2:short:${resolved}`
    : `open-media:search:v2:${resolved}`;
}

/**
 * Require a contiguous multi-word title phrase. Single-word searches must match
 * the first or last title token, preventing "Spider" from matching "Dienamite
 * ... spider mites ..." while retaining titles such as "Earth Vs. The Spider".
 */
export function isOpenMediaTitleRelevant(title: string, query: string): boolean {
  const rawQuery = query.trim();
  if (!rawQuery || !title.trim()) return false;
  if (/[\u3400-\u9fff]/u.test(rawQuery)) {
    const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    return normalize(title).includes(normalize(rawQuery));
  }
  const words = (value: string): string[] => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const queryWords = words(rawQuery);
  const titleWords = words(title);
  if (queryWords.length === 0 || titleWords.length === 0 || queryWords.every((word) => SEARCH_STOP_WORDS.has(word))) return false;

  if (queryWords.length > 1) {
    const titlePrefix = title.trim().toLowerCase();
    const queryPrefix = rawQuery.toLowerCase();
    const suffix = titlePrefix.slice(queryPrefix.length).trimStart();
    if (titlePrefix.startsWith(queryPrefix) && [':', '：', '-', '–', '—', '(', '['].some((separator) => suffix.startsWith(separator))) return true;
  }

  if (queryWords.length === 1) {
    const last = titleWords[titleWords.length - 1];
    const terminal = /^\d{4}$/.test(last) ? titleWords[titleWords.length - 2] : last;
    return titleWords[0] === queryWords[0] || terminal === queryWords[0];
  }

  const wordMatches = (titleWord: string, queryWord: string) =>
    titleWord === queryWord || titleWord === `${queryWord}s` || queryWord === `${titleWord}s`;
  for (let i = 0; i <= titleWords.length - queryWords.length; i++) {
    if (i !== 0) continue;
    if (!queryWords.every((word, offset) => wordMatches(titleWords[i + offset], word))) continue;
    const next = titleWords[i + queryWords.length];
    if (!queryWords.some((word) => SEARCH_STOP_WORDS.has(word))) return true;
    const allowedSubtitleWords = new Set(['the', 'a', 'an']);
    if (!next || /^\d{4}$/.test(next) || allowedSubtitleWords.has(next)) return true;
  }
  return false;
}

export interface ArchiveVideoFile {
  name?: string;
  format?: string;
  size?: string | number;
  length?: string | number;
}

export interface NasaAssetManifest {
  collection?: { items?: Array<{ href?: unknown }> };
}

export function hasExplicitCopyright(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase().replace(/[.。]+$/g, '');
  if (!text) return false;
  if (/^(?:false|no|none|n\/a|na|0)$/.test(text)) return false;
  if (/^(?:not copyrighted|uncopyrighted|public domain(?: in the [a-z ]+)?|no copyright(?: restrictions?)?|no known copyright restrictions)$/.test(text)) return false;
  return true;
}

export function normalizeNasaAssetUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.hostname.toLowerCase() !== 'images-assets.nasa.gov'
      || url.username || url.password) return null;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

/** NASA /asset returns collection.items[].href, not a bare string array. */
export function extractNasaAssetUrls(manifest: NasaAssetManifest): string[] {
  return (manifest.collection?.items ?? [])
    .map((item) => normalizeNasaAssetUrl(item.href))
    .filter((href): href is string => href !== null);
}

export interface CommonsLicenseMetadata {
  LicenseShortName?: unknown;
  LicenseUrl?: unknown;
  UsageTerms?: unknown;
  Duration?: unknown;
  Copyrighted?: unknown;
  Artist?: unknown;
  Credit?: unknown;
  ImageDescription?: unknown;
  Description?: unknown;
}

/** MediaWiki extmetadata values are objects such as { value, source, hidden }, not plain strings. */
export function commonsMetaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || !('value' in value)) return '';
  const inner = (value as { value?: unknown }).value;
  return typeof inner === 'string' ? inner : '';
}

export interface CommonsVideoDerivative {
  src?: unknown;
  type?: unknown;
  transcodekey?: unknown;
  width?: unknown;
  height?: unknown;
  bandwidth?: unknown;
}

export interface CommonsVideoInfo {
  url?: unknown;
  thumburl?: unknown;
  mime?: unknown;
  duration?: unknown;
  descriptionurl?: unknown;
  extmetadata?: CommonsLicenseMetadata;
  derivatives?: CommonsVideoDerivative[];
}

/** Accept explicit public-domain, CC0, CC BY, CC BY-SA and CC BY-ND declarations only. */
export function isAllowedCommonsLicence(metadata?: CommonsLicenseMetadata): boolean {
  if (!metadata) return false;
  const copyrighted = commonsMetaText(metadata.Copyrighted).trim().toLowerCase();
  if (copyrighted === 'true' || copyrighted === 'yes') return false;
  const shortName = commonsMetaText(metadata.LicenseShortName || metadata.UsageTerms).trim().toLowerCase();
  const licenseUrl = commonsMetaText(metadata.LicenseUrl).trim().toLowerCase();
  if (/by-nc|non.?commercial|all rights reserved/.test(`${shortName} ${licenseUrl}`)) return false;
  if (/public domain|no known copyright restrictions/.test(shortName)) return true;
  if (/creativecommons\.org\/publicdomain\/zero\/1\.0/.test(licenseUrl)) return true;
  return /creativecommons\.org\/licenses\/(by|by-sa|by-nd)\//.test(licenseUrl);
}

/**
 * Return a browser-supported HTTPS video from Wikimedia's official upload CDN.
 * Prefer an available transcode at or below 720p and roughly 900 kbps. If no
 * derivative meets that mobile budget, use the smallest available one instead
 * of sending a phone the multi-gigabyte original. DASH-only
 * derivatives are skipped because this app currently uses hls.js/native HTML5.
 */
export function selectCommonsVideoFile(info?: CommonsVideoInfo): {
  url: string;
  thumbnail?: string;
  mime: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  isTranscode: boolean;
} | null {
  if (!info || typeof info.url !== 'string' || typeof info.mime !== 'string') return null;
  const allowedMime = new Set(['video/mp4', 'video/webm', 'video/ogg']);
  const originalMime = info.mime.split(';', 1)[0].trim().toLowerCase();
  if (!allowedMime.has(originalMime)) return null;

  const trustedMediaUrl = (value: unknown): URL | null => {
    if (typeof value !== 'string') return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.hostname === 'upload.wikimedia.org' ? parsed : null;
    } catch {
      return null;
    }
  };

  const original = trustedMediaUrl(info.url);
  if (!original) return null;
  let thumbnailUrl: string | undefined;
  if (typeof info.thumburl === 'string') {
    try {
      const thumbnail = new URL(info.thumburl);
      const allowedThumbnailHost = thumbnail.hostname === 'upload.wikimedia.org' || thumbnail.hostname === 'thumb.wikimedia.org';
      if (thumbnail.protocol === 'https:' && allowedThumbnailHost) thumbnailUrl = thumbnail.href;
    } catch {
      // A malformed optional thumbnail must not hide an otherwise valid video.
    }
  }

  const derivatives = (Array.isArray(info.derivatives) ? info.derivatives : []).flatMap((derivative) => {
    if (!derivative || typeof derivative !== 'object') return [];
    const url = trustedMediaUrl(derivative.src);
    const mime = typeof derivative.type === 'string' ? derivative.type.split(';', 1)[0].trim().toLowerCase() : '';
    const height = Number(derivative.height);
    const width = Number(derivative.width);
    const bandwidth = Number(derivative.bandwidth);
    if (!url || !allowedMime.has(mime) || !Number.isFinite(height) || height <= 0) return [];
    return [{
      url: url.href,
      mime,
      height,
      width: Number.isFinite(width) && width > 0 ? width : undefined,
      bandwidth: Number.isFinite(bandwidth) && bandwidth > 0 ? bandwidth : undefined,
    }];
  });

  if (derivatives.length > 0) {
    const mobileCandidates = derivatives.filter((item) => item.height <= 720);
    const underBandwidthBudget = mobileCandidates.filter((item) => item.bandwidth !== undefined && item.bandwidth <= 900_000);
    const pool = underBandwidthBudget.length > 0
      ? underBandwidthBudget
      : mobileCandidates.length > 0
        ? mobileCandidates
        : derivatives;
    pool.sort((a, b) => {
      if (underBandwidthBudget.length > 0) {
        return b.height - a.height || (a.bandwidth ?? Number.MAX_SAFE_INTEGER) - (b.bandwidth ?? Number.MAX_SAFE_INTEGER);
      }
      return a.height - b.height || (a.bandwidth ?? Number.MAX_SAFE_INTEGER) - (b.bandwidth ?? Number.MAX_SAFE_INTEGER);
    });
    const selected = pool[0];
    return {
      url: selected.url,
      thumbnail: thumbnailUrl,
      mime: selected.mime,
      width: selected.width,
      height: selected.height,
      bandwidth: selected.bandwidth,
      isTranscode: true,
    };
  }

  return { url: original.href, thumbnail: thumbnailUrl, mime: originalMime, isTranscode: false };
}

const ARCHIVE_ALLOWED_LICENSES = new Set([
  'https://creativecommons.org/licenses/publicdomain/',
  'https://creativecommons.org/publicdomain/mark/1.0/',
  'https://creativecommons.org/publicdomain/zero/1.0/',
  'https://creativecommons.org/licenses/by/4.0/',
  'https://creativecommons.org/licenses/by-sa/4.0/',
  'https://creativecommons.org/licenses/by/3.0/',
  'https://creativecommons.org/licenses/by-sa/3.0/',
  'https://creativecommons.org/licenses/by/2.5/',
  'https://creativecommons.org/licenses/by-sa/2.5/',
  'https://creativecommons.org/licenses/by/2.0/',
  'https://creativecommons.org/licenses/by-sa/2.0/',
]);

export interface ArchiveSubtitleCandidate {
  fileName: string;
  label: string;
  lang: string;
  format: 'vtt' | 'srt';
}

/** Extract safe .vtt / .srt caption files from an Internet Archive item, prioritizing Chinese tracks. */
export function extractArchiveSubtitleFiles(files: ArchiveVideoFile[]): ArchiveSubtitleCandidate[] {
  const out: Array<ArchiveSubtitleCandidate & { priority: number }> = [];
  const seen = new Set<string>();

  for (const file of files) {
    const rawName = typeof file.name === 'string' ? file.name.trim() : '';
    if (!rawName || rawName.length > 240 || rawName.includes('..') || /[\u0000-\u001f\\]/.test(rawName)) continue;
    const lower = rawName.toLowerCase();
    const format = lower.endsWith('.vtt') ? 'vtt' : lower.endsWith('.srt') ? 'srt' : null;
    if (!format) continue;
    // Skip auto-generated spectrogram/metadata sidecars that are not real subtitles
    if (seen.has(lower)) continue;
    seen.add(lower);

    let label = '外挂字幕';
    let lang = 'und';
    let priority = 3;

    if (/(?:^|[._\-\s])(?:zh(?:[-_](?:cn|hans|sg))?|chs|chi|chinese|简体|中文)(?:$|[._\-\s])/i.test(rawName)) {
      label = '简体中文字幕';
      lang = 'zh-CN';
      priority = 0;
    } else if (/(?:^|[._\-\s])(?:zh[-_](?:tw|hk|hant)|cht|繁体|繁體)(?:$|[._\-\s])/i.test(rawName)) {
      label = '繁体中文字幕';
      lang = 'zh-TW';
      priority = 1;
    } else if (/(?:^|[._\-\s])(?:en|eng|english)(?:$|[._\-\s])/i.test(rawName)) {
      label = '英文字幕 (English)';
      lang = 'en';
      priority = 2;
    } else {
      const base = rawName.split('/').pop()?.replace(/\.(?:vtt|srt)$/i, '') || '字幕';
      label = `字幕 (${base.slice(-24)})`;
    }

    out.push({ fileName: rawName, label, lang, format, priority });
  }

  return out
    .sort((a, b) => a.priority - b.priority || (a.format === 'vtt' ? -1 : 1))
    .slice(0, 6)
    .map(({ fileName, label, lang, format }) => ({ fileName, label, lang, format }));
}

/** Encode external IDs into the URL-safe ID shape accepted by LibreTV's detail route. */
export function encodeOpenMediaId(provider: OpenMediaProvider, externalId: string): string {
  return `om-${Buffer.from(`${provider}|${externalId}`, 'utf8').toString('base64url')}`;
}

export function decodeOpenMediaId(id: string): { provider: OpenMediaProvider; externalId: string } | null {
  if (!/^om-[\w-]+$/.test(id)) return null;
  try {
    const decoded = Buffer.from(id.slice(3), 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator < 1) return null;
    const provider = decoded.slice(0, separator);
    const externalId = decoded.slice(separator + 1);
    if (!externalId || !['archive', 'nasa', 'peertube', 'commons', 'loc', 'curated'].includes(provider)) return null;
    return { provider: provider as OpenMediaProvider, externalId };
  } catch {
    return null;
  }
}

/** Keep only explicit, reusable PeerTube declarations; unknown and All Rights Reserved are excluded. */
export function isAllowedPeerTubeLicence(licence: unknown): boolean {
  if (!licence || typeof licence !== 'object') return false;
  const id = Number((licence as { id?: unknown }).id);
  return [1, 2, 3, 7, 8].includes(id);
}

const ARCHIVE_PUBLIC_DOMAIN_COLLECTIONS = new Set([
  'feature_films',
  'scifi_horror',
  'comedy_films',
  'film_noir',
  'silent_films',
  'classic_tv',
  'animationandcartoons',
  'prelinger',
]);

/** Archive.org rights metadata is uploader-supplied; only explicit open/public-domain claims or curated PD collections pass. */
export function isArchiveRightsAllowed(metadata: {
  rights?: unknown;
  licenseurl?: unknown;
  collection?: unknown;
  allowCuratedCollections?: boolean;
}): boolean {
  const rawLicense = typeof metadata.licenseurl === 'string' ? metadata.licenseurl.trim() : '';
  const rights = typeof metadata.rights === 'string' ? metadata.rights.trim().toLowerCase().replace(/[.。]+$/g, '') : '';
  const clearlyUnrestricted = /^(?:not copyrighted|uncopyrighted|public domain(?: in the usa)?|no known copyright restrictions|no copyright restrictions)$/i.test(rights);
  if (!clearlyUnrestricted && /all rights reserved|copyrighted|copyright\s*(?:©|\(c\)|:|by\b|\d{4})|permission required|not for reuse|copyright status unknown|by-nc|non-?commercial/.test(`${rights} ${rawLicense.toLowerCase()}`)) return false;
  if (rawLicense) {
    try {
      const parsed = new URL(rawLicense);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== 'creativecommons.org') return false;
      const normalized = `https://creativecommons.org${parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`}`;
      return ARCHIVE_ALLOWED_LICENSES.has(normalized);
    } catch {
      return false;
    }
  }
  if (clearlyUnrestricted) return true;
  if (rights && /public\s*domain|no known copyright restrictions/.test(rights)) return true;
  if (metadata.allowCuratedCollections && metadata.collection) {
    const collections = Array.isArray(metadata.collection)
      ? metadata.collection.map((c) => String(c).toLowerCase())
      : [String(metadata.collection).toLowerCase()];
    if (collections.some((c) => ARCHIVE_PUBLIC_DOMAIN_COLLECTIONS.has(c))) return true;
  }
  return false;
}

/** Prefer small MP4 derivatives suitable for mobile playback; never select captions or thumbnails. */
export function selectArchiveVideoFile(files: ArchiveVideoFile[]): ArchiveVideoFile | null {
  const candidates = files.filter((file) => {
    const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
    const format = typeof file.format === 'string' ? file.format.toLowerCase() : '';
    return name.endsWith('.mp4') && (format.includes('mpeg4') || format.includes('h.264') || format.includes('mp4') || !format);
  });
  const withKnownDuration = candidates.filter((file) => parseMediaDurationSeconds(file.length) !== null);
  const verifiedFeatureFiles = withKnownDuration.filter((file) => isFeatureLengthMedia(parseMediaDurationSeconds(file.length)));
  // If the item contains both a short preview and a full film, never let a small preview win on size/resolution.
  const pool = verifiedFeatureFiles.length > 0
    ? verifiedFeatureFiles
    : withKnownDuration.length > 0
      ? withKnownDuration
      : candidates;
  const rank = (file: ArchiveVideoFile): number => {
    const name = (file.name || '').toLowerCase();
    if (name.includes('~mobile')) return 0;
    if (/640x480|480p|512kb/.test(name)) return 1;
    if (/720p|1280x720/.test(name)) return 2;
    const size = Number(file.size || 0);
    if (size > 0 && size <= 250 * 1024 * 1024) return 3;
    return 4;
  };
  return pool.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** NASA manifests contain mixed media; select an official NASA MP4 and prefer the mobile derivative. */
export function selectNasaVideoUrl(urls: string[]): string | null {
  const candidates = urls
    .map(normalizeNasaAssetUrl)
    .filter((url): url is string => url !== null && /\.mp4(?:$|\?)/i.test(url));
  const rank = (url: string): number => {
    if (/~mobile\.mp4(?:$|\?)/i.test(url)) return 0;
    if (/~medium\.mp4(?:$|\?)/i.test(url)) return 1;
    if (/~small\.mp4(?:$|\?)/i.test(url)) return 2;
    if (/~large\.mp4(?:$|\?)/i.test(url)) return 3;
    if (/~orig\.mp4(?:$|\?)/i.test(url)) return 4;
    return 5;
  };
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Reject private/local media URLs returned by federated instances before exposing them to browsers. */
export function normalizePeerTubeMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const rawHostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const hostname = rawHostname.replace(/\.+$/, '');
    if (url.protocol !== 'https:' || url.username || url.password
      || hostname === 'localhost' || hostname.endsWith('.localhost')
      || hostname.endsWith('.local') || hostname.endsWith('.internal')
      || hostname.endsWith('.test') || hostname.endsWith('.invalid')
      || isPrivateIP(hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** PeerTube exposes HLS playlists and direct files on the detail endpoint. */
export function selectPeerTubeStreamUrl(video: {
  streamingPlaylists?: Array<{ playlistUrl?: unknown }>;
  files?: Array<{ fileUrl?: unknown; resolution?: { id?: unknown } }>;
}): string | null {
  const playlist = video.streamingPlaylists?.map((item) => normalizePeerTubeMediaUrl(item.playlistUrl))
    .find((url): url is string => url !== null);
  if (playlist) return playlist;

  const files = (video.files ?? []).flatMap((item) => {
    const fileUrl = normalizePeerTubeMediaUrl(item.fileUrl);
    return fileUrl ? [{ ...item, fileUrl }] : [];
  });
  const rank = (item: { resolution?: { id?: unknown } }): number => {
    const resolution = Number(item.resolution?.id || 0);
    if (resolution === 480) return 0;
    if (resolution === 720) return 1;
    if (resolution > 0) return 2;
    return 3;
  };
  files.sort((a, b) => rank(a) - rank(b));
  return typeof files[0]?.fileUrl === 'string' ? files[0].fileUrl : null;
}

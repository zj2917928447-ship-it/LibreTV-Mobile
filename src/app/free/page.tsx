'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { Icon } from '@/components/icon';
import { SmartImage } from '@/components/smart-image';
import { Spinner } from '@/components/states';
import { SubtitleControlPanel, useSubtitleController } from '@/components/subtitle-bar';
import { useToast } from '@/components/toast';
import { clearProgress, db, progressKeyOf, saveProgress, updateHistoryProgress, upsertHistory } from '@/lib/db';
import { OPEN_BROWSE_CATEGORIES, type OpenBrowseCategory } from '@/lib/open-browse-categories';
import { useAppStore } from '@/lib/store';
import type { SubtitleTrack } from '@/lib/types';
import { OPEN_SETTINGS_EVENT } from '@/lib/ui-events';
import { cn } from '@/lib/utils';

const PlayerShell = dynamic(() => import('@/components/player-shell').then((module) => module.PlayerShell), {
  ssr: false,
  loading: () => <div className="aspect-video rounded-xl bg-black flex items-center justify-center"><Spinner size="lg" /></div>,
});

interface FreeMediaItem {
  vod_id: string;
  vod_name: string;
  vod_pic?: string;
  type_name?: string;
  vod_year?: string;
  vod_remarks?: string;
  vod_direct?: boolean;
  vod_content?: string;
}

interface FreeMediaResponse {
  code?: number;
  msg?: string;
  page?: number;
  hasMore?: boolean;
  list?: FreeMediaItem[];
}

interface FreeMediaDetail extends FreeMediaItem {
  vod_play_from?: string;
  vod_play_url?: string;
  vod_subtitles?: SubtitleTrack[];
}

const CURATED_CHINESE_PICKS: {
  category: string;
  items: { label: string; query: string; tag: string }[];
}[] = [
  {
    category: '多集连播剧集',
    items: [
      { label: '福尔摩斯1080p《秘密武器》与探案全集 (10部)', query: '福尔摩斯与秘密武器1080p', tag: '贝克街神探典藏' },
      { label: '奥斯卡《亨利八世》《大鼻子情圣》 (8部)', query: '亨利八世的私生活1933', tag: '奥斯卡影帝名作' },
      { label: '希区柯克《年轻与纯真》与铁塔追凶 (8部)', query: '希区柯克年轻与纯真1937', tag: '高分悬疑反转' },
      { label: '《飞侠哥顿》太空歌剧10章全集', query: '飞侠哥顿1936太空歌剧', tag: '星球大战灵感源头' },
      { label: '西部传奇《独行侠》与富贵山庄 (8部)', query: '独行侠1949原版西部剧', tag: '银弹游侠经典' },
      { label: '律政逆转《冤案辩护人》10集连播', query: '冤案辩护人1959律政推理剧', tag: '绝境无罪翻案' },
    ],
  },
  {
    category: '即点即播大片',
    items: [
      { label: '铁扇公主 (1941 亚洲首部动画长片1080P)', query: '铁扇公主', tag: '1080P 国漫鼻祖' },
      { label: '辛特尔 (奇幻寻龙)', query: '辛特尔', tag: '720p 直连' },
      { label: '钢铁之泪 (科幻机甲)', query: '钢铁之泪', tag: '720p 直连' },
      { label: '活死人之夜 (95分钟完整版)', query: '活死人之夜', tag: 'HLS 直连' },
      { label: '巨兔邦尼 (60帧喜剧)', query: '大白兔', tag: '720p 直连' },
      { label: '宇宙洗衣店', query: '宇宙洗衣店', tag: '获奖科幻动画' },
    ],
  },
  {
    category: '华语与世界名作',
    items: [
      { label: '风云儿女 (1935 义勇军进行曲诞生片)', query: '风云儿女', tag: '华语史诗经典' },
      { label: '夜半歌声 (1937 马徐维邦惊悚名作)', query: '夜半歌声', tag: '早期华语传奇' },
      { label: '桃李劫 (1934 袁牧之毕业歌名片)', query: '桃李劫', tag: '有声电影先驱' },
      { label: '姊妹花 (1934 胡蝶分饰两角)', query: '姊妹花', tag: '早期票房神话' },
      { label: '小城之春 (费穆)', query: '小城之春', tag: '华语百年榜首' },
      { label: '马路天使 (赵丹/周璇)', query: '马路天使', tag: '四季歌天涯歌女' },
    ],
  },
];

const DOMESTIC_FREE_PLATFORMS = [
  {
    name: '1905 电影网 · 免费大片库',
    description: 'CCTV-6 电影频道官方平台，常年提供上千部国产院线大片、经典老电影与中文译制片免费点播。',
    url: 'https://www.1905.com/vod/list/n_1/o3p1.html',
    category: '国产 + 译制大片',
    note: '国内直连 · 全中文配音/字幕 · 免会员',
  },
  {
    name: '央视网 CCTV · 影视剧场库',
    description: '中央广播电视总台官方片库，涵盖高清国产经典电视剧、历史正剧与院线佳作免费点播。',
    url: 'https://tv.cctv.com/yxg/',
    category: '高清正版剧集',
    note: '国内直连 · 高清正版免费',
  },
  {
    name: '哔哩哔哩 · 免费电影专区',
    description: '筛选全部“免费观看”正版中外高分电影、动画电影与经典港片，自带中文字幕与弹幕互动。',
    url: 'https://www.bilibili.com/movie/index/#st=2&order=2&Pay_type=0&page=1',
    category: '免费电影 + 动画',
    note: '国内直连 · 中文字幕',
  },
  {
    name: '腾讯视频 · 免费电影频道',
    description: '正版限免院线电影与经典港片、喜剧、动作片合集，无需开通 VIP 即可免费观看完整正片。',
    url: 'https://v.qq.com/channel/movie?listpage=1&channel=movie&ipay=867',
    category: '限免正片',
    note: '国内直连 · 全中文字幕',
  },
  {
    name: '爱奇艺 · 免费影视专区',
    description: '官方免费电影与剧集频道，定期轮换动作、科幻、悬疑及华语经典正片资源。',
    url: 'https://list.iqiyi.com/www/1/----------0---11-1-1-iqiyi--.html',
    category: '限免正片',
    note: '国内直连 · 全中文字幕',
  },
  {
    name: '优酷视频 · 免费电影片库',
    description: '优酷正版免费电影筛选专区，涵盖经典武侠、喜剧港片、国产佳作与怀旧老电影。',
    url: 'https://www.youku.com/channel/webmovie/list?filter=type_%E7%94%B5%E5%BD%B1_paid_1',
    category: '经典港片 + 国产',
    note: '国内直连 · 正版免费筛选',
  },
  {
    name: '芒果TV · 免费电影片库',
    description: '湖南广电旗下正版免费电影频道，精选免费华语爱情、喜剧、悬疑电影资源。',
    url: 'https://www.mgtv.com/lib/3?lastp=list_index&kind=a1&chargeInfo=b1',
    category: '华语免费正片',
    note: '国内直连 · 免 VIP 专区',
  },
  {
    name: '央视纪实 · 顶级中文纪录片库',
    description: 'CCTV-9 纪录频道官方海量高清自然探索、历史人文、宇宙科学全中文配音纪录片。',
    url: 'https://tv.cctv.com/lm/jlp/',
    category: '全中文纪录片',
    note: '国内直连 · 超清无广告',
  },
  {
    name: '国家公共文化云 · 共享影视厅',
    description: '文旅部公共数字文化工程平台，免费提供公益电影展映、戏曲名段与非遗人文影像。',
    url: 'https://www.culturedc.cn/',
    category: '公共文化展映',
    note: '国内直连 · 公益免注册',
  },
  {
    name: '早期华语经典电影馆藏 (Archive)',
    description: '互联网档案馆收录的公共领域早期中国电影、纪录片与历史影像合集。',
    url: 'https://archive.org/details/movies?query=chinese+film',
    category: '历史数字档案',
    note: '公共领域 · 历史文献',
  },
  {
    name: '央视频 · 免费电影电视大厅',
    description: '总台新媒体旗舰平台，提供央视全频道高清直播、4K 精品纪录片与经典影视剧免费点播。',
    url: 'https://www.yangshipin.cn/',
    category: '总台 4K 影视',
    note: '国内直连 · 官方超清正版',
  },
  {
    name: '中国纪录片网 · 国家级纪实库',
    description: '国家级纪录片展示门户，汇聚自然地理、历史文化、社会百态与科技探索中文纪录长片。',
    url: 'http://www.docuchina.cn/',
    category: '权威纪录长片',
    note: '国内直连 · 全中文配音/字幕',
  },
  {
    name: '咪咕视频 · 免费院线与体育专区',
    description: '中国移动旗下正版综合视频平台，设有限免电影剧场、热门赛事集锦与高清卫视频道。',
    url: 'https://www.miguvideo.com/',
    category: '限免院线 + 赛事',
    note: '国内直连 · 高码率正版',
  },
  {
    name: '搜狐视频 · 免费正版影视库',
    description: '涵盖悬疑网剧、经典华语老片、海外引进剧集与科学自然探索专题免费观看内容。',
    url: 'https://tv.sohu.com/movie/',
    category: '悬疑剧集 + 电影',
    note: '国内直连 · 免会员筛选',
  },
  {
    name: '风行网 · 经典怀旧免费电影库',
    description: '专注经典动作港片、抗战历史剧、合家欢喜剧与怀旧译制电影的正版免费点播专区。',
    url: 'https://www.fun.tv/retrieve/c-e794b5e5bdb1.f-e5858de8b4b9/',
    category: '怀旧港片 + 译制',
    note: '国内直连 · 免费筛选直达',
  },
  {
    name: '科普中国 · 科学影像馆',
    description: '中国科协主办官方科普视频库，收录航空航天、前沿物理、生命科学与大国重器高清纪实。',
    url: 'https://www.kepuchina.cn/',
    category: '科普纪实影像',
    note: '国内直连 · 全中文权威科普',
  },
  {
    name: '西瓜视频 · 免费高清放映厅',
    description: '汇聚海量免费正版经典国产大片、怀旧港片、年代剧集与人文纪录片，免登录即点即看。',
    url: 'https://www.ixigua.com/cinema',
    category: '经典大片放映厅',
    note: '国内直连 · 高码率中文',
  },
  {
    name: '中国数字科技馆 · 科学影院',
    description: '国家级公益科学影视平台，提供宇宙天文、深海探索、极地科考与球幕科普影片在线点播。',
    url: 'https://www.cdstm.cn/',
    category: '球幕与科学影院',
    note: '国内直连 · 公益免注册',
  },
  {
    name: '中国非遗数字博物馆 · 影音馆',
    description: '中国艺术研究院主办，收录传统戏剧、曲艺皮影、民间音乐与大师口述史高清纪录长片。',
    url: 'https://www.ihchina.cn/video.html',
    category: '非遗戏剧纪录',
    note: '国内直连 · 官方权威馆藏',
  },
  {
    name: '故宫博物院 · 宫廷历史影像库',
    description: '故宫官方数字影视专栏，呈现国宝文物修复、紫禁城建筑美学与历史文化超清短片集。',
    url: 'https://www.dpm.org.cn/auditions.html',
    category: '文物人文超清',
    note: '国内直连 · 4K 东方美学',
  },
  {
    name: '国家图书馆 · 中国记忆影音库',
    description: '中国国家图书馆公益数字资源门户，提供名家人文讲坛、古籍历史纪录片与曲艺展演。',
    url: 'http://open.nlc.cn/',
    category: '历史文献公开课',
    note: '国内直连 · 国家级数字馆藏',
  },
  {
    name: '新华网 · 纪实与微电影频道',
    description: '新华社官方高清纪实视频专题，涵盖山河地理、大国工程、人文故事与公益微电影。',
    url: 'https://www.news.cn/video/',
    category: '山河与时代纪实',
    note: '国内直连 · 权威高清',
  },
  {
    name: '中国科普博览 · 中科院科学影院',
    description: '中国科学院官方网络科普门户，汇聚SELF格致论道科学演讲、深空探测与前沿物理纪录短片。',
    url: 'https://www.kepu.net.cn/',
    category: '中科院前沿科普',
    note: '国内直连 · 院士专家主讲',
  },
  {
    name: '人民视频 · 时代纪实与人文微电影',
    description: '人民网官方视频平台，提供人文地理纪录片、非遗传承故事与公益微电影免费高清观看。',
    url: 'http://v.people.cn/',
    category: '人文纪实微电影',
    note: '国内直连 · 免登录高清',
  },
  {
    name: '光明网 · 文艺戏曲与思想影音馆',
    description: '聚焦中华传统戏曲名家展演、交响芭蕾艺术现场、博物馆考古与文化名家公开课。',
    url: 'https://v.gmw.cn/',
    category: '文化戏曲展演',
    note: '国内直连 · 经典艺术现场',
  },
  {
    name: '中国天气网 · 气象地理科普影视',
    description: '中国气象局官方气象影视栏目，呈现风云卫星云图实况、四季物候地理与极端自然奇观解析。',
    url: 'http://www.weather.com.cn/video/',
    category: '自然物候与气象',
    note: '国内直连 · 卫星实景科普',
  },
  {
    name: '央视戏曲 · 九州大戏台全剧场',
    description: 'CCTV-11 戏曲频道官方高清点播库，免费提供京剧、越剧、黄梅戏、豫剧、粤剧经典名家全本大戏。',
    url: 'https://tv.cctv.com/lm/jzdxt/',
    category: '名家全本戏曲',
    note: '国内直连 · 高清全本唱词字幕',
  },
  {
    name: '央视音乐 · 风华国乐与交响现场',
    description: 'CCTV-15 音乐频道精品乐团现场展演，汇聚民族器乐名曲、古典交响音乐会与影视金曲盛典。',
    url: 'https://tv.cctv.com/lm/fhgy/',
    category: '国乐交响现场',
    note: '国内直连 · 舞台超清无损视听',
  },
  {
    name: '国家大剧院 · 古典艺术视听专区',
    description: '国家大剧院联合央视网打造的公益高雅艺术平台，展播歌剧电影、芭蕾舞剧与室内乐大师现场。',
    url: 'https://ncpa-classic.cntv.cn/',
    category: '歌剧舞剧电影',
    note: '国内直连 · 殿堂级舞台实录',
  },
  {
    name: '中国农影网 · 乡土人文与自然生态库',
    description: '中国农业电影电视中心官方平台，免费播放美丽乡村地理、四季节气美食与生态自然纪实节目。',
    url: 'https://www.ntv.cn/',
    category: '乡土美食纪实',
    note: '国内直连 · 全中文高清纪实',
  },
  {
    name: '央视科教 · 探索发现与百家讲坛全集',
    description: 'CCTV-10 科教频道官方点播库，免费观看《探索·发现》考古秘境、《自然传奇》与《百家讲坛》历史名篇。',
    url: 'https://tv.cctv.com/cctv10/',
    category: '考古历史自然',
    note: '国内直连 · 全中文超清无广告',
  },
  {
    name: '央视少儿 · 经典国产动画与银河剧场',
    description: 'CCTV-14 少儿频道官方动画库，汇聚《西游记》《哪吒传奇》等国产经典动画全集与亲子科普剧场。',
    url: 'https://tv.cctv.com/cctv14/',
    category: '国产经典动画',
    note: '国内直连 · 合家欢高清连播',
  },
  {
    name: '数字敦煌 · 莫高窟壁画艺术与丝路影像',
    description: '敦煌研究院官方公益数字平台，超高清全景漫游莫高窟30个经典洞窟并展播丝路文化纪录短片。',
    url: 'https://www.e-dunhuang.com/',
    category: '国宝文化超清',
    note: '国内直连 · 亿级像素全景与影像',
  },
  {
    name: '中国电影博物馆 · 百年影史数字展厅',
    description: '国家级专业电影博物馆官方门户，呈现中国电影百年发展史料、早期胶片修复专题与公益影展导览。',
    url: 'https://www.cnfm.org.cn/',
    category: '百年影史典藏',
    note: '国内直连 · 官方权威影史馆',
  },
  {
    name: '央视网动画 · 国产动画大片全集库',
    description: '央视网官方独立动画门户，免费点播上百部国产神话历史、科幻冒险与益智经典动画全集。',
    url: 'https://donghua.cctv.com/',
    category: '国产动画全集',
    note: '国内直连 · 免会员全集连播',
  },
  {
    name: '央视体育 · 顶级赛事回放与体育纪实',
    description: 'CCTV-5 官方体育视频专区，提供奥运世锦赛经典战役回放、天下足球专题与体育人物纪录片。',
    url: 'https://sports.cctv.com/',
    category: '体育赛事纪实',
    note: '国内直连 · 高清赛事与纪录',
  },
  {
    name: '中国国家地理 · 极致山河科学影像',
    description: '《中国国家地理》官方门户，汇聚雪山冰川、喀斯特秘境、珍稀野生动植物与地理科考高清短片。',
    url: 'http://www.dili360.com/',
    category: '绝美山河地理',
    note: '国内直连 · 权威自然科考',
  },
  {
    name: '中国文艺网 · 舞台戏剧与曲艺视听馆',
    description: '中国文联官方艺术门户，展播全国优秀话剧、舞剧、相声曲艺、书法美术与民间艺术精品视频。',
    url: 'http://www.cflac.org.cn/',
    category: '戏剧曲艺展演',
    note: '国内直连 · 国家级文艺库',
  },
  {
    name: '央视国防军事 · 大国重器与军史纪实',
    description: 'CCTV-7 国防军事频道官方视频库，免费点播航空航海重器、历史战役纪实与军旅微电影。',
    url: 'https://military.cctv.com/',
    category: '军史重器纪实',
    note: '国内直连 · 权威超清纪实',
  },
  {
    name: '央视农业农村 · 乡土中国与风物美食',
    description: 'CCTV-17 官方视听专区，展播《致富经》《中国土特产大会》与各地乡间节庆非遗美食纪录片。',
    url: 'https://nongye.cctv.com/',
    category: '风物美食纪实',
    note: '国内直连 · 烟火人间超清',
  },
  {
    name: '中国海洋数字科普馆 · 深海探索影像',
    description: '聚焦蛟龙号/奋斗者号万米深潜实拍、珊瑚礁海洋生物与极地破冰科考公益科普视频。',
    url: 'http://www.nmdis.org.cn/',
    category: '深海极地科考',
    note: '国内直连 · 海洋科学馆藏',
  },
  {
    name: '国家博物馆 · 国宝微纪录与数字展演',
    description: '中国国家博物馆官方视听专栏，超清呈现镇馆青铜瓷器书画背后的千年历史故事。',
    url: 'https://www.chnmuseum.cn/',
    category: '国宝历史微片',
    note: '国内直连 · 殿堂文物解说',
  },
  {
    name: '故宫博物院 · 数字文物与紫禁城视听馆',
    description: '故宫博物院官方公益视听平台，免费观看《故宫新事》、紫禁城古建匠艺与宫廷珍宝超清纪录短片。',
    url: 'https://www.dpm.org.cn/',
    category: '紫禁国宝影像',
    note: '国内直连 · 皇家古建超清纪实',
  },
  {
    name: '中国科普博览 · 中科院官方科学视频库',
    description: '中国科学院官方科普门户，汇聚量子物理、天眼 FAST、航空航天与前沿地球科学演讲及纪录短片。',
    url: 'https://www.kepu.net.cn/',
    category: '中科院硬核科普',
    note: '国内直连 · 国家级科学视听',
  },
  {
    name: '央视戏曲 · 九州大戏台与全本戏曲电影',
    description: 'CCTV-11 戏曲频道官方点播库，免费观看京剧、越剧、黄梅戏、豫剧与粤剧经典名段及戏曲电影全集。',
    url: 'https://tv.cctv.com/cctv11/',
    category: '传统戏曲电影',
    note: '国内直连 · 长辈最爱全集免VIP',
  },
  {
    name: '央视音乐 · 风华国乐与交响音乐会现场',
    description: 'CCTV-15 音乐频道官方高清库，展播民族器乐盛典、世界名曲交响现场与经典影视金曲音乐会。',
    url: 'https://tv.cctv.com/cctv15/',
    category: '国乐交响现场',
    note: '国内直连 · 高音质视听盛宴',
  },
  {
    name: '中国美术馆 · 典藏艺术视听美育馆',
    description: '中国美术馆官方数字美育专栏，超高清呈现近现代书画雕塑大师真迹赏析、展览导览与艺术纪录短片。',
    url: 'https://www.namoc.org/',
    category: '国家级美术影像',
    note: '国内直连 · 大师真迹超清赏析',
  },
  {
    name: '央视财经 · 经济半小时与大国财经纪实库',
    description: 'CCTV-2 财经频道官方点播专区，免费提供产业前沿调查、智造工程纪录长片与消费生活专题视频。',
    url: 'https://tv.cctv.com/cctv2/',
    category: '产业商业纪实',
    note: '国内直连 · 深度纪实超清',
  },
  {
    name: '央视社会与法 · 天网与传奇故事纪实剧场',
    description: 'CCTV-12 社会与法频道官方点播库，免费连播《天网》《一线》《法律讲堂》真实大案推理纪实。',
    url: 'https://tv.cctv.com/cctv12/',
    category: '悬疑普法纪实',
    note: '国内直连 · 真实探案全集连播',
  },
  {
    name: '上海博物馆 · 江南国宝与特展数字影像馆',
    description: '上海博物馆官方数字展演平台，超清解读江南青铜书画珍宝、古埃及文明特展与文物修复纪实。',
    url: 'https://www.shanghaimuseum.net/',
    category: '江南文物特展',
    note: '国内直连 · 4K 博物馆导览',
  },
  {
    name: '中国电影资料馆 · 艺术影院与胶片修复专题',
    description: '国家级电影档案保存与修复中心官方门户，呈现早期华语电影4K数字修复成果、影史学术放映与经典导赏。',
    url: 'https://www.cfa.org.cn/',
    category: '4K修复影史',
    note: '国内直连 · 国家级电影档案库',
  },
  {
    name: '南京博物院 · 金陵历代珍宝数字视听馆',
    description: '中国三大博物馆之一官方数字门户，超清展播六朝风华、明清皇家瓷玉书画与非遗苏绣昆曲纪录影像。',
    url: 'https://www.njmuseum.com/',
    category: '六朝文物纪实',
    note: '国内直连 · 殿堂国宝视听',
  },
  {
    name: '中国科学技术馆 · 科学实验与球幕科普影院',
    description: '中国科技馆官方科普视听专栏，提供趣味物理化学实验秀、航天器原理动画与巨幕科学电影导览。',
    url: 'https://cstm.org.cn/',
    category: '趣味科学影院',
    note: '国内直连 · 青少年科普精选',
  },
  {
    name: '陕西历史博物馆 · 盛唐长安与丝路国宝影像馆',
    description: '陕历博官方数字展厅，超清呈现何家村盛唐遗宝、秦汉青铜文明与丝绸之路千年壁画纪录短片。',
    url: 'https://www.sxhm.com/',
    category: '秦唐国宝超清',
    note: '国内直连 · 盛唐美学影像',
  },
  {
    name: '央视中文国际 · 国家记忆与远方的家全集库',
    description: 'CCTV-4 官方高清栏目点播库，免费连播《国家记忆》历史大案解密、《远方的家》走遍中国山河与《传奇中国节》。',
    url: 'https://tv.cctv.com/cctv4/',
    category: '山河人文全集',
    note: '国内直连 · 全中文超清连播',
  },
  {
    name: '中国美术学院 · 国美美育公开课与影像展厅',
    description: '中国美院官方学术与美育门户，展播东方山水画论、现代设计前沿、毕业动画短片展与艺术大师讲堂。',
    url: 'https://www.caa.edu.cn/',
    category: '艺术动画美育',
    note: '国内直连 · 顶级美院展映',
  },
  {
    name: '北京电影学院 · 青年影展与学院短片学术窗',
    description: '北京电影学院官方学术展映资讯门户，聚焦国际学生影视作品展（ISFVF）获奖短片与电影大师讲堂。',
    url: 'https://www.bfa.edu.cn/',
    category: '学院短片展映',
    note: '国内直连 · 青年导演佳作',
  },
  {
    name: '浙江省博物馆 · 良渚吴越国宝数字视听馆',
    description: '浙博官方数字文化门户，超高清展示良渚玉器文明、《富春山居图》数字影像与江南丝竹非遗纪录短片。',
    url: 'https://www.zjmuseum.com.cn/',
    category: '吴越文物影像',
    note: '国内直连 · 馆藏数字精品',
  },
  {
    name: '河南博物院 · 华夏古乐与中原国宝视听馆',
    description: '河南博物院官方视听专栏，展播贾湖骨笛远古乐音复原演奏、商周青铜重器与唐宫乐舞数字微纪录。',
    url: 'https://www.chnmus.net/',
    category: '华夏古乐复原',
    note: '国内直连 · 千年古乐实录',
  },
  {
    name: '湖北省博物馆 · 曾侯乙编钟与楚文化影像馆',
    description: '湖北省博物馆官方门户，呈现曾侯乙编钟金石交响演奏实录、越王勾践剑与楚辞浪漫美学专题视频。',
    url: 'https://www.hbww.org.cn/',
    category: '编钟国宝现场',
    note: '国内直连 · 殿堂古乐超清',
  },
  {
    name: '四川广汉三星堆博物馆 · 古蜀青铜神树数字影像',
    description: '三星堆官方数字文化平台，超清直击祭祀坑考古新发现、黄金面具与青铜神树三维数字修复纪实。',
    url: 'https://www.sxd.cn/',
    category: '古蜀考古超清',
    note: '国内直连 · 奇迹考古纪实',
  },
  {
    name: '上海天文馆 · 苍穹天象与深空球幕科普视听',
    description: '全球最大规模天文馆官方科普平台，提供星空天象预告、陨石探秘与宇宙演化超高清科普短片。',
    url: 'https://www.sstm-sam.org.cn/',
    category: '苍穹天文科普',
    note: '国内直连 · 球幕级宇宙视听',
  },
  {
    name: '中央戏剧学院 · 戏剧舞台经典与影视学术展演',
    description: '中央戏剧学院官方艺术视听窗口，聚焦中外经典话剧展演、舞台美术创作纪实与表演大师讲堂。',
    url: 'https://www.chntheatre.edu.cn/',
    category: '殿堂话剧展演',
    note: '国内直连 · 学院派舞台经典',
  },
  {
    name: '中国交响乐团 · 殿堂交响与合唱音乐会视听馆',
    description: '国家级交响乐团官方门户，展播贝多芬马勒交响名篇、《黄河大合唱》及中国原创管弦乐现场。',
    url: 'http://www.cnso.com.cn/',
    category: '国家级交响现场',
    note: '国内直连 · 高保真视听实录',
  },
  {
    name: '湖南省博物馆 · 马王堆汉代奇珍数字影像馆',
    description: '湘博官方数字文化门户，超清解析马王堆辛追汉墓漆器帛画、素纱襌衣与湖湘千年文明纪录短片。',
    url: 'https://www.hnmuseum.com/',
    category: '汉代帛画国宝',
    note: '国内直连 · 超清文物解密',
  },
  {
    name: '台北故宫博物院 · 传世书画瓷玉高清数字展厅',
    description: '公开数字典藏门户，超高清赏析《快雪时晴帖》《谿山行旅图》、翠玉白菜与历代宫廷珍玩导览视频。',
    url: 'https://www.npm.gov.tw/',
    category: '传世书画珍玩',
    note: '超清馆藏导览 · 繁中界面',
  },
  {
    name: '国家自然博物馆 · 远古恐龙与生命演化科普馆',
    description: '国家自然博物馆官方科普影音库，生动呈现古生物恐龙化石复原、热带雨林动物与地球生命演化史。',
    url: 'https://www.nnhm.org.cn/',
    category: '古生物与自然',
    note: '国内直连 · 亲子科普必看',
  },
  {
    name: '中央音乐学院 · 民乐钢琴大师课与音乐会展播',
    description: '中央音乐学院官方学术与展演平台，汇聚古琴琵琶二胡名家独奏、国际音乐节现场与名师公开课。',
    url: 'https://www.ccom.edu.cn/',
    category: '名家器乐现场',
    note: '国内直连 · 殿堂音乐美育',
  },
  {
    name: '上海博物馆 · 青铜书画国宝高清数字馆',
    description: '上海博物馆官方数字展厅，超高清呈现大克鼎青铜重器、历代书画名迹与特展深度策展人导览影像。',
    url: 'https://www.shanghaimuseum.net/',
    category: '青铜书画国宝',
    note: '国内直连 · 4K馆藏导览',
  },
  {
    name: '北京电影学院 · 学院奖动画与青年短片视听窗',
    description: '北京电影学院官方学术展映窗口，聚焦“学院奖”优秀动画短片、纪录作品与电影大师创作讲堂。',
    url: 'https://www.bfa.edu.cn/',
    category: '学院动画短片',
    note: '国内直连 · 电影学府展映',
  },
  {
    name: '中国美术馆 · 百年丹青经典数字美术馆',
    description: '国家级美术殿堂官方数字平台，展播齐白石徐悲鸿吴冠中名作赏析、艺术大师访谈与展览全景视频。',
    url: 'https://www.namoc.org/',
    category: '丹青大师纪实',
    note: '国内直连 · 美术殿堂视听',
  },
  {
    name: '陕西历史博物馆 · 盛唐壁画与长安国宝影像馆',
    description: '陕历博官方数字文化门户，超清解析唐墓壁画乐舞图、兽首玛瑙杯与周秦汉唐千年都城文明纪录短片。',
    url: 'https://www.sxhm.com/',
    category: '盛唐壁画国宝',
    note: '国内直连 · 千年长安视听',
  },
  {
    name: '国家海洋博物馆 · 深海探索与蓝色星球科普馆',
    description: '国家级综合性海洋博物馆官方平台，呈现远古海洋霸主、深潜科考实录与极地珊瑚礁生态高清科普。',
    url: 'https://www.hymuseum.org.cn/',
    category: '深海生态科普',
    note: '国内直连 · 蓝色海洋纪实',
  },
  {
    name: '苏州博物馆 · 贝聿铭建筑美学与江南雅韵影像馆',
    description: '苏州博物馆官方数字平台，融合贝聿铭现代山水建筑导览、吴门四家书画特展与江南非遗苏工纪录片。',
    url: 'https://www.szmuseum.com/',
    category: '江南美学非遗',
    note: '国内直连 · 东方园林雅韵',
  },
];

const OVERSEAS_FREE_PLATFORMS = [
  {
    name: 'Tubi',
    description: '海量欧美电影、剧集和动画，广告支持，不收订阅费。',
    url: 'https://tubitv.com/',
    category: '海外免费点播',
    note: '英语界面 · 需美国/海外网络',
  },
  {
    name: 'Pluto TV',
    description: '免费电视直播频道和点播电影、剧集。',
    url: 'https://pluto.tv/',
    category: '直播 + 点播',
    note: '英语界面 · 需美国/海外网络',
  },
  {
    name: 'Plex 免费片库',
    description: '免费电影、纪录片与直播频道；免费片库无需开通 Plex Pass。',
    url: 'https://watch.plex.tv/on-demand',
    category: '全球免费片库',
    note: '含广告免费 · 多地区可用',
  },
  {
    name: 'YouTube Movies (Free with Ads)',
    description: 'YouTube 官方广告支持免费电影频道，支持开启自动中文字幕翻译。',
    url: 'https://www.youtube.com/feed/storefront?bp=ogUCKAU%3D',
    category: '支持自动中字',
    note: '需海外网络 · 播放器支持自动翻译中文字幕',
  },
  {
    name: 'Kanopy / Hoopla',
    description: '凭合作公共图书馆或高校资格无广告免费观看经典与独立电影。',
    url: 'https://www.kanopy.com/',
    category: '图书馆借阅',
    note: '需合作机构账号 · 免费无广告',
  },
];

const OPEN_CATALOGS = [
  { name: 'Blender Studio 官方开源影院', detail: '全球顶级开源 3D/2D 动画大片与制作纪录长片，国内高速直连即点即播。', url: 'https://studio.blender.org/films/' },
  { name: '互联网档案馆 (Internet Archive)', detail: '全球最大公共领域与开放许可电影库，已打通中英片名映射、内置字幕提取与代理加速。', url: 'https://archive.org/details/feature_films' },
  { name: '美国国会图书馆 (LOC)', detail: '国家影片登记部公共领域经典名片，官方修复版直链播放。', url: 'https://www.loc.gov/free-to-use/public-domain-films-from-the-national-film-registry' },
  { name: '维基共享资源 (Wikimedia Commons)', detail: '公共领域与知识共享许可视频，自动优选手机省流高清转码并提取多语种字幕。', url: 'https://commons.wikimedia.org/wiki/Category:Videos' },
  { name: 'PeerTube 开放视频联邦', detail: '全球去中心化视频平台开放授权长片，内置国内镜像自动回退。', url: 'https://framatube.org/' },
  { name: 'NASA 官方影像库', detail: '美国宇航局阿波罗登月、韦伯望远镜与火星探测超清实拍档案。', url: 'https://images.nasa.gov/' },
];

function MediaPosterCard({
  item,
  opening,
  imageProxyMode,
  customImageProxy,
  onPlay,
}: {
  item: FreeMediaItem;
  opening: boolean;
  imageProxyMode: 'direct' | 'proxy' | 'custom';
  customImageProxy: string;
  onPlay: (item: FreeMediaItem) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const firstSummaryLine = item.vod_content
    ?.split('\n')
    .find((line) => line.trim().length > 0)
    ?.replace(/^中文导览：/, '');

  return (
    <article className="card overflow-hidden flex flex-col group hover:border-accent/40 transition-colors">
      <div
        className="relative aspect-video bg-chip overflow-hidden cursor-pointer"
        onClick={() => onPlay(item)}
      >
        {item.vod_pic && !imgFailed ? (
          <SmartImage
            url={item.vod_pic}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={item.vod_name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onExhausted={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-accent/20 via-chip to-surface px-4 text-center">
            <Icon name="bolt" className="w-6 h-6 text-accent/70 mb-1.5" />
            <span className="text-xs font-medium text-muted line-clamp-2">{item.vod_name}</span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          {item.vod_direct ? (
            <span className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
              国内直连秒播
            </span>
          ) : (
            <span className="rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white/85">
              云端公版馆藏
            </span>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent px-2.5 py-2 flex items-center justify-between gap-2 text-[11px] text-white/90">
          {item.vod_year ? (
            <span className="rounded bg-black/55 px-1.5 py-0.5 font-medium">{item.vod_year}</span>
          ) : <span />}
          {item.vod_remarks && (
            <span className="truncate rounded bg-black/55 px-1.5 py-0.5">
              {item.vod_remarks.split('·')[0]?.trim()}
            </span>
          )}
        </div>
      </div>

      <div className="p-3.5 flex-1 flex flex-col">
        <div className="text-[11px] text-accent truncate mb-1">{item.type_name || '开放授权影片'}</div>
        <h3 className="font-semibold text-sm text-content leading-snug line-clamp-2">{item.vod_name}</h3>
        {firstSummaryLine && (
          <p className="text-xs text-muted mt-1.5 line-clamp-2 leading-relaxed">{firstSummaryLine}</p>
        )}
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-faint truncate">支持外挂/翻译中字</span>
          <button
            type="button"
            className="btn-primary btn-sm shrink-0"
            disabled={opening}
            onClick={() => onPlay(item)}
          >
            {opening ? <Spinner size="sm" /> : <Icon name="bolt" className="w-3.5 h-3.5" />}
            立即播放
          </button>
        </div>
      </div>
    </article>
  );
}

interface FreePlayRoute {
  name: string;
  episodes: { label: string; url: string }[];
}

function parseFreePlayRoutes(vodPlayUrl?: string, vodPlayFrom?: string): FreePlayRoute[] {
  if (!vodPlayUrl) return [];
  const fromNames = (vodPlayFrom || '').split('$$$').map((s) => s.trim());
  const groups = vodPlayUrl.split('$$$');
  const routes: FreePlayRoute[] = [];
  groups.forEach((group, gIdx) => {
    const out: { label: string; url: string }[] = [];
    const rawParts = group.split('#').map((s) => s.trim()).filter(Boolean);
    rawParts.forEach((entry, idx) => {
      const dollar = entry.indexOf('$');
      const label = dollar >= 0 ? entry.slice(0, dollar).trim() : `第${idx + 1}集`;
      const url = dollar >= 0 ? entry.slice(dollar + 1).trim() : entry.trim();
      if (/^https:\/\//i.test(url)) {
        out.push({ label: label || `第${idx + 1}集`, url });
      }
    });
    if (out.length > 0) {
      routes.push({
        name: fromNames[gIdx] || `线路 ${routes.length + 1}`,
        episodes: out,
      });
    }
  });
  return routes;
}

export default function FreeResourcesPage() {
  const { toast } = useToast();
  const playerSectionRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [allowShort, setAllowShort] = useState(true);
  const [results, setResults] = useState<FreeMediaItem[]>([]);
  const [browseCategory, setBrowseCategory] = useState<OpenBrowseCategory>('all');
  const [browseItems, setBrowseItems] = useState<FreeMediaItem[]>([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseHasMore, setBrowseHasMore] = useState(true);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [onlyDirectFast, setOnlyDirectFast] = useState(false);
  const [onlySeriesFast, setOnlySeriesFast] = useState(false);
  const [localFilter, setLocalFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(48);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState('');
  const [error, setError] = useState('');
  const [showOverseas, setShowOverseas] = useState(false);
  const [translatingDesc, setTranslatingDesc] = useState(false);
  const [playing, setPlaying] = useState<{
    id: string;
    title: string;
    url: string;
    routes: FreePlayRoute[];
    routeIndex: number;
    episodes: { label: string; url: string }[];
    episodeIndex: number;
    source: string;
    pic?: string;
    desc?: string;
    subtitles?: SubtitleTrack[];
  } | null>(null);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const FREE_HISTORY_SOURCE_KEY = '__open_free__';

  const getFreeRestorePosition = useCallback(async () => {
    if (!playing?.id) return 0;
    const entry = await db.progress.get(progressKeyOf(FREE_HISTORY_SOURCE_KEY, playing.id, playing.episodeIndex));
    return entry?.position ?? 0;
  }, [playing?.episodeIndex, playing?.id]);

  const handleFreeProgress = useCallback(
    (position: number, duration: number) => {
      if (!playing?.id) return;
      saveProgress(FREE_HISTORY_SOURCE_KEY, playing.id, playing.episodeIndex, position, duration).catch(() => {});
      updateHistoryProgress(FREE_HISTORY_SOURCE_KEY, playing.id, position, duration).catch(() => {});
    },
    [playing?.episodeIndex, playing?.id]
  );

  const selectEpisode = useCallback((nextIdx: number) => {
    setPlaying((prev) => {
      if (!prev || nextIdx < 0 || nextIdx >= prev.episodes.length) return prev;
      const ep = prev.episodes[nextIdx];
      upsertHistory({
        sourceKey: FREE_HISTORY_SOURCE_KEY,
        vodId: prev.id,
        title: prev.title,
        pic: prev.pic,
        episodeIndex: nextIdx,
        totalEpisodes: prev.episodes.length,
        playbackPosition: 0,
        duration: 0,
        timestamp: Date.now(),
      }).catch(() => {});
      return { ...prev, episodeIndex: nextIdx, url: ep.url };
    });
  }, []);

  const handleFreeEnded = useCallback(() => {
    if (!playing?.id) return;
    clearProgress(FREE_HISTORY_SOURCE_KEY, playing.id, playing.episodeIndex).catch(() => {});
    if (playing.episodes.length > 1 && playing.episodeIndex + 1 < playing.episodes.length) {
      const nextIdx = playing.episodeIndex + 1;
      const nextEp = playing.episodes[nextIdx];
      selectEpisode(nextIdx);
      toast(`正在自动连播：${nextEp.label}`, 'info');
    }
  }, [playing, selectEpisode, toast]);

  const { state: subtitleState, setState: setSubtitleState } = useSubtitleController(
    playing?.subtitles,
    playing?.id
  );

  const adFilter = useAppStore((state) => state.adFilter);
  const volumeBoost = useAppStore((state) => state.volumeBoost);
  const miniProgressBar = useAppStore((state) => state.miniProgressBar);
  const imageProxyMode = useAppStore((state) => state.imageProxyMode);
  const customImageProxy = useAppStore((state) => state.customImageProxy);

  const loadBrowseCategory = useCallback(async (cat: OpenBrowseCategory) => {
    setBrowseCategory(cat);
    setBrowsePage(1);
    setVisibleCount(48);
    setBrowseHasMore(true);
    setBrowseLoading(true);
    try {
      const response = await fetch(`/api/open-media?ac=browse&category=${encodeURIComponent(cat)}&pg=1&compact=1`);
      const data = (await response.json()) as FreeMediaResponse;
      if (response.ok && data.code === 1) {
        setBrowseItems(data.list ?? []);
        setBrowseHasMore(data.hasMore !== false);
      }
    } catch {
      // 静默回退
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const loadMoreBrowse = useCallback(async () => {
    if (browseLoadingMore || !browseHasMore) return;
    const nextPage = browsePage + 1;
    setBrowseLoadingMore(true);
    try {
      const response = await fetch(
        `/api/open-media?ac=browse&category=${encodeURIComponent(browseCategory)}&pg=${nextPage}`,
        { cache: 'no-store' }
      );
      const data = (await response.json()) as FreeMediaResponse;
      const incoming = data.list ?? [];
      if (response.ok && data.code === 1 && incoming.length > 0) {
        setBrowseItems((prev) => {
          const seen = new Set(prev.map((x) => x.vod_id));
          return [...prev, ...incoming.filter((x) => !seen.has(x.vod_id))];
        });
        setBrowsePage(nextPage);
        setBrowseHasMore(Boolean(data.hasMore));
      } else {
        setBrowseHasMore(false);
        toast('已加载当前分类全部在线馆藏', 'info');
      }
    } catch {
      setBrowseHasMore(false);
    } finally {
      setBrowseLoadingMore(false);
    }
  }, [browseCategory, browseHasMore, browseLoadingMore, browsePage, toast]);

  useEffect(() => {
    void loadBrowseCategory('all');
  }, [loadBrowseCategory]);

  const search = useCallback(async (rawQuery: string, shortMode = allowShort) => {
    const q = rawQuery.trim().slice(0, 100);
    if (!q) return;
    setQuery(q);
    setActiveSearchQuery(q);
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        ac: 'videolist',
        wd: q,
        zh: '1',
        ...(shortMode ? { short: '1' } : {}),
      });
      const response = await fetch('/api/open-media?' + params.toString(), { cache: 'no-store' });
      const data = await response.json() as FreeMediaResponse;
      if (!response.ok || data.code !== 1) throw new Error(data.msg || '免费资源搜索暂时不可用，请稍后重试。');
      setResults(data.list ?? []);
      if ((data.list ?? []).length === 0) {
        setError('内置公版开放片库暂未收录该商业院线片（受版权保护的新片不在公共领域库中）。你可浏览下方精选海报墙立即观看，或前往下方 74 大国内正版免费专区查找，也可在右上角「设置 → 源管理」导入 TVBox 多仓/单仓订阅。');
      }
    } catch (cause) {
      setResults([]);
      setError(cause instanceof Error ? cause.message : '搜索失败，请检查网络后重试。');
    } finally {
      setLoading(false);
    }
  }, [allowShort]);

  const clearSearch = () => {
    setQuery('');
    setActiveSearchQuery('');
    setResults([]);
    setError('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(query, allowShort);
  };

  const playItem = useCallback(async (item: FreeMediaItem, initialEpisodeIndex = 0) => {
    setOpeningId(item.vod_id);
    setError('');
    try {
      const params = new URLSearchParams({
        ac: 'videolist',
        ids: item.vod_id,
        zh: '1',
        ...(allowShort ? { short: '1' } : {}),
      });
      const response = await fetch('/api/open-media?' + params.toString(), { cache: 'no-store' });
      const data = await response.json() as { code?: number; list?: FreeMediaDetail[] };
      const detail = data.list?.[0];
      const routes = parseFreePlayRoutes(detail?.vod_play_url, detail?.vod_play_from);
      const episodes = routes[0]?.episodes ?? [];
      const safeEpIndex = episodes.length > 0
        ? Math.min(Math.max(0, initialEpisodeIndex), episodes.length - 1)
        : 0;
      const mediaUrl = episodes[safeEpIndex]?.url || '';
      if (!response.ok || data.code !== 1 || !/^https:\/\//i.test(mediaUrl)) {
        throw new Error('该馆藏条目当前网络下暂无法直接提取视频流（海外档案馆可能连接超时），推荐优先播放「开源动画大片」或「太空与纪实」分类中的国内高速直连影片。');
      }
      const resolvedTitle = detail?.vod_name || item.vod_name;
      const resolvedPic = detail?.vod_pic || item.vod_pic;
      setPlaying({
        id: item.vod_id,
        title: resolvedTitle,
        url: mediaUrl,
        routes,
        routeIndex: 0,
        episodes,
        episodeIndex: safeEpIndex,
        source: routes[0]?.name || item.type_name || '免费开放片库',
        pic: resolvedPic,
        desc: detail?.vod_content || item.vod_content,
        subtitles: detail?.vod_subtitles,
      });
      upsertHistory({
        sourceKey: FREE_HISTORY_SOURCE_KEY,
        vodId: item.vod_id,
        title: resolvedTitle,
        pic: resolvedPic,
        episodeIndex: safeEpIndex,
        totalEpisodes: episodes.length,
        playbackPosition: 0,
        duration: 0,
        timestamp: Date.now(),
      }).catch(() => {});
      setTimeout(() => {
        playerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '获取播放地址失败。');
    } finally {
      setOpeningId('');
    }
  }, [allowShort]);

  // 支持从首页精选海报或历史记录一键带 `?play=<vod_id>&ep=<index>` 直达自动起播
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (autoPlayedRef.current || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const playId = sp.get('play')?.trim();
    if (!playId) return;
    const epRaw = Number.parseInt(sp.get('ep') || '0', 10);
    const epIdx = Number.isFinite(epRaw) && epRaw >= 0 ? epRaw : 0;
    autoPlayedRef.current = true;
    void playItem({ vod_id: playId, vod_name: '精选直连影片' }, epIdx);
  }, [playItem]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header showSearch />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-content">免费资源中心</h1>
            <p className="text-sm text-muted mt-1">
              6476+ 部 100% 实测直连大片与 118 部多集连播剧集即点即播、中英双向检索、一键汉化中文字幕，并聚合 74 大国内正版免费片库。
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
              <span className="text-faint">独立片单直下（兼容 PotPlayer / VLC / TVBox）：</span>
              <a href="/open-vod-direct.m3u" download className="text-accent hover:underline">
                超清点播片单 (.m3u)
              </a>
              <span className="text-line">·</span>
              <a href="/open-live-channels.m3u" download className="text-accent hover:underline">
                10082台直播源 (.m3u)
              </a>
              <span className="text-line">·</span>
              <a href="/open-live-channels.txt" download className="text-accent hover:underline">
                国内通用直播 (.txt)
              </a>
              <span className="text-line">·</span>
              <a href="/open-media-sources.json" download className="text-accent hover:underline">
                全套订阅包 (.json)
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/live" className="btn-ghost btn-sm text-accent">
              <Icon name="bolt" className="w-3.5 h-3.5" />
              免费电视直播 (10082+ 直连 / 165000+ 扩展)
            </Link>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))}
            >
              <Icon name="plus" className="w-3.5 h-3.5" />
              导入 TVBox 多仓 / 订阅源
            </button>
          </div>
        </div>

        <section className="card p-4 sm:p-5 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="font-semibold text-content">双语检索全球六大免费开放片库</h2>
              <p className="text-xs text-muted mt-1">
                支持中文译名、英文原名或题材词检索（如“动画”“科幻”“太空”“将军号”“辛特尔”“活死人之夜”）。
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer shrink-0">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[#2563eb]"
                checked={allowShort}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAllowShort(next);
                  if (query.trim()) void search(query, next);
                }}
              />
              包含开源动画与经典短片 (≥2分钟)
            </label>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              className="input min-w-0 flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入中文片名、英文片名或题材（如：辛特尔、钢铁之泪、活死人之夜、动画、太空…）"
              maxLength={100}
              aria-label="搜索免费开放影视资源"
            />
            {activeSearchQuery && (
              <button type="button" className="btn-ghost shrink-0" onClick={clearSearch}>
                返回海报墙
              </button>
            )}
            <button className="btn-primary shrink-0" type="submit" disabled={loading || !query.trim()}>
              {loading ? <Spinner size="sm" /> : <Icon name="search" className="w-4 h-4" />}
              <span className="hidden sm:inline">搜索</span>
            </button>
          </form>

          <div className="mt-4 space-y-2">
            {CURATED_CHINESE_PICKS.map((group) => (
              <div key={group.category} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted mr-1 shrink-0">{group.category}：</span>
                {group.items.map((pick) => (
                  <button
                    key={pick.label}
                    type="button"
                    className="rounded-full border border-line bg-chip hover:bg-hover hover:border-accent/50 px-2.5 py-1 text-xs text-content transition-colors"
                    onClick={() => void search(pick.query, allowShort)}
                    disabled={loading}
                    title={pick.tag}
                  >
                    {pick.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        {playing && (
          <section ref={playerSectionRef} className="card p-3 sm:p-4 mb-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-content truncate">{playing.title}</h2>
                <p className="text-xs text-muted mt-1">{playing.source} · 免费直连播放（若直连受阻自动切换代理加速）</p>
              </div>
              <button className="btn-ghost btn-sm shrink-0" onClick={() => setPlaying(null)}>
                关闭播放器
              </button>
            </div>
            <div className="aspect-video bg-black rounded-xl overflow-hidden">
              <PlayerShell
                url={playing.url}
                title={
                  playing.episodes.length > 1
                    ? `${playing.title} · ${playing.episodes[playing.episodeIndex]?.label || ''}`
                    : playing.title
                }
                adFilter={adFilter}
                autoplayNext={playing.episodes.length > 1 && playing.episodeIndex + 1 < playing.episodes.length}
                autoSkipSegments={false}
                volumeBoost={volumeBoost}
                miniProgressBar={miniProgressBar}
                pendingStart={pendingStart}
                onPendingStart={setPendingStart}
                getRestorePosition={getFreeRestorePosition}
                onTimeUpdate={handleFreeProgress}
                onPause={handleFreeProgress}
                onEnded={handleFreeEnded}
                subtitles={playing.subtitles}
                activeSubtitleKey={subtitleState.activeKey}
                localSubtitleText={subtitleState.localText}
                subtitleOffset={subtitleState.offset}
                subtitleSize={subtitleState.size}
                onRemoteSubtitleLoaded={(text) =>
                  setSubtitleState((prev) => ({ ...prev, remoteLoadedText: text }))
                }
              />
            </div>
            {playing.routes.length > 1 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-faint mr-1">播放线路:</span>
                {playing.routes.map((route, rIdx) => (
                  <button
                    key={`${route.name}-${rIdx}`}
                    type="button"
                    onClick={() => {
                      const nextEpIdx = Math.min(playing.episodeIndex, route.episodes.length - 1);
                      const nextUrl = route.episodes[nextEpIdx]?.url;
                      if (!nextUrl) return;
                      setPlaying((prev) =>
                        prev
                          ? {
                              ...prev,
                              routeIndex: rIdx,
                              episodes: route.episodes,
                              episodeIndex: nextEpIdx,
                              url: nextUrl,
                              source: route.name,
                            }
                          : prev
                      );
                      toast(`已切换至「${route.name}」`, 'info');
                    }}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      rIdx === playing.routeIndex
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-line bg-chip text-muted hover:text-content'
                    )}
                  >
                    {route.name}
                  </button>
                ))}
              </div>
            )}
            {playing.episodes.length > 1 && (
              <div className="mt-3 rounded-lg border border-line bg-chip/60 p-2.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-medium text-content">
                    剧集连播选集（第 {playing.episodeIndex + 1} / {playing.episodes.length} 集 · 播完自动切下一集）
                  </span>
                  {playing.episodeIndex + 1 < playing.episodes.length && (
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline shrink-0"
                      onClick={() => selectEpisode(playing.episodeIndex + 1)}
                    >
                      下一集 →
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                  {playing.episodes.map((ep, idx) => {
                    const active = idx === playing.episodeIndex;
                    return (
                      <button
                        key={`${ep.url}-${idx}`}
                        type="button"
                        onClick={() => selectEpisode(idx)}
                        className={cn(
                          'rounded-md border px-2.5 py-1.5 text-left text-xs truncate transition-colors',
                          active
                            ? 'border-accent bg-accent/15 text-accent font-medium'
                            : 'border-line bg-surface text-content hover:border-accent/40'
                        )}
                        title={ep.label}
                      >
                        {ep.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <SubtitleControlPanel
                remoteTracks={playing.subtitles}
                state={subtitleState}
                onChange={setSubtitleState}
                onToast={(msg) => toast(msg, 'info')}
              />
              {playing.desc && /[A-Za-z]{12,}/.test(playing.desc) && (
                <button
                  type="button"
                  className="btn-ghost btn-sm text-accent"
                  disabled={translatingDesc}
                  onClick={async () => {
                    if (!playing.desc) return;
                    setTranslatingDesc(true);
                    try {
                      const lines = playing.desc.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12);
                      const res = await fetch('/api/translate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lines }),
                      });
                      if (!res.ok) throw new Error('翻译失败');
                      const data = (await res.json()) as { translations?: string[] };
                      if (data.translations?.length) {
                        setPlaying((prev) => (prev ? { ...prev, desc: data.translations!.join('\n') } : prev));
                        toast('已将英文简介翻译为简体中文', 'success');
                      }
                    } catch {
                      toast('简介翻译暂不可用，请稍后重试', 'error');
                    } finally {
                      setTranslatingDesc(false);
                    }
                  }}
                >
                  {translatingDesc ? '正在翻译简介…' : '翻译英文简介'}
                </button>
              )}
            </div>
            {playing.desc && (
              <p className="mt-3 text-xs text-muted whitespace-pre-line leading-relaxed border-t border-line pt-2.5 line-clamp-5">
                {playing.desc}
              </p>
            )}
          </section>
        )}

        {error && (
          <div className="rounded-lg border border-line bg-chip px-4 py-3 text-sm text-muted mb-5" role="status">
            {error}
          </div>
        )}

        {loading && <div className="py-10 flex justify-center"><Spinner size="lg" /></div>}

        {!loading && activeSearchQuery && results.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-semibold text-content">
                “{activeSearchQuery}” 的免费可播结果
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-faint">{results.length} 部可用影片</span>
                <button type="button" className="text-xs text-accent hover:underline" onClick={clearSearch}>
                  清除筛选
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {results.map((item) => (
                <MediaPosterCard
                  key={item.vod_id}
                  item={item}
                  opening={openingId === item.vod_id}
                  imageProxyMode={imageProxyMode}
                  customImageProxy={customImageProxy}
                  onPlay={(target) => void playItem(target)}
                />
              ))}
            </div>
          </section>
        )}

        {/* 首屏精选开放影院海报墙 */}
        <section className="mb-10">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-semibold text-content">内置开放影院 · 分类海报墙</h2>
              <p className="text-xs text-muted mt-0.5">
                免搜索直接点播：涵盖官方开源 CG 动画电影、NASA / ESO 太空球幕长片、世界公版名作与早期华语经典。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <input
                  type="search"
                  value={localFilter}
                  onChange={(e) => {
                    setLocalFilter(e.target.value);
                    setVisibleCount(48);
                  }}
                  placeholder="快速筛选当前列表（如：创生之柱、露西、4K…）"
                  aria-label="快速筛选当前海报墙影片"
                  className="input h-8 px-2.5 text-xs w-52 sm:w-60"
                />
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm text-accent border border-line hover:border-accent/50"
                disabled={browseItems.length === 0 || Boolean(openingId)}
                onClick={() => {
                  const directPool = browseItems.filter((x) => x.vod_direct);
                  const pool = directPool.length > 0 ? directPool : browseItems;
                  const picked = pool[Math.floor(Math.random() * pool.length)];
                  if (picked) void playItem(picked);
                }}
              >
                <Icon name="bolt" className="w-3.5 h-3.5" />
                随机挑片即播
              </button>
              <label className="flex items-center gap-1.5 text-xs text-accent cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[#2563eb]"
                  checked={onlySeriesFast}
                  onChange={(e) => {
                    setOnlySeriesFast(e.target.checked);
                    setVisibleCount(48);
                  }}
                />
                仅看多集连播剧集
              </label>
              <label className="flex items-center gap-1.5 text-xs text-accent cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[#2563eb]"
                  checked={onlyDirectFast}
                  onChange={(e) => {
                    setOnlyDirectFast(e.target.checked);
                    setVisibleCount(48);
                  }}
                />
                仅看国内直连秒播
              </label>
              <span className="text-xs text-faint">
                共{' '}
                {
                  browseItems.filter((x) => {
                    if (onlyDirectFast && !x.vod_direct) return false;
                    if (onlySeriesFast && !(x.vod_remarks || '').includes('集连播')) return false;
                    const kw = localFilter.trim().toLowerCase();
                    if (!kw) return true;
                    return `${x.vod_name} ${x.vod_remarks || ''} ${x.vod_content || ''}`
                      .toLowerCase()
                      .includes(kw);
                  }).length
                }{' '}
                部影片
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3">
            {OPEN_BROWSE_CATEGORIES.map((cat) => {
              const active = browseCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => void loadBrowseCategory(cat.id)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5',
                    active
                      ? 'border-accent bg-accent/15 text-accent font-semibold'
                      : 'border-line bg-chip text-muted hover:text-content hover:border-accent/40'
                  )}
                >
                  <span>{cat.label}</span>
                  <span className="text-[10px] opacity-75">· {cat.badge}</span>
                </button>
              );
            })}
          </div>

          {browseLoading ? (
            <div className="py-10 flex justify-center"><Spinner size="lg" /></div>
          ) : (
            <>
              {(() => {
                const kw = localFilter.trim().toLowerCase();
                const filteredBrowse = browseItems.filter((x) => {
                  if (onlyDirectFast && !x.vod_direct) return false;
                  if (onlySeriesFast && !(x.vod_remarks || '').includes('集连播')) return false;
                  if (!kw) return true;
                  return `${x.vod_name} ${x.vod_remarks || ''} ${x.vod_content || ''}`
                    .toLowerCase()
                    .includes(kw);
                });
                const visibleBrowse = filteredBrowse.slice(0, visibleCount);
                return (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                      {visibleBrowse.map((item) => (
                        <MediaPosterCard
                          key={item.vod_id}
                          item={item}
                          opening={openingId === item.vod_id}
                          imageProxyMode={imageProxyMode}
                          customImageProxy={customImageProxy}
                          onPlay={(target) => void playItem(target)}
                        />
                      ))}
                    </div>
                    {visibleCount < filteredBrowse.length && (
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                        <button
                          type="button"
                          className="btn-primary px-5 py-2 text-sm"
                          onClick={() => setVisibleCount((prev) => prev + 72)}
                        >
                          继续展开下 72 部（已展示 {visibleBrowse.length} / {filteredBrowse.length} 部）
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-4 py-2 text-xs text-muted hover:text-content border border-line"
                          onClick={() => setVisibleCount(filteredBrowse.length)}
                        >
                          一次展开全部 {filteredBrowse.length} 部
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
              {browseHasMore && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    className="btn-ghost px-5 py-2 text-sm text-accent border border-line hover:border-accent/50"
                    disabled={browseLoadingMore}
                    onClick={() => void loadMoreBrowse()}
                  >
                    {browseLoadingMore ? (
                      <>
                        <Spinner size="sm" />
                        正在拉取更多在线开放片库…
                      </>
                    ) : (
                      <>
                        <Icon name="plus" className="w-4 h-4" />
                        加载更多在线片库馆藏（已展示 {browseItems.length} 部）
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="mb-8">
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-content">国内四十六大正版免费影视专区（全中文 · 免代理直达）</h2>
            <p className="text-sm text-muted mt-1">
              精选国内无需订阅 VIP 会员即可观看的正版免费电影、电视剧与纪录片官方片库，全部自带中文配音或中文字幕。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {DOMESTIC_FREE_PLATFORMS.map((platform) => (
              <article key={platform.name} className="card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-content">{platform.name}</h3>
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent shrink-0">
                    {platform.category}
                  </span>
                </div>
                <p className="text-sm text-muted mt-2 min-h-10">{platform.description}</p>
                <p className="text-xs text-faint mt-2">{platform.note}</p>
                <a
                  href={platform.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost btn-sm mt-4 self-start text-accent"
                >
                  进入免费片库 <Icon name="link" className="w-3.5 h-3.5" />
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-content">软件内置六大开放影视数据源</h2>
            <p className="text-sm text-muted mt-1">
              以下数据源已全部集成到上方搜索框与首页聚合搜索中，命中条目可直接在应用内播放并支持挂载中文字幕。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {OPEN_CATALOGS.map((catalog) => (
              <article key={catalog.name} className="card p-4">
                <h3 className="font-semibold text-content">{catalog.name}</h3>
                <p className="text-sm text-muted mt-2 min-h-10">{catalog.detail}</p>
                <a
                  href={catalog.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent mt-3"
                >
                  查看官方馆藏 <Icon name="link" className="w-3.5 h-3.5" />
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base font-semibold text-content">海外免费流媒体平台（英文界面 · 需相应地区网络）</h2>
              <p className="text-xs text-muted mt-0.5">
                默认折叠以保持全中文浏览体验；如具备海外网络环境可展开访问。
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm shrink-0"
              onClick={() => setShowOverseas((v) => !v)}
            >
              {showOverseas ? '收起海外平台' : `展开海外平台 (${OVERSEAS_FREE_PLATFORMS.length})`}
            </button>
          </div>

          {showOverseas && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-fade-in">
              {OVERSEAS_FREE_PLATFORMS.map((platform) => (
                <article key={platform.name} className="card p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-content">{platform.name}</h3>
                    <span className="rounded-full bg-chip px-2 py-1 text-[10px] text-muted shrink-0">
                      {platform.category}
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-2 min-h-10">{platform.description}</p>
                  <p className="text-xs text-faint mt-2">{platform.note}</p>
                  <a
                    href={platform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost btn-sm mt-4 self-start"
                  >
                    打开平台 <Icon name="link" className="w-3.5 h-3.5" />
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="text-sm text-muted">
          <Link href="/" className="text-accent hover:underline">返回首页搜索更多源</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseM3u } from './m3u-parser';
import { PUBLIC_LIVE_PACKS, resolvePublicLivePackUrl } from './public-live-packs';

describe('open-live-channels.m3u & PUBLIC_LIVE_PACKS', () => {
  it('内置直播频道表包含 9508+ 条经双阶实测去重的 HTTPS 频道与 12 大全中文分组', () => {
    const raw = readFileSync(resolve(process.cwd(), 'public/open-live-channels.m3u'), 'utf8');
    const channels = parseM3u(raw, 'https://app.example/open-live-channels.m3u');
    expect(channels.length).toBeGreaterThanOrEqual(9508);
    const urls = new Set<string>();
    for (const ch of channels) {
      expect(ch.url.startsWith('https://')).toBe(true);
      expect(ch.group).toBeTruthy();
      expect(/^https:\/\/\d+\.\d+\.\d+\.\d+/.test(ch.url)).toBe(false);
      urls.add(ch.url);
    }
    expect(urls.size).toBe(channels.length);

    const groups = new Set(channels.map((c) => c.group));
    expect(groups.has('华语卫视与影视')).toBe(true);
    expect(groups.has('CGTN与亚洲国际')).toBe(true);
    expect(groups.has('24小时电影大片')).toBe(true);
    expect(groups.has('经典老片与热播剧')).toBe(true);
    expect(groups.has('动漫番剧与少儿')).toBe(true);
    expect(groups.has('太空与自然纪实')).toBe(true);
    expect(groups.has('人文历史与科教')).toBe(true);
    expect(groups.has('综艺喜剧与合家欢')).toBe(true);
    expect(groups.has('美食旅行与慢直播')).toBe(true);
    expect(groups.has('体育赛事与极限汽车')).toBe(true);
    expect(groups.has('全球音乐与演唱会')).toBe(true);
    expect(groups.has('欧美与欧洲高清台')).toBe(true);
  });

  it('公开频道分类包覆盖 250 大包且均可解析为合法 HTTPS 订阅地址', () => {
    expect(PUBLIC_LIVE_PACKS.length).toBeGreaterThanOrEqual(250);
    for (const pack of PUBLIC_LIVE_PACKS) {
      const resolved = resolvePublicLivePackUrl(pack, 'https://app.example');
      expect(resolved.startsWith('https://')).toBe(true);
    }
  });
});

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkLiveUrlAllowed, checkUpstreamAllowed, isValidProxyUrl } from '@/lib/ssrf';
import { fetchUpstream } from '@/lib/fetch-utils';
import { readResponseTextLimited } from '@/lib/response-body';
import { isSameOriginPath } from '@/lib/same-origin-builtin';
import { parseM3u } from '@/lib/m3u-parser';
import { hostnameOf } from '@/lib/source-list';
import { decryptTvboxPayloadIfNeeded } from '@/lib/tvbox-crypto.server';
import {
  describeParseStats,
  extractTvboxMultiRepoEntries,
  isSingleCmsApiResponse,
  isTvboxMultiRepoPayload,
  mergeParsedSubscriptions,
  parseSubscriptionJson,
  parseSubscriptionPayload,
  withSkipped,
} from '@/lib/tvbox-parser';
import type { SourceListPayload } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * 拉取远程数据源订阅，自动识别多种格式：
 * 1. LibreTV-SourceList JSON：{ name?, sources: [点播源], liveSources: [直播源] }（也接受裸数组与老格式）；
 * 2. TVBOX 单仓 JSON：{ sites: [站点], lives: [直播源] }，导入直连类条目（Apple CMS 与 M3U/TXT 直播）；
 * 3. TVBOX 多仓索引 JSON：{ urls: [{ url, name }] } / { storeHouse: [...] }，受控并发展开子仓并去重聚合。
 *
 * 点播源与直播源的地址放行策略不同（点播一律拒绝内网，直播可用 LIVE_ALLOW_PRIVATE 放行），
 * 因此两类分别校验，不能共用一把尺子；被校验拦下的条目同样计入统计，便于前端说明导入结果。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const requestUrl = new URL(req.url);
  const target = (requestUrl.searchParams.get('url') || '').trim();
  if (target.length > 8192 || !/^https?:\/\//i.test(target)) {
    return NextResponse.json({ error: '无效的订阅地址' }, { status: 400 });
  }

  const builtInSourceList = isSameOriginPath(target, req, '/open-media-sources.json');
  if (!builtInSourceList) {
    const verdict = await checkUpstreamAllowed(target);
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.reason }, { status: 403 });
    }
  }

  try {
    let text: string;
    if (builtInSourceList) {
      text = await readFile(resolve(process.cwd(), 'public/open-media-sources.json'), 'utf8');
      const targetOrigin = new URL(target).origin;
      text = text.replace(/https:\/\/libretv-mobile-zj2917928447\.onrender\.com/g, targetOrigin);
    } else {
      const res = await fetchUpstream(target, { timeoutMs: 8000, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        return NextResponse.json({ error: `订阅地址返回 HTTP ${res.status}` }, { status: 502 });
      }
      // 读文本而非 JSON：部分配置带注释/尾随逗号，需要宽容解析；限制不可信订阅体积。
      text = await readResponseTextLimited(res, 4 * 1024 * 1024);
    }

    // 智能兼容：若用户直接把 M3U 或 TXT(#genre#) 直播播放列表地址填进了「数据源订阅」，自动包装为直播源导入
    const looksLikeLivePlaylist = /^\s*#EXTM3U|^\s*#EXTINF:|[,，]\s*#genre#\s*$/im.test(text);
    let parsed: SourceListPayload | null = null;
    if (looksLikeLivePlaylist) {
      const channels = parseM3u(text, target);
      if (channels.length > 0) {
        const playlistNameMatch = text.match(/^#PLAYLIST:(.+)$/m);
        const liveTitle = playlistNameMatch?.[1]?.trim() || `${hostnameOf(target)} (${channels.length} 频道)`;
        parsed = {
          name: liveTitle,
          sources: [],
          liveSources: [{ name: liveTitle, url: target }],
          stats: { format: 'libretv', skipped: 0, skippedByReason: {}, truncated: 0 },
        };
      }
    }

    if (!parsed) {
      let rawJson: unknown;
      try {
        rawJson = parseSubscriptionJson(decryptTvboxPayloadIfNeeded(text));
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : '订阅内容不是合法的 JSON' },
          { status: 400 }
        );
      }

      try {
        if (isTvboxMultiRepoPayload(rawJson)) {
          const multi = extractTvboxMultiRepoEntries(rawJson, target);
          if (multi.entries.length === 0) {
            return NextResponse.json({ error: 'TVBox 多仓索引中未找到有效的公网子仓库地址' }, { status: 400 });
          }
          let failedChildCount = 0;
          const childPayloads: SourceListPayload[] = [];
          let cursor = 0;
          const workerCount = Math.min(5, multi.entries.length);
          await Promise.all(
            Array.from({ length: workerCount }, async () => {
              while (cursor < multi.entries.length) {
                const entry = multi.entries[cursor++];
                try {
                  const childVerdict = await checkUpstreamAllowed(entry.url);
                  if (!childVerdict.ok) {
                    failedChildCount += 1;
                    continue;
                  }
                  const childRes = await fetchUpstream(entry.url, {
                    timeoutMs: 6000,
                    headers: { Accept: 'application/json' },
                  });
                  if (!childRes.ok) {
                    failedChildCount += 1;
                    continue;
                  }
                  const childText = await readResponseTextLimited(childRes, 2 * 1024 * 1024);
                  const childParsed = parseSubscriptionPayload(
                    parseSubscriptionJson(decryptTvboxPayloadIfNeeded(childText)),
                    entry.url
                  );
                  childPayloads.push(childParsed);
                } catch {
                  failedChildCount += 1;
                }
              }
            })
          );
          if (childPayloads.length === 0) {
            return NextResponse.json(
              { error: `TVBox 多仓下属的 ${multi.entries.length} 个子仓库均无法解析出可用直连源（可能全为 Spider 引擎或地址已失效）` },
              { status: 400 }
            );
          }
          parsed = mergeParsedSubscriptions(childPayloads, {
            name: multi.name,
            extraInvalid: multi.skippedInvalid + failedChildCount,
          });
        } else if (isSingleCmsApiResponse(rawJson)) {
          // 智能兼容：用户误把单个 Apple CMS 接口地址粘贴进订阅框时，自动包装为点播源导入
          const cleanTarget = target.replace(/\/+$/, '');
          parsed = {
            name: `${hostnameOf(cleanTarget)} 点播源`,
            sources: [{ name: hostnameOf(cleanTarget), url: cleanTarget }],
            liveSources: [],
            stats: { format: 'libretv', skipped: 0, skippedByReason: {}, truncated: 0 },
          };
        } else {
          parsed = parseSubscriptionPayload(rawJson, target);
        }
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : '订阅内容格式不正确' },
          { status: 400 }
        );
      }
    }

    // 点播源：拒绝非公网地址（同源内置 /api/open-media 除外；DNS 层校验在搜索/详情请求时另有兜底）
    const sources = parsed.sources.filter(
      (s) => isSameOriginPath(s.url, req, '/api/open-media', { allowSearch: true }) || isValidProxyUrl(s.url)
    );

    // 直播源：按直播策略校验，EPG 地址非法时丢弃该字段而非整条源
    const checkedLive = await Promise.all(
      parsed.liveSources.map(async (s) => {
        const allowed =
          isSameOriginPath(s.url, req, '/open-live-channels.m3u') || (await checkLiveUrlAllowed(s.url)).ok;
        if (!allowed) return null;
        if (s.epg && !(await checkLiveUrlAllowed(s.epg)).ok) return { ...s, epg: undefined };
        return s;
      })
    );
    const liveSources = checkedLive.filter((s): s is NonNullable<typeof s> => s !== null);

    // 被服务端校验拦下的条目也计入统计，用户能看清「配置里有 N 条却只导入 M 条」的原因
    const dropped = parsed.sources.length - sources.length + (parsed.liveSources.length - liveSources.length);
    const stats = withSkipped(parsed.stats, 'invalidUrl', dropped);

    if (sources.length === 0 && liveSources.length === 0) {
      const detail = describeParseStats(stats);
      return NextResponse.json(
        { error: detail ? `订阅未导入任何可用源：${detail}` : '订阅内容为空' },
        { status: 400 }
      );
    }

    const payload: SourceListPayload = { name: parsed.name, sources, liveSources, stats };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '订阅拉取失败' },
      { status: 502 }
    );
  }
}

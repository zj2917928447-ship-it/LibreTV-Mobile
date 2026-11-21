import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, parseDetail, parseDetailPageHtml } from '@/lib/cms-parser';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { buildCmsApiUrl, buildCmsDetailPageUrl, normalizeCmsSourceConfig, normalizePublicHttpUrl } from '@/lib/cms-url';
import { readCmsPayloadLimited, readResponseTextLimited } from '@/lib/response-body';
import { isSameOriginPath } from '@/lib/same-origin-builtin';
import { GET as getOpenMedia } from '@/app/api/open-media/route';
import type { SourceConfig, VideoDetail } from '@/lib/types';

export const runtime = 'nodejs';

/** 详情结果短缓存：换源测速/多人观看同一影片时避免重复打上游 */
const DETAIL_CACHE_TTL = 60 * 1000;

function parseSource(raw: string | null): SourceConfig | null {
  if (!raw || raw.length > 8192) return null;
  try {
    return normalizeCmsSourceConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 视频详情：优先走列表接口 ?ac=videolist&ids=，
 * 拿不到播放地址时（部分源需要爬详情页）降级到 detail 页 HTML 提取。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();
  const source = parseSource(url.searchParams.get('source'));
  const rawBaseUrl = url.searchParams.get('baseUrl');
  const baseUrl = rawBaseUrl ? normalizePublicHttpUrl(rawBaseUrl) : ''; // 可选：详情页根地址

  if (rawBaseUrl && !baseUrl) {
    return NextResponse.json({ error: '无效的详情页根地址' }, { status: 400 });
  }
  if (!id || id.length > 256 || /\.\./.test(id) || !/^[\w.:-]+$/u.test(id)) {
    return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
  }
  if (!source) {
    return NextResponse.json({ error: '无效的点播源配置' }, { status: 400 });
  }

  try {
    // 详情页根地址：显式 detail 优先，其次 baseUrl 参数，最后用接口地址的 origin 推导
    // （Apple CMS 的详情页通常与接口同域）。脏 URL 会让 new URL 抛错，由外层 catch 兜底
    const detailRoot = (source.detail || baseUrl || new URL(source.url).origin).replace(/\/+$/, '');
    // Cached details include source labels/adult flags; changing the source key or name must not reuse stale metadata.
    const cacheKey = `detail:${source.key}|${source.name}|${source.isAdult === true ? 1 : 0}|${source.url}|${detailRoot}|${id}`;
    const cached = getCache<VideoDetail>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const builtInOpenMedia = isSameOriginPath(source.url, req, '/api/open-media', { allowSearch: true });
    if (!builtInOpenMedia) {
      // 用户可控地址发起服务端请求，先过 SSRF 校验（协议白名单 + 内网/保留地址）
      const listVerdict = await checkUpstreamAllowed(source.url);
      if (!listVerdict.ok) {
        return NextResponse.json({ error: listVerdict.reason }, { status: 400 });
      }
    }

    let resolved: VideoDetail | null = null;

    // 1) 标准列表接口
    const api = buildCmsApiUrl(source.url, { ac: 'videolist', ids: id });
    const res = builtInOpenMedia
      ? await getOpenMedia(new Request(api, { signal: req.signal }))
      : await fetchUpstream(api, { timeoutMs: 10000, headers: cmsRequestHeaders() });
    if (res.ok) {
      const data = await readCmsPayloadLimited(res, 2 * 1024 * 1024);
      try {
        const detail = parseDetail(data, source);
        if (detail.episodes.length > 0) {
          resolved = detail;
        }
        // 有详情但无播放地址 → 继续尝试详情页
      } catch {
        // 列表接口无内容 → 继续尝试详情页
      }
    }

    // 2) 详情页 HTML 提取
    if (!resolved && /^https?:\/\//.test(detailRoot)) {
      const detailVerdict = await checkUpstreamAllowed(detailRoot);
      if (!detailVerdict.ok) {
        return NextResponse.json({ error: detailVerdict.reason }, { status: 400 });
      }
      const detailUrl = buildCmsDetailPageUrl(detailRoot, id);
      const detailRes = await fetchUpstream(detailUrl, {
        timeoutMs: 10000,
        headers: { 'User-Agent': cmsRequestHeaders()['User-Agent'] },
      });
      if (detailRes.ok) {
        const html = await readResponseTextLimited(detailRes, 2 * 1024 * 1024);
        resolved = parseDetailPageHtml(html, source);
      }
    }

    if (!resolved || resolved.episodes.length === 0) {
      return NextResponse.json({ error: '未找到播放资源' }, { status: 404 });
    }
    setCache(cacheKey, resolved, DETAIL_CACHE_TTL);
    return NextResponse.json(resolved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取详情失败' },
      { status: 502 }
    );
  }
}

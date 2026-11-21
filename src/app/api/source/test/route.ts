import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { fetchUpstream } from '@/lib/fetch-utils';
import { parseSearchList } from '@/lib/cms-parser';
import { buildCmsApiUrl, normalizePublicHttpUrl } from '@/lib/cms-url';
import { readJsonBodyLimited, RequestBodyTooLargeError } from '@/lib/request-body';
import { readCmsPayloadLimited } from '@/lib/response-body';
import { isSameOriginPath } from '@/lib/same-origin-builtin';
import { GET as getOpenMedia } from '@/app/api/open-media/route';

export const runtime = 'nodejs';

/** 点播源探活：以搜索 "test" 的响应耗时与结果量衡量可用性 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let rawUrl: unknown;
  try {
    const body = await readJsonBodyLimited<unknown>(req, 8 * 1024);
    rawUrl = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).url
      : undefined;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: '点播源地址请求体过大' }, { status: 413 });
    }
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const url = normalizePublicHttpUrl(rawUrl);
  if (!url) {
    return NextResponse.json({ error: '无效的源地址' }, { status: 400 });
  }

  const builtInOpenMedia = isSameOriginPath(url, req, '/api/open-media', { allowSearch: true });
  if (!builtInOpenMedia) {
    const verdict = await checkUpstreamAllowed(url);
    if (!verdict.ok) {
      return NextResponse.json({ ok: false, ms: 0, error: verdict.reason });
    }
  }

  const start = Date.now();
  try {
    const probeUrl = buildCmsApiUrl(url, { ac: 'videolist', wd: builtInOpenMedia ? 'Sintel' : 'test' });
    const res = builtInOpenMedia
      ? await getOpenMedia(new Request(probeUrl, { signal: req.signal }))
      : await fetchUpstream(probeUrl, {
          timeoutMs: 6000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
            Accept: 'application/json, application/xml, text/xml, */*;q=0.8',
          },
        });
    const ms = Date.now() - start;
    if (!res.ok) {
      return NextResponse.json({ ok: false, ms, error: `HTTP ${res.status}` });
    }
    const data = await readCmsPayloadLimited(res, 1024 * 1024);
    let list = parseSearchList(data, { key: 'test', name: 'test', url });
    // 中文采集站搜英文 "test" 常返回 0 条：快速补拉第 1 页最新列表以展示真实收录状态，失败静默忽略
    if (!builtInOpenMedia && list.length === 0) {
      try {
        const latestUrl = buildCmsApiUrl(url, { ac: 'videolist', pg: '1' });
        const latestRes = await fetchUpstream(latestUrl, {
          timeoutMs: 3000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
            Accept: 'application/json, application/xml, text/xml, */*;q=0.8',
          },
        });
        if (latestRes.ok) {
          const latestData = await readCmsPayloadLimited(latestRes, 1024 * 1024);
          const latestList = parseSearchList(latestData, { key: 'test', name: 'test', url });
          if (latestList.length > 0) list = latestList;
        }
      } catch {
        // 保持主探活成功结论
      }
    }
    return NextResponse.json({ ok: true, ms, count: list.length });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? '超时' : err.message) : '请求失败',
    });
  }
}

import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, filterRelevantResults, normalizeTitle, parseSearchList } from '@/lib/cms-parser';
import { expandCuratedQueryAliases } from '@/lib/curated-open-video';
import { expandBilingualQueryAliases } from '@/lib/open-media';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { buildCmsApiUrl, normalizeCmsSourceConfig } from '@/lib/cms-url';
import { readJsonBodyLimited, RequestBodyTooLargeError } from '@/lib/request-body';
import { readCmsPayloadLimited } from '@/lib/response-body';
import { isSameOriginPath } from '@/lib/same-origin-builtin';
import { GET as getOpenMedia } from '@/app/api/open-media/route';
import type { SearchResponse, SearchStreamEvent, SourceConfig, SourceSearchOutcome } from '@/lib/types';

export const runtime = 'nodejs';

interface SearchBody {
  wd: string;
  sources: SourceConfig[];
  filterAdult?: boolean;
}

/** 搜索结果短缓存：同一关键词 + 同一组源在 TTL 内直接返回（播放页返回搜索页等场景） */
const SEARCH_CACHE_TTL = 60 * 1000;

/** Cache key includes every source field that affects returned source labels or filtering. */
function searchCacheKey(wd: string, sources: SourceConfig[], filterAdult: boolean): string {
  const identities = sources
    .map((source) => [source.key, source.name, source.url.replace(/\/+$/, ''), source.detail ?? '', source.isAdult === true])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    .map((source) => JSON.stringify(source));
  return `search:${wd}\n${filterAdult ? 1 : 0}\n${identities.join('\n')}`;
}

/**
 * 每个源最多抓取的页数。
 * 第一页响应会带回 pagecount（源站真实总页数），实际抓取页数 = min(pagecount, 该值)。
 * 默认 5；页与页之间并行请求，单页失败只丢弃该页。
 */
const SEARCH_MAX_PAGES = (() => {
  const n = parseInt(process.env.SEARCH_MAX_PAGES || '5', 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(50, Math.max(1, n));
})();

/**
 * 单源总死线（毫秒）：该源所有分页请求必须在时限内完成，到点中断在途请求并标记超时。
 * 没有它时慢源最坏要等「首页 8s + 后续页并行 8s」，拖垮整体响应。
 * 环境变量 SEARCH_SOURCE_TIMEOUT_MS 可配，默认 10s。
 */
const SEARCH_SOURCE_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.SEARCH_SOURCE_TIMEOUT_MS || '10000', 10);
  if (!Number.isFinite(n)) return 10000;
  return Math.min(60000, Math.max(3000, n));
})();

/** AbortSignal.timeout / 源级死线中断均以 TimeoutError 语义呈现（直接抛出或挂在 cause 上） */
function isTimeoutError(err: unknown): boolean {
  const candidates: unknown[] = [err, err instanceof Error ? err.cause : undefined];
  return candidates.some((e) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'));
}

/**
 * 服务端聚合搜索：并行请求所有选中源，任一源失败不影响整体。
 * 每个源先取第一页并读取 pagecount，再并行抓取后续页（上限 SEARCH_MAX_PAGES），
 * 整源受 SEARCH_SOURCE_TIMEOUT_MS 总死线约束。
 * 旧版在浏览器里打满 N 个请求（暴露用户 IP、无法缓存、超时失控），现全部上移。
 */
async function searchSource(
  source: SourceConfig,
  wd: string,
  req: Request,
  clientSignal?: AbortSignal
): Promise<SourceSearchOutcome> {
  const start = Date.now();
  const finish = (outcome: Omit<SourceSearchOutcome, 'ms'>): SourceSearchOutcome => ({
    ...outcome,
    ms: Date.now() - start,
  });

  if (!source || typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url)) {
    return finish({ sourceKey: source?.key || 'unknown', ok: false, list: [], error: '无效的源地址' });
  }
  const builtInOpenMedia = isSameOriginPath(source.url, req, '/api/open-media', { allowSearch: true });
  if (!builtInOpenMedia) {
    // 用户可控地址发起服务端请求，必须先过 SSRF 校验（协议白名单 + 内网/保留地址）
    const verdict = await checkUpstreamAllowed(source.url);
    if (clientSignal?.aborted) {
      return finish({ sourceKey: source.key, ok: false, list: [], error: '请求已取消' });
    }
    if (!verdict.ok) {
      return finish({ sourceKey: source.key, ok: false, list: [], error: verdict.reason });
    }
  }

  // Both the source deadline and the browser request may abort all in-flight pages.
  const controller = new AbortController();
  const onClientAbort = () => controller.abort(new DOMException('客户端已断开', 'AbortError'));
  if (clientSignal?.aborted) controller.abort(new DOMException('客户端已断开', 'AbortError'));
  else clientSignal?.addEventListener('abort', onClientAbort, { once: true });
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SourceSearchOutcome>((resolve) => {
    deadlineTimer = setTimeout(() => {
      controller.abort(new DOMException('源搜索超时', 'TimeoutError'));
      resolve(
        finish({
          sourceKey: source.key,
          ok: false,
          list: [],
          error: `请求超时（>${Math.round(SEARCH_SOURCE_TIMEOUT_MS / 1000)}s）`,
          timedOut: true,
        })
      );
    }, SEARCH_SOURCE_TIMEOUT_MS);
  });

  const fetchPage = async (page: number) => {
    const api = buildCmsApiUrl(source.url, { ac: 'videolist', wd, pg: String(page) });
    if (builtInOpenMedia) {
      const localRes = await getOpenMedia(new Request(api, { signal: controller.signal }));
      if (!localRes.ok) throw new Error(`HTTP ${localRes.status}`);
      return readCmsPayloadLimited(localRes, 512 * 1024);
    }
    const res = await fetchUpstream(api, {
      timeoutMs: 8000,
      headers: cmsRequestHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readCmsPayloadLimited(res, 512 * 1024);
  };

  const run = async (): Promise<SourceSearchOutcome> => {
    const first = await fetchPage(1);
    const list = parseSearchList(first, source);
    // 源站真实总页数与配置上限取较小者；pagecount 缺失或非法时视为 1 页
    const rawPageCount = parseInt(String((first as { pagecount?: unknown }).pagecount ?? '1'), 10);
    const pageCount = Math.min(Number.isFinite(rawPageCount) ? Math.max(1, rawPageCount) : 1, SEARCH_MAX_PAGES);
    if (pageCount > 1) {
      const extraPages = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, i) => i + 2).map(async (page) => {
          try {
            return parseSearchList(await fetchPage(page), source);
          } catch {
            return [];
          }
        })
      );
      list.push(...extraPages.flat());
    }
    return { sourceKey: source.key, ok: true, list };
  };

  try {
    // 死线先到时 run 仍会在后台被 abort 并 reject，必须先挂 catch 防未处理 rejection
    const runPromise = run()
      .then(finish)
      .catch((err: unknown): SourceSearchOutcome =>
        finish({
          sourceKey: source.key,
          ok: false,
          list: [],
          error: clientSignal?.aborted ? '请求已取消' : err instanceof Error ? err.message : '请求失败',
          timedOut: !clientSignal?.aborted && isTimeoutError(err),
        })
      );
    return await Promise.race([runPromise, deadline]);
  } catch (err) {
    return finish({
      sourceKey: source.key,
      ok: false,
      list: [],
      error: clientSignal?.aborted ? '请求已取消' : err instanceof Error ? err.message : '请求失败',
      timedOut: !clientSignal?.aborted && isTimeoutError(err),
    });
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    clientSignal?.removeEventListener('abort', onClientAbort);
  }
}

/** 合并 + 去重 + 过滤 + 排序，stream 与非 stream 两种模式共用 */
function aggregateOutcomes(outcomes: SourceSearchOutcome[], wd: string, filterAdult: boolean): SearchResponse {
  const seen = new Set<string>();
  let list = outcomes.flatMap((o) => o.list).filter((item) => {
    const key = `${item.sourceKey}_${item.vodId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const aliases = [...new Set([...expandBilingualQueryAliases(wd), ...expandCuratedQueryAliases(wd)])];
  list = filterAdultResults(list, filterAdult);
  // 部分源站做分词/OR 模糊搜索（搜「摔跤吧！爸爸」返回一堆「爸爸XXX」），按关键词及双语等价译名过滤
  list = filterRelevantResults(list, wd, aliases);

  // 精确命中（忽略标点差异，兼容中英文原名）排在最前，其余按名称（与旧版一致），名称相同按源名
  const exactSet = new Set([wd, ...aliases].map(normalizeTitle).filter(Boolean));
  list.sort((a, b) => {
    const aExact = exactSet.has(normalizeTitle(a.name || '')) ? 0 : 1;
    const bExact = exactSet.has(normalizeTitle(b.name || '')) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const nameCompare = (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
    if (nameCompare !== 0) return nameCompare;
    const sourceNameCompare = (a.sourceName || '').localeCompare(b.sourceName || '', 'zh-Hans-CN');
    if (sourceNameCompare !== 0) return sourceNameCompare;
    return a.sourceKey.localeCompare(b.sourceKey);
  });

  const failures = outcomes
    .filter((o) => !o.ok)
    .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));

  return { list, failures };
}

/**
 * 服务端聚合搜索：
 * - 默认返回完整 JSON（换源流程使用）；
 * - `?stream=1` 以 NDJSON 逐源推送（完成一个推一条，健康源的结果不再等坏源超时），
 *   最终推送聚合后的 done 事件并写入短缓存。
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let rawBody: unknown;
  try {
    rawBody = await readJsonBodyLimited(req, 256 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: '搜索请求体过大' }, { status: 413 });
    }
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const body = rawBody as SearchBody;

  const wd = typeof body.wd === 'string' ? body.wd.trim() : '';
  if (!wd || wd.length > 100) {
    return NextResponse.json({ error: '搜索关键词无效' }, { status: 400 });
  }
  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    return NextResponse.json({ error: '请至少选择一个点播源' }, { status: 400 });
  }
  const suppliedSources = body.sources.slice(0, 50);
  const sources = suppliedSources.map(normalizeCmsSourceConfig);
  if (sources.some((source) => source === null)) {
    return NextResponse.json({ error: '点播源配置无效，请检查名称、地址和可选详情页地址' }, { status: 400 });
  }
  const validSources = sources as SourceConfig[];
  const filterAdult = body.filterAdult !== false;

  const cacheKey = searchCacheKey(wd, validSources, filterAdult);
  const cached = getCache<SearchResponse>(cacheKey);
  if (cached) {
    // 流式模式下缓存命中也要走 done 事件，客户端解析逻辑保持单一
    if (new URL(req.url).searchParams.get('stream') === '1') {
      const event: SearchStreamEvent = { type: 'done', list: cached.list, failures: cached.failures };
      return new Response(JSON.stringify(event) + '\n', {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json(cached);
  }

  const isStream = new URL(req.url).searchParams.get('stream') === '1';
  if (!isStream) {
    const outcomes = await Promise.all(validSources.map((source) => searchSource(source, wd, req, req.signal)));
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const payload = aggregateOutcomes(outcomes, wd, filterAdult);
    setCache(cacheKey, payload, SEARCH_CACHE_TTL);
    return NextResponse.json(payload);
  }

  const encoder = new TextEncoder();
  const streamAbortController = new AbortController();
  let closed = req.signal.aborted;
  const onClientAbort = () => {
    closed = true;
    streamAbortController.abort(new DOMException('客户端已断开', 'AbortError'));
  };
  if (closed) onClientAbort();
  else req.signal.addEventListener('abort', onClientAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SearchStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true; // 客户端已断开
          if (!streamAbortController.signal.aborted) {
            streamAbortController.abort(new DOMException('客户端已断开', 'AbortError'));
          }
        }
      };

      // 逐源结算即推送；outcomes 按下标回填保证聚合顺序稳定
      const outcomes: SourceSearchOutcome[] = new Array(validSources.length);
      await Promise.all(
        validSources.map(async (source, i) => {
          const outcome = await searchSource(source, wd, req, streamAbortController.signal);
          outcomes[i] = outcome;
          // 中间结果与最终结果共用去重和过滤规则，避免无关/成人条目短暂出现在页面上。
          const { list } = aggregateOutcomes([outcome], wd, filterAdult);
          send({ type: 'source', ...outcome, list });
        })
      );

      if (streamAbortController.signal.aborted || req.signal.aborted) {
        closed = true;
        req.signal.removeEventListener('abort', onClientAbort);
        try { controller.close(); } catch { /* 已断开 */ }
        return;
      }

      const payload = aggregateOutcomes(outcomes, wd, filterAdult);
      setCache(cacheKey, payload, SEARCH_CACHE_TTL);
      send({ type: 'done', list: payload.list, failures: payload.failures });
      closed = true;
      req.signal.removeEventListener('abort', onClientAbort);
      try {
        controller.close();
      } catch { /* 已断开 */ }
    },
    cancel(reason) {
      closed = true;
      req.signal.removeEventListener('abort', onClientAbort);
      if (!streamAbortController.signal.aborted) {
        streamAbortController.abort(reason ?? new DOMException('客户端已取消搜索', 'AbortError'));
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

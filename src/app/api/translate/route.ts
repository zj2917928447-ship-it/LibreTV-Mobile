import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader } from '@/lib/auth';
import { readJsonBodyLimited, RequestBodyTooLargeError } from '@/lib/request-body';
import { translateLinesToChinese } from '@/lib/translator';

export const runtime = 'nodejs';

const MAX_LINES_PER_REQUEST = 50;
const MAX_LINE_CHARS = 600;

function getExpectedRequestHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(req.url).host.toLowerCase());
  } catch { /* ignore */ }
  const hostHeader = req.headers.get('host')?.split(',')[0]?.trim().toLowerCase();
  if (hostHeader) hosts.add(hostHeader);
  const fwdHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
  if (fwdHost) hosts.add(fwdHost);
  return hosts;
}

function isSameOriginBrowserRequest(req: Request): boolean {
  const fetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return false;
  }
  const expectedHosts = getExpectedRequestHosts(req);
  const originHeader = req.headers.get('origin');
  if (originHeader) {
    try {
      const originHost = new URL(originHeader).host.toLowerCase();
      return expectedHosts.has(originHost);
    } catch {
      return false;
    }
  }
  if (fetchSite === 'same-origin') return true;
  return isPasswordConfigured() && sessionFromCookieHeader(req.headers.get('cookie'));
}

export async function POST(req: Request) {
  if (!isSameOriginBrowserRequest(req)) {
    return NextResponse.json({ error: '仅允许本站页面调用字幕与简介汉化服务' }, { status: 403 });
  }
  if (req.signal.aborted) return new Response(null, { status: 499 });

  let rawBody: unknown;
  try {
    rawBody = await readJsonBodyLimited(req, 64 * 1024);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: '翻译请求体过大' }, { status: 413 });
    }
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const linesRaw = (rawBody as { lines?: unknown }).lines;
  if (!Array.isArray(linesRaw) || linesRaw.length === 0 || linesRaw.length > MAX_LINES_PER_REQUEST) {
    return NextResponse.json({ error: `单次翻译行数须在 1~${MAX_LINES_PER_REQUEST} 之间` }, { status: 400 });
  }
  if (!linesRaw.every((item) => typeof item === 'string' && item.length <= MAX_LINE_CHARS)) {
    return NextResponse.json({ error: '翻译文本条目无效或单行超长' }, { status: 400 });
  }

  const lines = linesRaw as string[];
  const { translations, translatedCount } = await translateLinesToChinese(lines, req.signal);
  if (req.signal.aborted) return new Response(null, { status: 499 });

  return NextResponse.json(
    { translations, translatedCount },
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
}

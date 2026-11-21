/**
 * 同源内置公开资源识别辅助：
 * 当用户在本地开发（localhost / 127.0.0.1 / 局域网）或反向代理（Render / Docker）环境下
 * 启用本站内置的：
 * - `/api/open-media`（点播开放片库）
 * - `/open-live-channels.m3u`（内置公开直播频道表）
 * - `/open-media-sources.json`（内置公开订阅清单）
 * 时，允许同源路由直接内部读取，既避免 loopback 被公网 SSRF 拦截，也省去外部回环网络开销。
 *
 * 安全约束：严格限定精确路径白名单、禁止用户名/密码凭据，且目标 host 必须匹配当前请求的 host。
 */

function collectRequestHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(req.url).host.toLowerCase());
  } catch {
    /* ignore */
  }
  const hostHeader = req.headers.get('host')?.split(',')[0]?.trim().toLowerCase();
  if (hostHeader) hosts.add(hostHeader);
  const fwdHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
  if (fwdHost) hosts.add(fwdHost);
  return hosts;
}

export function isSameOriginPath(
  targetUrl: string,
  req: Request,
  expectedPathname: '/api/open-media' | '/open-live-channels.m3u' | '/open-media-sources.json',
  options: { allowSearch?: boolean } = {}
): boolean {
  try {
    const target = new URL(targetUrl);
    if (
      (target.protocol !== 'http:' && target.protocol !== 'https:') ||
      target.pathname !== expectedPathname ||
      (!options.allowSearch && Boolean(target.search)) ||
      Boolean(target.username) ||
      Boolean(target.password)
    ) {
      return false;
    }
    return collectRequestHosts(req).has(target.host.toLowerCase());
  } catch {
    return false;
  }
}

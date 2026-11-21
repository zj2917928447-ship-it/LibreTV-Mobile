import type { LiveChannel } from './types';

/**
 * M3U / M3U8 与 TVBox TXT（#genre#）直播播放列表解析。
 *
 * 兼容三种常见写法：
 * - 标准 M3U：`#EXTINF:-1 tvg-id="cctv1" tvg-logo="..." group-title="央视",CCTV-1`
 * - 非标准 M3U（属性写在标题后）：`#EXTINF:-1,CCTV-1 tvg-id="cctv1"`（含 `#EXTGRP:分组名`）
 * - 国内常见 TXT 频道表：`央视频道,#genre#` 分组行 + `CCTV-1,https://...`（兼容 `#http...` 多线拼接）
 *
 * 解析为单趟扫描（O(n)），频道按 URL 去重，仅保留 http(s) 流地址
 * （rtp:// udp:// rtsp:// 等浏览器无法播放的协议直接丢弃）。
 */

const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
const ATTR_STRIP_RE = /[a-zA-Z0-9_-]+="[^"]*"/g;

/** 由任意字符串生成稳定的短 id（djb2 变体，与 store.ts subKeyPrefix 同风格） */
function stableId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** 相对地址按订阅 URL 解析为绝对地址；仅放行 http(s) */
export function normalizeStreamUrl(raw: string, baseUrl?: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    return resolved.href;
  } catch {
    return undefined;
  }
}

/** URL 无名时的兜底名称：取路径末段，decode 后仍空则用主机名 */
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) {
      const decoded = decodeURIComponent(last).replace(/\.(m3u8?|flv|ts|mp4)$/i, '');
      if (decoded) return decoded;
    }
    return u.hostname;
  } catch {
    return '未命名频道';
  }
}

interface ExtinfContext {
  attrs: Record<string, string>;
  title: string;
  /** #EXTGRP 补充的分组（EXTINF 自身带 group-title 时忽略） */
  extGroup: string;
}

export function parseM3u(content: string, baseUrl?: string): LiveChannel[] {
  const channels: LiveChannel[] = [];
  if (!content) return channels;

  const seen = new Set<string>();
  let ctx: ExtinfContext | null = null;
  let txtGroup: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^\uFEFF/, '');
    if (!line) continue;

    if (line.toUpperCase().startsWith('#EXTINF')) {
      const attrs: Record<string, string> = {};
      ATTR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2].trim();

      // 移除属性片段后取首个逗号之后的文本为显示名
      const stripped = line.replace(ATTR_STRIP_RE, '').replace(/^#EXTINF\s*:\s*/i, '');
      const commaIdx = stripped.indexOf(',');
      const title = (commaIdx >= 0 ? stripped.slice(commaIdx + 1) : stripped)
        .trim()
        .replace(/^"+|"+$/g, '');

      ctx = { attrs, title, extGroup: '' };
      continue;
    }

    if (line.toUpperCase().startsWith('#EXTGRP:')) {
      const g = line.slice('#EXTGRP:'.length).trim();
      if (ctx && g && !ctx.attrs['group-title']) ctx.extGroup = g;
      continue;
    }

    if (line.startsWith('#') || line.startsWith('//')) continue; // 其余指令或注释行忽略

    // TVBox / 国内直播源常见 TXT 分组语法：`央视频道,#genre#`
    const genreMatch = line.match(/^([^,，]+)[,，]\s*#genre#\s*$/i);
    if (genreMatch) {
      txtGroup = genreMatch[1].trim() || undefined;
      ctx = null;
      continue;
    }

    // TXT 频道行语法：`CCTV-1 综合,https://...`（兼容 `url1#https://url2` 多源备用线与 `$高清` 尾注）
    if (!ctx) {
      const txtChannelMatch = line.match(/^([^,]+),\s*(https?:\/\/.+)$/i);
      if (txtChannelMatch && !/^https?:\/\//i.test(txtChannelMatch[1].trim())) {
        const baseName = txtChannelMatch[1].trim();
        const rawUrls = txtChannelMatch[2].split(/#(?=https?:\/\/)/i);
        rawUrls.forEach((rawCandidate, idx) => {
          const dollarTag = rawCandidate.match(/^(https?:\/\/[^\s$]+)\$([^\s/?&=]+)$/i);
          const cleanedCandidate = dollarTag ? dollarTag[1] : rawCandidate;
          const routeTag = dollarTag?.[2]?.trim();
          const streamUrl = normalizeStreamUrl(cleanedCandidate, baseUrl);
          if (!streamUrl || seen.has(streamUrl)) return;
          seen.add(streamUrl);
          const suffix = routeTag
            ? ` (${routeTag})`
            : rawUrls.length > 1 && idx > 0
              ? ` (线路${idx + 1})`
              : '';
          channels.push({
            id: stableId(streamUrl),
            name: `${baseName}${suffix}`,
            url: streamUrl,
            group: txtGroup,
          });
        });
        continue;
      }
    }

    // 非注释行即流地址
    const url = normalizeStreamUrl(line, baseUrl);
    const cur = ctx;
    ctx = null;
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const attrs = cur?.attrs ?? {};
    const tvgId = attrs['tvg-id'] || undefined;
    const logo = attrs['tvg-logo'] ? normalizeStreamUrl(attrs['tvg-logo'], baseUrl) : undefined;
    const name = cur?.title || nameFromUrl(url);
    channels.push({
      id: tvgId || stableId(url),
      name,
      url,
      logo,
      group: attrs['group-title'] || cur?.extGroup || undefined,
      tvgId,
      rawName: attrs['tvg-name'] || undefined,
    });
  }

  return channels;
}

/**
 * 字幕解码与 WebVTT 转换工具：
 * 1. 自动识别 UTF-8 / UTF-16 BOM / GB18030（兼容国内常见的 GBK/ANSI 中文字幕文件，杜绝乱码）；
 * 2. 将 SRT、ASS/SSA、WebVTT 统一转换为标准 WebVTT，并支持时间轴整体偏移（秒）；
 * 3. 解析出结构化 Cue 列表，同时服务于播放器自定义高清字幕层与原生 <video><track>（兼容系统全屏）。
 */

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

const MAX_SUBTITLE_TEXT_LENGTH = 2 * 1024 * 1024;

/** 解码字幕二进制字节流：优先严格 UTF-8，遇到非法字节序列自动回退 GB18030（覆盖 GBK/GB2312） */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/** 解析 HH:MM:SS.mmm / MM:SS.mmm / H:MM:SS,mmm / ASS H:MM:SS.cc 为秒数 */
export function parseSubtitleTimestamp(raw: string): number | null {
  const cleaned = raw.trim();
  const match = cleaned.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  const fractionRaw = match[4] ?? '0';
  const milliseconds = Number(fractionRaw.padEnd(3, '0').slice(0, 3));
  const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  return Number.isFinite(total) ? total : null;
}

/** 格式化秒数为标准 WebVTT 时间戳 HH:MM:SS.mmm */
export function formatVttTimestamp(seconds: number): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(clamped * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '') // 移除 ASS/SSA 样式花括号（如 {\pos(192,220)\an8}）
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<\/?(?:font|b|i|u|s)\b[^>]*>/gi, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function parseAssCues(input: string): SubtitleCue[] {
  const lines = input.split(/\r?\n/);
  let inEvents = false;
  let startIdx = 1;
  let endIdx = 2;
  let textIdx = 9;
  let fieldCount = 10;
  const cues: SubtitleCue[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;

    if (/^format\s*:/i.test(line)) {
      const fields = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      if (fields.length >= 3) {
        fieldCount = fields.length;
        const s = fields.indexOf('start');
        const e = fields.indexOf('end');
        const t = fields.indexOf('text');
        if (s >= 0) startIdx = s;
        if (e >= 0) endIdx = e;
        if (t >= 0) textIdx = t;
      }
      continue;
    }

    if (/^dialogue\s*:/i.test(line)) {
      const payload = line.slice(line.indexOf(':') + 1);
      const parts: string[] = [];
      let cursor = 0;
      for (let i = 0; i < fieldCount - 1; i++) {
        const comma = payload.indexOf(',', cursor);
        if (comma < 0) break;
        parts.push(payload.slice(cursor, comma).trim());
        cursor = comma + 1;
      }
      parts.push(payload.slice(cursor));
      if (parts.length <= Math.max(startIdx, endIdx, textIdx)) continue;
      const start = parseSubtitleTimestamp(parts[startIdx]);
      const end = parseSubtitleTimestamp(parts[endIdx]);
      const text = cleanCueText(parts[textIdx]);
      if (start !== null && end !== null && end > start && text) {
        cues.push({ start, end, text });
      }
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

function parseSrtOrVttCues(input: string): SubtitleCue[] {
  const normalized = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^WEBVTT[^\n]*\n?/i, '');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (/^(?:NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;

    const arrowLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowLineIdx < 0) continue;

    const arrowLine = lines[arrowLineIdx];
    const [leftRaw, rightWithSettings] = arrowLine.split('-->');
    if (!leftRaw || !rightWithSettings) continue;
    const rightRaw = rightWithSettings.trim().split(/\s+/)[0] ?? '';
    const start = parseSubtitleTimestamp(leftRaw);
    const end = parseSubtitleTimestamp(rightRaw);
    if (start === null || end === null || end <= start) continue;

    const text = cleanCueText(lines.slice(arrowLineIdx + 1).join('\n'));
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** 解析任意常见字幕文本（SRT / VTT / ASS / SSA）为结构化 Cue 数组，支持时间轴偏移 */
export function parseSubtitleCues(rawText: string, offsetSeconds = 0): SubtitleCue[] {
  const safeText = rawText.slice(0, MAX_SUBTITLE_TEXT_LENGTH).replace(/^\uFEFF/, '');
  if (!safeText.trim()) return [];
  const isAss = /\[script info\]/i.test(safeText) || /\ndialogue\s*:/i.test(`\n${safeText}`);
  const baseCues = isAss ? parseAssCues(safeText) : parseSrtOrVttCues(safeText);
  const shift = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  if (shift === 0) return baseCues;
  return baseCues
    .map((cue) => ({
      start: Math.max(0, cue.start + shift),
      end: Math.max(0, cue.end + shift),
      text: cue.text,
    }))
    .filter((cue) => cue.end > cue.start);
}

/** 将 SRT / ASS / VTT 统一序列化为标准 WebVTT 文本 */
export function convertSubtitleToVtt(rawText: string, offsetSeconds = 0): string {
  const cues = parseSubtitleCues(rawText, offsetSeconds);
  if (cues.length === 0) return 'WEBVTT\n\n';
  const body = cues
    .map((cue, index) => `${index + 1}\n${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** 二分查找当前播放时间命中的字幕行（支持双语或多条重叠合并展示） */
export function findActiveSubtitleText(cues: readonly SubtitleCue[], currentTime: number): string {
  if (cues.length === 0 || !Number.isFinite(currentTime) || currentTime < 0) return '';
  // Find first cue whose start <= currentTime; scan nearby window for overlapping dual-language cues
  let lo = 0;
  let hi = cues.length - 1;
  let pivot = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= currentTime) {
      pivot = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (pivot < 0) return '';
  const matched: string[] = [];
  const scanStart = Math.max(0, pivot - 6);
  for (let i = scanStart; i <= pivot; i++) {
    const cue = cues[i];
    if (cue.start <= currentTime && cue.end >= currentTime) {
      if (!matched.includes(cue.text)) matched.push(cue.text);
    }
  }
  return matched.join('\n');
}

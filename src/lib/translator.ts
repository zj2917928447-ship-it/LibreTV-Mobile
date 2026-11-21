import { fetchUpstreamJson, getCache, setCache } from './fetch-utils';
import { mapWithConcurrency } from './open-media';

/**
 * 影视字幕与剧情简介简体中文翻译器：
 * 1. 已含充足中文的文本直接原样返回，避免重复翻译；
 * 2. 三级引擎自动容错：可选 OpenAI 兼容大模型 -> Google GTX 高速批量（带连通性熔断记忆） -> MyMemory 免代理并发直连；
 * 3. 逐句缓存 12 小时，重复观看或拖拽进度零额外网络请求。
 */

const TRANSLATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const GTX_COOLDOWN_MS = 5 * 60 * 1000;
const MYMEMORY_COOLDOWN_MS = 30 * 60 * 1000;
const GTX_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const SIMPLY_ICIBA_ENDPOINT = 'https://simplytranslate.org/api/translate/';

let gtxCooldownUntil = 0;
let mymemoryCooldownUntil = 0;

/** 测试重置钩子 */
export function resetTranslatorCircuitBreaker(): void {
  gtxCooldownUntil = 0;
  mymemoryCooldownUntil = 0;
}

/** 判断文本是否主要是外文、需要汉化为简体中文 */
export function needsChineseTranslation(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned) return false;
  const cjkCount = (cleaned.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const latinCount = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  if (latinCount < 2) return false;
  if (cjkCount === 0) return true;
  return cjkCount / (cjkCount + latinCount) < 0.25;
}

function lineCacheKey(text: string): string {
  return `translate:zh-cn:v1:${text.trim()}`;
}

async function translateViaCustomLlm(lines: string[], signal?: AbortSignal): Promise<string[] | null> {
  const apiKey = process.env.TRANSLATE_API_KEY?.trim();
  if (!apiKey) return null;
  const apiUrl = process.env.TRANSLATE_API_URL?.trim() || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.TRANSLATE_MODEL?.trim() || 'gpt-4o-mini';

  try {
    const prompt = JSON.stringify(lines);
    const data = await fetchUpstreamJson<{
      choices?: Array<{ message?: { content?: string } }>;
    }>(apiUrl, {
      method: 'POST',
      timeoutMs: 10_000,
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: '你是专业电影中文字幕译者。将输入的 JSON 字符串数组逐条翻译为自然简练的简体中文，严格返回等长的纯 JSON 字符串数组，不要包含任何代码块标记或额外解释。',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const raw = data.choices?.[0]?.message?.content?.trim() || '';
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonText) as unknown;
    if (Array.isArray(parsed) && parsed.length === lines.length && parsed.every((item) => typeof item === 'string')) {
      return parsed.map((s) => s.trim());
    }
    return null;
  } catch {
    return null;
  }
}

async function translateSingleViaGtx(text: string, signal?: AbortSignal): Promise<{ text: string } | { networkFailed: boolean }> {
  try {
    const url = new URL(GTX_ENDPOINT);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'auto');
    url.searchParams.set('tl', 'zh-CN');
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    const data = await fetchUpstreamJson<unknown>(url.href, {
      timeoutMs: 2_200,
      retries: 0,
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!Array.isArray(data) || !Array.isArray(data[0])) return { networkFailed: false };
    const segments = (data[0] as unknown[])
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('')
      .trim();
    return segments ? { text: segments } : { networkFailed: false };
  } catch {
    return { networkFailed: true };
  }
}

async function translateBatchViaGtx(lines: string[], signal?: AbortSignal): Promise<string[] | null> {
  if (lines.length === 0) return [];
  if (Date.now() < gtxCooldownUntil) return null;

  const separator = '\n[[#]]\n';
  const joined = lines.map((l) => l.replace(/\r?\n/g, ' ')).join(separator);
  if (joined.length <= 2400) {
    const res = await translateSingleViaGtx(joined, signal);
    if ('networkFailed' in res) {
      if (res.networkFailed) gtxCooldownUntil = Date.now() + GTX_COOLDOWN_MS;
      return null;
    }
    const parts = res.text.split(/\s*\[\[\s*#\s*\]\]\s*/);
    if (parts.length === lines.length && parts.every((p) => p.trim().length > 0)) {
      return parts.map((p) => p.trim());
    }
  }

  const probe = await translateSingleViaGtx(lines[0], signal);
  if ('networkFailed' in probe) {
    if (probe.networkFailed) gtxCooldownUntil = Date.now() + GTX_COOLDOWN_MS;
    return null;
  }
  if (lines.length === 1) return [probe.text];
  const rest = await mapWithConcurrency(lines.slice(1), 5, async (line) => {
    const r = await translateSingleViaGtx(line, signal);
    return 'text' in r ? r.text : line;
  });
  return [probe.text, ...rest];
}

async function translateSingleViaMyMemory(text: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const clean = text.replace(/\r?\n/g, ' ').trim().slice(0, 480);
    if (!clean) return '';
    const url = new URL(MYMEMORY_ENDPOINT);
    url.searchParams.set('q', clean);
    url.searchParams.set('langpair', 'en|zh-CN');

    const data = await fetchUpstreamJson<{
      responseStatus?: number | string;
      quotaFinished?: boolean;
      responseData?: { translatedText?: string };
    }>(url.href, {
      timeoutMs: 5_000,
      retries: 0,
      signal,
      headers: { Accept: 'application/json' },
    });
    if (data?.quotaFinished || Number(data?.responseStatus) === 429) {
      mymemoryCooldownUntil = Date.now() + MYMEMORY_COOLDOWN_MS;
      return null;
    }
    const out = data?.responseData?.translatedText?.trim();
    if (!out || /^MYMEMORY WARNING/i.test(out)) {
      if (out && /^MYMEMORY WARNING/i.test(out)) {
        mymemoryCooldownUntil = Date.now() + MYMEMORY_COOLDOWN_MS;
      }
      return null;
    }
    return out;
  } catch {
    return null;
  }
}

async function translateBatchViaMyMemory(lines: string[], signal?: AbortSignal): Promise<string[] | null> {
  if (lines.length === 0) return [];
  if (Date.now() < mymemoryCooldownUntil) return null;
  const mapped = await mapWithConcurrency(lines, 6, async (line) => {
    return await translateSingleViaMyMemory(line, signal);
  });
  if (mapped.every((item) => item === null)) return null;
  return mapped.map((item, idx) => item ?? lines[idx]);
}

async function translateSingleViaSimplyIciba(text: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const clean = text.replace(/\r?\n/g, ' ').trim().slice(0, 480);
    if (!clean) return '';
    const url = new URL(SIMPLY_ICIBA_ENDPOINT);
    url.searchParams.set('engine', 'iciba');
    url.searchParams.set('from', 'en');
    url.searchParams.set('to', 'zh');
    url.searchParams.set('text', clean);

    const data = await fetchUpstreamJson<{
      'translated-text'?: string;
      translated_text?: string;
    }>(url.href, {
      timeoutMs: 9_000,
      retries: 1,
      signal,
      headers: { Accept: 'application/json' },
    });
    const out = (data?.['translated-text'] ?? data?.translated_text)?.trim();
    return out || null;
  } catch {
    return null;
  }
}

async function translateBatchViaSimplyIciba(lines: string[], signal?: AbortSignal): Promise<string[] | null> {
  if (lines.length === 0) return [];
  const mapped = await mapWithConcurrency(lines, 6, async (line) => {
    return await translateSingleViaSimplyIciba(line, signal);
  });
  if (mapped.every((item) => item === null)) return null;
  return mapped.map((item, idx) => item ?? lines[idx]);
}

/** 批量将外语台词或简介段落翻译为简体中文（保序、带缓存、失败安全回退原文） */
export async function translateLinesToChinese(
  inputs: readonly string[],
  signal?: AbortSignal
): Promise<{ translations: string[]; translatedCount: number }> {
  const results = new Array<string>(inputs.length);
  const pendingIndices: number[] = [];
  const pendingTexts: string[] = [];
  let translatedCount = 0;

  for (let i = 0; i < inputs.length; i++) {
    const raw = (inputs[i] ?? '').trim();
    if (!raw || !needsChineseTranslation(raw)) {
      results[i] = raw;
      continue;
    }
    const cached = getCache<string>(lineCacheKey(raw));
    if (cached) {
      results[i] = cached;
      translatedCount++;
      continue;
    }
    pendingIndices.push(i);
    pendingTexts.push(raw);
  }

  if (pendingTexts.length === 0) {
    return { translations: results, translatedCount };
  }

  const batchTranslated =
    (await translateViaCustomLlm(pendingTexts, signal)) ??
    (await translateBatchViaGtx(pendingTexts, signal)) ??
    (await translateBatchViaMyMemory(pendingTexts, signal)) ??
    (await translateBatchViaSimplyIciba(pendingTexts, signal));

  if (!batchTranslated) {
    for (let k = 0; k < pendingIndices.length; k++) {
      results[pendingIndices[k]] = pendingTexts[k];
    }
    return { translations: results, translatedCount };
  }

  for (let k = 0; k < pendingIndices.length; k++) {
    const idx = pendingIndices[k];
    const sourceText = pendingTexts[k];
    const targetText = (batchTranslated[k] || sourceText).trim();
    results[idx] = targetText;
    if (targetText && targetText !== sourceText) {
      setCache(lineCacheKey(sourceText), targetText, TRANSLATE_CACHE_TTL_MS);
      translatedCount++;
    }
  }

  return { translations: results, translatedCount };
}

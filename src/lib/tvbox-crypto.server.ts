import { createDecipheriv } from 'node:crypto';

/**
 * 服务端专用：解包 TVBox / FongMi 社区常见的 `2423...2324...`（ASCII `#$key$#`）Hex AES-128-CBC 加密订阅。
 *
 * 加密结构（全串为十六进制）：
 * - 头部：`2423`（`#$`） + `hex(key)` + `2324`（`$#`），其中 `key` 右补 `'0'` 至 16 字节作为 AES-128 密钥；
 * - 中段：AES-128-CBC PKCS#7 密文字节（长度必为 16 字节 / 32 个十六进制字符的整数倍）；
 * - 尾部：标准实现为末尾 26 个十六进制字符（13 字节时间戳 IV，右补 `'0'` 至 16 字节），兼容变体末尾 32 个十六进制字符（16 字节 IV）。
 *
 * 注意：本模块依赖 `node:crypto`，仅供服务端 API Route 导入，切勿在 `'use client'` 组件链路中引入。
 */
export function decryptTvboxPayloadIfNeeded(raw: string): string {
  const clean = raw.replace(/^\uFEFF/, '').trim();
  if (!clean || clean.startsWith('{') || clean.startsWith('[') || clean.startsWith('<')) {
    return raw;
  }

  const compact = clean.replace(/\s+/g, '');
  if (compact.length < 40 || compact.length % 2 !== 0 || !/^2423[0-9a-fA-F]+$/.test(compact)) {
    return raw;
  }

  const lower = compact.toLowerCase();
  // 在偶数边界上寻找第一个 `2324`（`$#`）密钥结束标记
  let keyEndIdx = -1;
  for (let idx = 4; idx <= Math.min(lower.length - 36, 132); idx += 2) {
    if (lower.slice(idx, idx + 4) === '2324') {
      keyEndIdx = idx;
      break;
    }
  }
  if (keyEndIdx < 4) return raw;

  const keyAscii = Buffer.from(lower.slice(4, keyEndIdx), 'hex').toString('utf8');
  const keyBuf = Buffer.from(keyAscii.padEnd(16, '0').slice(0, 16), 'utf8');
  const bodyAndIvHex = lower.slice(keyEndIdx + 4);

  // 根据密文块对齐（32 hex = 16 bytes）优先尝试标准 26 hex（13 字节）IV，其次兼容 32 hex（16 字节）IV
  const trailerCandidates = bodyAndIvHex.length % 32 === 26 ? [26, 32] : [32, 26];

  for (const ivHexLen of trailerCandidates) {
    if (bodyAndIvHex.length <= ivHexLen) continue;
    const cipherHex = bodyAndIvHex.slice(0, bodyAndIvHex.length - ivHexLen);
    if (cipherHex.length === 0 || cipherHex.length % 32 !== 0) continue;

    try {
      const ivAscii = Buffer.from(bodyAndIvHex.slice(bodyAndIvHex.length - ivHexLen), 'hex').toString('utf8');
      const ivBuf = Buffer.from(ivAscii.padEnd(16, '0').slice(0, 16), 'utf8');
      const cipherBuf = Buffer.from(cipherHex, 'hex');
      const decipher = createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
      const plain = Buffer.concat([decipher.update(cipherBuf), decipher.final()])
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .trim();
      if (plain.startsWith('{') || plain.startsWith('[') || plain.startsWith('//') || plain.startsWith('/*')) {
        return plain;
      }
    } catch {
      // 尝试下一候选或回退原文
    }
  }

  return raw;
}

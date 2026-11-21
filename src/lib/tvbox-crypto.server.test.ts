import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptTvboxPayloadIfNeeded } from './tvbox-crypto.server';

function encodeTvboxHexAesCbc(plainJson: string, keyRaw: string, ivRaw: string): string {
  const keyBuf = Buffer.from(keyRaw.padEnd(16, '0').slice(0, 16), 'utf8');
  const ivBuf = Buffer.from(ivRaw.padEnd(16, '0').slice(0, 16), 'utf8');
  const cipher = createCipheriv('aes-128-cbc', keyBuf, ivBuf);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plainJson, 'utf8')), cipher.final()]);
  return (
    '2423' +
    Buffer.from(keyRaw, 'utf8').toString('hex') +
    '2324' +
    encrypted.toString('hex') +
    Buffer.from(ivRaw, 'utf8').toString('hex')
  );
}

describe('decryptTvboxPayloadIfNeeded', () => {
  it('decrypts standard FongMi/TVBox 2423..2324 hex AES-128-CBC payload with 13-char timestamp IV', () => {
    const sample = JSON.stringify({
      sites: [{ key: 'demo', name: '演示采集站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' }],
    });
    const encryptedHex = encodeTvboxHexAesCbc(sample, 'tvboxkey', '1709876543210');
    expect(decryptTvboxPayloadIfNeeded(encryptedHex)).toBe(sample);
  });

  it('decrypts 16-byte IV variant and uppercase hex strings with comments', () => {
    const sample = '// 注释头\n{"urls":[{"name":"主仓","url":"https://repo.example.com/main.json"}]}';
    const encryptedHex = encodeTvboxHexAesCbc(sample, 'mysecretkey12345', '1234567890abcdef').toUpperCase();
    expect(decryptTvboxPayloadIfNeeded(`  ${encryptedHex}\n`)).toBe(sample);
  });

  it('leaves plain JSON, M3U playlists, and invalid hex untouched', () => {
    const plain = '{"sites":[]}';
    expect(decryptTvboxPayloadIfNeeded(plain)).toBe(plain);
    expect(decryptTvboxPayloadIfNeeded('#EXTM3U\nhttps://a.com/1.m3u8')).toBe('#EXTM3U\nhttps://a.com/1.m3u8');
    expect(decryptTvboxPayloadIfNeeded('2423deadbeef2324001122')).toBe('2423deadbeef2324001122');
  });
});

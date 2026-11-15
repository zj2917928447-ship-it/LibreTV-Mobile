import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSubscriptionJson, parseSubscriptionPayload } from './tvbox-parser';

describe('published open-media subscription', () => {
  it('is valid LibreTV SourceList JSON and imports one same-site CMS-compatible API', () => {
    const raw = readFileSync(resolve(process.cwd(), 'public/open-media-sources.json'), 'utf8');
    const payload = parseSubscriptionPayload(parseSubscriptionJson(raw));

    expect(payload.name).toContain('开放影视资料库');
    expect(payload.sources).toHaveLength(1);
    expect(payload.sources[0].url).toBe('https://libretv-mobile-zj2917928447.onrender.com/api/open-media');
    expect(payload.liveSources).toEqual([]);
  });
});

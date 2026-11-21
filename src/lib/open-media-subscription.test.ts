import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSubscriptionJson, parseSubscriptionPayload } from './tvbox-parser';

describe('published open-media subscription', () => {
  it('is valid LibreTV SourceList JSON and imports built-in VOD API and 600+ live channels', () => {
    const raw = readFileSync(resolve(process.cwd(), 'public/open-media-sources.json'), 'utf8');
    const payload = parseSubscriptionPayload(parseSubscriptionJson(raw));

    expect(payload.name).toContain('开放影视');
    expect(payload.sources).toHaveLength(1);
    expect(payload.sources[0].url).toBe('https://libretv-mobile-zj2917928447.onrender.com/api/open-media?short=1&zh=1');
    expect(payload.liveSources).toHaveLength(1);
    expect(payload.liveSources[0].url).toBe('https://libretv-mobile-zj2917928447.onrender.com/open-live-channels.m3u');
  });
});

import { describe, expect, it } from 'vitest';
import { isSameOriginPath } from './same-origin-builtin';

describe('isSameOriginPath', () => {
  it('识别本地 loopback 与反向代理同源内置路径，拒绝跨站与带凭据地址', () => {
    const req = new Request('http://localhost:18440/api/search', {
      headers: {
        host: '127.0.0.1:18440',
        'x-forwarded-host': 'libretv-mobile-zj2917928447.onrender.com',
      },
    });

    expect(
      isSameOriginPath('http://127.0.0.1:18440/api/open-media?short=1&zh=1', req, '/api/open-media', {
        allowSearch: true,
      })
    ).toBe(true);
    expect(
      isSameOriginPath(
        'https://libretv-mobile-zj2917928447.onrender.com/open-live-channels.m3u',
        req,
        '/open-live-channels.m3u'
      )
    ).toBe(true);

    // 拒绝查询串（未开启 allowSearch）、其它路径、跨站域或内嵌凭据
    expect(
      isSameOriginPath('http://127.0.0.1:18440/open-live-channels.m3u?x=1', req, '/open-live-channels.m3u')
    ).toBe(false);
    expect(
      isSameOriginPath('http://127.0.0.1:18440/api/other', req, '/api/open-media', { allowSearch: true })
    ).toBe(false);
    expect(
      isSameOriginPath('https://evil.example.com/api/open-media', req, '/api/open-media', { allowSearch: true })
    ).toBe(false);
    expect(
      isSameOriginPath('http://user:pass@127.0.0.1:18440/api/open-media', req, '/api/open-media', {
        allowSearch: true,
      })
    ).toBe(false);
  });
});

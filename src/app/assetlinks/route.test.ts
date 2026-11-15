import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('Digital Asset Links route', () => {
  it('serves the Android TWA association at the public JSON endpoint', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('public');

    const body = await response.json();
    expect(body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.zj2917928447.libretv',
          sha256_cert_fingerprints: [
            '55:67:98:66:3C:B9:59:22:C5:C3:9F:72:13:41:6A:D4:18:3D:36:3C:C5:44:64:FE:7E:CB:84:03:D4:BC:40:AB',
          ],
        },
      },
    ]);
  });
});

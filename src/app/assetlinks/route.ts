import { NextResponse } from 'next/server';

const DIGITAL_ASSET_LINKS = [
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
] as const;

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(DIGITAL_ASSET_LINKS, {
    headers: {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}

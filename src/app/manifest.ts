import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LibreTV - 免费在线视频搜索与观看平台',
    short_name: 'LibreTV',
    description: '免费在线视频搜索与观看平台',
    start_url: '/',
    display: 'standalone',
    scope: '/',
    orientation: 'any',
    categories: ['entertainment', 'video', 'multimedia'],
    prefer_related_applications: false,
    background_color: '#0b101a',
    theme_color: '#0b101a',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: '打开直播',
        short_name: '直播',
        url: '/live',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}

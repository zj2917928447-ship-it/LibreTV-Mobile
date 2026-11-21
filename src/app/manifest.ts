import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '自由影视 - 免费在线视频搜索与观看平台',
    short_name: '自由影视',
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
        name: '免费高清影院',
        short_name: '免费影院',
        url: '/free',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: '电视直播大厅',
        short_name: '电视直播',
        url: '/live',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}

export type OpenBrowseCategory = 'all' | 'animation' | 'comedy' | 'thriller' | 'space' | 'chinese';

export const OPEN_BROWSE_CATEGORIES: readonly { id: OpenBrowseCategory; label: string; badge: string }[] = [
  { id: 'all', label: '全部精选', badge: '即点即播' },
  { id: 'animation', label: '开源动画大片', badge: '超清直连' },
  { id: 'space', label: '太空与纪实', badge: '官方档案' },
  { id: 'comedy', label: '喜剧动作经典', badge: '影史名作' },
  { id: 'thriller', label: '悬疑科幻惊悚', badge: '公版馆藏' },
  { id: 'chinese', label: '华语经典影像', badge: '历史瑰宝' },
];

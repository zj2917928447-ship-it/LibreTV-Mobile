'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Icon } from './icon';
import { SmartImage } from './smart-image';
import { OPEN_BROWSE_CATEGORIES, type OpenBrowseCategory } from '@/lib/open-browse-categories';
import { useAppStore } from '@/lib/store';
import { OPEN_SETTINGS_EVENT } from '@/lib/ui-events';
import { cn } from '@/lib/utils';

interface BrowseCardItem {
  vod_id: string;
  vod_name: string;
  vod_pic?: string;
  vod_year?: string;
  vod_remarks?: string;
  vod_direct?: boolean;
}

function PosterItem({
  item,
  imageProxyMode,
  customImageProxy,
}: {
  item: BrowseCardItem;
  imageProxyMode: 'direct' | 'proxy' | 'custom';
  customImageProxy: string;
}) {
  const [failed, setFailed] = useState(false);
  const zhTitle = item.vod_name.split(' / ')[0] || item.vod_name;
  const durationBadge = item.vod_remarks?.split('·')[0]?.trim();

  return (
    <Link
      href={`/free?play=${encodeURIComponent(item.vod_id)}`}
      className="card overflow-hidden group hover:border-accent/50 transition-colors flex flex-col"
    >
      <div className="relative aspect-video bg-chip overflow-hidden">
        {item.vod_pic && !failed ? (
          <SmartImage
            url={item.vod_pic}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={zhTitle}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onExhausted={() => setFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent/20 to-surface px-2 text-center text-xs text-muted">
            {zhTitle}
          </div>
        )}
        {item.vod_direct && (
          <span className="absolute top-1.5 left-1.5 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
            直连秒播
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-2 py-1.5 flex items-center justify-between text-[10px] text-white/90">
          <span>{item.vod_year || '精选'}</span>
          {durationBadge && <span>{durationBadge}</span>}
        </div>
      </div>
      <div className="p-2.5 flex items-center justify-between gap-1.5">
        <span className="text-xs font-medium text-content truncate">{zhTitle}</span>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">即播</span>
      </div>
    </Link>
  );
}

/**
 * 首页首屏资源直达中心：
 * 支持首屏直接按分类切换与「换一批」浏览内置免费高清放映厅，并一键直达超清直播与多仓订阅导入。
 */
export function HomeInstantHub({ expanded = false }: { expanded?: boolean } = {}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [category, setCategory] = useState<OpenBrowseCategory>('all');
  const [batchOffset, setBatchOffset] = useState(0);
  const fetchLimit = expanded ? 144 : 72;

  const browseQuery = useQuery({
    queryKey: ['home-open-cinema-preview', category, fetchLimit],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/open-media?ac=browse&category=${encodeURIComponent(category)}&pg=1&limit=${fetchLimit}&compact=1`,
        { signal }
      );
      if (!res.ok) return { list: [] as BrowseCardItem[], total: 4384 };
      const data = (await res.json()) as { list?: BrowseCardItem[]; total?: number };
      return { list: data.list ?? [], total: data.total ?? (data.list?.length || 4384) };
    },
    staleTime: 600_000,
  });

  const allItems = browseQuery.data?.list ?? [];
  const totalCatalogCount = browseQuery.data?.total ?? allItems.length;
  const pageSize = expanded ? 36 : 12;
  const safeOffset = allItems.length > 0 ? batchOffset % allItems.length : 0;
  const featured =
    allItems.length <= pageSize
      ? allItems
      : [
          ...allItems.slice(safeOffset, safeOffset + pageSize),
          ...allItems.slice(0, Math.max(0, safeOffset + pageSize - allItems.length)),
        ];

  return (
    <section aria-label="内置免费影视与直播直达" className="mb-8 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <Link
          href="/free"
          className="card p-3.5 flex items-center justify-between gap-3 hover:border-accent/50 transition-colors"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-content">内置免费高清影院</div>
            <div className="text-xs text-muted truncate mt-0.5">4384+ 部直连名片与74部连播剧集 · 点开即播</div>
          </div>
          <span className="shrink-0 rounded-full bg-accent/15 p-2 text-accent">
            <Icon name="bolt" className="w-4 h-4" />
          </span>
        </Link>

        <Link
          href="/live"
          className="card p-3.5 flex items-center justify-between gap-3 hover:border-accent/50 transition-colors"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-content">免费电视直播大厅</div>
            <div className="text-xs text-muted truncate mt-0.5">内置 7321 台超清直连 · 172 包扩展 108000+ 频道</div>
          </div>
          <span className="shrink-0 rounded-full bg-accent/15 p-2 text-accent">
            <Icon name="link" className="w-4 h-4" />
          </span>
        </Link>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))}
          className="card p-3.5 flex items-center justify-between gap-3 hover:border-accent/50 transition-colors text-left"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-content">导入全网点播 / 直播源</div>
            <div className="text-xs text-muted truncate mt-0.5">兼容 TVBox 多仓/单仓/AES/XML/Base64 与 M3U/TXT</div>
          </div>
          <span className="shrink-0 rounded-full bg-accent/15 p-2 text-accent">
            <Icon name="plus" className="w-4 h-4" />
          </span>
        </button>
      </div>

      {featured.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <h2 className="text-sm font-semibold text-content">即点即播 · 内置免费高清放映厅</h2>
            <div className="flex items-center gap-3 text-xs">
              {allItems.length > pageSize && (
                <button
                  type="button"
                  className="text-muted hover:text-accent transition-colors"
                  onClick={() => setBatchOffset((prev) => prev + pageSize)}
                >
                  换一批 ({Math.floor(safeOffset / pageSize) + 1}/{Math.ceil(allItems.length / pageSize)})
                </button>
              )}
              <Link href="/free" className="text-accent hover:underline">
                查看全部 {totalCatalogCount}+ 部与在线馆藏 →
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-2.5">
            {OPEN_BROWSE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCategory(cat.id);
                  setBatchOffset(0);
                }}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  category === cat.id
                    ? 'border-accent bg-accent/15 text-accent font-medium'
                    : 'border-line bg-chip text-muted hover:text-content hover:border-accent/40'
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {featured.map((item) => (
              <PosterItem
                key={item.vod_id}
                item={item}
                imageProxyMode={imageProxyMode}
                customImageProxy={customImageProxy}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

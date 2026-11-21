'use client';

import type {
  CatalogProvidersResponse,
  CatalogSearchResponse,
  CatalogSearchResult,
  SearchResultItem,
} from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { buildChinesePlatformLinks, justWatchSearchUrl } from '@/lib/catalog-links';
import { SmartImage } from './smart-image';

interface CatalogResultsProps {
  query: string;
  response?: CatalogSearchResponse;
  providers?: CatalogProvidersResponse;
  directItems: SearchResultItem[];
  loading: boolean;
  providersLoading: boolean;
  error?: string;
  providersError?: string;
  onSearchKeyword?: (keyword: string) => void;
}

const REGION_OPTIONS = [
  { code: 'CN', label: '中国大陆 (CN)' },
  { code: 'HK', label: '中国香港 (HK)' },
  { code: 'TW', label: '中国台湾 (TW)' },
  { code: 'US', label: '美国 (US)' },
  { code: 'GB', label: '英国 (GB)' },
  { code: 'JP', label: '日本 (JP)' },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function hasDirectCandidate(result: CatalogSearchResult, items: SearchResultItem[]): boolean {
  const targets = [result.title, result.originalTitle]
    .filter((value): value is string => Boolean(value))
    .map(normalize);
  if (targets.length === 0) return false;
  return items.some((item) => {
    const name = normalize(item.name || '');
    if (!name || !targets.some((target) => name.includes(target) || target.includes(name))) return false;
    return !result.year || !item.year || result.year === item.year;
  });
}

function CatalogCard({
  query,
  result,
  directItems,
  providers,
  providersLoading,
  region,
  isDoubanProvider,
  providerKind,
  onSearchKeyword,
}: {
  query: string;
  result: CatalogSearchResult;
  directItems: SearchResultItem[];
  providers?: CatalogProvidersResponse;
  providersLoading: boolean;
  region: string;
  isDoubanProvider: boolean;
  providerKind?: 'tmdb' | 'douban' | 'bangumi';
  onSearchKeyword?: (keyword: string) => void;
}) {
  const imageMode = useAppStore((state) => state.imageProxyMode);
  const customImageProxy = useAppStore((state) => state.customImageProxy);
  const directCandidate = hasDirectCandidate(result, directItems);
  const availability = !isDoubanProvider
    ? providers?.list.find((item) => item.id === result.id && item.mediaType === result.mediaType)
    : undefined;
  const justWatchUrl = justWatchSearchUrl(result.originalTitle || result.title, region);
  const domesticLinks = buildChinesePlatformLinks(result.title);

  return (
    <article className="card flex min-w-0 overflow-hidden">
      <div className="relative w-[104px] sm:w-[116px] shrink-0 aspect-[2/3] bg-chip">
        {result.posterUrl ? (
          <SmartImage
            url={result.posterUrl}
            mode={imageMode}
            customProxy={customImageProxy}
            alt={result.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-faint text-xs">暂无海报</div>
        )}
      </div>
      <div className="p-3 min-w-0 flex-1 flex flex-col gap-2">
        <div>
          <h3 className="font-semibold text-sm text-content line-clamp-2">
            {result.title}
            {result.originalTitle && result.originalTitle !== result.title && (
              <span className="ml-1.5 font-normal text-xs text-muted">({result.originalTitle})</span>
            )}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-faint">
            <span>{result.mediaType === 'movie' ? '电影' : '剧集'}</span>
            {result.year && <span>{result.year}</span>}
            {typeof result.rating === 'number' && result.rating > 0 && (
              <span className="text-accent font-medium">评分 {result.rating.toFixed(1)}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {directCandidate ? (
            <span className="tag bg-success/15 text-success">已命中点播源候选</span>
          ) : (
            <span className="tag bg-chip text-muted">中文影视资料</span>
          )}
          {availability?.providerGroups.length ? (
            <span className="tag bg-accent/15 text-accent">有正版渠道信息</span>
          ) : null}
        </div>

        {result.overview && <p className="text-xs text-muted leading-relaxed line-clamp-3">{result.overview}</p>}

        {!isDoubanProvider && (
          availability?.providerGroups.length ? (
            <div className="space-y-1.5">
              {availability.providerGroups.map((group) => (
                <div key={group.type} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-faint shrink-0">{group.label}：</span>
                  {group.providers.map((provider) => (
                    <span
                      key={provider.id}
                      className="inline-flex items-center gap-1 rounded bg-chip px-1.5 py-1 text-[10px] text-content"
                      title={provider.name}
                    >
                      {provider.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={provider.logoUrl} alt="" loading="lazy" className="w-4 h-4 rounded object-contain" />
                      )}
                      {provider.name}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : providersLoading ? (
            <p className="text-[11px] text-faint" aria-live="polite">正在查询该地区的正版观看渠道…</p>
          ) : availability?.checked ? (
            <p className="text-[11px] text-faint">暂未收录该地区渠道列表，可使用下方国内正版平台快捷搜索。</p>
          ) : null
        )}

        <div className="space-y-1.5 mt-auto pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-faint shrink-0">正版直达：</span>
            {domesticLinks.map((platform) => (
              <a
                key={platform.name}
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-chip hover:bg-hover px-2 py-0.5 text-[11px] text-accent transition-colors"
              >
                {platform.name}
              </a>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {onSearchKeyword && result.title && normalize(result.title) !== normalize(query) && (
              <button
                type="button"
                className="text-accent hover:underline font-medium"
                onClick={() => onSearchKeyword(result.title)}
              >
                精准重搜此片
              </button>
            )}
            {onSearchKeyword &&
              result.originalTitle &&
              normalize(result.originalTitle) !== normalize(result.title) &&
              normalize(result.originalTitle) !== normalize(query) && (
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => onSearchKeyword(result.originalTitle!)}
                >
                  以英文原名搜源
                </button>
              )}
            {availability?.watchUrl && (
              <a href={availability.watchUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                查看地区正版渠道
              </a>
            )}
            <a
              href={result.doubanUrl || result.tmdbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-content hover:underline"
            >
              {result.doubanUrl ? '查看豆瓣详情' : providerKind === 'bangumi' ? '查看番组百科' : '查看 TMDB 资料'}
            </a>
            <a href={justWatchUrl} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-content hover:underline">
              JustWatch ({region})
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CatalogResults({
  query,
  response,
  providers,
  directItems,
  loading,
  providersLoading,
  error,
  providersError,
  onSearchKeyword,
}: CatalogResultsProps) {
  const watchRegion = useAppStore((state) => state.watchRegion);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const currentRegion = response?.region || watchRegion || 'CN';
  const isDoubanProvider = response?.provider === 'douban' || response?.provider === 'bangumi';
  const quickDomesticLinks = buildChinesePlatformLinks(query);

  return (
    <section aria-label="影视资料与正版观看渠道" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-content">中文影视资料与正版观看导航</h2>
          <p className="text-[11px] text-faint mt-0.5">
            即使当前未导入商业采集源，也可查看中文影片信息并一键直达国内正版平台；如需在软件内直接播放商业院线电影，请在右上角「设置 → 源管理」添加点播源或订阅。
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted shrink-0">
          <span>地区：</span>
          <select
            className="rounded-md border border-line bg-chip px-2 py-1 text-xs text-content focus:outline-none focus:border-accent"
            value={watchRegion}
            onChange={(e) => updateSettings({ watchRegion: e.target.value })}
            aria-label="切换观看渠道地区"
          >
            {REGION_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-live="polite">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="card flex h-40 overflow-hidden">
              <div className="w-[104px] shrink-0 bg-chip animate-pulse" />
              <div className="flex-1 p-3 space-y-2">
                <div className="h-4 w-3/4 rounded bg-chip animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-chip animate-pulse" />
                <div className="h-3 w-full rounded bg-chip animate-pulse" />
                <div className="h-3 w-2/3 rounded bg-chip animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-line bg-chip p-3 text-xs text-muted">{error}</div>
      ) : !response?.configured || response.list.length === 0 ? (
        <div className="rounded-lg border border-line bg-chip p-4 text-xs text-muted leading-relaxed space-y-2">
          <p>
            暂未获取到“{query}”的详细卡片资料，你仍可直接前往以下国内正版平台搜索观看：
          </p>
          <div className="flex flex-wrap gap-2">
            {quickDomesticLinks.map((platform) => (
              <a
                key={platform.name}
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost btn-sm text-accent"
              >
                在{platform.name}搜索“{query}”
              </a>
            ))}
            <a
              href={justWatchSearchUrl(query, currentRegion)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost btn-sm text-muted"
            >
              JustWatch ({currentRegion})
            </a>
          </div>
        </div>
      ) : (
        <>
          {providersError && !isDoubanProvider && (
            <div className="mb-3 rounded-lg border border-line bg-chip p-3 text-xs text-muted">
              影片资料已找到，但地区渠道查询失败：{providersError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {response.list.map((result) => (
              <CatalogCard
                key={`${result.mediaType}:${result.id}`}
                query={query}
                result={result}
                directItems={directItems}
                providers={providers}
                providersLoading={providersLoading}
                region={currentRegion}
                isDoubanProvider={isDoubanProvider}
                providerKind={response.provider}
                onSearchKeyword={onSearchKeyword}
              />
            ))}
          </div>
        </>
      )}

      <p className="mt-2 text-[10px] text-faint leading-relaxed">
        {isDoubanProvider
          ? '中文影视资料来源于公开条目检索；正版观看按钮将打开各官方平台对应搜索页。'
          : '影视资料及海报由 TMDB 提供；观看渠道数据由 JustWatch 提供。渠道列表不等于可在本应用内直接播放。'}
      </p>
    </section>
  );
}

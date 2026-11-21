'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { hasDescriptiveEpisodeNames } from '@/lib/cms-parser';
import type { SearchResultItem, VideoDetail } from '@/lib/types';
import { buildWatchUrl } from '@/lib/utils';
import { formatRemarks } from '@/lib/remarks';
import { SmartImage } from './smart-image';
import { useAppStore, resolveSource } from '@/lib/store';
import { useToast } from './toast';
import { cn } from '@/lib/utils';
import { addSearchHistory } from '@/lib/db';
import { copyToClipboard } from '@/lib/clipboard';
import { EmptyState, ErrorState, LoadingState } from './states';
import { useFocusTrap } from './use-focus-trap';
import { Icon } from './icon';

/**
 * 详情弹窗：剧集列表 + 排序 + 复制链接。
 * 剧集点击 → /watch 路由（URL 携带定位参数，可分享、可后退）。
 */

export function DetailModal({ item, onClose }: { item: SearchResultItem | null; onClose: () => void }) {
  const store = useAppStore();
  const router = useRouter();
  const { toast } = useToast();
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reversed, setReversed] = useState(false);
  const [routeIndex, setRouteIndex] = useState(0);
  const [posterFailed, setPosterFailed] = useState(false);
  const [translatedDesc, setTranslatedDesc] = useState('');
  const [translatingDesc, setTranslatingDesc] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 打开时把焦点移入弹窗、Tab 圈闭在弹窗内、关闭后归还焦点
  useFocusTrap(Boolean(item), panelRef);

  useEffect(() => setPosterFailed(false), [item?.pic, store.imageProxyMode, store.customImageProxy]);

  // 弹窗打开期间锁定背景滚动
  useEffect(() => {
    if (!item) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [item]);

  useEffect(() => {
    if (!item) {
      setDetail(null);
      setRouteIndex(0);
      setTranslatedDesc('');
      setError('');
      return;
    }
    setRouteIndex(0);
    setTranslatedDesc('');
    const source = resolveSource(store, item.sourceKey, {
      url: item.sourceUrl,
      name: item.sourceName,
    });
    if (!source) {
      setError('点播源配置不存在（可能已被删除），请在设置中重新添加');
      return;
    }
    setLoading(true);
    setError('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    api
      .detail(item.vodId, source, controller.signal)
      .then((d) => setDetail(d))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '获取详情失败');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [item, onClose]);

  if (!item) return null;

  const playRoutes = detail?.playRoutes ?? [];
  const safeRouteIndex = playRoutes.length > 0 ? Math.min(routeIndex, playRoutes.length - 1) : 0;
  const rawEpisodes = playRoutes[safeRouteIndex]?.episodes ?? detail?.episodes ?? [];
  const rawEpisodeNames = playRoutes[safeRouteIndex]?.episodeNames ?? detail?.episodeNames ?? [];
  const descriptiveNames = hasDescriptiveEpisodeNames(rawEpisodeNames);
  const maxLabelLen = descriptiveNames
    ? Math.max(0, ...rawEpisodeNames.map((n) => n.trim().length))
    : 0;
  const episodes = reversed ? [...rawEpisodes].reverse() : rawEpisodes;
  const info = detail?.videoInfo;

  const play = (index: number) => {
    if (!detail || !rawEpisodes[index]) return;
    addSearchHistory(item.name).catch(() => {});
    router.push(
      buildWatchUrl({
        sourceKey: item.sourceKey,
        vodId: item.vodId,
        index,
        route: safeRouteIndex,
        episodeUrl: rawEpisodes[index],
        title: item.name,
        sourceUrl: item.sourceUrl,
      })
    );
  };

  const copyLinks = async () => {
    if (!detail) return;
    const ok = await copyToClipboard(rawEpisodes.join('\n'));
    if (ok) toast('播放链接已复制', 'success');
    else toast('复制失败，请检查浏览器权限', 'error');
  };

  // 备注与卡片同源，同样归一化，避免同一部剧在两处显示不同文案
  const remarks = formatRemarks(info?.remarks);
  const metaRows = [
    info?.typeName && ['类型', info.typeName],
    info?.year && ['年份', info.year],
    info?.area && ['地区', info.area],
    info?.director && ['导演', info.director],
    info?.actor && ['主演', info.actor],
    remarks && ['备注', remarks],
  ].filter(Boolean) as [string, string][];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-start justify-center sm:overflow-y-auto bg-black/80 sm:py-10 px-0 sm:px-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        // 手机：贴底全宽底部面板（顶部圆角 + 安全区）；平板/桌面：居中弹窗
        className="bg-surface-raised rounded-t-2xl sm:rounded-xl w-full max-w-3xl shadow-2xl animate-slide-up outline-none max-h-[92dvh] sm:max-h-none flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} 详情`}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3 border-b border-line shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-content break-words">{item.name}</h2>
            <span className="text-sm text-faint">{item.sourceName}</span>
          </div>
          <button
            className="p-1.5 rounded-md text-muted hover:text-content hover:bg-hover shrink-0"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 pt-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] sm:pb-5 flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin">
          {loading && <LoadingState label="正在获取剧集信息..." />}

          {!loading && error && <ErrorState message={error || '获取失败'} />}

          {!loading && !error && detail && (
            <>
              <div className="flex gap-4 mb-4">
                {item?.pic && !posterFailed && (
                  <SmartImage
                    url={item.pic}
                    mode={store.imageProxyMode}
                    customProxy={store.customImageProxy}
                    alt={item.name}
                    // self-start 不能省：这一行是 flex（默认 align-items: stretch），
                    // 少了它海报会被信息列的高度拉变形，aspect-[2/3] 让位给拉伸高度，
                    // 手机与桌面同样中招（原实现的 self-center sm:self-start 就是干这个的）。
                    className="w-20 sm:w-32 aspect-[2/3] object-contain rounded-lg bg-chip shrink-0 self-start"
                    loading="eager"
                    onExhausted={() => setPosterFailed(true)}
                  />
                )}
                <div className="min-w-0 space-y-3">
                  {metaRows.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      {metaRows.map(([k, v]) => (
                        <div key={k} className="truncate" title={`${k}: ${v}`}>
                          <span className="text-faint">{k}:</span>{' '}
                          <span className="text-content">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {info?.desc && (
                    <div className="space-y-1.5">
                      <p className="text-sm text-muted leading-relaxed line-clamp-4">
                        {translatedDesc || info.desc}
                      </p>
                      {!translatedDesc && /[A-Za-z]{12,}/.test(info.desc) && (
                        <button
                          type="button"
                          className="text-xs text-accent hover:underline"
                          disabled={translatingDesc}
                          onClick={async () => {
                            if (!info.desc) return;
                            setTranslatingDesc(true);
                            try {
                              const lines = info.desc.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10);
                              const res = await fetch('/api/translate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lines }),
                              });
                              if (!res.ok) throw new Error('翻译失败');
                              const data = (await res.json()) as { translations?: string[] };
                              if (data.translations?.length) {
                                setTranslatedDesc(data.translations.join('\n'));
                              }
                            } catch {
                              toast('简介翻译暂不可用', 'error');
                            } finally {
                              setTranslatingDesc(false);
                            }
                          }}
                        >
                          {translatingDesc ? '正在翻译简介为中文…' : '将英文简介翻译为简体中文'}
                        </button>
                      )}
                    </div>
                  )}
                  {detail.subtitles && detail.subtitles.length > 0 && (
                    <p className="text-xs text-accent">
                      已检测到 {detail.subtitles.length} 条可用字幕轨（进入播放页可自动挂载或一键汉化）
                    </p>
                  )}
                </div>
              </div>

              {episodes.length > 0 ? (
                <>
                  {playRoutes.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-2.5 border-b border-line/60">
                      <span className="text-xs text-faint mr-1">播放线路:</span>
                      {playRoutes.map((route, idx) => (
                        <button
                          key={`${route.name}-${idx}`}
                          type="button"
                          onClick={() => setRouteIndex(idx)}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-xs transition-colors border',
                            idx === safeRouteIndex
                              ? 'border-accent bg-accent/15 text-accent font-medium'
                              : 'border-line bg-chip text-muted hover:text-content'
                          )}
                        >
                          {route.name} ({route.episodes.length})
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      {episodes.length > 1 && (
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => setReversed((v) => !v)}
                          aria-label={reversed ? '切换为正序排列' : '切换为倒序排列'}
                          title="调整剧集列表的排列顺序"
                        >
                          <Icon
                            name="arrowDown"
                            className={cn('w-3.5 h-3.5 transition-transform', reversed && 'rotate-180')}
                          />
                          {reversed ? '正序排列' : '倒序排列'}
                        </button>
                      )}
                      <span className="text-sm text-faint">共 {episodes.length} 集</span>
                    </div>
                    <button className="btn-primary btn-sm" onClick={copyLinks}>
                      复制链接
                    </button>
                  </div>
                  <div
                    className={cn(
                      'grid gap-2 max-h-[40vh] overflow-y-auto scrollbar-thin pr-1',
                      descriptiveNames
                        ? maxLabelLen > 10
                          ? 'grid-cols-1 sm:grid-cols-2'
                          : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5'
                        : 'grid-cols-4 sm:grid-cols-5 md:grid-cols-7'
                    )}
                  >
                    {episodes.map((_, i) => {
                      const realIndex = reversed ? rawEpisodes.length - 1 - i : i;
                      const label = descriptiveNames
                        ? rawEpisodeNames[realIndex] || String(realIndex + 1)
                        : String(realIndex + 1);
                      return (
                        <button
                          key={realIndex}
                          className={cn(
                            'btn-ghost btn-sm truncate',
                            descriptiveNames && maxLabelLen > 10 ? '!px-2.5 text-left justify-start' : '!px-1.5 text-center'
                          )}
                          title={rawEpisodeNames[realIndex] || `第 ${realIndex + 1} 集`}
                          onClick={() => play(realIndex)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon="alert"
                  title="未找到播放资源"
                  description="该视频可能暂时无法播放，请尝试其他视频"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

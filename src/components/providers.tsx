'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from './toast';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import { GlobalDownloadManager } from './download-manager';
import { useAppStore, hydrateLiveProbeResults } from '@/lib/store';
import { api, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';

const STARTER_PACK_SEEDED_KEY = 'libretv-starter-pack-v20';

function healBuiltInOpenMediaSources() {
  if (typeof window === 'undefined') return;
  const origin = window.location.origin;
  if (!origin || !/^https?:\/\//i.test(origin)) return;

  const targetOpenUrl = `${origin}/api/open-media?short=1&zh=1`;
  const state = useAppStore.getState();

  // 1) 自动解除内置同源 /api/open-media 因旧版超时留下的停用惩罚，并自动升级旧版裸 /api/open-media 地址
  let customChanged = false;
  const upgradedCustom = state.customAPIs.map((item) => {
    if (typeof item.url === 'string' && item.url.startsWith(`${origin}/api/open-media`)) {
      if (state.sourceHealth[item.key]) {
        state.clearSourceHealth(item.key);
      }
      if (!item.url.includes('short=1') || !item.url.includes('zh=1')) {
        customChanged = true;
        return {
          ...item,
          name: '内置双语开放影视库（5120+ 公版经典 / 国会图书馆直连 / 开源动画 / NASA / ESO）',
          url: targetOpenUrl,
        };
      }
    }
    return item;
  });
  for (const envItem of state.envSources) {
    if (typeof envItem.url === 'string' && envItem.url.startsWith(`${origin}/api/open-media`) && state.sourceHealth[envItem.key]) {
      state.clearSourceHealth(envItem.key);
    }
  }
  if (customChanged) {
    useAppStore.setState({ customAPIs: upgradedCustom });
  }
}

function seedStarterResourcesOnce() {
  if (typeof window === 'undefined') return;
  const origin = window.location.origin;
  if (!origin || !/^https?:\/\//i.test(origin)) return;

  let firstTimeV17 = false;
  try {
    if (localStorage.getItem(STARTER_PACK_SEEDED_KEY) !== '1') {
      localStorage.setItem(STARTER_PACK_SEEDED_KEY, '1');
      firstTimeV17 = true;
    }
  } catch {
    return;
  }
  if (!firstTimeV17) return;

  const state = useAppStore.getState();
  // 强制让旧手机上的同源预置订阅立即重刷最新 v16 open-media-sources.json（免等 24 小时周期）
  const targetSubUrl = `${origin}/open-media-sources.json`;
  if (state.subscriptions.some((s) => s.url === targetSubUrl)) {
    useAppStore.setState({
      subscriptions: state.subscriptions.map((s) =>
        s.url === targetSubUrl ? { ...s, lastSync: undefined, failStreak: 0 } : s
      ),
    });
  }
  if (state.customAPIs.length === 0 && state.envSources.length === 0) {
    state.addCustomApi({
      name: '内置双语开放影视库（5120+ 公版经典 + 开源动画 + 太空纪实）',
      url: `${origin}/api/open-media?short=1&zh=1`,
      detail: origin,
    });
  }
  if (state.liveSubscriptions.length === 0 && state.liveEnvSources.length === 0) {
    state.addLiveSubscription(
      `${origin}/open-live-channels.m3u`,
      '内置双阶实测超清直播（8868 台卫视 / 电影 / 动漫 / 纪实）'
    );
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      })
  );

  // PWA 只缓存同源静态资源；API、登录态、播放页和媒体流始终走网络。
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);

  // store 配置了 skipHydration：等挂载后再读 localStorage，
  // 保证 hydration 阶段客户端与服务端渲染结果一致。
  useEffect(() => {
    // 先等持久化状态恢复，再拉服务端下发数据：
    // 避免 setEnvSources/setLiveEnvSources 的勾选合并发生在 rehydrate 之前被覆盖
    Promise.resolve(useAppStore.persist.rehydrate())
      .then(() => {
        healBuiltInOpenMediaSources();
        seedStarterResourcesOnce();
        // 测活缓存从 IndexedDB 恢复（并顺带搬迁旧 localStorage 快照里的存量），
        // 与下方 /api/status 拉取互不依赖，失败静默
        void hydrateLiveProbeResults();
        // 拉取部署者通过 DEFAULT_SOURCES / DEFAULT_LIVE_SOURCES 预置的源（失败时静默忽略）
        // 与 AuthProvider 共用同一 query key，/api/status 全站只发一次
        return queryClient.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() });
      })
      .then(async (d) => {
        // 预置数据（DEFAULT_SOURCES / DEFAULT_LIVE_SOURCES / DEFAULT_SUBSCRIPTIONS）
        // 预置订阅要经鉴权接口拉取，首屏这次可能发生在登录之前而 401 静默失败；
        // 登录成功后由 AuthProvider 再调一次 applyEnvPresets 补齐（函数幂等）
        if (d) await applyEnvPresets(d);
        healBuiltInOpenMediaSources();
      })
      .catch(() => {
        healBuiltInOpenMediaSources();
      });
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          {/* 全站常驻：下载事件监听（enqueueDownload）依赖它存在——
              挂在 Header 里会让 /watch 等不渲染 Header 的页面派发的事件凭空丢失 */}
          <GlobalDownloadManager />
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

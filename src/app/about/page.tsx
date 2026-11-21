'use client';

import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10 space-y-8">
        <section>
          <h1 className="text-xl font-bold text-content mb-3">关于自由影视 (LibreTV)</h1>
          <p className="text-sm text-muted leading-relaxed">
            自由影视（基于 LibreTV 构建）是一个全中文化的免费在线视频搜索与观看平台。输入中文或英文片名即可在多个点播源中聚合搜索，
            内置双通道中文字幕引擎（支持外文字幕一键自动汉化与本地 UTF-8/GBK 字幕挂载）、公版开放影院与正版影视导航，无需注册、无内嵌广告、不存储任何视频文件。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">快捷键</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
            <li><code className="text-accent">空格</code> 播放 / 暂停</li>
            <li><code className="text-accent">←</code> / <code className="text-accent">→</code> 快退 / 快进 5 秒</li>
            <li><code className="text-accent">↑</code> / <code className="text-accent">↓</code> 音量调节</li>
            <li><code className="text-accent">F</code> 切换全屏</li>
            <li><code className="text-accent">Alt + ←/→</code> 上一集 / 下一集</li>
            <li>移动端长按视频可 3 倍速播放</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">影视资料与数据来源</h2>
          <div className="rounded-lg bg-chip p-3 space-y-2">
            <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-content hover:text-accent">
              {/* Official TMDB logo asset; keep its original proportions and colors. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/attribution/tmdb-blue-long.svg" alt="TMDB" className="h-6 w-auto max-w-[180px]" />
              <span className="sr-only">The Movie Database</span>
            </a>
            <p className="text-sm text-muted leading-relaxed">
              影视名称、简介、海报及评分由 TMDB API 提供。This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              正版流媒体、租赁和购买渠道数据由 JustWatch 提供，并通过 TMDB Watch Providers 接口查询。地区渠道信息可能不完整或延迟更新。
            </p>
            <div className="flex flex-wrap gap-3 text-xs">
              <a href="https://www.themoviedb.org/about/logos-attribution" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">TMDB Logo 与署名规范</a>
              <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">JustWatch</a>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">隐私与数据</h2>
          <p className="text-sm text-muted leading-relaxed">
            你的搜索历史、观看进度等数据仅保存在本设备浏览器中（IndexedDB），不会上传到服务器。
            聚合搜索请求由服务端代理转发，第三方数据源不会看到你的 IP 地址。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">免责声明</h2>
          <p className="text-sm text-faint leading-relaxed">
            本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力。
            请尊重版权，所有内容的合法性由对应数据源负责。
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

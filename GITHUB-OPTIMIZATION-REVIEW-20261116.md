# LibreTV Mobile 2.23.4 — GitHub 开源项目优化评估

评估日期：2026-11-16  
目标：在保留现有 LibreTV 功能与 Android TWA 发布链的前提下，筛选真正值得吸收的上游项目和修复。

## 结论

本轮没有为了“看起来更先进”而整体替换播放器、PWA 或框架。项目已经有成熟的 ArtPlayer + hls.js + mpegts.js 组合、经过测试的 PWA 离线壳和 Bubblewrap TWA。大规模替换会影响换源、续播、跳过标记、直播、下载、全屏和手机端行为；当前没有真机回归条件，不适合在补丁版本中冒险迁移。

本轮实际采用：
- `ipaddr.js@2.5.0`：用成熟地址分类库替换不完整的手写 IPv4/IPv6 特殊地址判断。
- 保留并强化现有媒体架构：限制 Archive/NASA 元数据并发、修复 NASA 带空格 ID、拒绝尾点 localhost 媒体地址、复用固定官方服务的代理 dispatcher。
- 继续跟踪上游播放器修复，但只在确实影响当前配置时移植。

## 项目比较

| 项目 | 上游状态 / 能力 | 对本项目的判断 |
|---|---|---|
| [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV) | 官方最新 Release 为 v2.23.2（2026-11-14）；当前分支已基于该版本 | 保持同步；本轮没有发现需要跳过官方更新的更高稳定版本 |
| [Video.js](https://github.com/videojs/video.js) | v10.4.0 于 2026-11-13 发布；现代播放器架构，吸收 Media Chrome 等生态能力 | 值得单独做原型，但不是 2.23.3 的直接替换。现有 ArtPlayer 集成涉及播放进度、跳过标记、HLS、原生直链和下载，迁移需独立真机验收 |
| [Shaka Player](https://github.com/shaka-project/shaka-player) | 活跃的自适应流媒体播放器，支持 HLS / DASH 等 | 可作为未来 DASH 支持的候选；当前已选择手机友好 WebM/MP4，增加第二套媒体引擎会扩大包体和故障面 |
| [Serwist](https://github.com/serwist/serwist) | 9.5.12 于 2026-07-22 发布；Workbox 系 PWA / Service Worker 工具链 | 当前 Service Worker 只缓存静态资源与离线提示页，API 和媒体保持网络请求，现有离线验收通过；暂不迁移 |
| [mpegts.js](https://github.com/xqq/mpegts.js) | 当前依赖 1.8.2；上游 PR #310 于 2026-11-10 合并，修复 Worker teardown 时读取 SourceBuffer.buffered 的 InvalidStateError | 本项目 FLV 播放明确使用 `enableWorker: false`，该 Worker 专属修复不影响当前路径；等待包含修复的正式版本，不直接依赖未发布分支 |
| [hls.js](https://github.com/video-dev/hls.js) | 当前依赖 1.7.4 | 保留；当前已有直播缓冲、网络重试和媒体错误恢复策略 |
| [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) | 当前 npm 最新稳定版 5.4.0；GitHub 开发代码已包含 5.4.1 safe-area 修复 | 保留；本项目已针对 5.4.0 的网页全屏→系统全屏回归设置 `FULLSCREEN_WEB_IN_BODY=false`，并显式关闭未使用的 autoOrientation 插件；继续等待正式 npm 发布后再评估升级 |
| [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) | 当前 TWA 工具链 1.27.0，`bubblewrap doctor` 已通过 | 保留；APK/AAB 已绑定稳定 HTTPS 域名与 Digital Asset Links，不需要重做原生壳 |
| [ipaddr.js](https://github.com/whitequark/ipaddr.js) | npm 稳定版 2.5.0，MIT | 已采用；非 unicast 地址分类覆盖私网、环回、链路本地、组播、保留、文档、基准测试、转换地址和 IPv4-mapped IPv6 |

## 本轮已实施的修复

### 1. SSRF / IP 地址判断
- 新增直接依赖 `ipaddr.js@2.5.0`。
- `isPrivateIP` 现在按地址库的非 unicast 分类拒绝特殊地址，避免仅靠少量正则遗漏保留网段。
- 继续保留 DNS 预检与连接级 DNS rebinding 防护；用户自定义采集源和联邦 PeerTube 主机不会获得固定官方服务的代理白名单。
- PeerTube 直链拒绝 `localhost.` 等尾点本地名称、私网字面量和本地域名后缀。

### 2. NASA 真实数据兼容
- NASA 的 `nasa_id` 可能包含空格和标点，不能只接受 `[A-Za-z0-9_-]`。
- 搜索和详情现在使用同一安全校验，并在请求边界把 ID 编码为单一路径段。
- 拒绝路径分隔符、控制字符、竖线和 `.` / `..` 路径段。
- 新增搜索 + 详情回归测试，覆盖 `Apollo 14 Prelaunch Activities - No Sound` 这类带空格 ID。

### 3. 上游请求负载
- Internet Archive 元数据查找最多 8 个并发。
- NASA 资产清单 / 元数据查找最多 4 个并发。
- 结果数组保持输入顺序，单条失败不会把错误扩散成整组结果失败。
- 固定官方提供方代理 dispatcher 按代理 URI 缓存；只有 Archive、NASA、Wikimedia 和 SepiaSearch 等固定域名可进入此路径。

## 暂不实施的变更

- 不把 ArtPlayer 直接换成 Video.js 10：需要建立独立分支，逐项验证触控、横竖屏、全屏、续播、倍速、跳过片段、HLS/FLV 和下载。
- 不把 hls.js 和 Shaka Player 同时装入生产：除非确认需要 DASH，避免重复媒体引擎。
- 不迁移 Serwist：目前没有离线缓存缺陷，视频/API 不应进入 Service Worker 缓存。
- 不移植 mpegts.js 未发布分支：当前 FLV 路径关闭 Worker，该修复不在实际执行路径。
- 不更新 Next.js 大版本：继续使用已通过本项目测试的 Next.js 15.5.29。

## 参考链接

- [LibreTV 官方 Releases](https://github.com/LibreSpark/LibreTV/releases)
- [Video.js Releases](https://github.com/videojs/video.js/releases)
- [mpegts.js PR #310](https://github.com/xqq/mpegts.js/pull/310)
- [Serwist Releases](https://github.com/serwist/serwist/releases)
- [ipaddr.js](https://github.com/whitequark/ipaddr.js)

## 2.23.4 播放器兼容性修复

- ArtPlayer 上游 issue [#1073](https://github.com/zhw2590582/ArtPlayer/issues/1073) 明确报告 5.4.0 在网页全屏切换系统全屏时会退出网页全屏；上游反馈的可用规避方案是 `Artplayer.FULLSCREEN_WEB_IN_BODY = false`。
- VOD 与 Live 两个播放器都在实例创建前应用该设置，避免只有点播修复、直播仍保留同一故障。
- 新增 `src/lib/artplayer-globals.ts` 统一管理全局 static 设置；播放器卸载时同时恢复 `CONTROL_HIDE_TIME=3000` 与 `FULLSCREEN_WEB_IN_BODY=true`，防止跨路由污染。
- ArtPlayer 5.4.1 的 safe-area 修复已出现在 GitHub 开发代码/未发布变更中，但 npm registry 当前仍为 5.4.0。该修复针对可选 `autoOrientation` 旋转插件；本应用 VOD/Live 均显式设置 `autoOrientation: false`，因此不把未发布代码直接 vendoring 进生产依赖。
- PeerTube 媒体地址的尾随点规范化改为移除全部尾点，并覆盖 `localhost..`、`localhost...`、`api.localhost...` 回归案例。

## 剩余验收限制

- Render 公网部署需要完成用户自己的 Render 登录授权后再触发。
- 真机 Android / iOS 播放、后台音频、硬件解码和实际下载仍需设备验收。
- NASA 单项权利仍需核对原始条目；NASA 官方资料库来源不等于每条素材都自动获得相同许可。


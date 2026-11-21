# LibreTV Mobile 2.23.6 — GitHub 开源项目优化评估

评估日期：2026-11-16  
目标：在保留现有 LibreTV 功能与 Android TWA 发布链的前提下，筛选真正值得吸收的上游项目和修复。

## 2.23.6：双轨搜索与社区方案复核

### C 方案实施
- 保留现有 CMS / 开放媒体搜索作为「播放源候选」通道；仅在详情接口解析出剧集播放 URL 后才确认可播放。
- 新增 TMDB `/search/multi` 电影/剧集资料搜索，服务端 Bearer token，不向浏览器暴露密钥。
- 新增 TMDB Watch Providers 地区查询，展示订阅、免费、广告、租赁、购买分类，并按用户设置的 ISO 国家地区代码查询。
- 复审后将资料搜索与 Watch Providers 拆成两个 API：资料结果先返回，正版渠道并行加载；最多 10 部影片、3 并发、单次 5 秒超时、30 分钟缓存，避免渠道 API 慢时阻塞影片搜索。
- TMDB 文档明确 Watch Providers 由 JustWatch 合作提供，不提供完整深链，而是返回 TMDB 观看页；实现按该约定展示并注明 JustWatch 来源。
- 影视资料与点播源候选分开显示，不把元数据冒充成可播放视频。
- Render Blueprint 将开放媒体目录改为 `DEFAULT_SOURCES` 预置源，首次访问自动勾选，避免依赖登录后才同步的默认订阅。
- 开放媒体中文别名缓存改为按解析后的 provider query 生成版本化 cache key；空结果不进入 CDN 缓存。

### GitHub 社区方案核对
- LibreTV [PR #981](https://github.com/LibreSpark/LibreTV/pull/981) 声称有 21 个逐项测试的直连 CMS 源，验证链包括搜索、详情和 m3u8 提取；该 PR 当前仍为 open，未合并。
- 没有把 PR 的第三方源地址直接复制进默认配置：PR 说明来源来自外部聚合站的直连线路，域名可能变动；不能仅凭 PR 声明确认所有源的授权状态与当前可用性。
- 采用其「逐源探测 + 搜索/详情/播放地址三阶段验证」的方法，但默认只预置本站开放许可资料库；用户可添加自己拥有或获授权使用的 CMS 源。

### TMDB 官方规则
- 使用 TMDB 官方 API Read Access Token（Bearer）并在服务端调用；API key 不进入浏览器。
- TMDB 官方 FAQ 要求应用使用其 Logo，并在 About/Credits 放置不背书声明；本项目使用 TMDB 官方 approved blue logo 资产和规定文案。
- TMDB 官方说明其开发者 API 免费仅限非商业用途且必须署名；商业用途需联系 TMDB 获取许可。
- TMDB Watch Providers 文档明确要求标注 JustWatch，并指出 API 不返回完整平台深链；本项目只链接其返回的 TMDB watch URL。

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

## 2.23.5 稳定性修复与 GitHub 复核

### 本轮修复
- API JSON 请求体增加真实字节上限，避免只信任 `Content-Length` 或对不受限的请求体直接 `req.json()`。
- CMS 点播源 URL 统一规范化，拒绝不支持协议与 URL userinfo；API URL 构建保留已有 query token；搜索缓存按来源标识、名称、详情页地址和成人标记区分。
- 搜索、画质探测、直播测活的 NDJSON 客户端取消会终止上游请求；同 host 等待队列中的任务立即退出，不再占用并发槽。
- `fetchWithSafeRedirects` 始终手动逐跳校验，`safeRedirects:false` 不能关闭 SSRF 检查；3xx 响应体在下一跳前取消，AbortSignal 通过组合信号贯穿响应体生命周期。
- 点播代理只对响应头等待限时，不再用 8 秒总超时切断长视频/分片；HLS 清单上限 2 MiB / 10 秒，直播测活清单上限 1 MiB。
- 直链下载验证实际文件头，限制单一 Range 请求，防止 multipart/byteranges 被错误标记为 MP4；签名读取有 5 秒上限。
- 为上游响应统一增加流式字节上限：CMS 搜索 512 KiB/页、源测试 1 MiB、详情 JSON/HTML 2 MiB、源订阅 4 MiB、直播 M3U 8 MiB、XMLTV 32 MiB、通用第三方 JSON 4 MiB；超限立即取消 body。
- XMLTV gzip 解压设置 64 MiB 输出上限，防止压缩炸弹；新增通用 bounded response reader 与 gzip 上限回归测试。
- 画质探测也复用 CMS 源配置规范化，拒绝 URL userinfo 和超长字段；代理、下载、直播订阅及 EPG 入口增加 URL / 频道标识长度上限。

### 上游问题核对
- ArtPlayer [#1073](https://github.com/zhw2590582/ArtPlayer/issues/1073) 报告 5.4.0 网页全屏切系统全屏会退出网页全屏；上游评论给出的规避设置是 `FULLSCREEN_WEB_IN_BODY=false`，本项目 VOD/Live 均已采用。
- ArtPlayer [#1033](https://github.com/zhw2590582/ArtPlayer/issues/1033) 讨论 iOS standalone 安全区与可选自动旋屏插件；当前应用显式 `autoOrientation:false`，不启用该问题涉及的旋转路径。
- LibreTV [#937](https://github.com/LibreSpark/LibreTV/issues/937) 描述 iOS 控制栏 3 秒自动隐藏；本项目触屏策略使用 `Number.MAX_SAFE_INTEGER`，并避免合成 mousemove 抢先切换控制栏。
- LibreTV [#977](https://github.com/LibreSpark/LibreTV/issues/977) 指出 Blob 下载触发不等于设备已落盘；当前下载管理器已区分「已生成，待保存」，保留 Blob 重试入口，不再误报已保存。

### 替代项目结论（按当前 GitHub 主分支 README / package 元数据复核）
- [Video.js 10](https://github.com/videojs/video.js) 的 `@videojs/core` 当前为 10.4.0，README 标注 v10 stable，并提供现代模块化及 React 方向；它是值得做独立原型的候选，但不是 ArtPlayer 的 API 兼容替换。
- [Shaka Player](https://github.com/shaka-project/shaka-player) 当前 5.3.0（2026-10-16），支持 HLS / DASH 和 IndexedDB 离线存储；iOS/iPadOS 在不支持 MSE 的环境回退到原生 HLS。若未来要增加 DASH 或离线下载，它是更合适的专项候选，但不应与 hls.js 无规划地并存。
- [Plyr](https://github.com/sampotts/plyr) 的 README 已明确标为 deprecated / security updates only，并指向 Video.js 10；不再把 Plyr 作为新项目候选。
- [Movi Player](https://github.com/MrUjjwalG/movi-player) 0.4.1 用 WASM 处理 MKV / HEVC / AV1 / HDR，并通过 Shaka、hls.js、dash.js 处理自适应流；README 标示 JS 50–410 KB、WASM 约 1.8–3.2 MB。对当前以 HLS / MP4 为主的手机网页，额外 WASM 下载、内存和 Canvas 播放链路的成本不划算，只适合将来明确需要浏览器解码 MKV/HEVC 的可选实验。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) 主分支 package 源码已出现 5.4.1，但 CHANGELOG 将 safe-area 修复列在 Unreleased；本项目锁定的 npm 5.4.0 不应直接假定已包含该修复。当前 5.4.0 的 fullscreen 回归继续用 `FULLSCREEN_WEB_IN_BODY=false` 规避。
- [hls.js](https://github.com/video-dev/hls.js) 是 HLS 媒体加载 / transmux 引擎，不是 UI 播放器；项目已使用 hls.js 1.7.4，保留现有 ArtPlayer + hls.js + mpegts.js 组合，避免重复引入第二套 HLS 引擎。

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


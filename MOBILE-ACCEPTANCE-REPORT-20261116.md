# LibreTV Mobile 2.23.3 — 2026-11-16 验收报告

## 版本与环境

- 应用版本：2.23.3
- Next.js：15.5.29
- React：19.3.1
- ArtPlayer：5.4.0
- hls.js：1.7.4
- mpegts.js：1.8.2
- ipaddr.js：2.5.0
- 本地 Node.js：24.18.0
- 工作目录：`E:\\Github\\LibreTV-Mobile-Publish`

## 自动化检查

| 检查 | 结果 |
|---|---|
| Vitest | 52 个测试文件通过 |
| 单元测试 | 741 passed / 0 failed |
| TypeScript | `npm run typecheck` 通过 |
| ESLint | `npm run lint` 通过 |
| 生产依赖审计 | 0 vulnerabilities |
| 全量依赖审计 | 0 vulnerabilities |
| `git diff --check` | 通过 |
| Next.js 生产构建 | 通过 |

说明：版本号更新后发现本地 `node_modules/next` 不完整。首次 clean `npm ci` 遇到 Windows 文件锁 EPERM；停止本项目验收服务后重试成功，重新安装 413 个依赖包。测试、类型检查、Lint、两种 npm audit 和 Next.js 生产构建均在 clean install 后通过。

## 真实上游接口验收（本地生产构建）

使用本地生产服务与 VPN07 出站代理，查询真实公共媒体 API：

| 查询 | 真实结果 |
|---|---|
| Apollo | 返回 15 条；包含 Internet Archive、NASA、PeerTube 与 Wikimedia Commons |
| Earth from Space | 返回 NASA 50:00 与 PeerTube 1:54:22 |
| The General | 返回 8 条；包含 Internet Archive 与 Wikimedia Commons |
| NASA 带空格 ID | `Apollo 14 Prelaunch Activities - No Sound` 返回 22:20，详情成功生成编码后的官方 mobile MP4 地址 |
| Wikimedia Commons | The General 真实 `videoinfo.duration` 为 4551.713 秒，详情成功选用 240p VP9 WebM 转码 |

本轮修复后，四个提供方均完成真实搜索 + 详情请求。Apollo 17 实测分别返回：Internet Archive 1:42:45 MP4、NASA 57:48 mobile MP4、PeerTube 28:29 HLS、Wikimedia Commons 28:30 WebM，均返回真实播放 URL。The General 实测返回 8 个不同版本（6 个 Archive、2 个 Commons）。NASA 带空格 ID 的搜索与详情也通过。此前观察到的 VPN07 代理连接拒绝在固定官方提供方复用 ProxyAgent 后，最终复测未再出现。

额外对四类真实媒体地址发起 `Range: bytes=0-1023`：Archive MP4、NASA MP4、Commons WebM 和 PeerTube HLS 均返回 HTTP 206。该检查证明源站支持 Range，不代表完整视频已下载或已在真机解码。此结果仍是本机生产构建验收，不能替代 Render 公网和手机真机验收。

## 修复摘要

- 通过 ipaddr.js 拦截更多 IPv4 / IPv6 非 unicast 地址。
- 修复 PeerTube 媒体 URL 对尾点 localhost 的漏判。
- 支持 NASA 含空格和标点的合法 `nasa_id`，并防止路径穿越。
- 对 Internet Archive 与 NASA 元数据查询设置并发上限。
- 固定官方提供方复用专用 Undici ProxyAgent；用户自定义源仍使用连接级 SSRF 防护。
- 新增相关回归测试。

## 公网与设备验收状态

- GitHub：上一补丁已发布到 main；2.23.3 本轮补丁需完成本次提交后再核验。
- Render：尚未部署本轮 2.23.3；已为用户准备独立 Render 登录授权页，等待用户登录并保存浏览器配置。
- Android APK：继续使用现有 TWA v1.0.0；本次是服务端更新，不需要重新打包 APK。
- 真机 Android / iOS：尚未完成播放、后台音频、硬件解码和真实下载验收。

## 结论

本地代码回归、类型检查、Lint、Next.js 生产构建和依赖安全审计均已通过。真实上游搜索与详情已验证 Archive、NASA、PeerTube、Commons 四类提供方均返回可播放地址。公网部署和真机验收仍是发布前必须完成的步骤。


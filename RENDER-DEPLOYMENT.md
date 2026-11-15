# LibreTV Mobile — Render 公网部署

## 目标

使用 Render Node.js Web Service 部署完整 Next.js 服务端，而不是 GitHub Pages 静态托管。Render 会分配稳定的 `*.onrender.com` HTTPS 地址，支持本项目的 App Router、Route Handlers、SSR、直播/点播代理和 HLS 分片转发。

## 已准备的部署配置

仓库根目录的 `render.yaml` 已配置：

- Render Free Web Service，Oregon 区域
- Node.js 24.18.0（`.node-version`）
- Build：`npm ci --no-audit --no-fund && npm run build`
- Start：`npm start`；`scripts/start.mjs` 自动读取平台注入的 `PORT`，本地默认 8080
- Health check：`/api/status`
- `PASSWORD` 与 `PROXY_SECRET` 由 Render 首次同步时生成，不写入 Git
- `COOKIE_SECURE=true`
- `LIVE_ALLOW_PRIVATE=0`，继续保持直播 SSRF 防护默认关闭内网放行

## 首次部署

1. 在 Render 登录后，选择 **New → Blueprint**。
2. 连接 GitHub 仓库 `zj2917928447-ship-it/LibreTV-Mobile`，分支 `main`。
3. Render 读取仓库根目录的 `render.yaml`，确认创建 `libretv-mobile-zj2917928447`，计算方案选择 **Free**。
4. 首次同步时 Render 自动生成 `PASSWORD` 与 `PROXY_SECRET`。
5. 等待部署成功，打开 Render 分配的 `https://<service>.onrender.com`。
6. 在 Render 服务的 **Environment** 页面查看自动生成的 `PASSWORD`，用于 LibreTV 登录；不要把它提交到 Git 或公开分享。
7. 验证：
   - `/` 返回 200
   - `/manifest.webmanifest` 返回 200
   - `/api/status` 返回 200 且 `passwordRequired=true`
   - 登录响应的会话 Cookie 包含 `Secure; HttpOnly; SameSite=Lax`

## Free 方案限制（必须知情）

Render 官方明确说明 Free 实例**不应承载生产应用**，只适合测试、个人项目和预览。它适合先验证手机版公网部署，但不保证 24×7 播放：

- 空闲 15 分钟后服务会休眠；下一次访问通常需要约 1 分钟唤醒。
- 每个 workspace 每月 750 小时 Free 实例额度；同一 workspace 的其他 Free 服务也会占用额度。
- 文件系统是临时的，重启、休眠和重新部署后会丢失。本项目的观看历史、设置和下载任务由浏览器 IndexedDB/localStorage 管理，服务器不依赖本地持久文件。
- 出站带宽与构建流水线分钟数有月度额度；大量在线播放/代理流量可能耗尽额度。若账户已绑定付款方式，超出出站带宽额度可能产生额外费用；若没有付款方式或已达到消费上限，Render 会暂停 Free 服务。
- 部署前建议在 Render Billing 中设置 $0 月度消费上限，或确认账户没有可用于超额计费的付款方式；不要为了测试启用付费实例。
- Render 可能随时重启 Free 实例。要获得无休眠、稳定高并发和持续流媒体体验，需要升级付费实例；本项目不会自动升级或创建付费资源。

## Android APK / TWA 的后续步骤

稳定 Render HTTPS 域名部署成功后，再用 Google Bubblewrap 1.27.0 构建 TWA：

1. 以稳定 Render URL 的 `/manifest.webmanifest` 初始化 TWA。
2. 生成签名密钥并构建 APK/AAB。
3. 读取签名证书 SHA-256 指纹。
4. 把 `/.well-known/assetlinks.json` 加入本项目并重新部署。
5. 用 Chrome 验证 Digital Asset Links，再安装 APK 真机测试。

不能用临时 `trycloudflare.com` 隧道地址作为正式 APK 的默认站点：隧道停止或重建后 URL 会变化，APK 将失去可用的服务端入口。

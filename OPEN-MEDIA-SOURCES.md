# LibreTV 开放影视资料库

本订阅不是第三方采集站合集，而是 LibreTV 自带的只读适配器，聚合公开档案与明确开放许可的视频。当前包含 Internet Archive、NASA、PeerTube 与 Wikimedia Commons 四个提供方。

## 订阅地址

`https://libretv-mobile-zj2917928447.onrender.com/open-media-sources.json`

在 LibreTV 中打开「设置 → 源管理 → 数据源订阅」，粘贴上述地址并同步。也可以直接添加 API：

`https://libretv-mobile-zj2917928447.onrender.com/api/open-media`

## 当前接入范围

| 提供方 | 内容范围 | 纳入规则 |
|---|---|---|
| Internet Archive | 公共领域电影、开放许可影片 | 仅接受条目元数据明确声明 Public Domain、Public Domain Mark、CC0、CC BY 4.0 或 CC BY-SA 4.0，且存在 MP4 文件 |
| NASA Image and Video Library | NASA 官方视频、任务纪录片、历史影像 | 过滤显式标记第三方版权的条目；保留来源说明，观看前仍应核对原始条目 |
| PeerTube / SepiaSearch | 联邦视频平台中的开放许可视频 | 只接受许可 ID 1、2、3、7、8；排除未知许可、非商业许可和 All Rights Reserved |
| Wikimedia Commons | 公共领域与 CC 视频文件 | 只接受 Public Domain、CC0、CC BY、CC BY-SA、CC BY-ND；排除非商业、明确版权所有及非 HTTPS/非官方上传 CDN 文件 |

许可元数据由上传者/平台提供，适配器不构成法律权利保证。对 Internet Archive、PeerTube 与 Wikimedia Commons，详情页会保留原始来源和许可标签；使用者仍需遵守署名、相同方式共享、禁止演绎等具体许可条件。

搜索阶段会进行标题相关性过滤，排除明显成人内容；Internet Archive 条目若描述文本与许可元数据出现明显版权冲突（例如 All Rights Reserved）也会被排除。过滤规则是保守启发式，不代替逐条权利核验。

## 限制

- 这不是商业影视平台，不保证包含最新院线电影、热门国产剧或付费会员内容。
- NASA 内容以科学、航天和历史纪录视频为主。
- Wikimedia Commons 以单文件视频为主，常见格式为 WebM / OGV / MP4；部分影片可能只有片段，不能假设每条都是完整电影。
- PeerTube 是用户上传的联邦平台，搜索结果不等同于电影目录。
- 只有可获取 MP4/HLS/受支持的 WebM/OGV 播放地址的条目才会进入详情。
- MP4/WebM/OGV 等直链由手机浏览器原生视频组件播放；HLS 由 hls.js 播放。直链下载通过同源 `/api/download` 流式转发，支持源站提供的 HTTP Range；HLS 仍使用原有分片下载器。下载接口要求先登录 LibreTV。
- Internet Archive 的大型影片可能需要较长缓冲时间；适配器优先选择适合手机的较小 MP4 衍生文件。
- 来源站点和媒体文件可能下线，搜索结果会缓存 5 分钟，详情缓存 10 分钟。

## API 兼容方式

`/api/open-media?ac=videolist&wd=关键词` 返回 Apple CMS 风格搜索结果。

`/api/open-media?ac=videolist&ids=om-...` 返回详情和播放地址。

本适配器只请求固定的 Internet Archive、NASA、SepiaSearch 与 Wikimedia Commons API；PeerTube 实例域名仍经过 LibreTV 的公网地址与 DNS rebinding SSRF 防护。

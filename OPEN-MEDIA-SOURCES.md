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

## 时长来源与验证

- Internet Archive：对选中的视频文件，`files[].length` 是媒体时长（秒），`files[].size` 是文件字节数；适配器优先读取实际播放文件的 `length`，再回退到条目级 `metadata.runtime`。不会把 `size` 当成时长。部分老文件没有 `length`，若也没有可验证的条目级时长，则不进入长片结果。
- NASA：搜索接口不保证返回 `duration`。缺失时会继续读取 `/asset/{nasa_id}` 的 `metadata.json`，优先识别 `QuickTime:Duration`、`QuickTime:MediaDuration`、`QuickTime:TrackDuration`、`AVAIL:Duration` 与 `XMP:Duration`（按 `Value × Scale` 转为秒）；最后才使用明确标注的 TRT / Runtime 文本。仍无法验证时不把条目当成长片。
- Wikimedia Commons：请求 MediaWiki `videoinfo` 的 `size` 属性以取得视频信息；`videoinfo.duration` 是播放时长（秒），`videoinfo.size` 是文件字节数，`derivatives` 提供可用转码。搜索和详情均保留真实时长，不从文件大小推算。
- PeerTube：使用其视频 API 返回的 `duration` 秒数；不使用文件大小推算时长。
- 所有提供方统一要求时长至少 20 分钟、最多 24 小时；缺少可靠时长的条目不会进入长片搜索结果。若同一 Archive 条目同时包含短预览和长片，优先选择已验证为长片的 MP4 文件，再按移动端友好程度选择转码。

## 限制

- 这不是商业影视平台，不保证包含最新院线电影、热门国产剧或付费会员内容。
- NASA 内容以科学、航天和历史纪录视频为主。
- Wikimedia Commons 以单文件视频为主，常见格式为 WebM / OGV；部分影片可能只有片段，不能假设每条都是完整电影。详情接口会额外读取 MediaWiki `videoinfo` 的转码列表，优先选择不超过 720p 且码率不超过约 900 kbps 的最高分辨率版本；若没有符合码率预算的版本，则选择较小的可用转码。DASH-only 版本目前不使用。
- PeerTube 是用户上传的联邦平台，搜索结果不等同于电影目录。
- 只有可获取 MP4/HLS/受支持的 WebM/OGV 播放地址的条目才会进入详情。
- MP4/WebM/OGV 等直链由手机浏览器原生视频组件播放；HLS 由 hls.js 播放。直链下载通过同源 `/api/download` 流式转发，支持源站提供的 HTTP Range；HLS 仍使用原有分片下载器。下载接口要求先登录 LibreTV。
- Internet Archive 的大型影片可能需要较长缓冲时间；适配器优先选择适合手机的较小 MP4 衍生文件。Wikimedia Commons 也优先使用官方转码；实测《The General》(1926) 的 240p WebM 为约 164 MB，原始文件约 1.09 GB。
- 来源站点和媒体文件可能下线，搜索结果会缓存 5 分钟，详情缓存 10 分钟。

## API 兼容方式

`/api/open-media?ac=videolist&wd=关键词` 返回 Apple CMS 风格搜索结果。

`/api/open-media?ac=videolist&ids=om-...` 返回详情和播放地址。

本适配器只请求固定的 Internet Archive、NASA、SepiaSearch 与 Wikimedia Commons API；PeerTube 实例域名仍经过 LibreTV 的公网地址与 DNS rebinding SSRF 防护。

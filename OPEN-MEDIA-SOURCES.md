# LibreTV 开放影视资料库

本订阅不是第三方采集站合集，而是 LibreTV 自带的只读适配器，聚合公开档案与明确开放许可的视频。当前包含 Internet Archive、Library of Congress 公共领域电影精选、NASA、PeerTube 全球搜索与 Wikimedia Commons。应用内 `/free` 页面直接调用该接口，无需手动添加订阅，也不需要 TMDB Token。

## 订阅地址

`https://libretv-mobile-zj2917928447.onrender.com/open-media-sources.json`

在 LibreTV 中打开「设置 → 源管理 → 数据源订阅」，粘贴上述地址并同步。也可以直接添加 API：

`https://libretv-mobile-zj2917928447.onrender.com/api/open-media`

## 当前接入范围

| 提供方 | 内容范围 | 纳入规则 |
|---|---|---|
| Internet Archive | 公共领域电影、开放许可影片 | 仅接受条目元数据明确声明 Public Domain、Public Domain Mark、CC0、CC BY 4.0 或 CC BY-SA 4.0，且存在 MP4 文件 |
| NASA Image and Video Library | NASA 官方视频、任务纪录片、历史影像 | 过滤显式标记第三方版权的条目；保留来源说明，观看前仍应核对原始条目 |
| PeerTube 全球搜索 | 联邦视频平台中的开放许可视频 | 使用 `search.joinpeertube.org`；只接受许可 ID 1、2、3、7、8；排除未知许可、非商业许可和 All Rights Reserved |
| Wikimedia Commons | 公共领域与 CC 视频文件 | 只接受 Public Domain、CC0、CC BY、CC BY-SA、CC BY-ND；排除非商业、明确版权所有及非 HTTPS/非官方上传 CDN 文件 |
| Library of Congress | National Film Registry 公共领域电影精选 | 限定在 LOC 的精选集 facet，并对影片标题使用 Free to Use and Reuse 公共领域清单白名单；只接受 `access_restricted=false`、官方精选集分组和 `tile.loc.gov` HTTPS MP4 |

许可元数据由上传者/平台提供，适配器不构成法律权利保证。对 Internet Archive、PeerTube 与 Wikimedia Commons，详情页会保留原始来源和许可标签；使用者仍需遵守署名、相同方式共享、禁止演绎等具体许可条件。

搜索阶段会进行标题相关性过滤，排除明显成人内容；Internet Archive 条目若描述文本与许可元数据出现明显版权冲突（例如 All Rights Reserved）也会被排除。过滤规则是保守启发式，不代替逐条权利核验。

## 时长来源与验证

- Internet Archive：对选中的视频文件，`files[].length` 是媒体时长（秒），`files[].size` 是文件字节数；适配器优先读取实际播放文件的 `length`，再回退到条目级 `metadata.runtime`。不会把 `size` 当成时长。部分老文件没有 `length`，若也没有可验证的条目级时长，则不进入长片结果。
- NASA：搜索接口不保证返回 `duration`。每个候选条目都会先读取 `/asset/{nasa_id}` 的真实媒体清单，确认存在可播放的官方 MP4，再读取 `metadata.json`；优先识别 `QuickTime:Duration`、`QuickTime:MediaDuration`、`QuickTime:TrackDuration`、`AVAIL:Duration` 与 `XMP:Duration`（按 `Value × Scale` 转为秒）；最后才使用明确标注的 TRT / Runtime 文本。仍无法验证时不把条目当成长片。NASA 的 `nasa_id` 可能含空格和标点，适配器会拒绝路径分隔符/控制字符并对安全 ID 做单段 URL 编码。
- Wikimedia Commons：请求 MediaWiki `videoinfo` 的 `size` 属性以取得视频信息；`videoinfo.duration` 是播放时长（秒），`videoinfo.size` 是文件字节数，`derivatives` 提供可用转码。搜索和详情均保留真实时长，不从文件大小推算。
- PeerTube：使用其视频 API 返回的 `duration` 秒数；不使用文件大小推算时长。
- Internet Archive、NASA、PeerTube 与 Wikimedia Commons 要求时长至少 20 分钟、最多 24 小时；缺少可靠时长的条目不会进入长片搜索结果。Library of Congress 是明确列入公共领域精选清单的历史电影，允许 60 秒至 24 小时，避免误删《The Great Train Robbery》等早期短片。若同一 Archive 条目同时包含短预览和长片，优先选择已验证为长片的 MP4 文件，再按移动端友好程度选择转码。

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

本适配器只请求固定的 Internet Archive、NASA、PeerTube 全球搜索、Library of Congress 与 Wikimedia Commons API；PeerTube 实例域名及其详情返回的播放地址均经过公网地址与 DNS rebinding SSRF 检查。NASA 搜索结果必须先通过 `/asset/{nasa_id}` 验证实际存在可播放 MP4，不能只凭搜索元数据展示结果。LOC 结果必须同时命中精选集分组、公共领域标题白名单和官方 MP4 域名。

## 2026-11-16 稳定性与安全更新

- Archive 元数据请求并发限制为 8，NASA 资产元数据请求并发限制为 4；单条记录失败不会中断同一提供方的其他结果。
- NASA 搜索命中必须有官方 `images-assets.nasa.gov` MP4 资产，并检查资产元数据中的版权/权利字段。无可播放 MP4 或明确标记第三方版权的项目不会展示。
- NASA 的 `nasa_id` 允许合法空格和标点，但拒绝路径分隔符、控制字符和管道符；请求时按单一路径段编码。
- PeerTube 返回的播放 URL 必须是 HTTPS、公网地址且不含 URL 账号密码；详情阶段还会对实际播放地址做 DNS 预检。
- 同名同年的不同来源不再合并成一条，用户可以比较不同剪辑版本、编码格式、来源和许可。仅相同提供方的相同资源 ID 才会去重。
- IP 范围判定统一使用 `ipaddr.js`，覆盖 IPv4、IPv6、映射 IPv6、文档网段、基准测试网段、组播及保留地址。

适配器仍然只做只读搜索与详情解析，不接受用户提交的上游 URL，不下载或托管视频文件。Tubi、Pluto TV、Plex、The Roku Channel、Xumo Play、Sling Freestream、Fawesome、PBS、Hoopla 与 Kanopy 只在 `/free` 页面提供官方免费入口；这些平台没有向 LibreTV 开放通用第三方直播放流 API，因此由平台自己的播放器播放。Hoopla 与 Kanopy 需要参与图书馆/大学资格；PBS 的 Passport 扩展片库可能需要捐赠支持。

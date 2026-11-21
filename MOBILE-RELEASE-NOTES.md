# LibreTV Mobile - Release Notes

## Follow-up patch 2.23.6 (2026-11-16)

- Added a second, independent TMDB catalogue search alongside the existing Apple CMS/open-media playback-source search. Movie and TV metadata, localized titles, original titles, posters, overviews, years and ratings are shown in a separate section; metadata is never presented as an in-app playable stream.
- Added TMDB Watch Providers lookups by user-selected region (US/CN/HK/TW/GB/CA/AU/JP/KR/IN/DE/FR). Subscription, free, ad-supported, rental and purchase providers are grouped separately. The app links to the TMDB watch page rather than inventing unsupported deep links.
- Split TMDB metadata search and Watch Providers into separate API requests: film metadata renders first, while regional availability loads independently. Provider lookup failures no longer delay or hide search results; provider calls are capped at 10 titles, concurrency 3, 5-second per-call timeout and 30-minute cache.
- Added persistent "正版观看地区" preference. Provider queries use the selected region; metadata search remains independent of the region.
- Added server-only `TMDB_API_READ_ACCESS_TOKEN` support. The token is never exposed to the browser; TMDB calls use Bearer authentication, a per-host concurrency gate, request cancellation, bounded result counts and a 10-minute cache.
- Added TMDB's official approved blue horizontal logo and required non-endorsement notice in the About page. JustWatch is explicitly credited for watch-provider availability data. Documentation states the free API is for non-commercial use with attribution; commercial use requires appropriate licensing.
- Added a clear unconfigured state and setup link when no TMDB token is present. The secret must be configured in server environment variables, not pasted into chat or placed in a `NEXT_PUBLIC_` variable.
- Split search results into "播放源搜索" and "影视资料与正版观看渠道". A CMS hit is labelled as a source candidate only; the app confirms playability only after detail parsing successfully returns episode playback URLs.
- Render Blueprint now preselects the built-in open-media catalogue as a default source rather than relying on a password-gated default subscription import. The source contains public-domain/open-licensed media only and is not represented as a commercial film catalogue.
- Fixed open-media alias cache identity: Chinese aliases such as "蜘蛛侠" share a versioned cache key with the resolved provider query "Spider-Man". Empty results are short-lived and are not CDN-cached, avoiding stale zero-result responses after alias changes.
- Reviewed LibreTV community PR #981 (21 claimed validated direct CMS sources) as an example of multi-source validation. Its third-party source list was not copied wholesale because source ownership, ongoing availability and rights could not be independently established; the app continues to accept sources the operator is authorized to use.
- No new runtime dependencies. Existing ArtPlayer, hls.js, mpegts.js, download manager, playback history, skip marks and Android TWA identity are unchanged.

## Follow-up patch 2.23.5 (2026-11-16)

- Added bounded JSON request-body parsing: search/quality requests are capped at 256 KiB, live-probe and source-list publish payloads at 512 KiB, and login/source-test payloads at 8 KiB. Oversized bodies return HTTP 413 before application parsing.
- Centralized CMS source URL normalization. Search, detail and source-test routes reject malformed URLs, unsupported protocols and embedded URL credentials; CMS API/detail URL builders preserve existing query-string tokens instead of overwriting them.
- Search cache keys now include source key, display name, URL, detail URL and adult flag; changing a source identity cannot return stale labels from another configuration.
- Streamed search, quality probing and live probing now abort in-flight upstream requests when the browser disconnects. Per-host waiters are removed from the FIFO queue on cancellation, and host slots are released idempotently.
- `fetchWithSafeRedirects` always follows redirects manually and revalidates every hop; the deprecated `safeRedirects: false` option can no longer disable the SSRF redirect guard. Redirect response bodies are cancelled before the next hop, and composed abort signals remain effective through response-body reads without accumulating anonymous listeners.
- The generic VOD/media proxy now applies its timeout only while waiting for upstream response headers; media bodies are not cut off by the old 8-second timeout. HLS manifests are limited to 2 MiB and 10 seconds, empty/oversized/stalled manifests fail explicitly, and upstream error pages are not rewritten or cached as playlists.
- Live-probe HLS manifests are limited to 1 MiB, preventing a user-supplied playlist URL from forcing an unbounded response-body allocation.
- All upstream response bodies from user-configurable CMS and IPTV sources are now bounded while streaming: search page JSON 512 KiB, source-test JSON 1 MiB, detail JSON/HTML 2 MiB, source subscriptions 4 MiB, live M3U 8 MiB and XMLTV 32 MiB. Oversized bodies are cancelled instead of fully buffered.
- XMLTV gzip decompression now has a 64 MiB output ceiling to prevent a small compressed EPG from expanding into an unbounded allocation.
- Direct video downloads now validate actual container signatures even when the upstream claims `video/mp4`, reject HTML/JSON masquerading as video, cap signature reads at 64 bytes / 5 seconds, and sanitize Range to one byte range so multipart/byteranges cannot be mislabeled as a video file. MP4 detection handles leading `free` boxes and extended-size `ftyp` boxes.
- Added regression coverage for cancellation, redirect-body cleanup, CMS query-token preservation, malformed source configs, oversized request/manifests, range handling, container signatures and HLS timeout behavior.
- Version bumped to 2.23.5. Android TWA package remains unchanged; this is a server/PWA patch and remains backward-compatible with the existing signed APK.

## Follow-up patch 2.23.4 (2026-11-16)

- Fixed an ArtPlayer 5.4.0 fullscreen regression: upstream issue [#1073](https://github.com/zhw2590582/ArtPlayer/issues/1073) confirms that web fullscreen followed by native fullscreen exits web fullscreen instead of entering native fullscreen. Both VOD and Live now keep the player inside its original container by setting `FULLSCREEN_WEB_IN_BODY=false`.
- Centralized ArtPlayer static settings and restore both `FULLSCREEN_WEB_IN_BODY` and `CONTROL_HIDE_TIME` to the installed library defaults when the player unmounts, preventing route-to-route setting leakage.
- Explicitly keep ArtPlayer `autoOrientation` disabled in both VOD and Live. The upstream safe-area fix exists in GitHub development code but is not in the current npm 5.4.0 package; the app does not activate that optional rotation plugin.
- Added regression tests for the shared ArtPlayer settings and repeated trailing-dot local hostnames (`localhost..`, `localhost...`, and `api.localhost...`) in PeerTube media URL validation.
- Version bumped to 2.23.4. Android TWA package remains unchanged; the server/PWA patch is backward-compatible with the existing signed APK.

## Follow-up patch 2.23.3 (2026-11-16)

- Fixed an ArtPlayer 5.4.0 fullscreen regression: upstream issue [#1073](https://github.com/zhw2590582/ArtPlayer/issues/1073) confirms that web fullscreen followed by native fullscreen exits web fullscreen instead of entering native fullscreen. Both VOD and Live now keep the player inside its original container by setting `FULLSCREEN_WEB_IN_BODY=false`.
- Centralized ArtPlayer static settings and restore both `FULLSCREEN_WEB_IN_BODY` and `CONTROL_HIDE_TIME` to the installed library defaults when the player unmounts, preventing route-to-route setting leakage.
- Explicitly keep ArtPlayer `autoOrientation` disabled in both VOD and Live. The upstream safe-area fix exists in GitHub development code but is not in the current npm 5.4.0 package; the app does not activate that optional rotation plugin.
- Added regression tests for the shared ArtPlayer settings and repeated trailing-dot local hostnames (`localhost..`, `localhost...`, and `api.localhost...`) in PeerTube media URL validation.
- Version bumped to 2.23.4. Android TWA package remains unchanged; the server/PWA patch is backward-compatible with the existing signed APK.

## Follow-up patch 2.23.3 (2026-11-16)

- Added `ipaddr.js` 2.5.0 as a direct dependency and replaced partial hand-written IP checks with the library's non-unicast range classification, covering reserved, benchmarking, documentation, transition, multicast and IPv4-mapped IPv6 addresses.
- PeerTube media URL validation now rejects trailing-dot localhost hosts as well as private, loopback, link-local, `.local`, `.internal`, `.test` and `.invalid` hosts before exposing direct playback URLs.
- NASA asset IDs may contain spaces and punctuation; the adapter validates IDs safely and encodes them as one path segment for both search and detail requests.
- Internet Archive and NASA metadata lookups now use explicit concurrency ceilings (8 and 4 respectively) to reduce request bursts while preserving provider result order.
- Every NASA search hit now verifies the official asset manifest, a playable MP4 and item-level copyright/rights metadata; records without an actual media file or with an explicit third-party copyright declaration are excluded.
- NASA copyright parsing recognizes explicit negative/public-domain declarations, while Archive conflict detection now catches common `Copyright 1974` text even without a © symbol.
- PeerTube detail performs a DNS public-address preflight on the selected media URL before returning it. Same-title items from different providers remain separate; only identical provider IDs are deduplicated.
- Fixed-provider outbound proxy dispatchers are reused per configured proxy URI; the proxy path remains restricted to the fixed official provider allowlist, while user-defined sources keep connection-pinned SSRF checks.
- Added regression coverage for reserved IP ranges, trailing-dot local hosts, NASA IDs with spaces, and provider-proxy dispatcher reuse.
- Version bumped to 2.23.3. The Android TWA package is unchanged because this patch updates the web service, not the native shell.

## Base
- Updated to official LibreTV 2.23.2 (2026-11-14).
- Original Next.js 15 / React 19 application and server Route Handlers are retained; framework is patched to Next.js 15.5.29.
- This edition is a mobile-first responsive PWA enhancement, not a native Android/iOS rewrite.

## Mobile improvements
- Added viewport-fit=cover for edge-to-edge safe-area handling on iOS.
- Enabled Apple standalone web-app metadata and black translucent status bar styling.
- Added dynamic viewport height fallback (100dvh) to reduce mobile browser chrome viewport jumps.
- Added safe-area padding for the sticky mobile header.
- Touch-target and form sizing use any-pointer: coarse; player touch-control detection uses the same query so touch laptops/tablets keep touch behavior even when a mouse/trackpad is also connected.
- Added touch manipulation behavior and momentum scrolling for drawers and panels.
- Added reduced-motion accessibility handling.
- Extended the PWA manifest with explicit scope, orientation, categories, app background color and a Live shortcut.
- Added a conservative service worker: static assets and offline shell only; API, watch/live routes and media streams remain network-only.

## Upstream and security updates
- Merged official LibreTV 2.23.2 changes.
- Updated hls.js to 1.7.4 and made ArtPlayer 5.4.0 the declared minimum; mpegts.js remains 1.8.2.
- Patched dependencies: Undici 6.29.1, PostCSS 8.5.33, Sharp 0.35.5 and source-map-js 1.2.2.
- Added a cross-platform production start launcher that respects Render/host-provided `PORT` while defaulting to port 8080 locally.
- Added `.node-version` and a Render Blueprint for a free Node.js web service with generated secrets, HTTPS cookies, `/api/status` health checks and private-IP live access disabled by default.
- Updated the test/build toolchain to Vite 6.4.6 and Vitest 4.1.12; pinned the patched nested minimatch and postcss-selector-parser dependencies.
- Refreshed in-range patch/minor dependencies without taking untested major upgrades: React/React DOM 19.3.1, TanStack Query 5.107.1, TanStack Virtual 3.14.26, Dexie 4.4.7, Zustand 5.1.0, Autoprefixer 10.6.2 and @types/node 22.20.5. Next.js 15, Tailwind 3, TypeScript 5, Undici 6, ESLint 9 and Vitest 4 remain on their tested major lines.
- Applied official #980 connection-layer SSRF fix: the live-request flag selects live URL validation, while connection-time private-network access additionally requires LIVE_ALLOW_PRIVATE=1.
- Added the upstream DNS-rebinding regression suite using two independently mocked DNS resolvers and a local loopback HTTP server.
- Retained the existing same-undici fetch/Agent pairing from #984 to avoid Node runtime undici cross-version dispatcher incompatibility.
- CI checks Node 22, 24 and 26; the local environment uses Node 24.18.0.
- Full dependency audit is clean: 521 dependencies checked, zero known vulnerabilities in both production-only and full npm audit.

## Reliability and bug fixes
- IPTV routes no longer bypass connection-layer DNS rebinding checks.
- Malformed percent-encoded session cookies fail closed as unauthenticated instead of throwing URIError.
- Added X-Content-Type-Options, X-Frame-Options, Referrer-Policy and Permissions-Policy headers; removed X-Powered-By.
- Screen Wake Lock is requested during active VOD/live playback and released on pause/end/error/unmount; unsupported browsers safely no-op.
- Fixed same-page pause/resume handling and stale download task recovery.
- First-run searches now keep the search term when no VOD source is selected, show a persistent setup guide, and open the source settings directly from its action button.
- Added a first-party open-media API adapter for Internet Archive, NASA, PeerTube / SepiaSearch and Wikimedia Commons. It filters to explicit Public Domain / Creative Commons declarations, preserves source/attribution details and emits Apple CMS-compatible search/detail responses.
- Wikimedia Commons detail now requests MediaWiki `videoinfo` derivatives and selects a mobile-friendly HTTPS transcode (prefer the highest resolution at or below 720p and 900 kbps; otherwise choose the smallest available derivative). DASH-only derivatives are skipped until a DASH playback engine is added. For the tested 1926 film, the chosen 240p WebM is 163,929,190 bytes versus the 1,089,704,550-byte original.
- Added query-relevance, adult-content and contradictory-rights filters so unrelated search hits, obvious adult material and Archive entries with conflicting copyright statements are excluded.
- Added native MP4/M4V/WebM/OGV/OGG playback detection. Direct files use the browser's native video pipeline; HLS continues to use hls.js. The HLS segment prefetcher no longer attempts to parse direct-file URLs.
- Added authenticated `/api/download` streaming relay for direct media. It forwards Range requests and relevant response headers, streams large files directly to the browser download manager, and rejects private destinations, HLS playlists and HTML/JSON error pages.
- Added a public LibreTV SourceList JSON at `public/open-media-sources.json` and configured it as a daily-refresh `DEFAULT_SUBSCRIPTIONS` entry in `render.yaml`; it becomes the default phone source after the Render Blueprint environment update is applied.
- Added per-download save-target tracking and batch episode queueing.
- Cancelling a paused download wakes waiting workers and aborts the partial save target.
- Cancellation rejects with AbortError instead of resolving as success, preventing false completion states.
- Memory download targets snapshot each Uint8Array view at write time and copy only the view's byte range into the final Blob; this prevents reused segment buffers or subarray backing bytes from corrupting exported video files.
- Poster cards preserve source image proportions; fallback images use the existing direct/mirror/proxy candidate chain.

## Kept intact
- Search/source aggregation and parsing logic.
- Video and live playback engines.
- Existing player touch-control strategy and episode controls.
- IndexedDB/Dexie history, progress and cache behavior.
- Desktop navigation and desktop layouts.
- Original API routes, authentication and server-side protections.

## Verification
- See MOBILE-ACCEPTANCE-REPORT-20261116-PATCH-2.23.4.md for the current 2.23.4 regression and build checks; see MOBILE-ACCEPTANCE-REPORT-20261116.md for the 2.23.3 live-provider acceptance scope, MOBILE-ACCEPTANCE-REPORT-20261114.md for the 2.23.2 browser-emulation baseline and SECURITY-AUDIT-20261114.md for the original dependency/application security review.
- Clean dependency installation completed. Local Node 24.18.0: typecheck, lint, 52 test files / 697 tests and production build passed after the 2.23.2 merge, mobile first-run onboarding, open-media adapter, Commons transcode selection, search-quality hardening, native media and streaming-download changes.
- After refreshing in-range dependencies, `npm update` audited 413 packages and reported zero vulnerabilities; the subsequent full `npm audit` also passed with zero vulnerabilities.
- Chrome/Playwright Pixel 7 emulation covers portrait/landscape routes, touch navigation, download manager drawer, PWA registration and offline fallback.
- The Render Blueprint preconfigures the first-party open-media subscription (Internet Archive / NASA / PeerTube / Wikimedia Commons). The current source code includes Commons mobile transcode selection, native media handling and authenticated `/api/download` streaming. Local production build and 695 tests pass; physical Android playback and authenticated full-file download still require a device-side acceptance run. No commercial-film scraper or unverified third-party source list is bundled.

## Android packaging decision
- Selected: Google Bubblewrap CLI 1.27.0 + Trusted Web Activity (TWA).
- Next.js remains on the patched 15.5.29 line; the current 16.4.6 major line was reviewed but not adopted without a separate migration and playback regression pass.
- Rejected as direct base: the old archived PWABuilder Android TWA package.
- Not adopted: the researched Capacitor fork that embeds server handlers and disables auth/SSRF shims.
- TWA requires a stable public HTTPS deployment and a matching Digital Asset Links file for the signing certificate. See ANDROID-TWA-SETUP.md.
- Android build tooling is now installed under `E:\\Android`: Temurin JDK 17.0.21, Bubblewrap 1.27.0, Gradle 8.11.1, Android API 36, Build Tools 36.1.0 and Platform Tools/ADB 37.0.1. The existing system JDK 21 was not changed; `bubblewrap doctor` passes.
- A final signed APK (1,422,787 bytes) and AAB (1,503,504 bytes) were built against `https://libretv-mobile-zj2917928447.onrender.com` and published in [GitHub Release mobile-v1.0.0](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/tag/mobile-v1.0.0). [Direct APK](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/download/mobile-v1.0.0/LibreTV-Mobile-Android-v1.0.0.apk) · [Direct AAB](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/download/mobile-v1.0.0/LibreTV-Mobile-Android-v1.0.0.aab). APK SHA-256: `33458ABFA3B5A2AA230BA28F8854564231E17FBBD1EA97B2A0E363B68EDCD531`; AAB SHA-256: `9AE3D115E9EF05F90EADE2A8824E552B2ACEAED032BFD1879803116A310D46E8`.
- APK v2/v3 signature and ZIP alignment checks pass. Google's Digital Asset Links API confirms one matching statement for the stable Render origin, package and certificate fingerprint.
- The initial temporary-tunnel test APK was superseded and must not be distributed. The final APK/AAB are ready for public release; physical Android installation, playback and download checks remain outstanding because no ADB device is attached.
- `scripts/build-twa-release.ps1` validates the final HTTPS origin, PWA manifest, icons and Digital Asset Links before producing the release APK/AAB. The public repository deploys through Render without installing its GitHub App; manual redeploys are required after later commits.

## Run locally
~~~bash
npm ci
npm run build
npm start
~~~
Open the hosted HTTPS site on the phone, then use the browser's Add to Home Screen / Install option.

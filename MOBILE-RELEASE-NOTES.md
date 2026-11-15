# LibreTV Mobile Edition - Release Notes

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
- See MOBILE-ACCEPTANCE-REPORT-20261114.md for the latest exact test counts and browser acceptance scope; see SECURITY-AUDIT-20261114.md for the dependency and application security review.
- Clean dependency installation completed. Local Node 24.18.0: typecheck, lint, 44 test files / 654 tests and production build passed after the 2.23.2 merge and security/media dependency updates.
- npm audit --omit=dev and full npm audit both passed with 521 dependencies audited and zero vulnerabilities.
- Chrome/Playwright Pixel 7 emulation covers portrait/landscape routes, touch navigation, download manager drawer, PWA registration and offline fallback.
- Physical Android/iPhone playback and real-device download remain unverified.

## Android packaging decision
- Selected: Google Bubblewrap CLI 1.27.0 + Trusted Web Activity (TWA).
- Next.js remains on the patched 15.5.29 line; the current 16.4.6 major line was reviewed but not adopted without a separate migration and playback regression pass.
- Rejected as direct base: the old archived PWABuilder Android TWA package.
- Not adopted: the researched Capacitor fork that embeds server handlers and disables auth/SSRF shims.
- TWA requires a stable public HTTPS deployment and a matching Digital Asset Links file for the signing certificate. See ANDROID-TWA-SETUP.md.
- Android build tooling is now installed under `E:\\Android`: Temurin JDK 17.0.21, Bubblewrap 1.27.0, Gradle 8.11.1, Android API 36, Build Tools 36.1.0 and Platform Tools/ADB 37.0.1. The existing system JDK 21 was not changed; `bubblewrap doctor` passes.
- A final signed APK (1,422,787 bytes) and AAB (1,503,504 bytes) were built against `https://libretv-mobile-zj2917928447.onrender.com`. APK SHA-256: `33458ABFA3B5A2AA230BA28F8854564231E17FBBD1EA97B2A0E363B68EDCD531`; AAB SHA-256: `9AE3D115E9EF05F90EADE2A8824E552B2ACEAED032BFD1879803116A310D46E8`.
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

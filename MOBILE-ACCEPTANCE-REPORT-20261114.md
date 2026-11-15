# LibreTV Mobile 2.23.2 — Final Acceptance Report

Test date: 2026-11-15 (latest local regression run; original browser emulation date 2026-11-14)
Worktree: E:\\Github\\电影\\LibreTV-Mobile

## Build and dependency target

- LibreTV package version: 2.23.2
- Next.js: 15.5.29
- React / React DOM: 19.3.0
- ArtPlayer: 5.4.0
- hls.js: 1.7.4
- mpegts.js: 1.8.2
- Undici: 6.29.1
- PostCSS: 8.5.33
- Sharp: 0.35.5
- source-map-js: 1.2.2
- Vite: 6.4.6
- Vitest: 4.1.12
- Node.js: 24.18.0
- Browser: installed Google Chrome controlled with Playwright
- Device profile: Pixel 7 emulation
- Portrait viewport: 412 × 915 CSS px
- Landscape viewport: 915 × 412 CSS px

## Clean install and dependency security

- Clean `npm ci` completed using the committed package manifest and lockfile.
- The two required lifecycle scripts were reviewed and explicitly approved at exact versions: `esbuild@0.25.12` and `unrs-resolver@1.12.2`.
- `npm audit --omit=dev`: 521 dependencies audited, 0 vulnerabilities.
- Full `npm audit`: 521 dependencies audited, 0 vulnerabilities.
- `npm ls` confirms the expected Next.js, Undici, PostCSS, Sharp, source-map-js, Vite and Vitest versions without invalid or extraneous packages.

## Automated project checks

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| ESLint | Passed |
| Vitest | 45 test files passed |
| Unit tests | 655 passed, 0 failed |
| Next.js production build | Passed |
| Next.js build version | 15.5.29 |
| Production npm audit | 0 vulnerabilities |
| Full npm audit | 0 vulnerabilities |

## Browser / mobile PWA checks

| Check | Result |
| --- | --- |
| Home page | HTTP 200 |
| Live route shell | HTTP 200 |
| Watch route shell | HTTP 200 |
| Horizontal overflow | None in portrait or landscape |
| Touch media | pointer: coarse, any-pointer: coarse, hover: none and touch input verified in both orientations |
| Main visible touch buttons | 40–46 CSS px in tested contexts |
| Mobile menu | Opened; navigation links/actions visible |
| Download manager | Opened; empty-state UI rendered |
| Authentication | Test-only local password accepted; /api/status returned verified=true and version=2.23.2 |
| PWA manifest | display=standalone; scope=/ |
| Service worker | Registered and controlling the page |
| Offline shell | /offline.html cached and shown after network was disabled |
| Recommendation posters | 10/10 loaded after the configured mirror fallback |
| Uncaught page errors | 0 |

## Runtime security headers

Verified on the production build in Chrome:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Powered-By` absent.

## Network observations

- The first recommendation request before test login returned HTTP 401. After login, the app loaded normally.
- Direct Douban image hosts returned HTTP 418 in this test environment. The existing image candidate/mirror fallback loaded all 10 recommendation posters. These are upstream/environment responses, not uncaught JavaScript errors.
- No VOD or M3U source was configured in the isolated test profile.

## Security / regression checks

- Official LibreTV #980 connection-layer SSRF/DNS-rebinding fix is present. Live private-network access requires both a live call-site and explicit `LIVE_ALLOW_PRIVATE=1`.
- The official #984 same-Undici fetch/Agent implementation is retained to avoid Node 26 dispatcher incompatibility.
- A malformed percent-encoded session cookie regression test was added; the guard rejects it safely instead of throwing URIError.
- Memory download Blob creation snapshots input buffers and respects Uint8Array byteOffset/byteLength. A regression test mutates the original backing buffer after write() and confirms the exported Blob contains only the intended original slice.
- Static source scan found no eval(), new Function, string-based timers or NEXT_PUBLIC secret-like variable usage.
- The only dangerouslySetInnerHTML use is a constant pre-hydration theme bootstrap string; no untrusted data is interpolated.
- Baseline response headers are configured and verified. CSP/HSTS are not guessed or forced; see SECURITY-AUDIT-20261114.md for rationale and remaining edge configuration notes.

## Android packaging and public deployment (2026-11-15)

- Bubblewrap CLI 1.27.0, Temurin JDK 17.0.21, Gradle 8.11.1, Android API 36, Build Tools 36.1.0 and Platform Tools / ADB 37.0.1 are installed under `E:\\Android`; the system JDK 21 was not changed.
- `bubblewrap doctor` passes.
- Render Free Web Service is live at `https://libretv-mobile-zj2917928447.onrender.com`.
- Public endpoint checks: homepage, manifest, 192/512 icons, `/api/status` and `/.well-known/assetlinks.json` all return HTTP 200.
- Google's Digital Asset Links API returns one matching statement for the stable site, package `com.zj2917928447.libretv` and release certificate fingerprint.
- Final signed APK (1,422,787 bytes) and AAB (1,503,504 bytes) were built against the stable Render origin and published in [GitHub Release mobile-v1.0.0](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/tag/mobile-v1.0.0).
- [Direct APK download](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/download/mobile-v1.0.0/LibreTV-Mobile-Android-v1.0.0.apk) and [direct AAB download](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/download/mobile-v1.0.0/LibreTV-Mobile-Android-v1.0.0.aab) both return HTTP 200.
- APK SHA-256: `33458ABFA3B5A2AA230BA28F8854564231E17FBBD1EA97B2A0E363B68EDCD531`.
- AAB SHA-256: `9AE3D115E9EF05F90EADE2A8824E552B2ACEAED032BFD1879803116A310D46E8`.
- APK v2/v3 signature verification and ZIP alignment verification pass.
- The earlier temporary-tunnel test APK has been superseded and must not be distributed. The final stable-domain APK is ready for release; physical-device installation, playback and download acceptance remain unverified because no ADB device is attached.

## What remains unverified

- This is browser emulation, not a physical Android phone.
- Actual MP4/HLS VOD playback, HTTP-FLV playback, M3U live playback, real episode downloads, hardware decoding, background audio, device orientation/fullscreen and physical-device wake lock were not verified because no user-configured VOD/M3U source or physical test device was available.
- iOS Safari/WebKit was not available; iPhone behavior is statically reviewed, not device-tested.
- Final stable-domain APK/AAB are built and cryptographically verified; physical Android/iOS playback and download acceptance remain pending.

## Browser screenshots

Stored in `artifacts/mobile-acceptance/`:

- `final-2.23.2-home-pixel7.png`
- `final-2.23.2-live-pixel7.png`
- `final-2.23.2-watch-pixel7.png`
- `final-2.23.2-offline-pixel7.png`

## Conclusion

The clean dependency install, zero-vulnerability audit, TypeScript check, ESLint, 655 unit tests, Next.js production build, responsive PWA shell, mobile touch navigation, download-manager drawer, security headers, service-worker registration and offline shell passed the tested local checks. The stable Render HTTPS site is live, and the final APK/AAB are built against it with verified signature, alignment and Digital Asset Links. Physical-device playback/download acceptance remains outstanding.

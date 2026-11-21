# LibreTV Mobile 2.23.5 — Patch Acceptance Report (2026-11-16)

## Scope

This is a server/PWA patch on top of the local LibreTV Mobile 2.23.4 working tree. It preserves the existing Next.js / React application, ArtPlayer + hls.js playback architecture, Android TWA package identity, and existing user data formats.

Version metadata was updated to 2.23.5 in both `package.json` and `package-lock.json`.

## Changes included

### Request and source validation
- Bounded request-body parsing for search, quality probing, live probing, source publishing, source testing and login.
- Centralized CMS source normalization for search, detail and source testing. Reject unsupported protocols, embedded URL credentials, malformed fields and overlong URLs.
- Preserve existing query-string credentials/options when building Apple CMS API and detail URLs.
- Include source key, display name, detail URL and adult flag in search cache identity.
- Apply the same CMS source normalizer to quality-probe items; reject embedded credentials and malformed/overlong source fields before probing. Add URL/identifier length ceilings to proxy, download, live subscription and EPG routes.

### Upstream and streaming reliability
- Streamed search, quality probing and live probing cancel upstream requests when the client disconnects.
- Per-host concurrency waiters are removed from the FIFO queue on abort; host slots are released idempotently.
- Redirects are always followed manually and each hop is revalidated. The deprecated `safeRedirects:false` flag cannot bypass the SSRF redirect guard.
- Cancel intermediate 3xx response bodies before following the next hop.
- Compose abort signals so cancellation remains effective while a response body is being read.
- Generic VOD proxy timeout now applies only while waiting for upstream response headers. Long video and media-segment bodies are not cut off by the former 8-second timeout.
- HLS manifests are bounded to 2 MiB / 10 seconds for proxy playback and 1 MiB for live probing. Empty, oversized and stalled manifests fail explicitly; upstream error pages are not rewritten as valid playlists.
- User-configurable upstream responses now have streaming byte ceilings: search JSON 512 KiB/page, source-test JSON 1 MiB, detail JSON/HTML 2 MiB, source subscriptions 4 MiB, live M3U 8 MiB, XMLTV 32 MiB and generic provider JSON 4 MiB.
- XMLTV gzip decompression is capped at 64 MiB output to prevent compressed EPG expansion from exhausting memory.

### Direct downloads
- Verify actual MP4/WebM/Ogg/FLV container signatures instead of trusting a URL extension or an upstream `video/mp4` MIME type.
- Bound signature reads to 64 bytes / 5 seconds.
- Forward only a single valid byte range; ignore malformed and multipart range requests so a multipart body is not mislabeled as a video file.
- Handle leading MP4 `free` boxes and extended-size `ftyp` boxes.

## GitHub review

Reviewed the official LibreTV and ArtPlayer issue history and compared alternative playback projects rather than replacing working components without device-level evidence.

- ArtPlayer #1073: the upstream 5.4.0 web-fullscreen to native-fullscreen regression is worked around by setting `FULLSCREEN_WEB_IN_BODY=false` in both VOD and Live (introduced in 2.23.4).
- ArtPlayer #1033: the iOS standalone safe-area discussion concerns the optional auto-orientation path; this app explicitly leaves `autoOrientation` disabled.
- LibreTV #937: mobile control-bar auto-hide is addressed by the existing touch-specific persistent-control policy.
- LibreTV #977: memory-Blob downloads are labelled as generated/pending save, with a retry-save entry point; the app no longer claims that triggering a browser download proves the file reached device storage.
- LibreTV #976: previous/next episode controls and batch download selection are already present in this working tree.
- Video.js and Shaka Player remain possible future prototypes, but replacing ArtPlayer in this patch would expand the regression surface across custom controls, playback history, skip marks, live HLS/FLV and downloads. No production player replacement was made.

## Automated verification

| Check | Result |
|---|---|
| Vitest | 60 test files passed |
| Unit tests | 821 passed / 0 failed (3 consecutive full-suite runs) |
| TypeScript typecheck | Passed |
| ESLint | Passed |
| Production npm audit | 0 vulnerabilities |
| Full npm audit | 0 vulnerabilities |
| Dependencies checked by npm audit | 516 |
| Next.js production build | Passed |
| Git whitespace check | Passed |

The production build generated all 22 static pages and all API route bundles successfully. A local production-server smoke test on port 18431 returned `/api/status` with version `2.23.5`; the temporary smoke-test server was stopped afterward.

## Deployment and device acceptance

- Changes are present in the local working tree at `E:\\Github\\LibreTV-Mobile-Publish`.
- Changes are not committed, pushed to GitHub, or deployed to Render.
- No public download URL has been created in this pass.
- The existing Android TWA APK is not rebuilt: this patch changes the hosted web application and does not change the Android package ID, signing key, origin or wrapper.
- Physical Android and iOS checks are still required for fullscreen transitions, background playback, hardware decoding, long-form streaming and actual device downloads.
- Different third-party CMS/IPTV providers can return non-standard data; automated limits prevent unbounded reads but cannot guarantee every source's compatibility.

## Final assessment

The 2.23.5 source tree passes the complete automated suite, typecheck, lint, production build and both npm audits. It is ready for a separate deployment/physical-device acceptance step, but it is not yet a published or deployed release.

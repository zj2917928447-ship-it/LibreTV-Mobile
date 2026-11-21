# LibreTV Mobile 2.23.6 — Acceptance Report
Date: 2026-11-16

## Scope

Local-only 2.23.6 patch in `E:\\Github\\LibreTV-Mobile-Publish`. No GitHub push, release, commit or Render deployment was performed.

The patch adds a separate movie/TV catalogue and regional legal-watch-provider discovery without replacing the existing Apple CMS / open-media search, ArtPlayer, hls.js, mpegts.js, playback history, downloads or Android TWA package identity.

## Changes

### 1. Search and playback are explicitly separated
- Existing Apple CMS / open-media search remains the only source of in-app playback candidates.
- A CMS result is not called playable merely because its title matched. The user must open the source detail and the app must successfully extract episode URLs before playback is available.
- TMDB catalogue results appear in a separate section and are never converted into synthetic video sources or playback URLs.
- The page explains when no direct source matched while still showing catalogue results below.

### 2. TMDB catalogue search
- Added authenticated server endpoint `GET /api/catalog/search?q=...&region=US`.
- Searches TMDB `/search/multi` with localized `zh-CN` results and `include_adult=false`.
- Returns movie/TV metadata: localized and original titles, year, overview, poster, rating and official TMDB detail URL.
- Search metadata returns independently; it does not wait for streaming-provider lookups.
- The API Read Access Token is read only from server environment variable `TMDB_API_READ_ACCESS_TOKEN`, sent as a Bearer header, and never returned to the browser.
- Search results are limited to 10 and cached in memory for 10 minutes. Requests use the existing SSRF-safe upstream fetch path, per-host concurrency gate and client-disconnect cancellation.

### 3. Regional legal watch-provider discovery
- Added authenticated server endpoint `POST /api/catalog/providers`.
- Uses TMDB Watch Providers by movie/TV ID and region. Supports subscription, free, ad-supported, rental and purchase categories.
- Provider lookups run independently after metadata search, with maximum 10 titles per request, concurrency 3, 5-second per-call timeout and 30-minute successful-result cache.
- One provider failure does not hide catalogue metadata or other provider results.
- Only TMDB's own validated watch URL is linked; no guessed provider deep links are generated.
- User preference for region is persisted locally. UI offers US/CN/HK/TW/GB/CA/AU/JP/KR/IN/DE/FR.

### 4. Attribution and compliance
- Added an approved TMDB blue logo asset sourced from TMDB's official logo/attribution page.
- About page includes the exact TMDB non-endorsement notice and credits JustWatch as the watch-provider data source.
- Documentation states TMDB's free developer API is for non-commercial use with attribution; commercial use requires an appropriate license.
- The TMDB token is not included in source or standalone packages. It must be configured on the server by the operator.
- No unverified third-party direct playback source list was copied from community PR #981; that PR is still open and its source rights/current uptime were not independently established.

### 5. Chinese alias and cache correction
- Rechecked the 2.23.2 source history: it already contained Chinese Spider-Man aliases. The earlier diagnosis that the old public code lacked the alias was incorrect.
- The open-media cache used the raw user query as the key, so a cached empty result for `蜘蛛侠` could remain separate from the `Spider-Man` query even though both resolve to the same provider term.
- Added a versioned canonical cache key based on the resolved provider query. Empty results are short-lived (30 seconds) and are not CDN-cached.
- This removes stale empty alias results; it cannot make a public-domain catalogue contain commercial copyrighted films that are not in its upstream catalogues.

### 6. Deployment defaults and duplicate-source protection
- Render Blueprint now preselects the built-in open-media API through `DEFAULT_SOURCES`, which is available in the status response before subscription import.
- Existing subscription-imported and newly preconfigured source entries pointing at the same normalized API URL are deduplicated before search.
- The built-in open-media source covers public-domain/open-licensed media; it is not a commercial movie catalogue.

## Verification

| Check | Result |
|---|---|
| Vitest files | 62 passed |
| Unit tests | 835 passed / 0 failed |
| Full suite repeat | 3 consecutive full-suite runs passed |
| TypeScript | Passed |
| ESLint | Passed |
| Next.js production build | Passed |
| Production routes | Includes `/api/catalog/search` and `/api/catalog/providers` |
| Local standalone smoke | Passed |
| Authentication smoke | Login succeeded; protected catalogue endpoints accepted the session |
| No-token behavior | Both catalogue endpoints correctly returned `configured=false` without a server token |
| Search page HTTP | 200 |
| Git whitespace check | Passed |

The production standalone server was started locally on port 18433, tested, and stopped afterward. The packaged `libretv-2.23.6-standalone.tar.gz` was then extracted to a clean smoke directory and started independently; version, login, and both catalogue API no-token states passed. The temporary smoke directory was removed.

### Network-dependent checks not completed
- A fresh `npm audit` could not complete because the configured local VPN07 proxy at `127.0.0.1:7688` was not listening; npm returned ECONNREFUSED. No new runtime dependencies were added in this patch. The previous 2.23.5 audit had reported zero vulnerabilities, but that is not a fresh 2.23.6 audit.
- TMDB live API/provider responses could not be tested because no `TMDB_API_READ_ACCESS_TOKEN` is configured locally. Mocked API contract tests passed.
- The public Render endpoint was last observed on 2.23.2 in the earlier check; it has not been deployed with 2.23.6. The current network check could not run because VPN07 port 7688 is unavailable.
- Physical Android/iOS device acceptance remains outstanding.

## Release and distribution state

- Local project version: 2.23.6.
- Production standalone build: generated successfully.
- No GitHub commit, push, tag or Release.
- No Render deployment.
- Existing signed Android TWA APK remains version 1.0.0 and points to the existing Render origin. It does not embed the 2.23.6 server code; after deployment to that origin it will display the deployed web version.
- A separate source archive and standalone server package are prepared in `E:\\Android\\Releases\\LibreTV-Mobile-2.23.6-Public-Download`.
- Remote bundle: `LibreTV-Mobile-2.23.6-remote-download.zip`. All included files passed checksum verification and ZIP integrity tests; source ZIP contains no `.git`, `node_modules`, `.next`, private env files, signing keys or native binaries. The final bundle SHA-256 is recorded in `BUNDLE-SHA256.txt`.
- A public file-host upload is still pending: the VPN07 process is present, but the expected local proxy `127.0.0.1:7688` is not listening. Port 8060 did not behave as an HTTP proxy. The separate 10804 proxy was not used because it is reserved for the user's ChatGPT traffic.

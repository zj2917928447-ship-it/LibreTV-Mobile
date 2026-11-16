# LibreTV Mobile — Open Media Acceptance 2026-11-16

## Scope

Application version: 2.23.3 (LibreTV 2.23.2 upstream base with this mobile/server patch set).

This report covers the server-side open-media adapter and live upstream HTTP behavior. It does not claim physical-device playback or a completed public Render deployment.

## Local verification

| Check | Result |
|---|---|
| Vitest | 52 files, 741 tests passed |
| TypeScript | Passed |
| ESLint | Passed |
| npm audit --omit=dev | 0 known vulnerabilities |
| Full npm audit | 0 known vulnerabilities |
| Next.js production build | Passed (15.5.29) |

## Real provider search and detail checks

Tests were run against a local production build with the fixed-provider outbound proxy configured.

| Search query | Observed results | Detail verification |
|---|---|---|
| The General | 8 results: six Internet Archive editions and two Wikimedia Commons copies | Distinct editions and both provider details returned playback URLs and runtimes |
| Apollo 17 | 6 results: two Archive items, one NASA item, two PeerTube items and one Commons item | One detail from each of the four providers returned a playable URL and runtime |
| Earth from Space | 2 results: NASA 50:00 and PeerTube 1:54:22 | Both detail endpoints returned playback URLs and runtimes |
| NASA ID with spaces | `Apollo 14 Launch Coverage` | Search, asset manifest, metadata and detail resolved a URL-encoded official mobile MP4 |

The results are archival/open-licence material, not a commercial streaming catalogue. PeerTube results are user-hosted and must retain their item-level licence and source attribution.

## Real upstream byte-range probes

Each probe requested bytes 0–1023 from the actual upstream media URL.

| Provider | Media | HTTP | Content type | Range result |
|---|---|---:|---|---|
| Internet Archive | The General 1926 MP4 | 206 | video/mp4 | bytes 0–1023 / 419,224,226 |
| NASA | Earth from Space mobile MP4 | 206 | video/mp4 | bytes 0–1023 / 128,208,963 |
| Wikimedia Commons | The General 240p VP9 WebM | 206 | video/webm | bytes 0–1023 / 163,929,190 |
| PeerTube | Apollo 15 HLS master playlist | 206 | application/vnd.apple.mpegurl | bytes 0–610 / 611 |

The tested Commons WebM and PeerTube HLS responses included `Access-Control-Allow-Origin: *`. The PeerTube master playlist exposed 240p, 480p, 720p and 1080p variants.

## Bugs addressed in this review

1. NASA IDs containing spaces/punctuation were previously rejected by a word-character-only validator. The adapter now accepts safe path-segment IDs, URL-encodes them for API requests and encodes their original-item links.
2. NASA search hits are verified against the actual asset manifest before being listed. A browser-playable MP4, acceptable duration and no explicit copyright/rights restriction are required.
3. NASA preview images are restricted to the official NASA assets host.
4. PeerTube media/thumbnail URLs reject credentials, non-HTTPS schemes, localhost and non-public/reserved IP addresses.
5. Same-title editions are preserved across providers; only identical provider IDs are deduplicated.
6. IPv4/IPv6 non-unicast ranges are classified by ipaddr.js rather than a partial handwritten range table. Regression tests cover IPv4-mapped IPv6 and trailing-dot localhost.

## Known limits / not yet proven

- HTTP 206 proves byte-range support, not that every phone/browser can decode the complete media.
- No physical Android or iOS device playback run was performed in this acceptance pass.
- No full-length download was completed; the upstream Range checks used only the first 1 KiB.
- The local fixed-provider proxy at 127.0.0.1:7688 is machine-specific and must never be copied into Render. The cloud service should use its own outbound networking.
- The public Render deployment has not yet been redeployed with the 2026-11-16 local changes. Do not treat the public site or the existing APK as containing these fixes until the new deployment is verified.

## Upstream review decisions

- Keep LibreTV 2.23.2 architecture, ArtPlayer 5.4.0, hls.js 1.7.4 and mpegts.js 1.8.2 for this release.
- Video.js 10.4.0 is a promising future player migration, not a drop-in replacement for current ArtPlayer wiring.
- Shaka Player is a candidate if DASH-only playback becomes a required feature; it is not added yet.
- mpegts.js upstream PR #310 fixes Worker-backed MSE teardown. Current FLV live playback has `enableWorker: false`, so the affected path is not active.

See [GITHUB-UPSTREAM-REVIEW.md](./GITHUB-UPSTREAM-REVIEW.md) for the detailed repository comparison and upstream links.


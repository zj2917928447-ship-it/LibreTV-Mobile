# LibreTV Mobile 2.23.2 — Security and Dependency Audit

Audit date: 2026-11-14
Worktree: E:\\Github\\电影\\LibreTV-Mobile
Application version: 2.23.2

## Executive result

Both the production-only and full dependency audits pass with zero known vulnerabilities in the current npm advisory database.

| Audit | Dependencies audited | Info | Low | Moderate | High | Critical |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Production dependencies (`npm audit --omit=dev`) | 521 | 0 | 0 | 0 | 0 | 0 |
| All dependencies (`npm audit`) | 521 | 0 | 0 | 0 | 0 | 0 |

A clean dependency installation was completed using the committed package manifest and lockfile. The two required native/build lifecycle scripts were reviewed and explicitly allow-listed at exact versions: `esbuild@0.25.12` and `unrs-resolver@1.12.2`.

## Vulnerabilities found and remediated

The initial audit of the previous lockfile reported five production vulnerability groups (including four high and one critical), plus development-tool findings.

| Package | Previous version | Final locked version | Remediation |
| --- | ---: | ---: | --- |
| Next.js | 15.5.26 | 15.5.29 | Updated within the supported Next.js 15 line; closes the reported 15.5.27-or-earlier advisories |
| Undici | 6.21.1 | 6.29.1 | Updated beyond the reported vulnerable range (<=6.29.0); retains same-package fetch + Agent pairing from upstream #984 |
| PostCSS | 8.5.28 | 8.5.33 | Updated beyond the reported vulnerable range (<=8.5.22) |
| Sharp | 0.35.4 | 0.35.5 | Updated to the patched release |
| source-map-js | 1.2.1 | 1.2.2 | Updated beyond the reported vulnerable range (<=1.2.1) |
| Vite | 5.4.21 | 6.4.6 | Updated to the patched Vite 6 line compatible with Vitest 4 |
| Vitest | 2.1.9 | 4.1.12 | Updated beyond the reported vulnerable mocker/tinypool ranges |
| minimatch (typescript-estree override) | 10.2.6 | 11.0.8 | Explicitly overrides the vulnerable nested parser dependency |
| postcss-selector-parser | <6.1.5 | 6.1.5 | Explicit patched override |

The final lockfile also pins the compatible transitive overrides for PostCSS, Sharp and source-map-js. `npm ls` confirms the expected direct and overridden dependency versions without invalid or extraneous packages.

## Application security review

### SSRF / DNS rebinding

- Official LibreTV #980 is retained: allowing private IPTV addresses at connection time requires both a live-request call-site and explicit deployment configuration `LIVE_ALLOW_PRIVATE=1`.
- The connection-layer DNS lookup is not bypassed by the live URL validator.
- Official #984 is retained: protected requests use the same Undici package implementation as the custom Agent, avoiding cross-version dispatcher incompatibility on Node 26.
- Regression tests exercise two separately mocked DNS resolvers and a loopback HTTP server without depending on public DNS.

### Authentication

- Session cookies are HMAC-signed, HttpOnly and SameSite=Lax.
- Malformed percent-encoded session cookies now fail closed as unauthenticated instead of throwing `URIError` and causing an API 500.
- The malformed-cookie regression test is included in the full suite.

### Browser response headers

Production response headers were verified in Chrome:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Powered-By` is absent.

### Download data-integrity review

- Found a concrete binary-corruption bug in the in-memory download fallback: the code previously passed each Uint8Array.buffer directly to Blob. When a segment is a subarray, the full backing buffer (including bytes outside byteOffset/byteLength) can be exported; if the caller reuses the backing buffer after write(), the queued segment can also be mutated before Blob creation.
- Fixed by snapshotting the exact view bytes on each write and building the final Blob from those stable snapshots.
- Added a regression test that mutates the original backing buffer after write() and verifies the Blob contains exactly the original two-byte subarray.

## Static source review

- No `eval()`, `new Function`, or string-based timer execution was found in application source.
- No `NEXT_PUBLIC_*` secret-like variable usage was found.
- The only `dangerouslySetInnerHTML` use is a constant, hard-coded pre-hydration theme bootstrap string; no user/API/storage content is interpolated into it.
- The external GitHub link using `target="_blank"` includes `rel="noopener noreferrer"`.
- The `allowPrivate: true` call sites are limited to the IPTV routes/stream proxy; the shared connection layer still gates private-network access on `LIVE_ALLOW_PRIVATE=1`.

## Public hosting configuration

- `render.yaml` keeps `PASSWORD` and `PROXY_SECRET` out of source control by using Render-generated random values.
- `COOKIE_SECURE=true` is set for the HTTPS host; the login cookie remains Secure, HttpOnly and SameSite=Lax.
- `LIVE_ALLOW_PRIVATE=0` is explicitly set so the public service does not allow private-network IPTV targets by default.
- The Free Render filesystem is ephemeral; this application stores viewing history/settings in the browser and does not rely on server-local persistent user data. Do not add server-side local file persistence without a database/object-store design.

## Deliberate non-changes

- Next.js 16.4.6 was reviewed but not adopted. The official LibreTV 2.23.2 base is on Next.js 15; a major framework migration needs its own playback, deployment and runtime regression pass.
- No broad CSP is forced in this release. The application uses a pre-hydration inline theme bootstrap and dynamic third-party image/media origins; a nonce-based policy must be validated against actual source providers and deployment headers before enforcement.
- HSTS is not hard-coded at the application layer because the app can be served behind different HTTP/TLS reverse-proxy arrangements. Configure HSTS at the HTTPS edge once the public deployment is fixed.
- No security feature is disabled to make the audit pass.

## Remaining acceptance limits

- Browser emulation is not a physical Android/iPhone device test.
- Actual VOD/HLS, HTTP-FLV, M3U live playback, real episode downloads, hardware decoding and background audio remain unverified because no user-configured media sources or physical test device were supplied.
- No signed APK/AAB is claimed. A stable HTTPS deployment domain, Android toolchain, signing key and matching Digital Asset Links are required. See `ANDROID-TWA-SETUP.md`.

# LibreTV Mobile 2.23.4 — Patch Acceptance Report (2026-11-16)

## Scope

This patch follows the published 2.23.3 release and fixes two issues found during the next review:

1. ArtPlayer 5.4.0 web-fullscreen to native-fullscreen transition regression.
2. PeerTube media URL validation of local hostnames with multiple trailing dots.

## Verified upstream evidence

ArtPlayer upstream issue [#1073](https://github.com/zhw2590582/ArtPlayer/issues/1073) is open and specifically reports that in 5.4.0, switching from web fullscreen to native fullscreen exits web fullscreen instead of entering native fullscreen. The upstream global setting documentation states that `FULLSCREEN_WEB_IN_BODY` controls whether the player is moved under `document.body` during web fullscreen and defaults to `true`.

This patch sets `FULLSCREEN_WEB_IN_BODY=false` for both VOD and Live players, keeps the player inside its original container, and restores both shared ArtPlayer static settings when a player unmounts. The optional `autoOrientation` plugin is explicitly disabled in both modes; the upstream safe-area change is not yet in npm 5.4.0 and does not affect the active app path.

Both players now use the shared `configureArtPlayerGlobals` / `restoreArtPlayerGlobals` helper. This prevents the live route from retaining touch-control settings or fullscreen settings after unmount. The patch does not upgrade ArtPlayer or modify the installed dependency.

References:
- [ArtPlayer issue #1073](https://github.com/zhw2590582/ArtPlayer/issues/1073)
- [ArtPlayer global properties documentation](https://artplayer.org/document/en/advanced/global.html)

## Additional hostname hardening

PeerTube media URL normalization now strips all trailing dots before checking local hostname suffixes. Regression cases include:
- `localhost.`
- `localhost..`
- `localhost...`
- `api.localhost...`

This prevents DNS-equivalent trailing-dot variants from bypassing the local-host checks.

## Automated verification

| Check | Result |
|---|---|
| Vitest | 53 test files passed |
| Unit tests | 746 passed / 0 failed |
| TypeScript typecheck | Passed |
| ESLint | Passed |
| Production npm audit | 0 vulnerabilities |
| Full npm audit | 0 vulnerabilities |
| Next.js production build | Passed |
| Git whitespace check | Passed |

## Final local production-server verification

A clean Next.js production build was started locally on port 8141 with the local-only fixed-provider proxy. `/api/status` reported version `2.23.4`. Authenticated live searches and detail requests succeeded:

| Search | Provider | Detail result |
|---|---|---|
| Apollo | Internet Archive | 45:30, playable MP4 URL |
| Apollo | NASA | 48:22, playable mobile MP4 URL |
| Apollo | PeerTube | 28:00, playable HLS URL |
| Apollo | Wikimedia Commons | 22:50, playable WebM URL |
| The General | Internet Archive | 1:18:52, playable MP4 URL |
| The General | Wikimedia Commons | 1:15:52, playable WebM URL |

No server errors were recorded in this final QA run. This validates provider search/detail resolution, not full-length playback or full downloads on a physical phone.

## Deployment status

- GitHub main was synchronized to published commit `fbcb72e` before this patch was prepared.
- This 2.23.4 patch is a new local change and is not yet published or deployed.
- Render was last checked on the prior deployment and still reported 2.23.2 at that time; it must be redeployed and verified after the 2.23.4 commit is published.
- Existing Android TWA APK v1.0.0 is not rebuilt: the patch changes the hosted web app and does not change the package ID, signing key, origin or Android wrapper. Physical-device fullscreen acceptance is still required.

## Limits

Automated tests and production build do not prove that every Android/iOS browser handles native fullscreen identically. Verify web fullscreen → native fullscreen → back-to-web-fullscreen on a physical Android device and iPhone after deployment.

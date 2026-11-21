# Android TWA packaging plan

## Selected architecture

Use the existing hosted LibreTV PWA with Google's Bubblewrap CLI to generate a Trusted Web Activity (TWA).

This preserves the current Next.js server and its Route Handlers. The Android app opens the HTTPS site in the browser engine in a full-screen TWA; it does not move server routes into a WebView, remove password authentication, or replace SSRF checks with permissive client shims.

- Primary project: https://github.com/GoogleChromeLabs/bubblewrap
- CLI version: 1.27.0 (Apache-2.0)
- Supporting Android library: https://github.com/GoogleChrome/android-browser-helper
- The older repository https://github.com/pwa-builder/pwabuilder-android-twa is archived and is not selected. PWABuilder's current Android packaging flow uses Bubblewrap.

## Required before final release

1. A stable public HTTPS origin for this LibreTV deployment. Do not use a localhost address or a `trycloudflare.com` Quick Tunnel for the release APK.
2. The deployed site's `/manifest.webmanifest` must be reachable and expose a standalone display mode, a valid start URL/scope, and working 192px/512px icons.
3. The Android package name is fixed as `com.zj2917928447.libretv`; do not change it after distributing the app.
4. The signing key is stored outside source control at `E:\\Android\\Signing\\libretv-release.keystore`. The DPAPI-protected password is at `E:\\Android\\Signing\\key-password.dpapi`. Do not upload either file or expose the password.
5. The public file `/.well-known/assetlinks.json` is now prepared in `public/.well-known/assetlinks.json` with the SHA-256 fingerprint of the release signing certificate. It must be deployed on the same stable origin as the PWA.
6. Verify the APK with Bubblewrap, apksigner, zipalign, and a real Android device. A missing Digital Asset Links association causes Chrome to fall back to a Custom Tab instead of a verified full-screen TWA.

## Current Android build environment (checked 2026-11-15)

All build tooling is installed on E:; the existing system JDK 21 was not changed.

| Component | Installed location / version | Status |
| --- | --- | --- |
| Node.js | 24.18.0 | Present |
| Bubblewrap CLI | 1.27.0 at `E:\\Android\\BubblewrapCli` | Installed |
| JDK | Temurin 17.0.21 at `E:\\Android\\JDK17` | Verified |
| Gradle wrapper | 8.11.1 under `E:\\Android\\GradleHome` | Verified |
| Android command-line tools | `E:\\Android\\Sdk\\cmdline-tools\\latest` | Installed |
| Android platform | API 36 | Installed |
| Build Tools | 36.1.0 | Installed |
| Platform Tools / ADB | 37.0.1 | Installed |
| Bubblewrap doctor | `bubblewrap doctor` | Passed |

**Important Bubblewrap 1.27.0 path detail:** its configuration expects the Android SDK path to contain `bin\\sdkmanager.bat`, `build-tools`, `platforms`, and `platform-tools` together. This machine therefore uses `E:\\Android\\Sdk\\cmdline-tools\\latest` as Bubblewrap's configured SDK root. Do not move those folders independently or point Bubblewrap at the parent `E:\\Android\\Sdk`.

## Initial test build (temporary tunnel; historical only)

A first signed test TWA was generated against a temporary Cloudflare Quick Tunnel. It is retained only as a build-history record and must not be distributed:

- APK: `E:\\Android\\LibreTV-TWA\\app-release-signed.apk` (1,422,787 bytes)
- AAB: `E:\\Android\\LibreTV-TWA\\app-release-bundle.aab` (1,503,479 bytes)
- Package: `com.zj2917928447.libretv`
- Version: `1.0.0`
- Min SDK: 24 (Android 7.0)
- Target SDK: 36

Checks passed:
- APK signature verified using APK Signature Scheme v2 and v3.
- ZIP alignment verified.
- Package name, launcher activity, and SDK metadata inspected.
- Signing certificate SHA-256: `556798663CB95922C5C39F7213416AD4183D363CC54464FE7ECB8403D4BC40AB`.

**The initial test APK points at the temporary Cloudflare Quick Tunnel and must not be distributed.**

## Final release build (2026-11-15)

The Render Free Web Service is live at:

- `https://libretv-mobile-zj2917928447.onrender.com`

Public checks passed:
- `/` — HTTP 200
- `/manifest.webmanifest` — HTTP 200, `display=standalone`
- `/icons/icon-192.png` and `/icons/icon-512.png` — HTTP 200
- `/api/status` — HTTP 200, app version 2.23.2 and password protection enabled
- `/.well-known/assetlinks.json` — HTTP 200
- Google's Digital Asset Links API — one matching statement for this HTTPS origin, package and signing certificate

The final signed Android artifacts were rebuilt against this stable origin and published as [GitHub Release mobile-v1.0.0](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/tag/mobile-v1.0.0):

- [Direct APK download](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/download/mobile-v1.0.0/LibreTV-Mobile-Android-v1.0.0.apk)
- [Direct AAB download](https://github.com/zj2917928447-ship-it/LibreTV-Mobile/releases/download/mobile-v1.0.0/LibreTV-Mobile-Android-v1.0.0.aab)
- Current public phone-download page: https://gofile.is/d/EifUx0 (downloaded and SHA-256 verified against the local signed APK)

| Artifact | Value |
| --- | --- |
| APK | `E:\\Android\\LibreTV-TWA\\app-release-signed.apk` |
| APK size | 1,422,787 bytes |
| APK SHA-256 | `33458ABFA3B5A2AA230BA28F8854564231E17FBBD1EA97B2A0E363B68EDCD531` |
| AAB | `E:\\Android\\LibreTV-TWA\\app-release-bundle.aab` |
| AAB size | 1,503,504 bytes |
| AAB SHA-256 | `9AE3D115E9EF05F90EADE2A8824E552B2ACEAED032BFD1879803116A310D46E8` |
| Signing certificate SHA-256 | `556798663CB95922C5C39F7213416AD4183D363CC54464FE7ECB8403D4BC40AB` |

The APK signature (v2/v3) and ZIP alignment checks pass. The APK is bound to the stable Render hostname, not the temporary tunnel. The local ADB device list is empty, so physical-device install, playback and download testing remain outstanding.

The repeatable release builder is `scripts/build-twa-release.ps1`. To rebuild after a site or signing change:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\build-twa-release.ps1 -SiteUrl https://libretv-mobile-zj2917928447.onrender.com
```

It rejects temporary/local origins, verifies that the deployed `/api/status` version exactly matches the local `package.json` version and that `/free` is present, validates the live site, PWA manifest, icons and Digital Asset Links fingerprint, updates the TWA manifest, builds APK/AAB, then verifies APK signature and alignment. It reads the existing Windows system proxy for Bubblewrap/Gradle instead of assuming port 7688. This prevents accidentally signing an APK that still opens an older deployment without the Free Resources Center.

The repository is public, so Render was deployed from the public Blueprint URL without installing Render's GitHub App. Public-repository URL deploys require manual redeploys after future commits.

## Why TWA is preferred over the researched Capacitor fork

The researched `065021/libretv-mobile` fork is based on LibreTV 2.19.0 and its app-only shims intentionally bypass server authentication and SSRF checks. Its embedded-route approach also changes the server execution model and has documented differences such as HTTP-FLV support. It is useful research, but not a safe drop-in upgrade for this 2.23.2 server application.

TWA keeps the existing production server boundary intact. It requires the site to remain hosted and online; it is not an offline self-contained server app.

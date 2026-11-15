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

## Test build (not the final public release)

A signed test TWA was successfully generated at:

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

**This test APK points at the temporary Cloudflare Quick Tunnel and must not be distributed as the final app.** The current ADB device list is empty, so physical-device install/playback validation has not yet been performed.

The repository is public, so Render can import it directly using the Blueprint URL in `README.md` / `RENDER-DEPLOYMENT.md`. This avoids installing Render's GitHub App or granting it access to the user's repositories. Render does not support automatic deploys for a public-repository URL, so use Manual Deploy in Render after later commits.

## Final build gate

The final release builder is prepared at `scripts/build-twa-release.ps1`. After the Render Blueprint creates a stable HTTPS service and the latest GitHub commit is deployed, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\build-twa-release.ps1 -SiteUrl https://YOUR_RENDER_SERVICE.onrender.com
```

The script refuses temporary/local origins, verifies the live site, PWA manifest, 192px/512px icons, and Digital Asset Links fingerprint before it updates the TWA manifest and builds the signed APK/AAB. It then verifies the signature and ZIP alignment.

After the builder succeeds, complete the remaining release checks:

1. Confirm the root page, `/manifest.webmanifest`, required icons, `/api/status`, and `/.well-known/assetlinks.json` return expected responses over HTTPS.
2. Verify signature, alignment, package metadata, and Digital Asset Links.
3. Install and test playback/download behavior on a real Android device.
4. Publish the final APK as a GitHub Release asset and provide the direct public download URL.

## Why TWA is preferred over the researched Capacitor fork

The researched `065021/libretv-mobile` fork is based on LibreTV 2.19.0 and its app-only shims intentionally bypass server authentication and SSRF checks. Its embedded-route approach also changes the server execution model and has documented differences such as HTTP-FLV support. It is useful research, but not a safe drop-in upgrade for this 2.23.2 server application.

TWA keeps the existing production server boundary intact. It requires the site to remain hosted and online; it is not an offline self-contained server app.

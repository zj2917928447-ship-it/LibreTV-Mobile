# Android TWA packaging plan

## Chosen architecture

Use the existing hosted LibreTV PWA with Google's Bubblewrap CLI to generate a Trusted Web Activity (TWA).

This preserves the current Next.js server and its Route Handlers. The Android app opens the HTTPS site in the user's browser engine in a full-screen TWA; it does not move server routes into a WebView, remove password authentication, or replace SSRF checks with permissive client shims.

Primary project: https://github.com/GoogleChromeLabs/bubblewrap
Current CLI version reviewed: 1.27.0 (Apache-2.0)
Supporting Android library: https://github.com/GoogleChrome/android-browser-helper

The older repository https://github.com/pwa-builder/pwabuilder-android-twa is archived and is not selected. PWABuilder's current Android packaging flow uses Bubblewrap, so it is an alternative interface rather than a different core implementation.

## Required before generating an installable TWA

Use the stable HTTPS origin from `RENDER-DEPLOYMENT.md` for the final APK. Do not build a release APK against a `trycloudflare.com` Quick Tunnel URL: it changes when the tunnel is recreated and the APK would lose its origin.

1. A stable public HTTPS origin for this LibreTV deployment. TWA cannot be finalized from localhost or a ZIP-only static build.
2. The deployed site's manifest must be reachable at /manifest.webmanifest and expose a standalone display mode, valid start URL/scope, and working 192px/512px icons.
3. The Android application ID/package name must be chosen and kept stable once distributed.
4. A signing key must be generated and stored safely by the owner. Never put keystore passwords or private keys in source control.
5. After the APK/AAB signing certificate is known, publish the matching Digital Asset Links JSON at:
   https://YOUR_DOMAIN/.well-known/assetlinks.json
6. Verify that the installed package opens in verified TWA mode. If Digital Asset Links verification fails, browsers fall back to a Custom Tab rather than granting verified full-screen TWA behavior.

## Build procedure once the domain and package ID are supplied

Use Node.js 18+ (the current machine has Node 24.18.0). Bubblewrap CLI 1.27.0 requires JDK 17 and Android command-line tools. On this machine, keep all Android tooling under `E:\\Android` (not on C:). Set `USERPROFILE=E:\\Android\\BubblewrapHome` for the Bubblewrap process before its first run so its managed `.bubblewrap` directory is created on E:. Bubblewrap's first-run wizard can download JDK 17 and Android SDK automatically. If setting up manually, use JDK 17; the system-wide JDK 21 is not accepted by Bubblewrap 1.27.0, so do not change the system-wide Java installation.

~~~bash
npx --yes @bubblewrap/cli@1.27.0 init --manifest=https://YOUR_DOMAIN/manifest.webmanifest --directory=android-twa
cd android-twa
npx --yes @bubblewrap/cli@1.27.0 doctor
npx --yes @bubblewrap/cli@1.27.0 build
~~~

Bubblewrap validates the PWA/TWA configuration and generates an Android project, signed APK (app-release-signed.apk) and App Bundle (app-release-bundle.aab) when signing is configured. Run bubblewrap doctor to verify the managed JDK/Android SDK paths. Keep the generated twa-manifest.json and the signing configuration under owner control.

## Why TWA is preferred over the previously researched Capacitor fork

The researched 065021/libretv-mobile fork is based on LibreTV 2.19.0 and its app-only shims intentionally bypass server authentication and SSRF checks. Its embedded-route approach also changes the server execution model and has documented differences such as HTTP-FLV support. It is useful research, but not a safe drop-in upgrade for this 2.23.2 server application.

TWA keeps the existing production server boundary intact. It requires the site to remain hosted and online; it is not an offline self-contained server app.

## Current machine readiness (checked 2026-11-14)

- Node.js 24.18.0: present.
- JDK 21: present.
- Android SDK: not found in the checked standard locations.
- ADB: not found on PATH or in the checked SDK locations.
- Gradle: not found on PATH.
- Public temporary test URL: verified, but not suitable for final APK because Quick Tunnel URLs are temporary.
- Stable Render HTTPS deployment: Blueprint prepared; requires connecting the Render account and creating the Free Web Service.

The next build gate is the stable Render HTTPS origin, JDK 17/Android SDK installation under E:, and Digital Asset Links verification. Do not generate a placeholder package or fake Digital Asset Links file.

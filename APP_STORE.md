# Shipping Rally to the Apple App Store

This wraps the existing web app in a native iOS shell with **Capacitor** and
builds it on a **cloud Mac (Codemagic)** so you don't need your own Mac. The web
app and PWA are unaffected — this is additive.

## Current state (already done in the repo)
- `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` installed.
- `capacitor.config.json` — app id `com.danbaldauf.rally`, web dir `dist`.
- `npm run cap:sync` — builds the web app and syncs it into the iOS project.
- `codemagic.yaml` — cloud build + TestFlight/App Store submission workflow.
- The `ios/` folder is **git-ignored** and generated on the cloud Mac each build
  (it can't be generated reliably on Windows).

## ⚠️ The one real code task left: native Google sign-in
Rally's Google login (Firebase) and Google Calendar import use **browser popups +
Vercel serverless**, which **do not work inside a native app**. Before the App
Store build is functional you must switch to native OAuth:
- Add `@capacitor-firebase/authentication` (or `@codetrix-studio/capacitor-google-auth`)
  for Google sign-in via the native flow instead of `signInWithPopup`.
- Create an **iOS OAuth client** in Google Cloud Console and add its reversed
  client-id URL scheme to the iOS app.
- Re-point the Google Calendar connect flow to a redirect/native flow.

I can do this code change next — I just need you to create the iOS OAuth client
and share its client id / reversed scheme. (Until then the native app will load
but Google sign-in won't complete.)

## What you need to do (one-time)

### 1. Apple Developer Program — $99/year
Enroll at <https://developer.apple.com/programs/>. Required to publish.

### 2. App Store Connect — create the app
- <https://appstoreconnect.apple.com> → **Apps → +** → New App (iOS).
- Set the **Bundle ID** to match `capacitor.config.json` (`com.danbaldauf.rally`),
  or change both to whatever you prefer (reverse-domain, must be unique).

### 3. App Store Connect API key (for Codemagic signing/upload)
- App Store Connect → **Users and Access → Integrations → App Store Connect API**
  → generate a key (Admin or App Manager role). Download the `.p8`, note the
  **Key ID** and **Issuer ID**.

### 4. Codemagic
- Sign up at <https://codemagic.io> (free tier includes 500 build-min/mo on macOS).
- **Add application** → connect this GitHub repo.
- **Teams → Integrations → App Store Connect**: add the API key from step 3.
  Name it `CodemagicAppStoreKey` (matches `codemagic.yaml`, or rename both).
- Codemagic will auto-manage signing certs/profiles via that key.
- Start a build of the `ios-release` workflow → it lands in **TestFlight**.

### 5. App assets & metadata (in App Store Connect)
- **App icon**: 1024×1024 PNG (no transparency). Generate from the logo with
  `npx @capacitor/assets generate` once `ios/` exists, or export from
  `public/icon-512.png` upscaled / re-rendered at 1024.
- **Screenshots**: required per device size (use the iOS Simulator or a TestFlight device).
- **Privacy policy URL**: Apple requires one (host a page on the Rally site).
- **Data collection disclosure** (App Privacy): you collect email/calendar — declare it.

### 6. Submit for review
- In `codemagic.yaml`, set `submit_to_app_store: true` (and fill required metadata),
  or promote the TestFlight build to App Store in App Store Connect manually.

## Heads-up on review
Apple guideline **4.2** can reject apps that are just a wrapped website. Capacitor
apps usually pass because they bundle the code and run locally, but make sure the
native sign-in works and the app feels like an app (no broken external popups).

## Local commands
```
npm run build        # web only
npm run cap:sync     # build web + sync into ios/ (needs the ios/ folder)
```
The actual iOS compile/upload happens on Codemagic (no Mac needed locally).

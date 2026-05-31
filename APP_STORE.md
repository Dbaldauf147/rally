# Shipping Rally to the Apple App Store

This wraps the existing web app in a native iOS shell with **Capacitor** and
builds it on **GitHub Actions' macOS runners** so you don't need your own Mac.
The web app and PWA are unaffected — this is additive.

## Current state (already done in the repo)
- `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` installed.
- `capacitor.config.json` — app id `com.danbaldauf.rally`, web dir `dist`.
- `npm run cap:sync` — builds the web app and syncs it into the iOS project.
- `.github/workflows/ios.yml` — builds on a macOS runner and uploads to TestFlight,
  using App Store Connect API-key cloud signing (no fastlane, no cert repo).
- The `ios/` folder is **git-ignored** and generated fresh on the runner each build
  (it can't be generated reliably on Windows).

## ⚠️ The one real code task left: native Google sign-in
Rally also has email/password login, which works natively — so the app is
shippable today. But Google login and Google Calendar import use **browser popups**
that don't work in a native app (they're now hidden/degraded in the app). To bring
in-app Google features back later:
- Add `@capacitor-firebase/authentication` for native Google sign-in.
- Create an **iOS OAuth client** in Google Cloud Console; add its reversed
  client-id URL scheme to the iOS app.
- Re-point the Google Calendar connect flow to a redirect/native flow.

Until then, sign in with **email/password** in the app. (To keep the gated tabs,
make an email account using `baldaufdan@gmail.com`.)

## What you need to do (one-time)

### 1. Apple Developer Program — done ✅ ($99/yr)

### 2. App Store Connect — create the app — done ✅
Bundle ID `com.danbaldauf.rally`, registered as an Identifier in the Developer portal.

### 3. App Store Connect API key
- App Store Connect → **Users and Access → Integrations → App Store Connect API**
  → generate a key with the **App Manager** role.
- Download the `.p8` (one-time download). Note the **Key ID** and **Issuer ID**.

### 4. Find your Team ID
- <https://developer.apple.com/account> → **Membership** → copy the 10-character **Team ID**.

### 5. Add GitHub repository secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Secret name | Value |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | the Key ID from step 3 |
| `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID from step 3 |
| `APP_STORE_CONNECT_PRIVATE_KEY` | the **full contents** of the `.p8` file (open it in a text editor, paste everything including the BEGIN/END lines) |
| `APPLE_TEAM_ID` | the Team ID from step 4 |

### 6. Run the build
- Repo → **Actions → "iOS → TestFlight" → Run workflow** (or push a tag like `ios-v1.0.0`).
- It builds on a macOS runner, signs via your API key, and uploads to **TestFlight**.
- First run may take ~15 min. If signing fails, see Troubleshooting below.
- Install the **TestFlight** app on your iPhone to test the build.

### 7. App assets & metadata (in App Store Connect)
- **App icon**: 1024×1024 PNG, no transparency (re-render from the logo at 1024).
- **Screenshots**: required per device size (from the build on a device/simulator).
- **Privacy policy URL**: Apple requires one (host a page on the Rally site).
- **App Privacy disclosure**: you collect email — declare it.

### 8. Submit for review
- In App Store Connect, select the TestFlight build for the App Store version and
  **Submit for Review**.

## Troubleshooting the workflow
- **Export fails on `method app-store`**: newer Xcode wants `app-store-connect` —
  change that value in `.github/workflows/ios.yml`.
- **"No signing certificate"**: cloud signing should auto-create one via the API key
  (key needs App Manager role). If it persists, switch to fastlane `match`.
- **Duplicate build number**: the build number is set from the run number; re-running
  is fine, but re-uploading the same number is rejected — just run again.

## Heads-up on review
Apple guideline **4.2** can reject apps that are just a wrapped website. Capacitor
apps usually pass because they bundle the code and run locally; make sure sign-in
works and there are no broken external popups.

## Local commands
```
npm run build        # web only
npm run cap:sync     # build web + sync into ios/ (needs a Mac for the ios/ folder)
```
The actual iOS compile/upload happens on GitHub Actions (no Mac needed locally).

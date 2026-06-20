# Rally iOS Share Extension

Lets users share an Instagram reel/post into a Rally event from Instagram's iOS
share sheet. The extension grabs the link, opens the app via `rally://share?url=…`,
and the app's `/share` page saves it as an itinerary **activity**.

> **Status: wired into CI.** The web half (save-as-activity + deep-link routing)
> ships in the app bundle, and the `.github/workflows/ios.yml` build now injects,
> signs, and embeds this extension. It hasn't been verified on a physical device
> yet — the first TestFlight build from this branch is the real test.

## Why this lives in `ci/ios/` and not `ios/`

The entire `/ios` folder is **gitignored and regenerated every build** — CI runs
`npx cap add ios` to create the Xcode project from scratch, then copies tracked
overrides in (e.g. `ci/ios/AppDelegate.swift → ios/App/App/AppDelegate.swift`).
There is no committed Xcode project and **no Mac/Xcode in the loop** — it's all
headless CI. So the extension is injected into the generated project by CI rather
than added in Xcode.

## Files here

- `ShareViewController.swift` — headless controller: extracts the shared URL
  (or a URL inside shared text), opens `rally://share?url=…&title=…`, dismisses.
- `Info.plist` — `NSExtension` activation rules (web URL + text). No storyboard
  key — the controller is UI-less.

## How it's wired in CI (`.github/workflows/ios.yml`)

After `npx cap add ios` / `npx cap sync ios`, three steps make the extension real:

1. **`Register the rally:// URL scheme`** — PlistBuddy adds `CFBundleURLTypes`
   (scheme `rally`) to the regenerated `ios/App/App/Info.plist`, so the
   `rally://share…` handoff opens the app.
2. **`Inject Share Extension target`** — `ci/ios/add-share-extension.rb` (Ruby
   `xcodeproj`) copies these two files into the generated project, creates a
   `ShareExtension` app-extension target (bundle id
   `com.danbaldauf.rally.ShareExtension`, deployment matched to the app), makes
   it a dependency of the `App` target, and adds an *Embed App Extensions* copy
   phase so the `.appex` ships inside the app.
3. **Signing** — `ci/create-signing-assets.mjs` now also registers the extension
   bundle id (if new) and creates a second App Store profile for it with the same
   distribution cert. Both profiles are installed and both bundle ids are mapped
   in `ExportOptions.plist`, so `xcodebuild -exportArchive` signs app + extension.

The `App` scheme builds its new dependency automatically, so `-scheme App`
archive/export needs no scheme change.

## End-to-end flow

```
Instagram share sheet
  -> ShareViewController extracts the URL
  -> opens rally://share?url=<reel>&title=<caption>
  -> AppDelegate forwards open(url:) to Capacitor
  -> @capacitor/app fires 'appUrlOpen'
  -> useShareDeepLink.js routes to /share?url=…&title=…
  -> SharePage saves it as event.itinerary[] activity
```

## Notes / gotchas

- `openHostApp` walks the responder chain to call `openURL:` because extensions
  can't use `UIApplication.shared.open` directly. Standard, App-Store-accepted,
  but if review pushes back switch to an App Group + the app polling the shared
  container on `applicationDidBecomeActive`.
- First build requires the App Store Connect API key to have permission to
  **create a bundle id** (for `…ShareExtension`). If that POST 403s, register the
  bundle id once by hand in the developer portal; later runs just reuse it.
- `xcodeproj` is preinstalled via the runner's CocoaPods; the workflow's
  `gem install` is best-effort and non-fatal.
- No App Group is needed — the handoff passes everything in the `rally://` URL.
  Add `group.com.danbaldauf.rally` only if you later pass large payloads
  (e.g. a downloaded video file) through a shared container.

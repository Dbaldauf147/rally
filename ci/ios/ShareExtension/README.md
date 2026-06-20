# Rally iOS Share Extension (scaffold)

Goal: let users share an Instagram reel/post into a Rally event from
Instagram's iOS share sheet. The extension grabs the link, opens the app via
`rally://share?url=…`, and the app's `/share` page saves it as an itinerary
**activity**.

> **Status: scaffold only — NOT yet wired into the build.** These files compile
> the extension's behavior, but the CI pipeline does not build them yet. See
> "What's still required" below. The web half of the feature (save-as-activity
> + deep-link routing) is done and shipping.

## Why this lives in `ci/ios/` and not `ios/`

The entire `/ios` folder is **gitignored and regenerated every build**. The
GitHub Actions workflow (`.github/workflows/ios.yml`) runs `npx cap add ios`
to create the Xcode project from scratch, then copies tracked overrides in
(e.g. `ci/ios/AppDelegate.swift → ios/App/App/AppDelegate.swift`). There is no
committed Xcode project and **no Mac/Xcode in the loop** — everything is
headless CI. So a Share Extension can't be "added in Xcode"; it has to be
injected into the generated project by CI, the same way AppDelegate is.

## Files here

- `ShareViewController.swift` — headless controller: extracts the shared URL
  (or a URL inside shared text), opens `rally://share?url=…&title=…`, dismisses.
- `Info.plist` — `NSExtension` activation rules (web URL + text). No storyboard
  key — the controller is UI-less.

## How the handoff works (once wired)

```
Instagram share sheet
  -> ShareViewController extracts the URL
  -> opens rally://share?url=<reel>&title=<caption>
  -> AppDelegate forwards open(url:) to Capacitor
  -> @capacitor/app fires 'appUrlOpen'   (already installed + wired)
  -> useShareDeepLink.js routes to /share?url=…&title=…
  -> SharePage saves it as event.itinerary[] activity   (done)
```

The web side is complete: `@capacitor/app` is a dependency,
`src/hooks/useShareDeepLink.js` is mounted in `App.jsx`, and `SharePage`
already saves shared links as activities.

## What's still required (CI work — not done)

Adding a second target/binary to a headless cap-generated build is real
pipeline work, roughly:

1. **Register the URL scheme.** After `npx cap sync ios`, patch
   `ios/App/App/Info.plist` to add `CFBundleURLTypes` with scheme `rally`
   (a `plutil`/`PlistBuddy` step, or a tracked Info.plist override copied in
   like AppDelegate). Keep the scheme in sync with `useShareDeepLink.js`.
2. **Create the extension target.** `cap add` won't make one. Inject a
   `ShareExtension` target into the generated `App.xcodeproj` (e.g. via a
   `ruby/xcodeproj` or `xcodegen` script run in CI), copy these two files into
   it, set bundle id `com.danbaldauf.rally.ShareExtension`, and embed it in the
   App target's "Embed App Extensions" build phase.
3. **Sign the second bundle.** The current workflow provisions exactly one
   profile for `com.danbaldauf.rally`. The extension needs its own App Store
   provisioning profile for `com.danbaldauf.rally.ShareExtension`, added to the
   keychain and to `ExportOptions.plist`'s `provisioningProfiles` dict.
4. **Archive** still uses `-scheme App`; confirm the embedded extension is
   included (it is, once it's a dependency of the App target).

Steps 2 + 3 are the substantial parts. Until they're done, sharing from
Instagram on the native app won't show Rally; the in-app "Add from Instagram"
paste flow and the PWA `share_target` remain the working paths.

## Optional: App Group

Not needed — the handoff passes everything in the `rally://` URL. Only add an
App Group (`group.com.danbaldauf.rally`) if you later pass large payloads
(e.g. a downloaded video file) through a shared container instead of the query
string. That would also avoid the responder-chain `openURL:` trick in
`ShareViewController` (replace it with the app polling the container on
`applicationDidBecomeActive`), which is the more App-Review-safe pattern.

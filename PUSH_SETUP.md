# Reach Out daily badge — push setup

The daily red-dot badge (family + friend outstanding) is updated even when the
app is closed by a morning APNs push. Everything native is handled by the
GitHub Actions build (`.github/workflows/ios.yml`) — no Mac and no Xcode. The
only manual work is creating an APNs key and pasting four values into Vercel.

## Two different badge paths — don't confuse them

| | While the app is open | While the app is closed |
|---|---|---|
| Who sets it | `src/hooks/useReachOutBadge.js` via `@capawesome/capacitor-badge` | the `/api/reachout-badge` cron via APNs |
| Needs push set up | no | **yes** — everything below |

So a badge that appears when you open the app but never updates on its own, and
a 9am nudge that never arrives, are the same symptom: push isn't working.
Opening the app never *sends* a notification; it only re-counts the badge.

## What's already in the code

- `src/hooks/usePushRegistration.js` — registers the device for push, saves its
  APNs token to `users/{uid}.pushTokens` (keyed by token), and records the
  outcome to `users/{uid}.pushStatus`.
- `src/components/ReachOutPage.jsx` — shows a red banner whenever `pushStatus`
  isn't `registered`, so a broken setup is visible on the phone.
- `api/reachout-badge.js` — Vercel cron; computes each user's outstanding count
  (in ET) and pushes the badge via APNs.
- `vercel.json` — cron `/api/reachout-badge` at `0 14 * * *` (~9am ET).

## What the CI build does for you

`ios/` is gitignored and regenerated on every build (`npx cap add ios`), so all
the usual Xcode clicking is scripted against the generated project:

- **The plugin** — `npx cap sync ios` picks up `@capacitor/push-notifications`
  from `package.json` automatically. Nothing to do.
- **The AppDelegate hooks** — `ci/ios/AppDelegate.swift` (copied over the
  generated one) forwards `didRegisterForRemoteNotificationsWithDeviceToken` and
  `didFailToRegisterForRemoteNotificationsWithError` to Capacitor. Without these
  the JS `registration` listener never fires and no token is ever saved — and it
  fails silently, so don't remove them.
- **The entitlement** — `ci/ios/add-push-entitlement.rb` copies
  `ci/ios/App.entitlements` (`aps-environment: production`) in and sets
  `CODE_SIGN_ENTITLEMENTS` on the App target. This is Xcode's
  "+ Capability → Push Notifications", done headlessly.
- **The App ID capability** — `ci/create-signing-assets.mjs` enables
  `PUSH_NOTIFICATIONS` on the App ID *before* creating the provisioning profile,
  so the profile authorises that entitlement. Order matters: a profile is a
  snapshot of the App ID's capabilities when it was created.

## 1. Apple Developer: create an APNs Auth Key (.p8)

This is a **different key** from the App Store Connect API key in `APP_STORE.md`
— that one uploads builds, this one sends pushes. You need both.

1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → **+**.
2. Name it (e.g. "Rally APNs"), enable **Apple Push Notifications service (APNs)**,
   Continue → Register → **Download** the `.p8` (you can only download it once).
3. Note the **Key ID** (10 chars) shown on the key, and your **Team ID**
   (top-right of the portal, 10 chars).

Bundle ID is already `com.danbaldauf.rally`.

## 2. Vercel: add environment variables

Project → Settings → Environment Variables (Production):

| Name | Value |
|------|-------|
| `APNS_KEY_ID` | the 10-char Key ID |
| `APNS_TEAM_ID` | your 10-char Team ID |
| `APNS_BUNDLE_ID` | `com.danbaldauf.rally` |
| `APNS_PRIVATE_KEY` | full contents of the `.p8`, including the `-----BEGIN/END PRIVATE KEY-----` lines |
| `APNS_PRODUCTION` | leave unset or `true`. The CI build ships `aps-environment: production`, so the sandbox host would reject its tokens. |

`FIREBASE_SERVICE_ACCOUNT` is already set (used by the other crons).

Paste the `.p8` with real newlines; the handler also tolerates `\n`-escaped
newlines.

## 3. Rebuild & ship

Repo → **Actions → "iOS → TestFlight" → Run workflow**, then install the build
from TestFlight. On first launch the app asks for notification permission and
registers its token. From the next morning, the badge (and a "You have N people
to reach out to today" nudge) arrives at ~9am ET whether or not the app is open.

## Checking it worked, from the phone

Every registration outcome is written to `users/{uid}.pushStatus`, and the Reach
Out page shows a red banner whenever the state isn't `registered` — so a broken
setup is visible on the device instead of only in a console you can't open on a
TestFlight build.

| `state` | What it means |
|---------|---------------|
| `registered` | Token saved; no banner. The cron can reach this device. |
| `denied` | Permission not granted — iOS Settings → Rally → Notifications. |
| `unavailable` | The plugin isn't in the build. Check the "Generate iOS project" step in the Actions log. |
| `error` | APNs refused registration. The message names the cause; `aps-environment` in it means the entitlement or App ID capability didn't make it into the build. |
| `no-response` | `register()` was called and iOS said nothing for 15s — the AppDelegate forwarding methods are missing. |

## Testing without waiting for the cron

Trigger the function manually once tokens exist and env vars are set:

```bash
curl -X POST https://rally-seven-theta.vercel.app/api/reachout-badge
```

It returns `{ ran, today, sent, total, results }`. `skipped: true` means an env
var is missing. `total: 0` means no device has registered a token yet — check
the banner on the phone. Per-token `reason` (e.g. `BadDeviceToken`) helps debug;
dead tokens are pruned automatically.

`BadDeviceToken` with everything else correct usually means an environment
mismatch: a sandbox token being sent to the production host, or vice versa.

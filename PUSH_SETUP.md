# Reach Out daily badge — push setup

The daily red-dot badge (family + friend outstanding) is updated even when the
app is closed by a morning APNs push. The app code is done; these one-time steps
wire up the credentials and native capability.

## What's already in the code

- `src/hooks/usePushRegistration.js` — registers the device for push and saves its
  APNs token to `users/{uid}.pushTokens` (keyed by token).
- `api/reachout-badge.js` — Vercel cron; computes each user's outstanding count
  (in ET) and pushes the badge via APNs.
- `vercel.json` — cron `/api/reachout-badge` at `0 14 * * *` (~9am ET).
- `package.json` — adds `@capacitor/push-notifications`.

## 1. Install the plugin + sync native

```bash
npm install
npm run cap:sync      # vite build && cap sync ios
```

## 2. Xcode: add the Push Notifications capability

Open `ios/App/App.xcworkspace` → target **App** → **Signing & Capabilities** →
**+ Capability** → **Push Notifications**. (This adds `aps-environment` to the
app's entitlements and updates the provisioning profile.)

Optional, only if you want the silent badge-clear when the count is 0: also add
**Background Modes** → check **Remote notifications**.

## 3. Apple Developer: create an APNs Auth Key (.p8)

1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → **+**.
2. Name it (e.g. "Rally APNs"), enable **Apple Push Notifications service (APNs)**,
   Continue → Register → **Download** the `.p8` (you can only download it once).
3. Note the **Key ID** (10 chars) shown on the key, and your **Team ID**
   (top-right of the portal, 10 chars).

Bundle ID is already `com.danbaldauf.rally`.

## 4. Vercel: add environment variables

Project → Settings → Environment Variables (Production):

| Name | Value |
|------|-------|
| `APNS_KEY_ID` | the 10-char Key ID |
| `APNS_TEAM_ID` | your 10-char Team ID |
| `APNS_BUNDLE_ID` | `com.danbaldauf.rally` |
| `APNS_PRIVATE_KEY` | full contents of the `.p8`, including the `-----BEGIN/END PRIVATE KEY-----` lines |
| `APNS_PRODUCTION` | `true` for TestFlight/App Store builds; set `false` only to test a debug build run from Xcode |

`FIREBASE_SERVICE_ACCOUNT` is already set (used by the other crons).

Paste the `.p8` with real newlines; the handler also tolerates `\n`-escaped
newlines.

## 5. Rebuild & ship

Archive in Xcode → TestFlight/App Store. On first launch after updating, the app
asks for notification permission and registers its token. From the next morning,
the badge (and a "You have N people to reach out to today" nudge) arrives at
~9am ET whether or not the app is open.

## Testing without waiting for the cron

Trigger the function manually once tokens exist and env vars are set:

```bash
curl -X POST https://rally-seven-theta.vercel.app/api/reachout-badge
```

It returns `{ ran, today, sent, total, results }`. `skipped: true` means an env
var is missing. Per-token `reason` (e.g. `BadDeviceToken`) helps debug; dead
tokens are pruned automatically.

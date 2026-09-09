# Rally — working notes

## Git workflow

**Every requested change ships as its own PR.** For each user request that produces code changes:

1. Create a fresh feature branch off the latest `main`. Use `claude/<short-kebab-slug>` for the name — pick a slug that describes the change (e.g. `claude/expense-split-custom`, `claude/event-member-invite`). Note the default branch here is `main`, not `master`.
2. Commit on that branch and push it with `git push -u origin <branch>`.
3. Open the PR. Prefer the GitHub API (`mcp__github__create_pull_request`) when it's available; if it fails, fall back to printing the compare URL: `https://github.com/Dbaldauf147/rally/pull/new/<branch>`.
4. **Merge it yourself** (`mcp__github__merge_pull_request`) once the work is verified — the user asked for this rather than being handed a link each time. Report the merge commit instead. Verification doesn't get lighter for being faster: see below for what it means here. If the branch conflicts or the change turns out riskier than it looked, fix that first rather than merging and explaining afterwards. Still stop and ask on anything destructive or genuinely ambiguous.
5. Don't push directly to `main`. Everything lands through a PR.

Branches stay one-PR-per-change so each fix can be reviewed and merged independently — don't pile unrelated changes onto a previous branch.

## Verifying before you merge

**No CI runs on pull requests here** — the only workflows are the iOS ones, and they fire on a tag or by hand. Nothing will catch a broken build for you, so run all of it yourself:

    npm run build     # vite build
    npm run lint      # eslint .
    npm test          # vitest run

Then **check the actual behaviour**. Chromium and Playwright are available: drive the real page and assert on what you changed, watching `pageerror` as you go.

Two things this app can't prove locally, and the honest move is to say which of them your change touches rather than implying it was exercised:

- **The iOS shell.** Capacitor wraps the same web build, but plugins (contacts, push, browser) only answer on a device.
- **The Wealth Architect contract.** Expenses arrive over `POST /api/split-expenses` with a shared secret; the other app is a separate deployment on a separate Firebase project. If you change that route's request or response shape, you have changed a contract with something not in this repo — say so in the PR.

## Deploys

Vercel builds `main` on every merge: the static site, the `api/` routes and the crons in `vercel.json`. A merged PR is live within a couple of minutes.

What that build does **not** ship:

- `firestore.rules` — released with `firebase deploy --only firestore:rules` (project `rally-bd41a`). A rule written and never published reads, on a fresh load, like a user with no data.
- **The iOS app.** `.github/workflows/ios.yml` runs on a `ios-v*` tag or a manual dispatch, so merging changes the web app and nothing in the App Store. Shipping the app is a deliberate, separate act — don't describe a merge as having released it.

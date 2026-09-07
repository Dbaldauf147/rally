# Rally

Plan events and trips with friends and family. React + Vite on Firebase
(project `rally-bd41a`), with a Capacitor iOS shell.

## Expenses

Charges that need splitting arrive from Wealth Architect — a separate app on a
separate Firebase project — and land in the `expenses` collection. Neither app
holds the other's database credentials; the whole contract between them is
`POST /api/split-expenses`, authenticated with a shared secret that only ever
lives in the two deployments' env vars.

    RALLY_INGEST_SECRET   must match Wealth Architect's copy
    RALLY_OWNER_EMAIL     whose expenses these are (optional)

An expense arrives unassigned. Putting it on an event is what makes it
splittable, because an event is where the people are — participants come from
that event's `members` map. From there the split is even or custom per person,
and people pay you back in as many instalments as they like: settling up is
a log of payments, not a checkbox. Older expenses still carry the checkbox
this replaced, and are read as "paid in full" until a real payment is logged
against that person.

Reminders are sent by an explicit click, never a cron. A ledger that nags
your friends on a schedule without you deciding to is a good way to lose
both.

`src/lib/expenses.js` holds the arithmetic, is pure, and has tests
(`npm test`) — it is the one place here where being subtly wrong costs real
money. It divides in whole
cents rather than dollars: splitting $10 three ways in floats gives shares that
add up to $9.999…, and that missing fraction becomes a balance nobody can ever
settle. Rounding to cents and handing the remainder out one cent at a time
keeps shares summing to exactly the charge, which is what makes "all square"
reachable.

Both surfaces use the same editor (`ExpenseSplitter`): the `/expenses` page
lists every charge with per-person balances, and each event has an Expenses
tab scoped to its own — plus the unassigned ones, so a charge tagged on a phone
can be pulled onto the trip you're already looking at.

### Getting paid

Two ways out, both one-directional, because neither service will tell us when
somebody actually pays.

**Venmo** has no consumer API worth having — it was shut to new developers
years ago and nothing can read your transactions. What still works is a link
that opens the app with the request filled in, so what somebody owes doubles
as a charge button and the reminder email carries the same link. Handles live
on the member row (`members.<key>.venmo`), beside their phone and email.

**Splitwise** does have a real API, and a trip's charges can be pushed into a
Splitwise group with Rally's exact per-person shares. Push only: pulling
settlements back would mean a stored mapping, a cron, and a rule for who wins
when both sides change the same number — a lot of machinery for a second copy
of a ledger that already lives here.

    SPLITWISE_API_KEY   personal key from https://secure.splitwise.com/apps

The key is personal, so every write lands as whoever owns it — which is why
`/api/splitwise` is a server route and not a fetch from the browser. Without
the variable the route answers `{ configured: false }` and the section simply
doesn't appear. People are matched to a Splitwise group by email, except you:
the key's owner is matched by account, since an organiser's own member row
rarely carries an email. Anyone who can't be matched is named rather than
dropped — dropping them would make the shares stop adding up, and Splitwise
answers a bad split with HTTP 200 and an `errors` array, so every response is
read for that rather than trusted on status.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

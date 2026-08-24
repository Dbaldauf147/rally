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
and each person can be ticked off as they pay you back.

`src/lib/expenses.js` holds the arithmetic and is pure. It divides in whole
cents rather than dollars: splitting $10 three ways in floats gives shares that
add up to $9.999…, and that missing fraction becomes a balance nobody can ever
settle. Rounding to cents and handing the remainder out one cent at a time
keeps shares summing to exactly the charge, which is what makes "all square"
reachable.

Both surfaces use the same editor (`ExpenseSplitter`): the `/expenses` page
lists every charge with per-person balances, and each event has an Expenses
tab scoped to its own — plus the unassigned ones, so a charge tagged on a phone
can be pulled onto the trip you're already looking at.

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

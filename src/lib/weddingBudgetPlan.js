/* The wedding budget: who is chipping in, the total that adds up to, how many
   guests it feeds, and how that total is split across line items.

   Stored as one field, `weddingBudgetPlan`, on the owner's user document:

     { v: 3,
       total: number|null,
       guests: { source, count },
       salesTax: { rate },
       contributors: [{ id, name, low, high, note }],
       categories:   [{ id, name, pct, items: [{ id, name, pct, perPlate?, markup? }] }] }

   Most lines are a percentage of the total, and their dollars follow from it.
   Two kinds of line work the other way round:
   - per plate (`perPlate: { price }`): price × the guest count; its % follows
     from its dollars.
   - a markup (`markup: { rate, of: [itemId] }`): rate % of other lines — the
     service charge on food and bar.
   A category with items is the sum of its items; one without items carries
   its own percentage.

   Sales tax sits on top: one rate for the plan, added to every line marked
   `taxed` (a category without items carries its own flag). A line's % and
   amount are before tax; what has to fit in the total is the lines plus
   their tax. */

const FOOD = 'Food (cocktail hour, dinner, vendor meals)';
const BAR = 'Bar and beverages';
const SERVICE = 'Service charge and gratuity';
// Typical catering service charge, and New York City sales tax (Brooklyn).
const SERVICE_RATE = 22;
export const DEFAULT_TAX_RATE = 8.875;
const TAX_RATE = DEFAULT_TAX_RATE;

// Lines a planner, the clerk or the post office charge — no sales tax on them.
const UNTAXED = new Set(['c-planner-or-coordinator', 'c-officiant-and-marriage-license', 'c-contingency', 'i-postage']);

const SEED = [
  ['Venue, catering, bar, rentals', 48, [
    ['Venue site fee', 10],
    [FOOD, 18],
    [BAR, 7],
    [SERVICE, { rate: SERVICE_RATE, of: [FOOD, BAR] }],
    ['Rentals (tables, chairs, linens, china, glassware)', 4],
  ]],
  ['Photography and videography', 12, [
    ['Photographer', 7],
    ['Videographer', 4],
    ['Albums and prints', 1],
  ]],
  ['Music and entertainment', 8, [
    ['Reception band or DJ', 6],
    ['Ceremony and cocktail-hour musicians', 1.5],
    ['Sound equipment and microphones', 0.5],
  ]],
  ['Flowers and decor', 8, [
    ['Reception centerpieces and arrangements', 3.5],
    ['Ceremony flowers (arch, aisle)', 2],
    ['Lighting, candles, other decor', 1.5],
    ['Personal flowers (bouquets, boutonnieres)', 1],
  ]],
  ['Attire and beauty', 7, [
    ['Wedding dress', 3],
    ['Hair and makeup', 1.5],
    ['Alterations', 1],
    ['Suit or tux', 1],
    ['Shoes, veil, accessories', 0.5],
  ]],
  ['Planner or coordinator', 5, []],
  ['Stationery', 3, [
    ['Invitations and reply cards', 1.5],
    ['Save-the-dates', 0.5],
    ['Postage', 0.5],
    ['Day-of paper (programs, menus, signage)', 0.5],
  ]],
  ['Cake or dessert', 2, []],
  ['Transportation', 2, [
    ['Guest shuttles', 1.5],
    ["Couple's car", 0.5],
  ]],
  ['Officiant and marriage license', 1, []],
  ['Contingency', 4, []],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const itemId = (name) => `i-${slug(name)}`;

export function newId(prefix = 'b') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function seedCategories() {
  return SEED.map(([name, pct, items]) => ({
    id: `c-${slug(name)}`,
    name,
    pct,
    taxed: !UNTAXED.has(`c-${slug(name)}`),
    items: items.map(([n, p]) => (typeof p === 'number'
      ? { id: itemId(n), name: n, pct: p, perPlate: null, markup: null, taxed: !UNTAXED.has(itemId(n)) }
      : { id: itemId(n), name: n, pct: 0, perPlate: null, markup: { rate: p.rate, of: p.of.map(itemId) }, taxed: !UNTAXED.has(itemId(n)) })),
  }));
}

// Floating-point percentages (0.1 + 0.2) shouldn't show up as 30.000000004%.
export const roundPct = (n) => Math.round(n * 1000) / 1000;

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const pctOf = (v) => Math.max(0, num(v) ?? 0);
const money = (v) => { const n = num(v); return n == null ? null : Math.max(0, n); };
const str = (v) => (typeof v === 'string' ? v : '');

/* The guest count every per-plate line and the per-person column use, set
   beside the total budget. Linked to the Wedding guest list or typed:
     source 'all'       — everyone on the list (bar hidden guests)
            'attending' — the list less anyone marked Not coming
            'confirmed' — only those marked Confirmed
            'manual'    — `count` as typed */
export const GUEST_SOURCES = ['all', 'attending', 'confirmed', 'manual'];

function normalizeGuests(g) {
  const o = g && typeof g === 'object' ? g : {};
  const count = money(o.count);
  return {
    source: GUEST_SOURCES.includes(o.source) ? o.source : 'all',
    count: count == null ? null : Math.round(count),
  };
}

/* Head counts from the Wedding guest list. Hidden guests are off the list
   for every count, as on the guest page. */
export function guestCounts(contacts) {
  const list = (Array.isArray(contacts) ? contacts : [])
    .filter((c) => c && String(c.category || '').trim().toLowerCase() !== 'hide');
  return {
    all: list.length,
    attending: list.filter((c) => c.status !== 'Not coming').length,
    confirmed: list.filter((c) => c.status === 'Confirmed').length,
  };
}

export function headcount(guests, counts) {
  if (!guests) return 0;
  if (guests.source === 'manual') return guests.count ?? 0;
  return counts?.[guests.source] ?? 0;
}

export function plateAmount(perPlate, guestN) {
  return (perPlate?.price ?? 0) * (guestN || 0);
}

function normalizePerPlate(pp) {
  if (!pp || typeof pp !== 'object') return null;
  return { price: money(pp.price) };
}

function normalizeMarkup(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    rate: pctOf(m.rate),
    of: Array.isArray(m.of) ? [...new Set(m.of.filter((x) => typeof x === 'string' && x))] : [],
  };
}

/* Plans saved before markups had one "Service charge, tax, gratuity" line at
   a flat 9%. Where food and bar sit beside it, it becomes the two computed
   lines the seed now has. Anything renamed or rearranged is left alone. */
function upgradeServiceLine(categories) {
  return categories.map((c) => {
    const idx = c.items.findIndex((i) => !i.markup
      && (i.id === 'i-service-charge-tax-gratuity' || i.name.trim().toLowerCase() === 'service charge, tax, gratuity'));
    if (idx < 0) return c;
    const find = (id, re) => c.items.find((i) => i.id === id) || c.items.find((i) => re.test(i.name));
    const food = find(itemId(FOOD), /^food\b/i);
    const bar = find(itemId(BAR), /^bar\b/i);
    if (!food || !bar) return c;
    const service = { id: itemId(SERVICE), name: SERVICE, pct: 0, perPlate: null, markup: { rate: SERVICE_RATE, of: [food.id, bar.id] } };
    const tax = { id: itemId('Tax'), name: 'Tax', pct: 0, perPlate: null, markup: { rate: TAX_RATE, of: [food.id, bar.id, service.id] } };
    const items = [...c.items];
    items.splice(idx, 1, service, tax);
    return { ...c, items };
  });
}

/* Plans from before the tax column had sales tax as a computed "Tax" line.
   The line goes and its rate becomes the plan's. */
function liftTaxLine(categories) {
  let rate = null;
  const next = categories.map((c) => {
    const items = c.items.filter((i) => {
      const isTax = i.markup && (i.id === itemId('Tax') || i.name.trim().toLowerCase() === 'tax');
      if (isTax && rate == null) rate = i.markup.rate;
      return !isTax;
    });
    return items.length === c.items.length ? c : { ...c, items };
  });
  return { categories: next, rate };
}

export function normalizePlan(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const contributors = Array.isArray(r.contributors) ? r.contributors : [];
  const rawCats = Array.isArray(r.categories) ? r.categories : seedCategories();
  // The guest count used to live on each per-plate line; the first one found
  // becomes the plan's.
  const legacyGuests = !r.guests && rawCats
    .flatMap((c) => (Array.isArray(c?.items) ? c.items : []))
    .find((i) => i?.perPlate?.source)?.perPlate;
  let categories = rawCats.filter((c) => c && typeof c === 'object').map((c) => ({
    id: str(c.id) || newId('c'),
    name: str(c.name),
    pct: pctOf(c.pct),
    taxed: typeof c.taxed === 'boolean' ? c.taxed : !UNTAXED.has(str(c.id)),
    items: (Array.isArray(c.items) ? c.items : []).filter((i) => i && typeof i === 'object').map((i) => {
      const markup = normalizeMarkup(i.markup);
      const id = str(i.id) || newId('i');
      return {
        id,
        name: str(i.name),
        pct: pctOf(i.pct),
        perPlate: markup ? null : normalizePerPlate(i.perPlate),
        markup,
        taxed: typeof i.taxed === 'boolean' ? i.taxed : !UNTAXED.has(id),
      };
    }),
  }));
  const version = num(r.v) ?? 1;
  if (version < 2) categories = upgradeServiceLine(categories);
  let taxRate = r.salesTax && typeof r.salesTax === 'object' ? num(r.salesTax.rate) : null;
  if (version < 3) {
    const lifted = liftTaxLine(categories);
    categories = lifted.categories;
    if (taxRate == null) taxRate = lifted.rate;
  }
  return {
    v: 3,
    total: money(r.total),
    salesTax: { rate: Math.max(0, taxRate ?? DEFAULT_TAX_RATE) },
    guests: normalizeGuests(r.guests || legacyGuests),
    contributors: contributors.filter((c) => c && typeof c === 'object').map((c) => ({
      id: str(c.id) || newId('p'),
      name: str(c.name),
      low: money(c.low),
      high: money(c.high),
      note: str(c.note),
    })),
    categories,
    calculator: normalizeCalculator(r.calculator),
    venueQuotes: normalizeVenueQuotes(r.venueQuotes),
  };
}

/* ── The calculator beside the split ──
   What each line actually costs, typed in (a quote, an invoice), added up to
   the total fee. Kept apart from the % split on purpose: the split is the
   plan, this is the bill. `amounts` is { [line id]: dollars }; a line with
   items is its items, one without is the category itself.

   A line can be priced per person instead of as a flat fee ("$185 a head"):
   `perPerson` is { [line id]: dollars per guest }, and what it comes to is
   that times the guest count, worked out on read (calcDollars) so it follows
   the count as the list changes. A line is in one place only: included, per
   person, or flat. */
function normalizeCalculator(raw) {
  const amounts = {};
  const src = raw && typeof raw === 'object' && raw.amounts && typeof raw.amounts === 'object' ? raw.amounts : {};
  for (const [id, v] of Object.entries(src)) {
    const n = money(v);
    if (id && n != null) amounts[id] = n;
  }
  // Lines a venue's price already covers ("rentals included"): no cost of
  // their own, but answered. An included line carries no amount.
  const included = {};
  const inc = raw && typeof raw === 'object' && raw.included && typeof raw.included === 'object' ? raw.included : {};
  for (const [id, v] of Object.entries(inc)) {
    if (id && v === true) { included[id] = true; delete amounts[id]; }
  }
  const perPerson = {};
  const pp = raw && typeof raw === 'object' && raw.perPerson && typeof raw.perPerson === 'object' ? raw.perPerson : {};
  for (const [id, v] of Object.entries(pp)) {
    const n = money(v);
    if (!id || n == null || included[id]) continue;
    perPerson[id] = n;
    delete amounts[id];
  }
  return { amounts, included, perPerson, subs: normalizeSubs(raw && typeof raw === 'object' ? raw.subs : null) };
}

/* An empty calculator. */
export const emptyCalculator = () => ({ amounts: {}, included: {}, perPerson: {}, subs: {} });

/* ── Sub-items ──
   A calculator line can be broken down: Food into cocktail hour, raw bar,
   dinner. They hang off the line by its id:

     subs: { [line id]: [{ id, name, amount: dollars|null, pp: bool, included: bool }] }

   `pp` makes the amount a price per person. A sub-item is "answered" once it
   has an amount or is marked included. As soon as one is, the line stops
   using its own figure and becomes the sum of its sub-items (or Included,
   when every answered one is). */
function normalizeSubs(raw) {
  const out = {};
  for (const [lineId, list] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!lineId || !Array.isArray(list)) continue;
    const seen = new Set();
    const subs = [];
    for (const x of list) {
      if (!x || typeof x !== 'object') continue;
      const id = str(x.id) || newId('s');
      if (seen.has(id)) continue;
      seen.add(id);
      const included = x.included === true;
      subs.push({ id, name: str(x.name), amount: included ? null : money(x.amount), pp: !included && x.pp === true, included });
    }
    if (subs.length) out[lineId] = subs;
  }
  return out;
}

export const subAnswered = (sub) => !!sub && (sub.included || sub.amount != null);
export const subDollars = (sub, guestN = 0) => (sub?.amount == null || sub.included ? null : sub.pp ? sub.amount * Math.max(0, Number(guestN) || 0) : sub.amount);

/* Does this line take its figure from its sub-items? */
export function lineFromSubs(calc, lineId) {
  return (calc?.subs?.[lineId] || []).some(subAnswered);
}

/* The calculator as the totals read it: every line in dollars and which are
   included — per-person prices multiplied out, and any line with answered
   sub-items replaced by their sum. */
export function effectiveCalc(calc, guestN = 0) {
  const amounts = calcDollars(calc, guestN);
  const included = { ...(calc?.included || {}) };
  for (const [lineId, list] of Object.entries(calc?.subs || {})) {
    const answered = list.filter(subAnswered);
    if (answered.length === 0) continue;
    const priced = answered.filter((x) => !x.included);
    if (priced.length) {
      amounts[lineId] = priced.reduce((sum, x) => sum + subDollars(x, guestN), 0);
      delete included[lineId];
    } else {
      delete amounts[lineId];
      included[lineId] = true;
    }
  }
  return { amounts, included };
}

/* Clearing the calculator for the next venue: every figure goes, but the
   sub-items stay as empty rows, so the same breakdown can be priced again. */
export function clearedCalculator(calc) {
  const subs = {};
  for (const [lineId, list] of Object.entries(normalizeSubs(calc?.subs))) {
    const named = list.filter((x) => x.name.trim()).map((x) => ({ ...x, amount: null, pp: false, included: false }));
    if (named.length) subs[lineId] = named;
  }
  return { ...emptyCalculator(), subs };
}

/* Is anything answered at all — a line, or a sub-item? */
export function calcHasAnswers(calc) {
  return Object.keys(calc?.amounts || {}).length + Object.keys(calc?.included || {}).length + Object.keys(calc?.perPerson || {}).length > 0
    || Object.values(calc?.subs || {}).some((list) => list.some(subAnswered));
}

/* A calculator (or a saved venue) as plain dollars per line: the flat amounts,
   plus each per-person line at its price times the guest count. This is what
   the totals and the comparison add up. */
export function calcDollars(calc, guestN = 0) {
  const out = { ...(calc?.amounts || {}) };
  const n = Math.max(0, Number(guestN) || 0);
  for (const [id, price] of Object.entries(calc?.perPerson || {})) out[id] = price * n;
  return out;
}

/* Switch one line between a flat fee and a per-person price, keeping what it
   comes to: $60,000 flat for 200 guests becomes $300 a person, and back. With
   no guest count there is nothing to divide by, so the number moves as typed. */
export function toggleCalcPerPerson(calc, id, guestN = 0) {
  const c = normalizeCalculator(calc);
  const n = Math.max(0, Number(guestN) || 0);
  const cents = (v) => Math.round(v * 100) / 100;
  if (id in c.perPerson) {
    const price = c.perPerson[id];
    delete c.perPerson[id];
    c.amounts[id] = n > 0 ? cents(price * n) : price;
    return c;
  }
  const flat = c.amounts[id];
  delete c.amounts[id];
  delete c.included[id];
  // No number yet: the line is still switched, waiting for its price.
  c.perPerson[id] = flat == null ? 0 : (n > 0 ? cents(flat / n) : flat);
  return c;
}

/* Is this a food line? One priced per plate in the split, or named like one.
   The calculator and the venue comparison show these per person. */
export function isFoodLine(line) {
  return !!line?.perPlate || /\b(food|cater|catering|dinner|lunch|brunch|meal|meals|plate)\b/i.test(String(line?.name || ''));
}

/* The calculator's lines, in the split's order, grouped by category. */
export function calculatorGroups(categories) {
  return (categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    lines: (c.items.length ? c.items : [c]).map((l) => ({ id: l.id, name: l.name || c.name, taxed: !!l.taxed, food: isFoodLine({ ...l, name: l.name || c.name }) })),
  }));
}

/* Subtotal of what's typed, sales tax on the taxed lines, and the total fee.
   Amounts for lines that no longer exist don't count. A line marked included
   is answered at no cost. `food` is the food lines' dollars before tax, and
   `foodLines` how many of them have a price. */
export function calculatorTotals(categories, amounts, rate, included = {}) {
  let subtotal = 0;
  let tax = 0;
  let filled = 0;
  let lines = 0;
  let food = 0;
  let foodLines = 0;
  let includedLines = 0;
  for (const g of calculatorGroups(categories)) {
    for (const l of g.lines) {
      lines += 1;
      if (included?.[l.id]) { filled += 1; includedLines += 1; continue; }
      const v = amounts?.[l.id];
      if (v == null) continue;
      filled += 1;
      subtotal += v;
      if (l.food) { food += v; foodLines += 1; }
      if (l.taxed) tax += (v * (rate || 0)) / 100;
    }
  }
  return { subtotal, tax, total: subtotal + tax, filled, lines, food, foodLines, included: includedLines };
}

/* The same sums per category: what's typed on its lines, their sales tax, and
   how many are answered. One entry per category, in the split's order. */
export function calculatorGroupTotals(categories, amounts, rate, included = {}) {
  return calculatorGroups(categories).map((g) => {
    let subtotal = 0;
    let tax = 0;
    let filled = 0;
    let priced = 0;
    for (const l of g.lines) {
      if (included?.[l.id]) { filled += 1; continue; }
      const v = amounts?.[l.id];
      if (v == null) continue;
      filled += 1;
      priced += 1;
      subtotal += v;
      if (l.taxed) tax += (v * (rate || 0)) / 100;
    }
    return { id: g.id, name: g.name, subtotal, tax, total: subtotal + tax, filled, priced, lines: g.lines.length };
  });
}

/* The category that is the venue's own bill — site fee, catering, bar,
   rentals: the first one named for the venue. Null when there isn't one. */
export function venueGroupOf(groups) {
  return (groups || []).find((g) => /\bvenue\b/i.test(String(g.name || ''))) || null;
}

/* Fill in every markup's % from the lines it's charged on. Markups can be
   charged on other markups (tax on the service charge), so they settle in
   dependency order; one caught in a loop counts as 0%. A line it names that
   no longer exists is skipped. */
export function resolveMarkups(categories) {
  const all = new Map();
  for (const c of categories) for (const i of c.items) all.set(i.id, i);
  const pct = new Map();
  for (const [id, i] of all) if (!i.markup) pct.set(id, i.pct);
  let pending = [...all.values()].filter((i) => i.markup);
  for (let pass = 0; pending.length && pass <= all.size; pass += 1) {
    const next = [];
    for (const m of pending) {
      const bases = m.markup.of.filter((id) => all.has(id) && id !== m.id);
      if (bases.every((id) => pct.has(id))) {
        pct.set(m.id, roundPct((m.markup.rate / 100) * bases.reduce((s, id) => s + pct.get(id), 0)));
      } else next.push(m);
    }
    if (next.length === pending.length) break; // a loop: nothing more settles
    pending = next;
  }
  return categories.map((c) => (c.items.some((i) => i.markup)
    ? { ...c, items: c.items.map((i) => (i.markup ? { ...i, pct: pct.get(i.id) ?? 0, derived: true } : i)) }
    : c));
}

/* The split with every computed line's % filled in, so sums, category totals
   and scaling can treat all lines alike. Per-plate lines are marked `fixed`
   (their dollars come from price × guests, not from the total), markups
   `derived` (they follow whatever they're charged on). */
export function resolveCategories(categories, total, guestN) {
  const plated = categories.map((c) => (c.items.some((i) => i.perPlate)
    ? {
      ...c,
      items: c.items.map((i) => (i.perPlate
        ? { ...i, pct: total > 0 ? roundPct((plateAmount(i.perPlate, guestN) / total) * 100) : 0, fixed: true }
        : i)),
    }
    : c));
  return resolveMarkups(plated);
}

export function categoryPct(cat) {
  if (!cat.items.length) return cat.pct;
  return roundPct(cat.items.reduce((s, i) => s + i.pct, 0));
}

export function totalPct(categories) {
  return roundPct(categories.reduce((s, c) => s + categoryPct(c), 0));
}

/* Sales tax, in the same % of total units as the lines. */
export const lineTaxPct = (pct, taxed, rate) => (taxed ? (pct * rate) / 100 : 0);

export function categoryTaxPct(cat, rate) {
  if (!cat.items.length) return roundPct(lineTaxPct(cat.pct, cat.taxed, rate));
  return roundPct(cat.items.reduce((s, i) => s + lineTaxPct(i.pct, i.taxed, rate), 0));
}

export function totalTaxPct(categories, rate) {
  return roundPct(categories.reduce((s, c) => s + categoryTaxPct(c, rate), 0));
}

/* Lines plus their tax: what has to fit inside the total budget. */
export function grossPct(categories, rate) {
  return roundPct(totalPct(categories) + totalTaxPct(categories, rate));
}

/* What everyone can give. A person with only one end of the range filled in
   counts that number at both ends. */
export function contributorTotals(contributors) {
  let low = 0;
  let high = 0;
  let counted = 0;
  for (const c of contributors) {
    const lo = c.low ?? c.high;
    const hi = c.high ?? c.low;
    if (lo == null) continue;
    counted += 1;
    low += Math.min(lo, hi);
    high += Math.max(lo, hi);
  }
  return { low, high, mid: (low + high) / 2, counted };
}

/* The number the line items are split from: the total you typed, or — until
   you type one — the middle of what people said they can give. */
export function effectiveTotal(plan) {
  if (plan.total != null) return { amount: plan.total, source: 'set' };
  const t = contributorTotals(plan.contributors);
  if (t.counted) return { amount: t.mid, source: 'contributors' };
  return { amount: 0, source: 'none' };
}

export const amountFor = (pct, total) => (total * pct) / 100;

export function pctFromAmount(amount, total) {
  if (!(total > 0)) return null;
  return roundPct((Math.max(0, amount) / total) * 100);
}

/* Scaling. Only "free" lines — plain percentages — are multiplied; per-plate
   lines hold still and markups are recomputed from their (scaled) bases.
   Everything is linear in the factor, so the sum at factor 0 and factor 1
   gives the exact factor for any target. */
const isFree = (i) => !i.fixed && !i.derived;

function scaleFree(categories, f, inCat = null) {
  return resolveMarkups(categories.map((c) => {
    if (inCat && c.id !== inCat) return c;
    if (!c.items.length) return inCat ? c : { ...c, pct: roundPct(c.pct * f) };
    return { ...c, items: c.items.map((i) => (isFree(i) ? { ...i, pct: roundPct(i.pct * f) } : i)) };
  }));
}

function solveFactor(sumAt, target) {
  const a = sumAt(0);
  const b = sumAt(1) - a;
  if (!(b > 0)) return null;
  return Math.max(0, (target - a) / b);
}

// Rounding leaves a few thousandths over or under; put them on the largest
// free line — preferably one no markup is charged on, so the fix doesn't
// ripple (and a couple of passes for when there's no such line).
function settleDrift(categories, sumOf, target, inCat = null, rate = 0) {
  const charged = new Set(categories.flatMap((c) => c.items.flatMap((i) => i.markup?.of || [])));
  let next = categories;
  for (let k = 0; k < 3; k += 1) {
    const drift = roundPct(target - sumOf(next));
    if (drift === 0) break;
    let best = null;
    const better = (pct, ripples) => !best || (best.ripples && !ripples) || (best.ripples === ripples && pct > best.pct);
    next.forEach((c, ci) => {
      if (inCat && c.id !== inCat) return;
      if (c.items.length) {
        c.items.forEach((i, ii) => {
          if (isFree(i) && better(i.pct, charged.has(i.id))) best = { ci, ii, pct: i.pct, ripples: charged.has(i.id) };
        });
      } else if (!inCat && better(c.pct, false)) best = { ci, ii: -1, pct: c.pct, ripples: false };
    });
    if (!best) break;
    // A taxed line moves the sum by its tax too.
    const line = best.ii < 0 ? next[best.ci] : next[best.ci].items[best.ii];
    const d = drift / (1 + (line.taxed ? rate / 100 : 0));
    next = resolveMarkups(next.map((c, ci) => {
      if (ci !== best.ci) return c;
      if (best.ii < 0) return { ...c, pct: roundPct(Math.max(0, c.pct + d)) };
      return { ...c, items: c.items.map((i, ii) => (ii === best.ii ? { ...i, pct: roundPct(Math.max(0, i.pct + d)) } : i)) };
    }));
  }
  return next;
}

/* Set one category's share (on a resolved split). One with items rescales its
   plain items so they keep their proportions — or splits evenly when they're
   all 0% — while its per-plate lines hold and its markups follow. */
export function setCategoryPct(categories, catId, pct) {
  const target = Math.max(0, pct);
  const cat = categories.find((c) => c.id === catId);
  if (!cat) return categories;
  if (!cat.items.length) return categories.map((c) => (c.id === catId ? { ...c, pct: roundPct(target) } : c));
  let cats = categories;
  const free = cat.items.filter(isFree);
  if (!free.length) return categories;
  if (free.every((i) => i.pct === 0)) {
    cats = resolveMarkups(cats.map((c) => (c.id === catId ? { ...c, items: c.items.map((i) => (isFree(i) ? { ...i, pct: 1 } : i)) } : c)));
  }
  const catSum = (cs) => categoryPct(cs.find((c) => c.id === catId));
  const f = solveFactor((x) => catSum(scaleFree(cats, x, catId)), target);
  if (f == null) return categories;
  return settleDrift(scaleFree(cats, f, catId), catSum, Math.max(target, catSum(scaleFree(cats, 0, catId))), catId);
}

/* Rescale the plain lines so the whole split — sales tax included — adds to
   exactly 100%. */
export function scaleTo100(categories, taxRate = 0) {
  const sum = (cs) => grossPct(cs, taxRate);
  const f = solveFactor((x) => sum(scaleFree(categories, x)), 100);
  if (f == null) return categories;
  const floor = sum(scaleFree(categories, 0));
  return settleDrift(scaleFree(categories, f), sum, Math.max(100, floor), null, taxRate);
}

/* "$40,000", "40k", "1.2m", "40000" → number. Blank → null. */
export function parseMoney(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/[$,\s]/g, '');
  if (!s) return null;
  const m = s.match(/^(\d*\.?\d+)([km]?)$/);
  if (!m) return null;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1;
  return Math.round(parseFloat(m[1]) * mult * 100) / 100;
}

export function parsePct(text) {
  const s = String(text ?? '').trim().replace(/[%\s]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? roundPct(n) : null;
}

export function formatMoney(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return `${Math.round(n * 100) / 100}%`;
}

// A rate like a sales tax needs its third decimal (8.875%).
export function formatRate(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return `${Math.round(n * 1000) / 1000}%`;
}

/* ── Venue pricing ──
   The calculator's amounts, saved under a venue's name so several venues can
   be held side by side (Budget → Venue cost comparison):

     venueQuotes: [{ id, name, amounts: { [line id]: dollars }, included, perPerson, savedAt }]

   Amounts are keyed by budget line, like the calculator's, so every venue is
   priced against the same lines and the same sales-tax ticks. */
function normalizeVenueQuotes(raw) {
  const seen = new Set();
  const out = [];
  for (const q of Array.isArray(raw) ? raw : []) {
    if (!q || typeof q !== 'object') continue;
    const name = str(q.name).trim();
    const id = str(q.id) || newId('v');
    if (!name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, ...normalizeCalculator(q), savedAt: str(q.savedAt) });
  }
  return out;
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export function findVenueQuote(quotes, name) {
  return (quotes || []).find((q) => sameName(q.name, name)) || null;
}

/* Save the amounts under a venue's name: a venue already saved (same name,
   whatever the capitals) is updated in place, a new one goes on the end. */
export function saveVenueQuote(quotes, name, calc, now = new Date()) {
  const clean = String(name || '').trim();
  if (!clean) return quotes || [];
  // `calc` is the calculator ({ amounts, included, perPerson }); a bare amounts map is taken as one.
  const whole = calc && typeof calc.amounts === 'object' && calc.amounts !== null ? calc : { amounts: calc };
  const entry = { name: clean, ...normalizeCalculator(whole), savedAt: now.toISOString() };
  const existing = findVenueQuote(quotes, clean);
  if (existing) return quotes.map((q) => (q.id === existing.id ? { ...q, ...entry } : q));
  return [...(quotes || []), { id: newId('v'), ...entry }];
}

/* True when the calculator holds exactly what a saved venue holds — nothing
   would be lost by loading another one over it. */
export function sameAmounts(a, b) {
  const x = normalizeCalculator({ amounts: a }).amounts;
  const y = normalizeCalculator({ amounts: b }).amounts;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => x[k] === y[k]);
}

/* The same, for a whole calculator or saved venue: amounts, included lines
   and per-person prices. */
export function sameCalc(a, b) {
  const x = normalizeCalculator(a);
  const y = normalizeCalculator(b);
  const inc = new Set([...Object.keys(x.included), ...Object.keys(y.included)]);
  const pp = new Set([...Object.keys(x.perPerson), ...Object.keys(y.perPerson)]);
  return sameAmounts(x.amounts, y.amounts)
    && [...inc].every((k) => !!x.included[k] === !!y.included[k])
    && [...pp].every((k) => x.perPerson[k] === y.perPerson[k])
    && JSON.stringify(answeredSubs(x.subs)) === JSON.stringify(answeredSubs(y.subs));
}

// Sub-items that say something, in a form two calculators can be compared by:
// empty rows and ids don't make a venue different.
function answeredSubs(subs) {
  return Object.keys(subs).sort().map((lineId) => [lineId, subs[lineId].filter(subAnswered).map((x) => [x.name.trim(), x.amount, x.pp, x.included])])
    .filter(([, list]) => list.length);
}

/* The comparison table. `categories` are the resolved split, `budget` the
   total budget (0 when none is set), `guestN` the guest count.

   rows:   the budget lines at least one venue has a price for, in the split's
           order — { kind: 'category' | 'line', id, name, budgeted, amounts: [n|null per venue],
           included: [bool per venue], perPerson: [price|null per venue], low }
           amounts are dollars; a line a venue prices per person is its price × the guests
           where `low` is the index of the cheapest venue on that line (null on a tie or with
           one price); a line a venue includes counts as $0 there
   venues: per venue { id, name, savedAt, subtotal, tax, total, filled, perPerson, diff,
           food, foodPerPerson } — diff is budget − total (null with no budget); foodPerPerson
           is the food lines before tax over the guests (null with none priced)
   cheapest: id of the venue with the lowest total among those with any price */
export function venueComparison(categories, quotes, rate, budget = 0, guestN = 0) {
  const list = quotes || [];
  // Each venue's lines in dollars — per-person prices multiplied out, lines
  // with sub-items summed — and which lines it includes.
  const effs = list.map((q) => effectiveCalc(q, guestN));
  const dollars = effs.map((e) => e.amounts);
  const inc = effs.map((e) => e.included);
  const subKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const rows = [];
  for (const g of calculatorGroups(categories)) {
    const lines = g.lines.filter((l) => list.some((q, i) => dollars[i][l.id] != null || inc[i][l.id]));
    if (lines.length === 0) continue;
    const byId = new Map((categories.find((c) => c.id === g.id)?.items || []).map((i) => [i.id, i]));
    const cat = categories.find((c) => c.id === g.id);
    const standalone = g.lines.length === 1 && g.lines[0].id === g.id;
    if (!standalone) rows.push({ kind: 'category', id: `cat-${g.id}`, name: g.name || 'Untitled' });
    for (const l of lines) {
      const included = list.map((q, i) => !!inc[i][l.id]);
      const amounts = list.map((q, i) => (included[i] || dollars[i][l.id] == null ? null : dollars[i][l.id]));
      const perPerson = list.map((q, i) => (!included[i] && !lineFromSubs(q, l.id) && q.perPerson?.[l.id] != null ? q.perPerson[l.id] : null));
      const priced = amounts.map((v, i) => [included[i] ? 0 : v, i]).filter(([v]) => v != null);
      const min = Math.min(...priced.map(([v]) => v));
      const lows = priced.filter(([v]) => v === min);
      const pct = standalone ? cat.pct : (byId.get(l.id)?.pct ?? 0);
      rows.push({
        kind: 'line', id: l.id, name: l.name || 'Untitled', taxed: l.taxed, food: l.food, standalone,
        budgeted: budget > 0 ? amountFor(pct, budget) : null,
        amounts,
        included,
        perPerson,
        low: priced.length > 1 && lows.length === 1 ? lows[0][1] : null,
      });
      // The line's sub-items, under it: one row per name, whichever venues have it.
      const names = new Map();
      for (const q of list) {
        for (const x of q.subs?.[l.id] || []) {
          if (subAnswered(x) && subKey(x.name) && !names.has(subKey(x.name))) names.set(subKey(x.name), x.name.trim());
        }
      }
      for (const [key, name] of names) {
        const found = list.map((q) => (q.subs?.[l.id] || []).find((x) => subAnswered(x) && subKey(x.name) === key) || null);
        const subIncluded = found.map((x) => !!x?.included);
        const subAmounts = found.map((x) => subDollars(x, guestN));
        const subPriced = subAmounts.map((v, i) => [subIncluded[i] ? 0 : v, i]).filter(([v]) => v != null);
        const subMin = Math.min(...subPriced.map(([v]) => v));
        const subLows = subPriced.filter(([v]) => v === subMin);
        rows.push({
          kind: 'sub', id: `${l.id}:${key}`, name,
          amounts: subAmounts,
          included: subIncluded,
          perPerson: found.map((x) => (x && !x.included && x.pp ? x.amount : null)),
          low: subPriced.length > 1 && subLows.length === 1 ? subLows[0][1] : null,
        });
      }
    }
  }
  const venues = list.map((q, qi) => {
    const t = calculatorTotals(categories, dollars[qi], rate, inc[qi]);
    return {
      id: q.id, name: q.name, savedAt: q.savedAt, ...t,
      foodPerPerson: guestN > 0 && t.foodLines > 0 ? t.food / guestN : null,
      venuePerPerson: (() => {
        const g = venueGroupOf(calculatorGroupTotals(categories, dollars[qi], rate, inc[qi]));
        return g && g.priced > 0 && guestN > 0 ? { name: g.name, subtotal: g.subtotal / guestN, total: g.total / guestN } : null;
      })(),
      perPerson: guestN > 0 && t.filled > 0 ? t.total / guestN : null,
      diff: budget > 0 && t.filled > 0 ? budget - t.total : null,
    };
  });
  const priced = venues.filter((v) => v.filled > 0);
  const min = Math.min(...priced.map((v) => v.total));
  const lowest = priced.filter((v) => v.total === min);
  return { rows, venues, cheapest: priced.length > 1 && lowest.length === 1 ? lowest[0].id : null };
}

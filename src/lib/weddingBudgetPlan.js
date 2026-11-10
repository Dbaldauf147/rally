/* The wedding budget: who is chipping in, the total that adds up to, how many
   guests it feeds, and how that total is split across line items.

   Stored as one field, `weddingBudgetPlan`, on the owner's user document:

     { v: 2,
       total: number|null,
       guests: { source, count },
       contributors: [{ id, name, low, high, note }],
       categories:   [{ id, name, pct, items: [{ id, name, pct, perPlate?, markup? }] }] }

   Most lines are a percentage of the total, and their dollars follow from it.
   Two kinds of line work the other way round:
   - per plate (`perPlate: { price }`): price × the guest count; its % follows
     from its dollars.
   - a markup (`markup: { rate, of: [itemId] }`): rate % of other lines — the
     service charge on food and bar, the tax on those plus the service charge.
   A category with items is the sum of its items; one without items carries
   its own percentage. */

const FOOD = 'Food (cocktail hour, dinner, vendor meals)';
const BAR = 'Bar and beverages';
const SERVICE = 'Service charge and gratuity';
// Typical catering service charge, and New York City sales tax (Brooklyn).
const SERVICE_RATE = 22;
const TAX_RATE = 8.875;

const SEED = [
  ['Venue, catering, bar, rentals', 48, [
    ['Venue site fee', 10],
    [FOOD, 18],
    [BAR, 7],
    [SERVICE, { rate: SERVICE_RATE, of: [FOOD, BAR] }],
    ['Tax', { rate: TAX_RATE, of: [FOOD, BAR, SERVICE] }],
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
    items: items.map(([n, p]) => (typeof p === 'number'
      ? { id: itemId(n), name: n, pct: p, perPlate: null, markup: null }
      : { id: itemId(n), name: n, pct: 0, perPlate: null, markup: { rate: p.rate, of: p.of.map(itemId) } })),
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
    items: (Array.isArray(c.items) ? c.items : []).filter((i) => i && typeof i === 'object').map((i) => {
      const markup = normalizeMarkup(i.markup);
      return {
        id: str(i.id) || newId('i'),
        name: str(i.name),
        pct: pctOf(i.pct),
        perPlate: markup ? null : normalizePerPlate(i.perPlate),
        markup,
      };
    }),
  }));
  if ((num(r.v) ?? 1) < 2) categories = upgradeServiceLine(categories);
  return {
    v: 2,
    total: money(r.total),
    guests: normalizeGuests(r.guests || legacyGuests),
    contributors: contributors.filter((c) => c && typeof c === 'object').map((c) => ({
      id: str(c.id) || newId('p'),
      name: str(c.name),
      low: money(c.low),
      high: money(c.high),
      note: str(c.note),
    })),
    categories,
  };
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
function settleDrift(categories, sumOf, target, inCat = null) {
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
    next = resolveMarkups(next.map((c, ci) => {
      if (ci !== best.ci) return c;
      if (best.ii < 0) return { ...c, pct: roundPct(Math.max(0, c.pct + drift)) };
      return { ...c, items: c.items.map((i, ii) => (ii === best.ii ? { ...i, pct: roundPct(Math.max(0, i.pct + drift)) } : i)) };
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

/* Rescale the plain lines so the whole split adds to exactly 100%. */
export function scaleTo100(categories) {
  const f = solveFactor((x) => totalPct(scaleFree(categories, x)), 100);
  if (f == null) return categories;
  const floor = totalPct(scaleFree(categories, 0));
  return settleDrift(scaleFree(categories, f), totalPct, Math.max(100, floor));
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

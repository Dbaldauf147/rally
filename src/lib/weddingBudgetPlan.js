/* The wedding budget: who is chipping in, the total that adds up to, and how
   that total is split across line items by percentage.

   Stored as one field, `weddingBudgetPlan`, on the owner's user document:

     { total: number|null,
       contributors: [{ id, name, low, high, note }],
       categories:   [{ id, name, pct, items: [{ id, name, pct }] }] }

   Percentages are the source of truth and dollar amounts are derived from
   them, so changing the total moves every line. A category with items is the
   sum of its items; one without items carries its own percentage. */

const SEED = [
  ['Venue, catering, bar, rentals', 48, [
    ['Venue site fee', 10],
    ['Food (cocktail hour, dinner, vendor meals)', 18],
    ['Bar and beverages', 7],
    ['Service charge, tax, gratuity', 9],
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

export function newId(prefix = 'b') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function seedCategories() {
  return SEED.map(([name, pct, items]) => ({
    id: `c-${slug(name)}`,
    name,
    pct,
    items: items.map(([n, p]) => ({ id: `i-${slug(n)}`, name: n, pct: p })),
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

export function normalizePlan(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const contributors = Array.isArray(r.contributors) ? r.contributors : [];
  const categories = Array.isArray(r.categories) ? r.categories : seedCategories();
  return {
    total: money(r.total),
    contributors: contributors.filter((c) => c && typeof c === 'object').map((c) => ({
      id: str(c.id) || newId('p'),
      name: str(c.name),
      low: money(c.low),
      high: money(c.high),
      note: str(c.note),
    })),
    categories: categories.filter((c) => c && typeof c === 'object').map((c) => ({
      id: str(c.id) || newId('c'),
      name: str(c.name),
      pct: pctOf(c.pct),
      items: (Array.isArray(c.items) ? c.items : []).filter((i) => i && typeof i === 'object').map((i) => ({
        id: str(i.id) || newId('i'),
        name: str(i.name),
        pct: pctOf(i.pct),
      })),
    })),
  };
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

/* Setting a whole category's share: one with items rescales them so they keep
   their proportions to each other (or splits evenly when they're all 0%). */
export function setCategoryPct(cat, pct) {
  const target = Math.max(0, pct);
  if (!cat.items.length) return { ...cat, pct: roundPct(target) };
  const current = categoryPct(cat);
  const items = cat.items.map((i) => ({
    ...i,
    pct: roundPct(current > 0 ? (i.pct / current) * target : target / cat.items.length),
  }));
  return { ...cat, items };
}

/* Rescale every line so the split adds to exactly 100%. Rounding drift lands
   on the largest line so the sum is exact. */
export function scaleTo100(categories) {
  const sum = totalPct(categories);
  if (!(sum > 0)) return categories;
  const f = 100 / sum;
  const next = categories.map((c) => (c.items.length
    ? { ...c, items: c.items.map((i) => ({ ...i, pct: roundPct(i.pct * f) })) }
    : { ...c, pct: roundPct(c.pct * f) }));
  const drift = roundPct(100 - totalPct(next));
  if (drift === 0) return next;
  let best = null;
  next.forEach((c, ci) => {
    if (c.items.length) c.items.forEach((i, ii) => { if (!best || i.pct > best.pct) best = { ci, ii, pct: i.pct }; });
    else if (!best || c.pct > best.pct) best = { ci, ii: -1, pct: c.pct };
  });
  return next.map((c, ci) => {
    if (ci !== best.ci) return c;
    if (best.ii < 0) return { ...c, pct: roundPct(c.pct + drift) };
    return { ...c, items: c.items.map((i, ii) => (ii === best.ii ? { ...i, pct: roundPct(i.pct + drift) } : i)) };
  });
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

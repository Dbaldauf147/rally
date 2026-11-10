/* Wedding → Venues → Dream venue: what the venue has to be, as a checklist
   of categories and items you tick off, reword, add to and remove.

   Kept on the user doc as `weddingDreamVenue: { categories: [...] }`. Until
   it's first edited there is nothing stored and the list below is shown, so
   an untouched account always sees the current starting list.

   Ids are explicit, not positions, so rewording or reordering never moves a
   tick onto the wrong item. Pure, for testing without React. */

const C = (id, title, items) => ({ id, title, items: items.map(([iid, t, detail]) => ({ id: iid, title: t, detail, done: false })) });

export const SEED_CATEGORIES = [
  C('service', 'Service model', [
    ['all-inclusive', 'All-inclusive', 'Catering halls, country clubs, hotels, and restaurants provide food, bar, staff, tables, and linens under one per-person price. This is the dominant model on Long Island, and it is the easiest to budget and plan.'],
    ['raw-space', 'Raw or semi-raw space', 'Lofts, museums, estates, barns, and parks charge a site fee, and you bring in the caterer, rentals, and sometimes power and restrooms. It offers more creative control, but costs are less predictable and a planner is close to essential.'],
  ]),
  C('capacity', 'Capacity and layout', [
    ['guest-count', 'Guest count', 'Check the seated-dinner capacity with a dance floor, not the standing capacity. A room that is too large for your count feels empty.'],
    ['flow', 'Flow', 'Look for distinct spaces for the ceremony, cocktail hour, and reception, or ask how the room is “flipped” between them.'],
    ['exclusivity', 'Exclusivity', 'Some halls run several weddings at once, so ask whether you would share entrances, restrooms, or photo spots.'],
  ]),
  C('ceremony', 'Ceremony and weather', [
    ['on-site', 'Ceremony on site', 'Decide whether you want the ceremony at the venue or at a house of worship, which adds travel and timing.'],
    ['rain', 'Rain plan', 'For anything outdoors, see the indoor backup in person and decide whether you’d be happy with it.'],
    ['season', 'Season', 'Check heating, air conditioning, and how the space looks in your month.'],
  ]),
  C('logistics', 'Location and logistics', [
    ['travel', 'Travel', 'Consider the distance for most guests, parking or valet, and transit access. In the city, think about a venue’s load-in rules and elevator access.'],
    ['lodging', 'Lodging', 'Out-of-town guests need hotels nearby, and a venue far from them may require shuttles.'],
    ['accessibility', 'Accessibility', 'Check for step-free access and accessible restrooms for older or disabled guests.'],
  ]),
  C('rules', 'Rules and restrictions', [
    ['timing', 'Timing', 'Ask about the end time, noise curfews, how many hours are included, and overtime rates.'],
    ['vendors', 'Vendors', 'Some venues require you to use their caterer or an approved vendor list.'],
    ['limits', 'Other limits', 'Ask about restrictions on candles, decor, amplified music, and outside alcohol.'],
  ]),
  C('cost', 'Cost structure', [
    ['pricing', 'Pricing terms', 'Compare the all-in per-person price, any site fee, and the food-and-beverage minimum.'],
    ['date-flex', 'Date flexibility', 'Fridays, Sundays, and off-season months (roughly November through April) are often priced well below peak Saturdays.'],
    ['contract', 'Contract terms', 'Look at the deposit schedule, the cancellation and postponement policy, and when the final headcount is due.'],
  ]),
  C('feel', 'Feel and extras', [
    ['style', 'Style', 'Decide whether you want a ballroom, waterfront, garden, industrial, or historic setting, and whether the space needs much decoration to look good.'],
    ['photos', 'Photos', 'Look for good portrait spots on site, especially if the weather turns.'],
    ['amenities', 'Amenities', 'A bridal suite, a getting-ready room, and an on-site coordinator all make the day easier.'],
  ]),
];

const str = (v) => (typeof v === 'string' ? v : '');

export function newDreamId(prefix = 'd') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* The stored list, cleaned: missing ids filled, duplicate ids renamed, odd
   values dropped. Nothing stored → the starting list. An empty stored list
   stays empty (you deleted everything; that's yours to keep). */
export function normalizeDreamVenue(raw) {
  const cats = Array.isArray(raw?.categories) ? raw.categories : null;
  if (!cats) return SEED_CATEGORIES.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) }));
  const seen = new Set();
  const uniq = (id, prefix) => {
    let out = str(id).trim() || newDreamId(prefix);
    while (seen.has(out)) out = newDreamId(prefix);
    seen.add(out);
    return out;
  };
  return cats.filter((c) => c && typeof c === 'object').map((c) => ({
    id: uniq(c.id, 'cat'),
    title: str(c.title),
    items: (Array.isArray(c.items) ? c.items : []).filter((i) => i && typeof i === 'object').map((i) => ({
      id: uniq(i.id, 'item'),
      title: str(i.title),
      detail: str(i.detail),
      done: i.done === true,
    })),
  }));
}

const mapCat = (cats, catId, fn) => cats.map((c) => (c.id === catId ? fn(c) : c));
const mapItem = (cats, catId, itemId, fn) => mapCat(cats, catId, (c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? fn(i) : i)) }));
const move = (list, id, dir) => {
  const at = list.findIndex((x) => x.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
};

export const toggleItem = (cats, catId, itemId) => mapItem(cats, catId, itemId, (i) => ({ ...i, done: !i.done }));
export const editItem = (cats, catId, itemId, patch) => mapItem(cats, catId, itemId, (i) => ({ ...i, ...patch }));
export const removeItem = (cats, catId, itemId) => mapCat(cats, catId, (c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) }));
export const moveItem = (cats, catId, itemId, dir) => mapCat(cats, catId, (c) => ({ ...c, items: move(c.items, itemId, dir) }));
export function addItem(cats, catId, { title = '', detail = '' } = {}, id = newDreamId('item')) {
  return { cats: mapCat(cats, catId, (c) => ({ ...c, items: [...c.items, { id, title, detail, done: false }] })), id };
}

export const renameCategory = (cats, catId, title) => mapCat(cats, catId, (c) => ({ ...c, title }));
export const removeCategory = (cats, catId) => cats.filter((c) => c.id !== catId);
export const moveCategory = (cats, catId, dir) => move(cats, catId, dir);
export function addCategory(cats, title = '', id = newDreamId('cat')) {
  return { cats: [...cats, { id, title, items: [] }], id };
}
// Every item in a category ticked, or every one unticked if they all were.
export const toggleCategory = (cats, catId) => mapCat(cats, catId, (c) => {
  const all = c.items.length > 0 && c.items.every((i) => i.done);
  return { ...c, items: c.items.map((i) => ({ ...i, done: !all })) };
});

export function dreamProgress(cats) {
  let done = 0;
  let total = 0;
  for (const c of cats || []) for (const i of c.items) { total += 1; if (i.done) done += 1; }
  return { done, total };
}

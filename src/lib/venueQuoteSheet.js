/* Budget → Venue cost comparison, many venues at a time: a spreadsheet with
   one row per venue and one column per budget line, written out and read
   back in.

   A cell is one of:
     12000 / $12,000 / 12k   a flat fee for that line
     $250 pp / 250 per person / 250/guest   a price per guest
     Included                 covered by another line's price
     (blank)                  not priced — on a venue already saved, left as it is

   The download holds the venues already saved, so it doubles as an export:
   edit it and import it again. A line whose cell still reads what the
   download wrote is left alone, so a line priced from sub-items keeps them.
   Pure, so it can be tested without React. */

import { calculatorGroups, effectiveCalc, findVenueQuote, formatMoney, lineFromSubs, parseMoney, saveVenueQuote } from './weddingBudgetPlan.js';

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/* The sheet's line columns: { id, label, category }. A line's own name, with
   its category in front only where two lines share a name. */
export function quoteSheetLines(categories) {
  const lines = calculatorGroups(categories).flatMap((g) => g.lines.map((l) => ({ id: l.id, name: l.name || 'Untitled', category: g.name || 'Untitled' })));
  const count = new Map();
  for (const l of lines) count.set(norm(l.name), (count.get(norm(l.name)) || 0) + 1);
  return lines.map((l) => ({ id: l.id, category: l.category, label: count.get(norm(l.name)) > 1 ? `${l.category}: ${l.name}` : l.name }));
}

// What the sheet shows for one saved venue on one line.
function quoteCell(q, lineId) {
  if (lineFromSubs(q, lineId)) {
    const e = effectiveCalc(q, 0);
    if (e.included[lineId]) return 'Included';
    // Sub-items priced per person can't be summed without a guest count; the
    // flat ones are written, and the cell matching it means "leave it".
    const subs = q.subs[lineId].filter((x) => !x.included && x.amount != null);
    if (subs.some((x) => x.pp)) return '';
    return formatMoney(subs.reduce((s, x) => s + x.amount, 0)) || '$0';
  }
  if (q.included?.[lineId]) return 'Included';
  if (q.perPerson?.[lineId] != null) return `${formatMoney(q.perPerson[lineId]) || '$0'} per person`;
  if (q.amounts?.[lineId] != null) return formatMoney(q.amounts[lineId]) || '$0';
  return '';
}

/* The workbook as rows: the Venues sheet (headings, then every saved venue)
   and a How-to sheet. */
export function quoteSheetRows(categories, quotes) {
  const lines = quoteSheetLines(categories);
  const head = ['Venue', ...lines.map((l) => l.label)];
  const venues = [head, ...(quotes || []).map((q) => [q.name, ...lines.map((l) => quoteCell(q, l.id))])];
  const howTo = [
    ['Venue pricing template'],
    [],
    ['One venue per row on the Venues sheet. Venue is the only column you have to fill in.'],
    ['Each other column is a line of your budget. In each cell put one of:'],
    ['   12000 or $12,000 or 12k', 'a flat price for that line'],
    ['   $250 pp or 250 per person', 'a price per guest (multiplied by your guest count)'],
    ['   Included', 'covered by the venue’s other prices'],
    ['   (blank)', 'not priced yet — a venue already saved keeps what it had'],
    [],
    ['A venue already in the comparison (same name) is updated; any other name is added.'],
    ['Then: Wedding → Budget → Venue cost comparison → Import a spreadsheet.'],
    [],
    ['Columns', 'Budget category'],
    ...lines.map((l) => [l.label, l.category]),
  ];
  return { venues, howTo };
}

/* One cell → what it sets on the line, or null for a blank / unreadable cell. */
export function parseQuoteCell(raw) {
  const s = norm(raw);
  if (!s) return null;
  if (/^(incl\.?|included|inclusive|yes|y)$/.test(s)) return { included: true };
  const pp = s.match(/^(.*?)\s*(?:pp|p\/p|per\s*(?:person|guest|head|plate)|\/\s*(?:person|guest|head|pp|plate)|each|a head|a person)$/);
  if (pp) {
    const n = parseMoney(pp[1]);
    return n == null ? { bad: true } : { perPerson: n };
  }
  const n = parseMoney(s);
  return n == null ? { bad: true } : { amount: n };
}

/* Rows read from a file → what importing them would do.
     quotes:   the venue list afterwards
     added, updated: venue names
     unchanged: venues named that came out the same
     skipped:  rows with cells but no venue name
     unknown:  headings that match no budget line (their cells are ignored)
     bad:      [{ venue, column, value }] cells that couldn't be read
   Throws when there's no Venue column. */
export function planQuoteImport(categories, quotes, rows, now = new Date()) {
  const lines = quoteSheetLines(categories);
  const [head = [], ...body] = rows || [];
  const heads = head.map(norm);
  const nameAt = heads.findIndex((h) => /^(venue|venue name|name)$/.test(h));
  if (nameAt < 0) throw new Error('there’s no “Venue” column — use the template’s first row as the headings');
  // A heading names a line by its label, or by the line's bare name when only one line has it.
  const byLabel = new Map(lines.map((l) => [norm(l.label), l.id]));
  const bare = new Map();
  for (const l of lines) {
    const k = norm(l.label.includes(': ') ? l.label.slice(l.label.indexOf(': ') + 2) : l.label);
    bare.set(k, bare.has(k) ? null : l.id);
  }
  const cols = [];
  const unknown = [];
  heads.forEach((h, i) => {
    if (i === nameAt || !h) return;
    const id = byLabel.get(h) ?? bare.get(h) ?? null;
    if (id) cols.push({ id, i, label: head[i] });
    else unknown.push(String(head[i]).trim());
  });

  let list = [...(quotes || [])];
  const added = [];
  const updated = [];
  const unchanged = [];
  const bad = [];
  let skipped = 0;
  for (const row of body) {
    const name = String(row?.[nameAt] ?? '').trim();
    if (!name) {
      if (cols.some((c) => norm(row?.[c.i]))) skipped += 1;
      continue;
    }
    const existing = findVenueQuote(list, name);
    const calc = existing ? structuredClone({ amounts: existing.amounts, included: existing.included, perPerson: existing.perPerson, subs: existing.subs }) : { amounts: {}, included: {}, perPerson: {}, subs: {} };
    let changed = !existing;
    for (const c of cols) {
      const cell = row?.[c.i];
      if (existing && norm(cell) === norm(quoteCell(existing, c.id))) continue; // as downloaded
      const v = parseQuoteCell(cell);
      if (!v) continue;
      if (v.bad) { bad.push({ venue: name, column: String(c.label).trim(), value: String(cell).trim() }); continue; }
      delete calc.amounts[c.id];
      delete calc.included[c.id];
      delete calc.perPerson[c.id];
      delete calc.subs[c.id]; // a typed figure replaces a breakdown
      if (v.included) calc.included[c.id] = true;
      else if (v.perPerson != null) calc.perPerson[c.id] = v.perPerson;
      else calc.amounts[c.id] = v.amount;
      changed = true;
    }
    if (!changed) { if (!unchanged.includes(existing.name)) unchanged.push(existing.name); continue; }
    list = saveVenueQuote(list, existing ? existing.name : name, calc, now);
    const into = existing ? updated : added;
    const saved = existing ? existing.name : name;
    if (!added.includes(saved) && !updated.includes(saved)) into.push(saved);
  }
  return { quotes: list, added, updated, unchanged: unchanged.filter((n) => !updated.includes(n)), skipped, unknown, bad };
}

/* Budget → Venue cost comparison, many venues at a time: a spreadsheet with
   one row per venue and one column per budget line, written out and read
   back in.

   A cell is one of:
     12000 / $12,000 / 12k   a flat fee for that line
     $250 pp / 250 per person / 250/guest   a price per guest
     Included                 covered by another line's price
   plus an Availability column of free text (open dates, holds).
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

// Dollars as a cell shows them: whole dollars, or with cents when there are some.
const cellMoney = (n) => (Number.isInteger(n) ? formatMoney(n) || '$0' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// What the sheet shows for one saved venue on one line.
function quoteCell(q, lineId) {
  if (lineFromSubs(q, lineId)) {
    const e = effectiveCalc(q, 0);
    if (e.included[lineId]) return 'Included';
    // Sub-items priced per person can't be summed without a guest count; the
    // flat ones are written, and the cell matching it means "leave it".
    const subs = q.subs[lineId].filter((x) => !x.included && x.amount != null);
    if (subs.some((x) => x.pp)) return '';
    return cellMoney(subs.reduce((s, x) => s + x.amount, 0));
  }
  if (q.included?.[lineId]) return 'Included';
  if (q.perPerson?.[lineId] != null) return `${cellMoney(q.perPerson[lineId])} per person`;
  if (q.amounts?.[lineId] != null) return cellMoney(q.amounts[lineId]);
  return '';
}

/* The workbook as rows: the Venues sheet (headings, then every saved venue)
   and a How-to sheet. */
export function quoteSheetRows(categories, quotes) {
  const lines = quoteSheetLines(categories);
  const head = ['Venue', ...lines.map((l) => l.label), 'Availability'];
  const venues = [head, ...(quotes || []).map((q) => [q.name, ...lines.map((l) => quoteCell(q, l.id)), q.availability || ''])];
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
    ['Availability is free text (open dates, holds) — it isn’t a price.'],
    ['Prices are before sales tax; the comparison adds the tax itself.'],
    [],
    ['A venue already in the comparison (same name) is updated; any other name is added.'],
    ['Then: Wedding → Budget → Venue cost comparison → drop the file there (or Import venues from Excel).'],
    [],
    ['Columns', 'Budget category'],
    ...lines.map((l) => [l.label, l.category]),
  ];
  return { venues, howTo };
}

/* One cell → what it sets on the line, or null for a blank / unreadable cell. */
export function parseQuoteCell(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? { amount: Math.round(raw * 100) / 100 } : { bad: true };
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

/* A file → its rows (an array of arrays of text), ready for planQuoteImport.
   An Excel file is read from its "Venues" sheet only (the template's other
   sheet is instructions); a CSV is its one table. Throws, with a message fit
   to show, for any other file or an Excel file without a Venues sheet.
   `XLSX` is the xlsx library, passed in so the app can load it lazily. */
export const IMPORT_ACCEPT = '.xlsx,.xls,.csv';

export function readVenueFile(fileName, data, XLSX) {
  const name = String(fileName || '');
  const excel = /\.xlsx?$/i.test(name);
  if (!excel && !/\.csv$/i.test(name)) throw new Error(`${name || 'That file'} isn’t an Excel (.xlsx) or CSV file`);
  const wb = excel ? XLSX.read(data, { type: 'array' }) : XLSX.read(typeof data === 'string' ? data : new TextDecoder().decode(data), { type: 'string', raw: true });
  const sheetName = excel ? wb.SheetNames.find((n) => norm(n) === 'venues') : wb.SheetNames[0];
  if (!sheetName) throw new Error(`${name} has no “Venues” sheet — fill in the Venues sheet of the template`);
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '', blankrows: false });
}

const isAvailability = (h) => /^(availability|available dates|dates available)$/.test(h);

/* For a heading that matches no line: the one line it most likely means — its
   name with something added ("Venue site fee (including admin charges)") or
   cut short — or null when none or several fit. */
export function suggestLine(header, lines) {
  const h = norm(header).replace(/\s*\(.*\)\s*$/, '');
  if (!h) return null;
  const fits = lines.filter((l) => {
    const name = norm(l.label.includes(': ') ? l.label.slice(l.label.indexOf(': ') + 2) : l.label);
    const bare = name.replace(/\s*\(.*\)\s*$/, '');
    return name === h || bare === h || name.startsWith(`${h} `) || h.startsWith(`${bare} `) || norm(header).startsWith(`${name} `);
  });
  return fits.length === 1 ? fits[0].id : null;
}

// What a venue holds on a line, as the import would set it — to tell a cell
// that changes nothing from one that does.
function sameAsSaved(q, lineId, v) {
  if (!q) return false;
  if (lineFromSubs(q, lineId)) return false;
  if (v.included) return !!q.included?.[lineId];
  if (v.perPerson != null) return q.perPerson?.[lineId] === v.perPerson;
  return q.amounts?.[lineId] === v.amount && !q.included?.[lineId] && q.perPerson?.[lineId] == null;
}

/* Rows read from a file → what importing them would do, without doing it.
     quotes:   the venue list afterwards
     added, updated: venue names
     unchanged: venues named that came out the same
     changes:  { [venue name]: [{ column, from, to }] } — every cell that would
               change, worded as the sheet shows it ('—' for nothing)
     columns:  [{ index, header, id, kind: 'line' | 'mapped' | 'unknown', suggestion }]
               every heading but Venue and Availability
     skipped:  rows with cells but no venue name
     unknown:  headings that match no budget line and weren't mapped (ignored)
     bad:      [{ venue, column, value }] cells that couldn't be read
   `mapping` is { [column index]: line id | '' }: a heading the lines don't
   name, pointed at one by hand ('' skips it).
   Throws when there's no Venue column or no venue rows. */
export function planQuoteImport(categories, quotes, rows, now = new Date(), { mapping = {} } = {}) {
  const lines = quoteSheetLines(categories);
  const lineIds = new Set(lines.map((l) => l.id));
  const labelOf = new Map(lines.map((l) => [l.id, l.label]));
  const [head = [], ...body] = rows || [];
  const heads = head.map(norm);
  const nameAt = heads.findIndex((h) => /^(venue|venue name|name)$/.test(h));
  if (nameAt < 0) throw new Error('there’s no “Venue” column — use the template’s first row as the headings');
  if (!body.some((r) => String(r?.[nameAt] ?? '').trim())) throw new Error('there are no venues in it — put one venue per row, its name in the Venue column');
  const availAt = heads.findIndex((h, i) => i !== nameAt && isAvailability(h));
  // A heading names a line by its label, or by the line's bare name when only one line has it.
  const byLabel = new Map(lines.map((l) => [norm(l.label), l.id]));
  const bare = new Map();
  for (const l of lines) {
    const k = norm(l.label.includes(': ') ? l.label.slice(l.label.indexOf(': ') + 2) : l.label);
    bare.set(k, bare.has(k) ? null : l.id);
  }
  const columns = [];
  heads.forEach((h, i) => {
    if (i === nameAt || i === availAt || !h) return;
    const header = String(head[i]).trim();
    const id = byLabel.get(h) ?? bare.get(h) ?? null;
    if (id) { columns.push({ index: i, header, id, kind: 'line', suggestion: null }); return; }
    const mapped = mapping[i];
    const ok = mapped && lineIds.has(mapped);
    columns.push({ index: i, header, id: ok ? mapped : null, kind: ok ? 'mapped' : 'unknown', suggestion: suggestLine(header, lines) });
  });
  const cols = columns.filter((c) => c.id);
  const unknown = columns.filter((c) => !c.id).map((c) => c.header);

  const before = new Map((quotes || []).map((q) => [q.id, q]));
  let list = [...(quotes || [])];
  const added = [];
  const updated = [];
  const unchanged = [];
  const bad = [];
  let skipped = 0;
  for (const row of body) {
    const name = String(row?.[nameAt] ?? '').trim();
    if (!name) {
      if (cols.some((c) => norm(row?.[c.index])) || (availAt >= 0 && norm(row?.[availAt]))) skipped += 1;
      continue;
    }
    const existing = findVenueQuote(list, name);
    const calc = existing ? structuredClone({ amounts: existing.amounts, included: existing.included, perPerson: existing.perPerson, subs: existing.subs }) : { amounts: {}, included: {}, perPerson: {}, subs: {} };
    let changed = !existing;
    for (const c of cols) {
      const cell = row?.[c.index];
      if (existing && norm(cell) === norm(quoteCell(existing, c.id))) continue; // as downloaded
      const v = parseQuoteCell(cell);
      if (!v) continue; // a blank cell never clears what's saved
      if (v.bad) { bad.push({ venue: name, column: c.header, value: String(cell).trim() }); continue; }
      if (sameAsSaved(existing, c.id, v)) continue;
      delete calc.amounts[c.id];
      delete calc.included[c.id];
      delete calc.perPerson[c.id];
      delete calc.subs[c.id]; // a typed figure replaces a breakdown
      if (v.included) calc.included[c.id] = true;
      else if (v.perPerson != null) calc.perPerson[c.id] = v.perPerson;
      else calc.amounts[c.id] = v.amount;
      changed = true;
    }
    const avail = availAt >= 0 ? String(row?.[availAt] ?? '').trim().replace(/\s+/g, ' ') : '';
    const availChanged = !!avail && avail !== (existing?.availability || '');
    if (!changed && !availChanged) { if (!unchanged.includes(existing.name)) unchanged.push(existing.name); continue; }
    const saved = existing ? existing.name : name;
    if (changed) list = saveVenueQuote(list, saved, calc, now);
    if (availChanged) list = list.map((q) => (q.name === saved ? { ...q, availability: avail, savedAt: now.toISOString() } : q));
    const into = existing && before.has(existing.id) ? updated : added;
    if (!added.includes(saved) && !updated.includes(saved)) into.push(saved);
  }

  // Each touched venue against what was saved before the import.
  const changes = {};
  for (const n of [...added, ...updated]) {
    const after = findVenueQuote(list, n);
    const was = before.get(after.id) || null;
    const out = [];
    for (const l of lines) {
      const from = was ? quoteCell(was, l.id) : '';
      const to = quoteCell(after, l.id);
      if (from !== to) out.push({ column: labelOf.get(l.id), from: from || '—', to: to || '—' });
    }
    if ((was?.availability || '') !== (after.availability || '')) out.push({ column: 'Availability', from: was?.availability || '—', to: after.availability || '—' });
    changes[n] = out;
  }
  return { quotes: list, added, updated, unchanged: unchanged.filter((n) => !updated.includes(n)), changes, columns, skipped, unknown, bad };
}

/* The wedding guest list as a formatted Excel workbook.

   Pure apart from the ExcelJS module, which the caller passes in (the page
   loads it on demand so the library stays out of the main bundle, and the
   tests pass the real one). Sheets:

   - One per tab on the page (All, Not categorized, each category, Hide),
     when the page passes its tabs in — each guest on the same sheets, in the
     same order, with the same wedding-group and couple boxes as the table.
     Called with no tabs it writes the single "Guest List" sheet below.
   - Guest List: a title block, then one row per guest with a dark header,
     frozen panes, filter arrows, and the page's status colours (yellow
     Pending, green Confirmed, red Not coming). Sorted the way the page sorts:
     undecided and Pending first, then Confirmed, then Not coming, each by
     last name. Set up to print landscape, one page wide, header repeated.
   - Summary: guest counts by status, category, group, guest-of and side. */

export const STATUS_ORDER = ['Pending', 'Confirmed', 'Not coming'];
const STATUS_RANK = { Confirmed: 1, 'Not coming': 2 };

// Fills mirror the page's row tints; text colours keep them readable.
const STATUS_STYLE = {
  Pending: { fill: 'FFFFF4CC', font: 'FF7A5A00' },
  Confirmed: { fill: 'FFDDF3E4', font: 'FF1E6B3A' },
  'Not coming': { fill: 'FFFBE0E0', font: 'FF9B1C1C' },
};

const INK = 'FF1F2937';
const MUTED = 'FF6B7280';
const ACCENT = 'FF7C5C3B'; // warm brown, wedding-stationery rather than spreadsheet blue
const HEADER_FILL = 'FF3F3A36';
const BAND_FILL = 'FFF8F6F3';
const RULE = 'FFE5E0DA';

export const EXPORT_COLUMNS = [
  { key: 'name', header: 'Name', width: 26 },
  { key: 'status', header: 'Status', width: 13 },
  { key: 'group', header: 'Group', width: 18 },
  { key: 'category', header: 'Category', width: 16 },
  { key: 'subcategory', header: 'Subcategory', width: 18 },
  { key: 'guestOf', header: 'Guest Of', width: 16 },
  { key: 'side', header: 'Side', width: 18 },
  { key: 'party', header: 'Wedding group', width: 20 },
  { key: 'email', header: 'Email', width: 30 },
  { key: 'phone', header: 'Phone', width: 16 },
  { key: 'address', header: 'Address', width: 30 },
  { key: 'city', header: 'City', width: 16 },
  { key: 'state', header: 'State', width: 8 },
  { key: 'zip', header: 'Zip', width: 9 },
];

/* The columns to write, in EXPORT_COLUMNS' order, from a list of keys. No
   list (or nothing recognised in it) means every column. */
export function pickExportColumns(keys) {
  if (!Array.isArray(keys)) return EXPORT_COLUMNS;
  const want = new Set(keys);
  const cols = EXPORT_COLUMNS.filter((c) => want.has(c.key));
  return cols.length ? cols : EXPORT_COLUMNS;
}

const isHidden = (c) => String(c?.category || '').trim().toLowerCase() === 'hide';
const clean = (v) => String(v ?? '').trim();
const fullName = (c) => [clean(c.firstName), clean(c.lastName)].filter(Boolean).join(' ');

export function guestSortKey(c) {
  return `${STATUS_RANK[c.status] || 0}|${clean(c.lastName).toLowerCase()}|${clean(c.firstName).toLowerCase()}`;
}

// The guests that go in the file: everyone but the hidden ones, page order.
export function exportableGuests(contacts) {
  return (contacts || [])
    .filter((c) => c && !isHidden(c))
    .sort((a, b) => {
      const ka = guestSortKey(a);
      const kb = guestSortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

export function guestRow(c) {
  return {
    name: fullName(c),
    status: clean(c.status),
    group: clean(c.group),
    category: clean(c.category),
    subcategory: clean(c.subcategory),
    guestOf: clean(c.guestOf),
    side: clean(c.side),
    party: clean(c.party),
    email: clean(c.email),
    phone: clean(c.phone),
    address: clean(c.address),
    city: clean(c.city),
    state: clean(c.state),
    zip: clean(c.zip),
  };
}

// [label, count] pairs, biggest first, blanks last as "—".
export function countBy(guests, field) {
  const m = new Map();
  for (const g of guests) {
    const k = clean(g[field]) || '—';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => {
    if (a[0] === '—') return 1;
    if (b[0] === '—') return -1;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
}

export function statusCounts(guests) {
  const counts = { Pending: 0, Confirmed: 0, 'Not coming': 0, 'No status': 0 };
  for (const g of guests) {
    if (STATUS_ORDER.includes(g.status)) counts[g.status] += 1;
    else counts['No status'] += 1;
  }
  return counts;
}

export function exportFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Wedding Guest List ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xlsx`;
}

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const hair = { style: 'thin', color: { argb: RULE } };
const boxed = { top: hair, left: hair, bottom: hair, right: hair };

function colLetter(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/* A tab's label as an Excel sheet name: no []:*?/\, at most 31 characters,
   and unique in the workbook (case-insensitively, as Excel compares them). */
export function sheetNameFor(label, used = new Set()) {
  const base = (String(label || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) {
    const tag = ` (${n})`;
    name = base.slice(0, 31 - tag.length) + tag;
  }
  used.add(name.toLowerCase());
  return name;
}

export const DEFAULT_EXPORT_OUTLINE_COLORS = { group: '#4f46e5', couple: '#e11d74' };
const argbOf = (hex, fallback) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  return `FF${(m ? m[1] : fallback.slice(1)).toUpperCase()}`;
};

/* The cell border for a guest row, drawing the page's boxes: a dashed box
   round each wedding group, a solid one round each couple. A cell has one
   line per side, so where the two meet the couple keeps its top and bottom
   (the lines that set it apart inside its group) and the group keeps its
   sides — both boxes still read. */
function outlineBorder(o, colNumber, lastCol, colors) {
  const groupLine = { style: 'mediumDashed', color: { argb: colors.group } };
  const coupleLine = { style: 'medium', color: { argb: colors.couple } };
  const edges = (pos) => ({
    top: pos === 'top',
    bottom: pos === 'bottom',
    left: !!pos && colNumber === 1,
    right: !!pos && colNumber === lastCol,
  });
  const g = o?.group ? edges(o.group) : {};
  const c = o?.couple ? edges(o.couple) : {};
  const side = (k) => {
    const [first, second] = k === 'top' || k === 'bottom' ? [c, g] : [g, c];
    const [l1, l2] = first === c ? [coupleLine, groupLine] : [groupLine, coupleLine];
    return first[k] ? l1 : second[k] ? l2 : hair;
  };
  return { top: side('top'), left: side('left'), bottom: side('bottom'), right: side('right') };
}

function buildGuestSheet(wb, guests, { title, exportedOn, sheetName = 'Guest List', outlines, colors, cols = EXPORT_COLUMNS }) {
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: cols[0].key === 'name' ? 1 : 0, ySplit: 4, showGridLines: false }],
    properties: { defaultRowHeight: 18 },
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      printTitlesRow: '4:4',
    },
    headerFooter: { oddFooter: '&L&8Wedding Guest List&R&8Page &P of &N' },
  });
  const last = colLetter(cols.length);
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));

  // Title block: name, then a one-line tally, then a spacer.
  ws.mergeCells(`A1:${last}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { name: 'Georgia', size: 20, bold: true, color: { argb: ACCENT } };
  t.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 34;

  const s = statusCounts(guests);
  ws.mergeCells(`A2:${last}2`);
  const sub = ws.getCell('A2');
  sub.value = `${guests.length} guests  ·  ${s.Confirmed} confirmed  ·  ${s.Pending} pending  ·  ${s['Not coming']} not coming  ·  ${s['No status']} no status yet  ·  Exported ${exportedOn}`;
  sub.font = { size: 10, italic: true, color: { argb: MUTED } };
  const boxedGuests = outlines ? guests.filter((g) => outlines.get(g.id)?.group || outlines.get(g.id)?.couple).length : 0;
  if (boxedGuests) {
    // A key for the boxes, in their colours, where the spacer row was.
    ws.mergeCells(`A3:${last}3`);
    const key = ws.getCell('A3');
    const parts = [];
    if (guests.some((g) => outlines.get(g.id)?.group)) parts.push({ text: '- - -  Dashed box: wedding group', font: { size: 9, bold: true, color: { argb: colors.group } } });
    if (guests.some((g) => outlines.get(g.id)?.couple)) parts.push({ text: '———  Solid box: couple', font: { size: 9, bold: true, color: { argb: colors.couple } } });
    key.value = { richText: parts.flatMap((p, i) => (i ? [{ text: '      ', font: { size: 9 } }, p] : [p])) };
    ws.getRow(3).height = 16;
  } else {
    ws.getRow(3).height = 6;
  }

  const header = ws.getRow(4);
  header.values = cols.map((c) => c.header);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = fill(HEADER_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
  });

  guests.forEach((g, i) => {
    const row = ws.addRow(guestRow(g));
    const st = STATUS_STYLE[g.status];
    const band = i % 2 === 1 ? BAND_FILL : null;
    const o = outlines?.get(g.id);
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = o && (o.group || o.couple) ? outlineBorder(o, colNumber, cols.length, colors) : boxed;
      cell.alignment = { vertical: 'middle', indent: 1 };
      cell.font = { color: { argb: INK }, size: 10 };
      if (st) cell.fill = fill(st.fill);
      else if (band) cell.fill = fill(band);
      const key = cols[colNumber - 1]?.key;
      if (key === 'name') cell.font = { color: { argb: INK }, size: 10, bold: true };
      if (key === 'status' && st) cell.font = { color: { argb: st.font }, size: 10, bold: true };
      if (key === 'email' && cell.value) {
        cell.value = { text: cell.value, hyperlink: `mailto:${cell.value}` };
        cell.font = { color: { argb: 'FF2F5D8A' }, size: 10, underline: true };
      }
      if (key === 'zip' || key === 'phone') cell.numFmt = '@';
    });
  });

  if (guests.length) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + guests.length, column: cols.length } };
    // Status picks from the same three choices as the page.
    const statusCol = cols.findIndex((c) => c.key === 'status') + 1;
    for (let r = 5; statusCol && r <= 4 + guests.length; r += 1) {
      ws.getRow(r).getCell(statusCol).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${STATUS_ORDER.join(',')}"`],
      };
    }
  } else {
    ws.mergeCells(`A5:${last}5`);
    const empty = ws.getCell('A5');
    empty.value = 'No guests on the list yet.';
    empty.font = { italic: true, color: { argb: MUTED } };
  }
  return ws;
}

function buildSummarySheet(wb, guests, { title, exportedOn }) {
  const ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 3 }, { width: 28 }, { width: 10 }, { width: 10 }, { width: 3 }, { width: 28 }, { width: 10 }, { width: 10 }];

  ws.mergeCells('B1:H1');
  const t = ws.getCell('B1');
  t.value = `${title} — Summary`;
  t.font = { name: 'Georgia', size: 18, bold: true, color: { argb: ACCENT } };
  ws.getRow(1).height = 30;
  ws.mergeCells('B2:H2');
  const sub = ws.getCell('B2');
  sub.value = `${guests.length} guests on the list  ·  Exported ${exportedOn}  ·  Hidden guests are left out`;
  sub.font = { size: 10, italic: true, color: { argb: MUTED } };

  const total = guests.length || 1;
  // Draws one titled table at (row, col) and returns the row after it.
  const table = (startRow, startCol, heading, pairs, styleFor) => {
    const c = (r, off) => ws.getCell(startRow + r, startCol + off);
    ws.mergeCells(startRow, startCol, startRow, startCol + 2);
    c(0, 0).value = heading;
    c(0, 0).font = { bold: true, size: 12, color: { argb: ACCENT } };
    ['', 'Guests', 'Share'].forEach((h, i) => {
      const cell = c(1, i);
      cell.value = i === 0 ? heading.replace(/^By /, '') : h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = fill(HEADER_FILL);
      cell.alignment = { horizontal: i === 0 ? 'left' : 'right', indent: 1 };
    });
    pairs.forEach(([label, n], i) => {
      const r = i + 2;
      const st = styleFor?.(label);
      const cells = [c(r, 0), c(r, 1), c(r, 2)];
      cells[0].value = label;
      cells[1].value = n;
      cells[2].value = n / total;
      cells[2].numFmt = '0%';
      cells.forEach((cell, j) => {
        cell.border = boxed;
        cell.alignment = { horizontal: j === 0 ? 'left' : 'right', indent: 1 };
        cell.font = { size: 10, color: { argb: st ? st.font : INK }, bold: !!st && j === 0 };
        if (st) cell.fill = fill(st.fill);
        else if (i % 2 === 1) cell.fill = fill(BAND_FILL);
      });
    });
    const tr = pairs.length + 2;
    [c(tr, 0), c(tr, 1), c(tr, 2)].forEach((cell, j) => {
      cell.value = j === 0 ? 'Total' : j === 1 ? guests.length : guests.length ? 1 : 0;
      if (j === 2) cell.numFmt = '0%';
      cell.font = { bold: true, size: 10, color: { argb: INK } };
      cell.alignment = { horizontal: j === 0 ? 'left' : 'right', indent: 1 };
      cell.border = { top: { style: 'medium', color: { argb: ACCENT } } };
    });
    return startRow + tr + 2;
  };

  const s = statusCounts(guests);
  const statusPairs = [...STATUS_ORDER, 'No status'].map((k) => [k, s[k]]);
  const leftEnd = table(4, 2, 'By Status', statusPairs, (label) => STATUS_STYLE[label]);
  table(leftEnd, 2, 'By Category', countBy(guests, 'category'));
  const rightEnd = table(4, 6, 'By Group', countBy(guests, 'group'));
  const guestOfEnd = table(rightEnd, 6, 'By Guest Of', countBy(guests, 'guestOf'));
  table(guestOfEnd, 6, 'By Side', countBy(guests, 'side'));
  return ws;
}

/* Builds the workbook and returns its bytes (an ArrayBuffer-like Buffer).
   `contacts` is the raw guest list; hidden guests are dropped from the
   Summary (and from the lone Guest List sheet when no tabs are given).

   `tabs`: [{ label, guests, outlines }] — the page's tabs, each with its
   guests already in the table's order and, in group view, rowOutlines()'s
   Map of id → { group, couple } ('top' | 'mid' | 'bottom'). `outlineColors`
   are the page's picked colours as hex. `columns`: the keys of the
   EXPORT_COLUMNS to write on the guest sheets (all of them when left out). */
export async function buildGuestWorkbook(ExcelJS, contacts, { title = 'Wedding Guest List', now = new Date(), tabs, outlineColors = {}, columns } = {}) {
  const guests = exportableGuests(contacts);
  const cols = pickExportColumns(columns);
  const exportedOn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rally';
  wb.created = now;
  if (Array.isArray(tabs) && tabs.length) {
    const colors = {
      group: argbOf(outlineColors.group, DEFAULT_EXPORT_OUTLINE_COLORS.group),
      couple: argbOf(outlineColors.couple, DEFAULT_EXPORT_OUTLINE_COLORS.couple),
    };
    const used = new Set(['summary']);
    for (const t of tabs) {
      const label = clean(t.label) || 'Guests';
      buildGuestSheet(wb, t.guests || [], {
        title: label === 'All' ? title : `${title} — ${label}`,
        exportedOn,
        sheetName: sheetNameFor(label, used),
        outlines: t.outlines instanceof Map ? t.outlines : null,
        colors,
        cols,
      });
    }
  } else {
    buildGuestSheet(wb, guests, { title, exportedOn, cols });
  }
  buildSummarySheet(wb, guests, { title, exportedOn });
  return wb.xlsx.writeBuffer();
}

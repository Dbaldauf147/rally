/* The wedding guest list as a formatted Excel workbook.

   Pure apart from the ExcelJS module, which the caller passes in (the page
   loads it on demand so the library stays out of the main bundle, and the
   tests pass the real one). Two sheets:

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
  { key: 'email', header: 'Email', width: 30 },
  { key: 'phone', header: 'Phone', width: 16 },
  { key: 'address', header: 'Address', width: 30 },
  { key: 'city', header: 'City', width: 16 },
  { key: 'state', header: 'State', width: 8 },
  { key: 'zip', header: 'Zip', width: 9 },
];

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

function buildGuestSheet(wb, guests, { title, exportedOn }) {
  const ws = wb.addWorksheet('Guest List', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
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
  const last = colLetter(EXPORT_COLUMNS.length);
  ws.columns = EXPORT_COLUMNS.map((c) => ({ key: c.key, width: c.width }));

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
  ws.getRow(3).height = 6;

  const header = ws.getRow(4);
  header.values = EXPORT_COLUMNS.map((c) => c.header);
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
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = boxed;
      cell.alignment = { vertical: 'middle', indent: 1 };
      cell.font = { color: { argb: INK }, size: 10 };
      if (st) cell.fill = fill(st.fill);
      else if (band) cell.fill = fill(band);
      const key = EXPORT_COLUMNS[colNumber - 1]?.key;
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
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + guests.length, column: EXPORT_COLUMNS.length } };
    // Status picks from the same three choices as the page.
    for (let r = 5; r <= 4 + guests.length; r += 1) {
      ws.getCell(`B${r}`).dataValidation = {
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
   `contacts` is the raw guest list; hidden guests are dropped here. */
export async function buildGuestWorkbook(ExcelJS, contacts, { title = 'Wedding Guest List', now = new Date() } = {}) {
  const guests = exportableGuests(contacts);
  const exportedOn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rally';
  wb.created = now;
  buildGuestSheet(wb, guests, { title, exportedOn });
  buildSummarySheet(wb, guests, { title, exportedOn });
  return wb.xlsx.writeBuffer();
}

import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildGuestWorkbook, exportableGuests, countBy, statusCounts, exportFileName, sheetNameFor, EXPORT_COLUMNS } from './weddingGuestExport.js';

const guests = [
  { id: '1', firstName: 'Zoe', lastName: 'Adams', status: 'Confirmed', category: 'A', group: 'College', side: "Mom's side", email: 'zoe@example.com', zip: '01234' },
  { id: '2', firstName: 'Bob', lastName: 'Young', status: 'Pending', category: 'B', group: 'Work' },
  { id: '3', firstName: 'Al', lastName: 'Brown', status: 'Not coming', category: 'A', group: 'College' },
  { id: '4', firstName: 'Cy', lastName: 'Clark', category: 'A' },
  { id: '5', firstName: 'Hid', lastName: 'Den', category: 'Hide', status: 'Confirmed' },
];

describe('exportableGuests', () => {
  it('drops hidden guests and sorts undecided/pending, then confirmed, then not coming', () => {
    expect(exportableGuests(guests).map((g) => g.firstName)).toEqual(['Cy', 'Bob', 'Zoe', 'Al']);
  });
});

describe('counts', () => {
  it('counts by status and field, blanks last', () => {
    const shown = exportableGuests(guests);
    expect(statusCounts(shown)).toEqual({ Pending: 1, Confirmed: 1, 'Not coming': 1, 'No status': 1 });
    expect(countBy(shown, 'group')).toEqual([['College', 2], ['Work', 1], ['—', 1]]);
  });
  it('names the file by date', () => {
    expect(exportFileName(new Date(2026, 10, 5))).toBe('Wedding Guest List 2026-11-05.xlsx');
  });
});

describe('buildGuestWorkbook', () => {
  it('writes a styled Guest List and Summary that read back', async () => {
    const buf = await buildGuestWorkbook(ExcelJS, guests, { now: new Date(2026, 10, 5) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Guest List', 'Summary']);

    const ws = wb.getWorksheet('Guest List');
    expect(ws.getCell('A1').value).toBe('Wedding Guest List');
    expect(ws.getCell('A2').value).toContain('4 guests');
    expect(ws.getRow(4).getCell(1).value).toBe('Name');
    expect(ws.getCell('A5').value).toBe('Cy Clark');
    expect(ws.getCell('A7').value).toBe('Zoe Adams');
    expect(ws.getCell('B7').value).toBe('Confirmed');
    expect(ws.getCell('B7').fill.fgColor.argb).toBe('FFDDF3E4');
    expect(ws.getCell('B8').fill.fgColor.argb).toBe('FFFBE0E0');
    expect(ws.getCell('G7').value).toBe("Mom's side");
    expect(ws.getCell('I7').value).toMatchObject({ hyperlink: 'mailto:zoe@example.com' });
    expect(ws.getCell('N7').value).toBe('01234');
    expect(ws.rowCount).toBe(8);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });

    const sum = wb.getWorksheet('Summary');
    const labels = [];
    sum.eachRow((row) => labels.push(row.getCell(2).value));
    expect(labels).toContain('By Status');
    expect(labels).toContain('Total');
    const right = [];
    sum.eachRow((row) => right.push(row.getCell(6).value));
    expect(right).toContain('By Side');
  });

  it('handles an empty list', async () => {
    const buf = await buildGuestWorkbook(ExcelJS, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.getWorksheet('Guest List').getCell('A5').value).toBe('No guests on the list yet.');
  });
});

describe('sheetNameFor', () => {
  it('drops characters Excel refuses, caps at 31 and keeps names unique', () => {
    const used = new Set(['summary']);
    expect(sheetNameFor('Work / College', used)).toBe('Work College');
    expect(sheetNameFor('work college', used)).toBe('work college (2)');
    expect(sheetNameFor('Summary', used)).toBe('Summary (2)');
    expect(sheetNameFor('x'.repeat(40), used)).toHaveLength(31);
    expect(sheetNameFor('', used)).toBe('Sheet');
  });
});

describe('buildGuestWorkbook with tabs', () => {
  const fam = [
    { id: 'a', firstName: 'Dan', lastName: 'Baldauf', party: 'Baldauf family', category: 'Family' },
    { id: 'b', firstName: 'Judy', lastName: 'Baldauf', party: 'Baldauf family', category: 'Family' },
    { id: 'c', firstName: 'Sal', lastName: 'Baldauf', party: 'Baldauf family', category: 'Family' },
    { id: 'd', firstName: 'Zed', lastName: 'Zulu' },
    { id: 'h', firstName: 'Hid', lastName: 'Den', category: 'Hide' },
  ];
  const boxes = new Map([
    ['a', { group: 'top', couple: 'top' }],
    ['b', { group: 'mid', couple: 'bottom' }],
    ['c', { group: 'bottom' }],
    ['d', {}],
  ]);
  const tabs = [
    { label: 'All', guests: fam.slice(0, 4), outlines: boxes },
    { label: 'Not categorized', guests: [fam[3]], outlines: new Map([['d', {}]]) },
    { label: 'Family', guests: fam.slice(0, 3), outlines: boxes },
    { label: 'Hide', guests: [fam[4]], outlines: null },
  ];
  const load = async (opts) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildGuestWorkbook(ExcelJS, fam, { now: new Date(2026, 10, 5), ...opts }));
    return wb;
  };

  it('writes a sheet per tab, in the given order, then the Summary', async () => {
    const wb = await load({ tabs });
    expect(wb.worksheets.map((w) => w.name)).toEqual(['All', 'Not categorized', 'Family', 'Hide', 'Summary']);
    const all = wb.getWorksheet('All');
    expect(all.getCell('A1').value).toBe('Wedding Guest List');
    expect([5, 6, 7, 8].map((r) => all.getCell(`A${r}`).value)).toEqual(['Dan Baldauf', 'Judy Baldauf', 'Sal Baldauf', 'Zed Zulu']);
    const partyCol = EXPORT_COLUMNS.findIndex((c) => c.key === 'party') + 1;
    expect(all.getRow(4).getCell(partyCol).value).toBe('Wedding group');
    expect(all.getRow(5).getCell(partyCol).value).toBe('Baldauf family');
    expect(wb.getWorksheet('Family').getCell('A1').value).toBe('Wedding Guest List — Family');
    expect(wb.getWorksheet('Hide').getCell('A5').value).toBe('Hid Den');
    // Summary still counts the visible list, hidden guest left out.
    expect(wb.getWorksheet('Summary').getCell('B2').value).toContain('4 guests');
  });

  it('draws the wedding group and couple boxes in the picked colours', async () => {
    const wb = await load({ tabs, outlineColors: { group: '#112233', couple: '#aa0055' } });
    const ws = wb.getWorksheet('All');
    const last = EXPORT_COLUMNS.length;
    const b = (r, c) => ws.getRow(r).getCell(c).border;
    // Dan: top of the group and of the couple — the couple keeps the top,
    // the group keeps the side.
    expect(b(5, 1).top).toMatchObject({ style: 'medium', color: { argb: 'FFAA0055' } });
    expect(b(5, 1).left).toMatchObject({ style: 'mediumDashed', color: { argb: 'FF112233' } });
    expect(b(5, last).right).toMatchObject({ style: 'mediumDashed' });
    // Judy: bottom of the couple, middle of the group.
    expect(b(6, 3).bottom).toMatchObject({ style: 'medium', color: { argb: 'FFAA0055' } });
    expect(b(6, 3).top.style).toBe('thin');
    // Sal: bottom of the group.
    expect(b(7, 2).bottom).toMatchObject({ style: 'mediumDashed' });
    // Zed: no box.
    expect(b(8, 1).left.style).toBe('thin');
    // The key row only where there are boxes.
    expect(JSON.stringify(ws.getCell('A3').value)).toContain('wedding group');
    expect(JSON.stringify(ws.getCell('A3').value)).toContain('couple');
    expect(wb.getWorksheet('Not categorized').getCell('A3').value).toBeNull();
  });

  it('leaves the boxes off when group view is off', async () => {
    const wb = await load({ tabs: tabs.map((t) => ({ ...t, outlines: null })) });
    const ws = wb.getWorksheet('All');
    expect(ws.getRow(5).getCell(1).border.top.style).toBe('thin');
    expect(ws.getCell('A3').value).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildGuestWorkbook, exportableGuests, countBy, statusCounts, exportFileName } from './weddingGuestExport.js';

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
    expect(ws.getCell('H7').value).toMatchObject({ hyperlink: 'mailto:zoe@example.com' });
    expect(ws.getCell('M7').value).toBe('01234');
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

import { describe, it, expect } from 'vitest';
import {
  STATUS, NO_TYPE, parseStatus, normalizeEntry, normalizeList, hasContent, entryTitle,
  entrySubtitle, entryPickerLabel, matchesQuery, groupByType, countByStatus, issueCell, typeUsage,
  daysSince, daysSinceLabel, dateColumns, daysSinceField, setDaysSinceSource,
  parseCadence, nextVisit,
  addEntry, updateEntry, removeEntry, isBlank,
  addField, updateField, removeField, fieldUsage, setCustomValue, customValueOf,
  BUILTIN_COLUMNS, resolveColumns, visibleColumns, renameColumn, setColumnHidden, moveColumn,
  addType, renameType, removeType, moveType, sameType, showsStatusBadge,
  telHref, mailHref, mapHref, safeLink, linkLabel, seedDoctors,
  isCheckInEntry, isIssueEntry, laneCounts,
  addQuestion, updateQuestion, removeQuestion, toggleQuestionTag, addQuestionTag,
  removeQuestionTag, groupQuestions, questionTagCounts, questionMatches, normalizeQuestion,
  normalizeAppointments, lastAppointment, nextAppointment, upcomingVisit,
  linkAppointment, unlinkAppointment, ignoreAppointment, unignoreAppointment,
  settledEventIds, suggestEntryFor, pendingAppointments, setDoctorCalendar,
} from './doctors';

const entry = (o) => normalizeEntry(o);

describe('parseStatus', () => {
  it('reads the three values the sheet actually used', () => {
    expect(parseStatus('Resolved')).toBe(STATUS.RESOLVED);
    expect(parseStatus('Being Treated')).toBe(STATUS.TREATING);
    expect(parseStatus('-')).toBe(STATUS.NONE);
  });

  it('treats a blank or unrecognised value as ongoing rather than dropping the row', () => {
    expect(parseStatus('')).toBe(STATUS.NONE);
    expect(parseStatus(undefined)).toBe(STATUS.NONE);
    expect(parseStatus('who knows')).toBe(STATUS.NONE);
  });

  it('ignores case and surrounding space', () => {
    expect(parseStatus('  BEING TREATED ')).toBe(STATUS.TREATING);
  });
});

describe('normalizeEntry', () => {
  it('fills every field so the edit form stays controlled', () => {
    const e = entry({ doctor: 'Dr. Who' });
    expect(e.notes).toBe('');
    expect(e.previousMeds).toBe('');
    expect(e.id).toBeTruthy();
  });

  it('trims what was typed and keeps the id it was given', () => {
    const e = entry({ id: 'abc', doctor: '  Dr. Who  ' });
    expect(e).toMatchObject({ id: 'abc', doctor: 'Dr. Who' });
  });

  it('accepts a bare array as the stored shape', () => {
    expect(normalizeList([{ issue: 'Neck sprain' }]).entries).toHaveLength(1);
  });

  it('survives a missing or malformed document', () => {
    expect(normalizeList(undefined).entries).toEqual([]);
    expect(normalizeList({ entries: 'nope' }).entries).toEqual([]);
  });
});

describe('hasContent', () => {
  it('keeps a row that is only an issue', () => {
    expect(hasContent(entry({ issue: 'Levator spasm' }))).toBe(true);
  });

  it('drops a row with nothing on it', () => {
    expect(hasContent(entry({}))).toBe(false);
  });
});

describe('entryTitle', () => {
  it('prefers the doctor', () => {
    expect(entryTitle(entry({ doctor: 'Sanjay Jobanputra', place: 'City MD', issue: 'Fissure' })))
      .toBe('Sanjay Jobanputra');
  });

  it('falls back through place, then issue, then speciality', () => {
    expect(entryTitle(entry({ place: 'City MD', issue: 'Jock itch' }))).toBe('City MD');
    expect(entryTitle(entry({ issue: 'Neck sprain', type: 'Ortho' }))).toBe('Neck sprain');
    expect(entryTitle(entry({ type: 'Gastroenterologist' }))).toBe('Gastroenterologist');
  });
});

describe('entryPickerLabel', () => {
  it('leads with the speciality, so you pick the dentist rather than the practice', () => {
    expect(entryPickerLabel(entry({ doctor: 'Dr. Matthew Kim, MD (ENT)', type: 'Ear' })))
      .toBe('Ear — Dr. Matthew Kim, MD (ENT)');
  });

  it('keeps what identifies the record, so one speciality twice stays tellable apart', () => {
    expect(entryPickerLabel(entry({ doctor: 'Dr. Annemarie Uliasz, MD', type: 'Skin' })))
      .toBe('Skin — Dr. Annemarie Uliasz, MD');
    expect(entryPickerLabel(entry({ doctor: 'Sochulak, Stephen', type: 'Skin' })))
      .toBe('Skin — Sochulak, Stephen');
  });

  it('falls back to the place when there is no name', () => {
    expect(entryPickerLabel(entry({ place: '34th St Dental', type: 'Dentist' })))
      .toBe('Dentist — 34th St Dental');
  });

  it('shows a speciality on its own rather than trailing an apology', () => {
    expect(entryPickerLabel(entry({ type: 'Gastroenterologist' }))).toBe('Gastroenterologist');
  });

  it('falls back to the title when the record has no speciality', () => {
    expect(entryPickerLabel(entry({ doctor: 'Amy Chen' }))).toBe('Amy Chen');
    expect(entryPickerLabel(entry({}))).toBe('No doctor recorded yet');
  });
});

describe('issueCell', () => {
  it('blanks the issue when the issue is already what the row is called', () => {
    expect(issueCell(entry({ issue: 'Neck sprain' }))).toBe('');
  });

  it('keeps the issue when something else names the row', () => {
    expect(issueCell(entry({ doctor: 'Dr. Kim', issue: 'Eczema' }))).toBe('Eczema');
  });

  it('is blank when there is no issue at all', () => {
    expect(issueCell(entry({ doctor: 'Dr. Kim' }))).toBe('');
  });
});

describe('how long since the last visit', () => {
  const march = new Date(2026, 2, 20); // 20 March 2026, local

  it('counts whole days back to the date', () => {
    expect(daysSince('2026-03-20', march)).toBe(0);
    expect(daysSince('2026-03-19', march)).toBe(1);
    expect(daysSince('2025-03-20', march)).toBe(365);
  });

  it('counts across a daylight-saving change without slipping a day', () => {
    // US clocks went forward on 8 March 2026.
    expect(daysSince('2026-03-01', march)).toBe(19);
  });

  it('reads a date written loosely, not only the ISO one a Date column stores', () => {
    expect(daysSince('3/19/2026', march)).toBe(1);
    expect(daysSince('Mar 19, 2026', march)).toBe(1);
  });

  it('has no count without a whole date', () => {
    expect(daysSince('', march)).toBeNull();
    expect(daysSince(undefined, march)).toBeNull();
    expect(daysSince('sometime', march)).toBeNull();
    expect(daysSince('7/30', march)).toBeNull(); // no year: which July?
  });

  it('prints a bare number, and says the two things a number cannot', () => {
    expect(daysSinceLabel('2026-03-19', march)).toBe('1');
    expect(daysSinceLabel('2026-03-20', march)).toBe('Today');
    expect(daysSinceLabel('2026-04-02', march)).toBe('in 13');
    expect(daysSinceLabel('', march)).toBe('');
  });
});

describe('what the counter counts from', () => {
  const withDate = (label = 'Last Visit') =>
    addField(normalizeList({ entries: [{ id: '1', doctor: 'Dr. A' }] }), { label, type: 'date' });
  const idOf = (l, label) => l.fields.find((f) => f.label === label).id;

  it('finds the one Date column without being told', () => {
    const l = withDate();
    expect(daysSinceField(l).label).toBe('Last Visit');
  });

  it('has nothing to count from until there is a Date column', () => {
    expect(daysSinceField(normalizeList({ entries: [] }))).toBeNull();
    expect(dateColumns(addField(normalizeList({ entries: [] }), { label: 'Copay' }))).toEqual([]);
  });

  it('takes the leftmost Date column when there are several', () => {
    const l = addField(withDate(), { label: 'Next appointment', type: 'date' });
    expect(dateColumns(l).map((c) => c.label)).toEqual(['Last Visit', 'Next appointment']);
    expect(daysSinceField(l).label).toBe('Last Visit');
  });

  it('counts from the one the owner picked instead', () => {
    const l = addField(withDate(), { label: 'Next appointment', type: 'date' });
    const picked = setDaysSinceSource(l, idOf(l, 'Next appointment'));
    expect(daysSinceField(picked).label).toBe('Next appointment');
  });

  it('refuses a column that is not a date', () => {
    const l = addField(withDate(), { label: 'Copay', type: 'number' });
    expect(setDaysSinceSource(l, idOf(l, 'Copay')).daysSinceSource).toBe('');
  });

  it('falls back when the chosen column is deleted since', () => {
    const l = addField(withDate(), { label: 'Next appointment', type: 'date' });
    const picked = setDaysSinceSource(l, idOf(l, 'Next appointment'));
    const gone = removeField(picked, idOf(l, 'Next appointment'));
    expect(daysSinceField(gone).label).toBe('Last Visit');
  });

  it('is a column like any other, and can be hidden', () => {
    const l = setColumnHidden(withDate(), 'daysSince', true);
    expect(visibleColumns(l).map((c) => c.key)).not.toContain('daysSince');
  });
});

describe('matchesQuery', () => {
  const e = entry({
    doctor: 'Dr. Matthew Kim, MD (ENT)', type: 'Ear', issue: 'Eczema',
    currentMeds: 'Fluocinolone Acetonide', location: '10 Union Sq E, New York, NY 10003',
  });

  it('matches an empty query', () => {
    expect(matchesQuery(e, '  ')).toBe(true);
  });

  it('searches the fields you actually remember, not just the name', () => {
    expect(matchesQuery(e, 'eczema')).toBe(true);
    expect(matchesQuery(e, 'fluocinolone')).toBe(true);
    expect(matchesQuery(e, 'union sq')).toBe(true);
  });

  it('requires every term, so two terms narrow instead of widen', () => {
    expect(matchesQuery(e, 'kim ear')).toBe(true);
    expect(matchesQuery(e, 'kim dentist')).toBe(false);
  });

  it('matches on the status label', () => {
    expect(matchesQuery(entry({ issue: 'Plantar', status: 'Being Treated' }), 'being treated')).toBe(true);
  });
});

describe('countByStatus', () => {
  it('counts each status, including the empty ones', () => {
    const counts = countByStatus([entry({ issue: 'a', status: 'Resolved' }), entry({ issue: 'b' })]);
    expect(counts).toEqual({ [STATUS.TREATING]: 0, [STATUS.NONE]: 1, [STATUS.RESOLVED]: 1 });
  });
});

describe('links out', () => {
  it('strips a written-down phone number to something dialable', () => {
    expect(telHref('(212) 555-1234')).toBe('tel:2125551234');
    expect(telHref('')).toBeNull();
  });

  it('only offers mailto for something that looks like an address', () => {
    expect(mailHref('drj.ccrscny@gmail.com')).toBe('mailto:drj.ccrscny@gmail.com');
    expect(mailHref('no address here')).toBeNull();
  });

  it('hands an address to a map search', () => {
    expect(mapHref('135 N 7th St, Brooklyn, NY 11211'))
      .toBe('https://www.google.com/maps/search/?api=1&query=135%20N%207th%20St%2C%20Brooklyn%2C%20NY%2011211');
    expect(mapHref('  ')).toBeNull();
  });

  it('refuses a link that is not http(s), so a pasted script cannot be clicked', () => {
    expect(safeLink('https://example.com/x')).toBe('https://example.com/x');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('not a url')).toBeNull();
  });

  it('shows a long link by its host rather than in full', () => {
    expect(linkLabel('https://www.google.com/search?q=angular+cheilitis&ei=verylong')).toBe('google.com');
    expect(linkLabel('nope')).toBe('');
  });
});

describe('seedDoctors', () => {
  const { entries } = seedDoctors();

  it('carries every row off the original sheet', () => {
    expect(entries).toHaveLength(11);
    expect(entries.every(hasContent)).toBe(true);
  });

  it('gives the rows stable ids so re-seeding cannot duplicate them', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(seedDoctors().entries.map((e) => e.id)).toEqual(ids);
  });

  it('has exactly one thing still being treated', () => {
    const treating = entries.filter((e) => e.status === STATUS.TREATING);
    expect(treating.map((e) => e.issue)).toEqual(['Plantar fasciitis (right foot): Happened second']);
  });

  it('keeps the contact details attached to the right doctor', () => {
    const sanjay = entries.find((e) => e.doctor === 'Sanjay Jobanputra');
    expect(sanjay).toMatchObject({
      email: 'drj.ccrscny@gmail.com',
      type: 'Colorectal',
      issue: 'Anal Fissure',
      status: STATUS.RESOLVED,
    });
  });

  it('keeps the primary physician’s cadence and its reminder note', () => {
    const sinai = entries.find((e) => e.type === 'Primary Physician');
    expect(sinai).toMatchObject({
      cadence: 'Every 2 year(s)',
      notes: 'Annual Medical (Last Friday in April)',
      location: '135 N 7th St, Brooklyn, NY 11211',
    });
    expect(sinai.status).toBe(STATUS.NONE);
  });

  it('leaves medication spellings exactly as they were written down', () => {
    const sanjay = entries.find((e) => e.doctor === 'Sanjay Jobanputra');
    expect(sanjay.currentMeds).toBe('Diltiazem 2% Lidocaine 5% (Metamusicil too)');
  });
});

describe('normalizeList types', () => {
  it('keeps the declared order of the headings', () => {
    const l = normalizeList({ types: ['Skin', 'Ear'], entries: [] });
    expect(l.types).toEqual(['Skin', 'Ear']);
  });

  it('folds a type spelled with different capitals into one heading', () => {
    expect(normalizeList({ types: ['Skin', 'skin', ' SKIN '], entries: [] }).types).toEqual(['Skin']);
  });

  it('rescues a type a record uses that the list has lost', () => {
    const l = normalizeList({ types: ['Skin'], entries: [{ type: 'Ear' }] });
    expect(l.types).toEqual(['Skin', 'Ear']);
  });

  it('survives a document with no types at all', () => {
    expect(normalizeList({ entries: [{ issue: 'x' }] }).types).toEqual([]);
  });
});

describe('groupByType', () => {
  const list = {
    types: ['Skin', 'Ear'],
    entries: [
      { id: '1', doctor: 'Zoe Skin', type: 'Skin', status: 'Resolved' },
      { id: '2', doctor: 'Adam Skin', type: 'skin', status: '-' },
      { id: '3', doctor: 'Ken Ear', type: 'Ear', status: 'Being Treated' },
      { id: '4', issue: 'Neck sprain', status: 'Resolved' },
    ],
  };

  it('runs the headings in the stored order, untyped last', () => {
    expect(groupByType(list).map((g) => g.type)).toEqual(['Skin', 'Ear', NO_TYPE]);
  });

  it('gathers a type spelled with different capitals under one heading', () => {
    const skin = groupByType(list).find((g) => g.type === 'Skin');
    expect(skin.entries).toHaveLength(2);
  });

  it('sorts alphabetically inside a heading', () => {
    const skin = groupByType(list).find((g) => g.type === 'Skin');
    expect(skin.entries.map((e) => e.doctor)).toEqual(['Adam Skin', 'Zoe Skin']);
  });

  it('drops a heading nothing is left under rather than showing it empty', () => {
    expect(groupByType(list, { query: 'neck' }).map((g) => g.type)).toEqual([NO_TYPE]);
  });

  it('filters by status across every heading at once', () => {
    const groups = groupByType(list, { status: STATUS.RESOLVED });
    expect(groups.map((g) => g.type)).toEqual(['Skin', NO_TYPE]);
  });

  it('reads a bare array of entries, from before types existed', () => {
    expect(groupByType([{ id: 'a', issue: 'Neck sprain' }]).map((g) => g.type)).toEqual([NO_TYPE]);
  });
});

describe('a card under its own type heading', () => {
  const gastro = normalizeEntry({ type: 'Gastroenterologist' });

  it('does not repeat the heading as its title', () => {
    expect(entryTitle(gastro, 'Gastroenterologist')).toBe('No doctor recorded yet');
  });

  it('still uses the type as a title away from that heading', () => {
    expect(entryTitle(gastro)).toBe('Gastroenterologist');
  });

  it('leaves the type out of the subtitle under its own heading', () => {
    const e = normalizeEntry({ doctor: 'Dr. Kim', type: 'Ear', place: 'Union Sq' });
    expect(entrySubtitle(e, 'Ear')).toBe('Union Sq');
    expect(entrySubtitle(e)).toBe('Union Sq · Ear');
  });

  it('keeps the issue as the title when the heading took the type', () => {
    const e = normalizeEntry({ type: 'Ear', issue: 'Eczema' });
    expect(entryTitle(e, 'Ear')).toBe('Eczema');
    expect(issueCell(e, 'Ear')).toBe('');
  });
});

describe('editing the type list', () => {
  const base = () => normalizeList({
    types: ['Skin', 'Ear', 'Dentist'],
    entries: [{ id: '1', doctor: 'A', type: 'Skin' }, { id: '2', doctor: 'B', type: 'Ear' }],
  });

  it('adds a type', () => {
    expect(addType(base(), 'Cardiology').types).toEqual(['Skin', 'Ear', 'Dentist', 'Cardiology']);
  });

  it('refuses a blank or duplicate type', () => {
    expect(addType(base(), '   ').types).toHaveLength(3);
    expect(addType(base(), 'skin').types).toHaveLength(3);
  });

  it('renames a type and carries its records along', () => {
    const l = renameType(base(), 'Skin', 'Dermatology');
    expect(l.types).toEqual(['Dermatology', 'Ear', 'Dentist']);
    expect(l.entries.find((e) => e.id === '1').type).toBe('Dermatology');
  });

  it('merges when renamed onto a type that already exists', () => {
    const l = renameType(base(), 'Skin', 'Ear');
    expect(l.types).toEqual(['Ear', 'Dentist']);
    expect(l.entries.every((e) => e.type === 'Ear')).toBe(true);
  });

  it('ignores a rename to nothing, or of a type that is not there', () => {
    expect(renameType(base(), 'Skin', '  ').types).toEqual(['Skin', 'Ear', 'Dentist']);
    expect(renameType(base(), 'Nope', 'X').types).toEqual(['Skin', 'Ear', 'Dentist']);
  });

  it('deleting a type keeps its records and drops them into No type', () => {
    const l = removeType(base(), 'Skin');
    expect(l.types).toEqual(['Ear', 'Dentist']);
    expect(l.entries).toHaveLength(2);
    expect(l.entries.find((e) => e.id === '1').type).toBe(NO_TYPE);
  });

  it('renaming or deleting a type leaves the rest of the list alone', () => {
    // Everything a list carries besides its types and records: an added column,
    // what the counter counts from, the hidden and reordered columns, and the
    // calendar appointments are read off.
    const dressed = normalizeList({
      ...addField(base(), { label: 'Last Visit', type: 'date' }),
      hiddenColumns: ['status'],
      columnOrder: ['status', 'name'],
      columnLabels: { name: 'Who' },
      calendar: { id: 'med@cal', name: 'Medical' },
    });
    const kept = (l) => ({
      fields: l.fields.length,
      daysSinceSource: l.daysSinceSource,
      hiddenColumns: l.hiddenColumns,
      columnOrder: l.columnOrder,
      columnLabels: l.columnLabels,
      calendar: l.calendar,
    });
    expect(kept(normalizeList(renameType(dressed, 'Skin', 'Dermatology')))).toEqual(kept(dressed));
    expect(kept(normalizeList(removeType(dressed, 'Skin')))).toEqual(kept(dressed));
  });

  it('reorders a type, and does nothing at either end', () => {
    expect(moveType(base(), 'Ear', -1).types).toEqual(['Ear', 'Skin', 'Dentist']);
    expect(moveType(base(), 'Ear', 1).types).toEqual(['Skin', 'Dentist', 'Ear']);
    expect(moveType(base(), 'Skin', -1).types).toEqual(['Skin', 'Ear', 'Dentist']);
    expect(moveType(base(), 'Dentist', 1).types).toEqual(['Skin', 'Ear', 'Dentist']);
  });

  it('counts what each type is carrying', () => {
    const { entries } = base();
    expect(typeUsage(entries, 'Skin')).toBe(1);
    expect(typeUsage(entries, 'Dentist')).toBe(0);
  });

  it('compares type names case- and space-insensitively', () => {
    expect(sameType(' SKIN ', 'skin')).toBe(true);
    expect(sameType('Skin', 'Ear')).toBe(false);
  });
});

describe('showsStatusBadge', () => {
  it('badges only what is news', () => {
    expect(showsStatusBadge(STATUS.TREATING)).toBe(true);
    expect(showsStatusBadge(STATUS.RESOLVED)).toBe(true);
    expect(showsStatusBadge(STATUS.NONE)).toBe(false);
  });
});

describe('seeded types', () => {
  it('seeds the speciality column in the order it was given', () => {
    expect(seedDoctors().types)
      .toEqual(['Gastroenterologist', 'Skin', 'Colorectal', 'Primary Physician', 'Dentist', 'Ear']);
  });

  it('gathers the untyped complaints under their own heading', () => {
    const groups = groupByType(seedDoctors());
    const untyped = groups.find((g) => g.type === NO_TYPE);
    expect(untyped.entries).toHaveLength(4);
    // It used to be pinned last. It no longer is: the pile holds the one record
    // still being treated, so it now sits above the specialities that are
    // entirely resolved. It is still last among the headings with nothing open.
    const open = groups.filter((g) => g.entries.some((e) => e.status !== 'resolved'));
    expect(open[open.length - 1].type).toBe(NO_TYPE);
  });

  it('files both skin records under the one Skin heading', () => {
    const skin = groupByType(seedDoctors()).find((g) => g.type === 'Skin');
    expect(skin.entries.map((e) => e.doctor)).toEqual(['Dr. Annemarie Uliasz, MD', 'Sochulak, Stephen']);
  });
});

describe('editing records a cell at a time', () => {
  const base = () => normalizeList({
    types: ['Skin', 'Ear'],
    entries: [
      { id: '1', doctor: 'Dr. A', type: 'Skin', issue: 'Rash' },
      { id: '2', doctor: 'Dr. B', type: 'Ear' },
    ],
  });
  const byId = (l, id) => l.entries.find((e) => e.id === id);

  it('patches one field and leaves the rest alone', () => {
    const l = updateEntry(base(), '1', { issue: 'Eczema' });
    expect(byId(l, '1')).toMatchObject({ doctor: 'Dr. A', type: 'Skin', issue: 'Eczema' });
  });

  it('patches several fields at once, as one cell can carry', () => {
    const l = updateEntry(base(), '1', { phone: '(212) 555-0199', email: 'a@b.c' });
    expect(byId(l, '1')).toMatchObject({ phone: '(212) 555-0199', email: 'a@b.c' });
  });

  it('trims what was typed', () => {
    expect(byId(updateEntry(base(), '1', { doctor: '  Dr. Aa  ' }), '1').doctor).toBe('Dr. Aa');
  });

  it('cannot be talked into changing a record id', () => {
    const l = updateEntry(base(), '1', { id: '999', doctor: 'X' });
    expect(l.entries.map((e) => e.id)).toEqual(['1', '2']);
    expect(byId(l, '1').doctor).toBe('X');
  });

  it('ignores a patch aimed at a record that is not there', () => {
    expect(updateEntry(base(), 'nope', { doctor: 'X' }).entries).toHaveLength(2);
  });

  it('registers a new type the moment a record starts using it', () => {
    const l = updateEntry(base(), '1', { type: 'Dermatology' });
    expect(l.types).toContain('Dermatology');
    expect(groupByType(l).map((g) => g.type)).toContain('Dermatology');
  });

  it('moves a record to another heading without touching the rest of it', () => {
    const l = updateEntry(base(), '1', { type: 'Ear' });
    const ear = groupByType(l).find((g) => g.type === 'Ear');
    expect(ear.entries.map((e) => e.id).sort()).toEqual(['1', '2']);
    expect(byId(l, '1').issue).toBe('Rash');
  });

  it('clears a field back to empty', () => {
    expect(byId(updateEntry(base(), '1', { issue: '' }), '1').issue).toBe('');
  });

  it('adds a record, with an id of its own', () => {
    const l = addEntry(base(), { doctor: 'Dr. C' });
    expect(l.entries).toHaveLength(3);
    expect(l.entries[2].doctor).toBe('Dr. C');
    expect(new Set(l.entries.map((e) => e.id)).size).toBe(3);
  });

  it('adds a blank record, which is what the table drops in to type into', () => {
    const l = addEntry(base(), {});
    expect(l.entries).toHaveLength(3);
    expect(isBlank(l.entries[2])).toBe(true);
    expect(groupByType(l).find((g) => g.type === NO_TYPE).entries).toHaveLength(1);
  });

  it('removes a record', () => {
    const l = removeEntry(base(), '1');
    expect(l.entries.map((e) => e.id)).toEqual(['2']);
  });

  it('ignores a remove for a record that is not there', () => {
    expect(removeEntry(base(), 'nope').entries).toHaveLength(2);
  });

  it('does not mutate what it was given', () => {
    const before = base();
    updateEntry(before, '1', { doctor: 'Changed' });
    removeEntry(before, '1');
    addEntry(before, { doctor: 'New' });
    expect(before.entries).toHaveLength(2);
    expect(byId(before, '1').doctor).toBe('Dr. A');
  });
});

describe('isBlank', () => {
  it('is true for a row added and never filled in', () => {
    expect(isBlank(normalizeEntry({}))).toBe(true);
  });

  it('is false as soon as anything is typed', () => {
    expect(isBlank(normalizeEntry({ phone: '555' }))).toBe(false);
  });
});

describe('columns of your own', () => {
  const withField = (label = 'Copay', type = 'text') =>
    addField(normalizeList({ entries: [{ id: '1', doctor: 'Dr. A' }, { id: '2', doctor: 'Dr. B' }] }), { label, type });
  const idOf = (l) => l.fields[0].id;

  it('adds a column', () => {
    const l = withField();
    expect(l.fields).toHaveLength(1);
    expect(l.fields[0]).toMatchObject({ label: 'Copay', type: 'text' });
    expect(l.fields[0].id).toBeTruthy();
  });

  it('refuses a column with no name', () => {
    expect(addField(normalizeList({ entries: [] }), { label: '  ' }).fields).toEqual([]);
  });

  it('stores a value against the record', () => {
    const l0 = withField();
    const l = setCustomValue(l0, '1', idOf(l0), '$40');
    expect(customValueOf(l.entries[0], l.fields[0])).toBe('$40');
    expect(customValueOf(l.entries[1], l.fields[0])).toBeUndefined();
  });

  it('coerces the value by the column’s own type', () => {
    const l0 = withField('Copay', 'number');
    const l = setCustomValue(l0, '1', idOf(l0), '$40');
    expect(customValueOf(l.entries[0], l.fields[0])).toBe(40);
  });

  it('keeps a value that cannot be coerced out of the record rather than storing junk', () => {
    const l0 = withField('Copay', 'number');
    const l = setCustomValue(l0, '1', idOf(l0), 'no idea');
    expect(customValueOf(l.entries[0], l.fields[0])).toBe('');
  });

  it('ignores a write to a column that is not there', () => {
    const l0 = withField();
    expect(setCustomValue(l0, '1', 'cf_nope', 'x').entries[0].custom).toEqual({});
  });

  it('renaming a column keeps every value attached', () => {
    const base = withField();
    const id = idOf(base);
    const withValue = setCustomValue(base, '1', id, '$40');
    const renamed = updateField(withValue, id, { label: 'Co-pay' });
    expect(renamed.fields[0].label).toBe('Co-pay');
    expect(renamed.fields[0].id).toBe(id);
    expect(customValueOf(renamed.entries[0], renamed.fields[0])).toBe('$40');
  });

  it('refuses a rename to nothing, which would drop the column', () => {
    const base = withField();
    expect(updateField(base, idOf(base), { label: '   ' }).fields).toHaveLength(1);
    expect(updateField(base, idOf(base), { label: '   ' }).fields[0].label).toBe('Copay');
  });

  it('cannot be talked into changing a column id', () => {
    const base = withField();
    const l = updateField(base, idOf(base), { id: 'cf_other', label: 'X' });
    expect(l.fields[0].id).toBe(idOf(base));
  });

  it('deleting a column takes its values with it', () => {
    const base = withField();
    const id = idOf(base);
    const withValue = setCustomValue(base, '1', id, '$40');
    expect(fieldUsage(withValue.entries, id)).toBe(1);
    const l = removeField(withValue, id);
    expect(l.fields).toEqual([]);
    expect(l.entries[0].custom).toEqual({});
    expect(l.entries).toHaveLength(2);
  });

  it('counts only the records actually carrying a value', () => {
    const base = withField();
    const id = idOf(base);
    expect(fieldUsage(base.entries, id)).toBe(0);
    const some = setCustomValue(setCustomValue(base, '1', id, 'x'), '2', id, '');
    expect(fieldUsage(some.entries, id)).toBe(1);
  });


  it('survives a document whose fields are malformed', () => {
    expect(normalizeList({ fields: 'nope', entries: [] }).fields).toEqual([]);
    expect(normalizeList({ fields: [{ label: 'no id' }], entries: [] }).fields).toEqual([]);
  });

  it('keeps custom values through a normalize round trip', () => {
    const base = withField();
    const id = idOf(base);
    const withValue = setCustomValue(base, '1', id, '$40');
    expect(normalizeList(JSON.parse(JSON.stringify(withValue))).entries[0].custom[id]).toBe('$40');
  });

  it('searches the added columns as well as the built-in ones', () => {
    const base = withField('Referred by');
    const id = idOf(base);
    const l = setCustomValue(base, '1', id, 'Aunt Carol');
    expect(matchesQuery(l.entries[0], 'aunt carol', l.fields)).toBe(true);
    expect(matchesQuery(l.entries[1], 'aunt carol', l.fields)).toBe(false);
    // groupByType passes the definitions through, so the page search reaches them.
    const groups = groupByType(l, { query: 'aunt carol' });
    expect(groups.flatMap((g) => g.entries).map((e) => e.id)).toEqual(['1']);
  });
});

describe('the columns, built-in and added alike', () => {
  const base = () => normalizeList({ entries: [{ id: '1', doctor: 'Dr. A' }] });
  const keys = (l) => resolveColumns(l).map((c) => c.key);
  const labels = (l) => resolveColumns(l).map((c) => c.label);
  const addCol = (l, label = 'Copay') => addField(l, { label });
  const lastId = (l) => l.fields[l.fields.length - 1].id;

  it('starts with the built-in columns, in their built order', () => {
    expect(keys(base())).toEqual(BUILTIN_COLUMNS.map((c) => c.key));
    expect(labels(base())).toEqual(['Doctor', 'Issue', 'Meds', 'Contact', 'Cadence', 'Days since', 'Next visit', 'Status']);
  });

  it('puts an added column on the end without any bookkeeping', () => {
    const l = addCol(base());
    expect(keys(l)).toHaveLength(9);
    expect(labels(l).at(-1)).toBe('Copay');
    expect(resolveColumns(l).at(-1).kind).toBe('custom');
  });

  it('renames a built-in column', () => {
    const l = renameColumn(base(), 'meds', 'Medication');
    expect(labels(l)[2]).toBe('Medication');
    expect(keys(l)[2]).toBe('meds');
  });

  it('renaming a built-in back to its default drops the override', () => {
    const l = renameColumn(renameColumn(base(), 'meds', 'Medication'), 'meds', 'Meds');
    expect(l.columnLabels).toEqual({});
  });

  it('renames an added column through the same door', () => {
    const l0 = addCol(base());
    const l = renameColumn(l0, lastId(l0), 'Co-pay');
    expect(labels(l).at(-1)).toBe('Co-pay');
    expect(l.fields[0].label).toBe('Co-pay');
  });

  it('refuses a rename to nothing', () => {
    expect(labels(renameColumn(base(), 'meds', '   '))[2]).toBe('Meds');
  });

  it('ignores a rename of a column that does not exist', () => {
    expect(labels(renameColumn(base(), 'nope', 'X'))).toEqual(labels(base()));
  });

  it('hides a built-in column without touching the records', () => {
    const l = setColumnHidden(base(), 'contact', true);
    expect(visibleColumns(l).map((c) => c.key)).not.toContain('contact');
    expect(resolveColumns(l).map((c) => c.key)).toContain('contact');
    expect(l.entries).toHaveLength(1);
  });

  it('unhiding brings it back where it was', () => {
    const hidden = setColumnHidden(base(), 'contact', true);
    expect(keys(setColumnHidden(hidden, 'contact', false))).toEqual(keys(base()));
    expect(visibleColumns(setColumnHidden(hidden, 'contact', false))).toHaveLength(8);
  });

  it('hiding twice does not stack up', () => {
    const l = setColumnHidden(setColumnHidden(base(), 'contact', true), 'contact', true);
    expect(l.hiddenColumns).toEqual(['contact']);
  });

  it('moves a column along the order, built-in or added', () => {
    expect(keys(moveColumn(base(), 'issue', -1)).slice(0, 2)).toEqual(['issue', 'name']);
    const l = addCol(base());
    const id = lastId(l);
    expect(keys(moveColumn(l, id, -1)).at(-2)).toBe(id);
  });

  it('lets an added column sit between two built-in ones', () => {
    let l = addCol(base());
    const id = lastId(l);
    l = moveColumn(l, id, -7);
    expect(keys(l)).toEqual(['name', id, 'issue', 'meds', 'contact', 'cadence', 'daysSince', 'nextVisit', 'status']);
  });

  it('does nothing at either end', () => {
    expect(keys(moveColumn(base(), 'name', -1))).toEqual(keys(base()));
    expect(keys(moveColumn(base(), 'status', 1))).toEqual(keys(base()));
  });

  it('a stored order survives a column being deleted since', () => {
    const l0 = addCol(base());
    const id = lastId(l0);
    const ordered = moveColumn(l0, id, -8);
    const l = removeField(ordered, id);
    expect(keys(l)).toEqual(BUILTIN_COLUMNS.map((c) => c.key));
  });

  it('a stored order missing a column still shows it, on the end', () => {
    const l = normalizeList({ entries: [], columnOrder: ['status', 'name'] });
    expect(keys(l)).toEqual(['status', 'name', 'issue', 'meds', 'contact', 'cadence', 'daysSince', 'nextVisit']);
  });

  it('survives a document whose column settings are malformed', () => {
    const l = normalizeList({ entries: [], columnOrder: 'nope', columnLabels: 'nope', hiddenColumns: 7 });
    expect(keys(l)).toEqual(BUILTIN_COLUMNS.map((c) => c.key));
    expect(visibleColumns(l)).toHaveLength(8);
  });
});

describe('parseCadence', () => {
  it('reads the shape the spreadsheet wrote, "(s)" and all', () => {
    expect(parseCadence('Every 6 months')).toEqual({ months: 6 });
    expect(parseCadence('Every 2 year(s)')).toEqual({ months: 24 });
    expect(parseCadence('Every 1 year(s)')).toEqual({ months: 12 });
  });

  it('reads it without the "every", and without the number', () => {
    expect(parseCadence('6 months')).toEqual({ months: 6 });
    expect(parseCadence('every month')).toEqual({ months: 1 });
    expect(parseCadence('every week')).toEqual({ days: 7 });
  });

  it('keeps months as months and days as days', () => {
    // 6 months is not 180 days — see the January 31st case below.
    expect(parseCadence('every 90 days')).toEqual({ days: 90 });
    expect(parseCadence('every 4 weeks')).toEqual({ days: 28 });
  });

  it('reads the words for it', () => {
    expect(parseCadence('Annually')).toEqual({ months: 12 });
    expect(parseCadence('quarterly')).toEqual({ months: 3 });
    expect(parseCadence('every other year')).toEqual({ months: 24 });
    expect(parseCadence('every other week')).toEqual({ days: 14 });
  });

  it('refuses the two words that mean two different things', () => {
    // "biannual" is read as both twice-a-year and every-two-years, and getting
    // it wrong puts a follow-up eighteen months out of place.
    expect(parseCadence('biannual')).toBeNull();
    expect(parseCadence('biennially')).toBeNull();
  });

  it('says nothing rather than guessing', () => {
    for (const v of ['', '-', 'as needed', 'when it flares up', null, undefined]) {
      expect(parseCadence(v)).toBeNull();
    }
  });
});

describe('nextVisit', () => {
  const on = (d) => new Date(`${d}T12:00:00`);

  it('counts the cadence forward from the last visit', () => {
    expect(nextVisit('2026-03-20', 'Every 6 months', on('2026-09-07')))
      .toMatchObject({ iso: '2026-09-20', label: '9/20/2026', daysAway: 13, overdue: false });
  });

  it('lands on the end of a short month rather than rolling into the next', () => {
    // Six months after 31 January is the last day of July; one month after it
    // is the last day of February, not the 3rd of March.
    expect(nextVisit('2026-01-31', 'every month', on('2026-01-31')).iso).toBe('2026-02-28');
    expect(nextVisit('2028-01-31', 'every month', on('2028-01-31')).iso).toBe('2028-02-29');
  });

  it('counts days as days', () => {
    expect(nextVisit('2026-03-20', 'every 90 days', on('2026-03-20')).iso).toBe('2026-06-18');
  });

  it('marks one that has gone past, and says how long ago', () => {
    const v = nextVisit('2024-01-10', 'Every 1 year(s)', on('2026-09-07'));
    expect(v).toMatchObject({ iso: '2025-01-10', overdue: true });
    expect(v.daysAway).toBe(-605);
  });

  it('marks the day itself as due, not overdue', () => {
    expect(nextVisit('2026-03-07', 'every 6 months', on('2026-09-07')))
      .toMatchObject({ daysAway: 0, overdue: false, due: true });
  });

  it('says nothing without both halves', () => {
    expect(nextVisit('', 'Every 6 months')).toBeNull();      // never been
    expect(nextVisit('2026-03-20', '')).toBeNull();          // no cadence recorded
    expect(nextVisit('2026-03-20', 'as needed')).toBeNull(); // one that isn't a schedule
    expect(nextVisit('sometime in March', 'every month')).toBeNull();
  });

  it('needs a year on the last visit — 3/20 could be any of them', () => {
    expect(nextVisit('3/20', 'every 6 months')).toBeNull();
    expect(nextVisit('3/20/2026', 'every 6 months').iso).toBe('2026-09-20');
  });
});

describe('check-ins and issues', () => {
  const dentist = { id: '1', doctor: 'Dentist', issue: 'Angular Cheilitis', status: 'resolved', cadence: 'Every 6 months' };
  const physical = { id: '2', doctor: 'Mount Sinai', cadence: 'Every 2 year(s)' };
  const sprain = { id: '3', issue: 'Neck sprain', status: 'resolved' };
  const treating = { id: '4', issue: 'Plantar fasciitis', status: 'treating' };
  const contact = { id: '5', doctor: 'Gastroenterologist' };

  it('calls a scheduled visit a check-in', () => {
    expect(isCheckInEntry(physical)).toBe(true);
    expect(isIssueEntry(physical)).toBe(false);
  });

  it('calls a complaint an issue', () => {
    expect(isIssueEntry(sprain)).toBe(true);
    expect(isIssueEntry(treating)).toBe(true);
    expect(isCheckInEntry(sprain)).toBe(false);
  });

  // The dentist is seen twice a year AND is where something got sorted out.
  // Hiding them from either tab would be wrong whichever one you picked.
  it('puts a record that is both under both', () => {
    expect(isCheckInEntry(dentist)).toBe(true);
    expect(isIssueEntry(dentist)).toBe(true);
  });

  it('keeps a bare contact somewhere rather than nowhere', () => {
    expect(isCheckInEntry(contact)).toBe(true);
    expect(isIssueEntry(contact)).toBe(false);
  });

  it('counts a cadence it cannot parse as an arrangement all the same', () => {
    expect(isCheckInEntry({ id: '6', issue: 'Back', status: 'treating', cadence: 'when it flares up' })).toBe(true);
  });

  it('reads a status as an issue even with the field left blank', () => {
    expect(isIssueEntry({ id: '7', doctor: 'Someone', status: 'treating' })).toBe(true);
  });

  it('counts each lane, and says so even when they overlap', () => {
    const list = { types: [], entries: [dentist, physical, sprain, treating, contact] };
    expect(laneCounts(list)).toEqual({ all: 5, checkins: 3, issues: 3, questions: 0 });
  });

  it('filters the grouped list down to one lane', () => {
    const list = { types: [], entries: [physical, sprain] };
    const names = (lane) => groupByType(list, { lane }).flatMap((g) => g.entries.map((e) => e.id));
    expect(names('checkins')).toEqual(['2']);
    expect(names('issues')).toEqual(['3']);
    expect(names('all').sort()).toEqual(['2', '3']);
  });

  it('still honours the search and status filters inside a lane', () => {
    const list = { types: [], entries: [sprain, treating] };
    expect(groupByType(list, { lane: 'issues', query: 'plantar' }).flatMap((g) => g.entries.map((e) => e.id)))
      .toEqual(['4']);
    expect(groupByType(list, { lane: 'issues', status: 'treating' }).flatMap((g) => g.entries.map((e) => e.id)))
      .toEqual(['4']);
  });
});

describe('settled things sink', () => {
  // Shaped like the real list: four specialities holding nothing but a resolved
  // complaint, one ongoing, and the untyped pile where the live one sits.
  const list = {
    types: ['Skin', 'Colorectal', 'Dentist', 'Ear', 'Hair'],
    entries: [
      { id: 'skin', type: 'Skin', issue: 'Jock itch', status: 'resolved' },
      { id: 'colo', type: 'Colorectal', issue: 'Anal fissure', status: 'resolved' },
      { id: 'dent', type: 'Dentist', issue: 'Angular cheilitis', status: 'resolved', cadence: 'Every 6 months' },
      { id: 'ear', type: 'Ear', issue: 'Eczema', status: 'resolved', cadence: 'Every 1 year(s)' },
      { id: 'hair', type: 'Hair', issue: 'Male pattern balding', status: 'none' },
      { id: 'levator', issue: 'Levator spasm', status: 'resolved' },
      { id: 'neck', issue: 'Neck sprain', status: 'resolved' },
      { id: 'pf-left', issue: 'Plantar fasciitis (left foot)', status: 'resolved' },
      { id: 'pf-right', issue: 'Plantar fasciitis (right foot)', status: 'treating' },
    ],
  };
  const headings = (lane = 'issues') => groupByType(list, { lane }).map((g) => g.type);
  const ids = (lane = 'issues') => groupByType(list, { lane }).flatMap((g) => g.entries.map((e) => e.id));

  it('puts what is still open above what is finished, within a heading', () => {
    const untyped = groupByType(list, { lane: 'issues' }).find((g) => g.type === '');
    expect(untyped.entries.map((e) => e.id))
      .toEqual(['pf-right', 'levator', 'neck', 'pf-left']);
  });

  it('floats a heading with something open above the settled ones', () => {
    // Hair is ongoing and the untyped pile still has one being treated, so both
    // come before the four specialities that are entirely resolved.
    expect(headings().slice(0, 2)).toEqual(['Hair', '']);
    expect(headings().slice(2)).toEqual(['Skin', 'Colorectal', 'Dentist', 'Ear']);
  });

  it('leaves the being-treated record at the top of its own heading', () => {
    // Not the top of the page: Hair is ongoing and sits earlier in the owner's
    // type order, and this rule only sinks headings with nothing left open —
    // it does not re-rank the ones that are still live against each other.
    expect(ids()[0]).toBe('hair');
    expect(ids()[1]).toBe('pf-right');
  });

  it('keeps the owner’s type order among headings that are equally settled', () => {
    // Skin/Colorectal/Dentist/Ear are all resolved — they stay in the order the
    // owner arranged, rather than being re-sorted by name.
    expect(headings().slice(2)).toEqual(['Skin', 'Colorectal', 'Dentist', 'Ear']);
  });

  it('sorts by name inside a status, as it always did', () => {
    const same = {
      types: ['Skin'],
      entries: [
        { id: 'z', type: 'Skin', doctor: 'Zeta', status: 'resolved' },
        { id: 'a', type: 'Skin', doctor: 'Alpha', status: 'resolved' },
      ],
    };
    expect(groupByType(same).flatMap((g) => g.entries.map((e) => e.id))).toEqual(['a', 'z']);
  });

  it('treats an unrecognised status as ongoing, not as settled', () => {
    const odd = { types: ['X'], entries: [{ id: 'odd', type: 'X', issue: 'thing', status: 'weird' }] };
    expect(groupByType(odd)[0].entries[0].id).toBe('odd');
    // and it does not sink the heading
    const mixed = {
      types: ['Done', 'Odd'],
      entries: [
        { id: 'd', type: 'Done', issue: 'a', status: 'resolved' },
        { id: 'o', type: 'Odd', issue: 'b', status: 'weird' },
      ],
    };
    expect(groupByType(mixed).map((g) => g.type)).toEqual(['Odd', 'Done']);
  });
});

// --- appointments off a Google Calendar -------------------------------------

const TODAY = new Date(2026, 8, 7); // 2026-09-07

// A list with one Date column and two records, the shape the page has once a
// "Last Visit" column exists.
function apptList() {
  let l = normalizeList({
    types: ['Dermatology', 'Dental'],
    entries: [
      { id: 'e1', doctor: 'Amy Chen', type: 'Dermatology', place: 'Newport Skin', cadence: 'Every 6 months' },
      { id: 'e2', doctor: 'Rob Salk', type: 'Dental', cadence: 'Every 6 months' },
    ],
  });
  l = addField(l, { label: 'Last Visit', type: 'date' });
  return l;
}
const dateFieldId = (l) => l.fields[0].id;
const ev = (o) => ({ id: 'g1', title: '', start: '', ...o });

describe('normalizeAppointments', () => {
  it('reads both shapes Google returns and sorts oldest first', () => {
    const out = normalizeAppointments([
      { eventId: 'b', start: '2026-03-12T14:00:00-04:00', title: 'Timed' },
      { eventId: 'a', date: '2026-01-05', title: 'All day' },
    ]);
    expect(out.map((a) => [a.eventId, a.date])).toEqual([['a', '2026-01-05'], ['b', '2026-03-12']]);
  });

  it('drops what it cannot count from, and repeats of one event', () => {
    const out = normalizeAppointments([
      { eventId: 'a', date: '2026-01-05' },
      { eventId: 'a', date: '2026-02-05' },
      { eventId: 'b', date: 'sometime' },
      { eventId: '', date: '2026-01-05' },
      null,
    ]);
    expect(out).toEqual([{ eventId: 'a', date: '2026-01-05', title: '' }]);
  });

  it('survives a round trip through the stored entry', () => {
    const e = normalizeEntry({ doctor: 'A', appointments: [{ eventId: 'a', date: '2026-01-05' }] });
    expect(normalizeEntry(e).appointments).toEqual([{ eventId: 'a', date: '2026-01-05', title: '' }]);
  });
});

describe('lastAppointment / nextAppointment', () => {
  const entry = normalizeEntry({
    doctor: 'A',
    appointments: [
      { eventId: 'past', date: '2026-03-12' },
      { eventId: 'today', date: '2026-09-07' },
      { eventId: 'soon', date: '2026-10-01' },
      { eventId: 'later', date: '2027-03-01' },
    ],
  });

  it('counts today as a visit had, not one to come', () => {
    expect(lastAppointment(entry, TODAY).eventId).toBe('today');
    expect(nextAppointment(entry, TODAY).eventId).toBe('soon');
  });

  it('is null on either side when there is nothing there', () => {
    const bare = normalizeEntry({ doctor: 'A' });
    expect(lastAppointment(bare, TODAY)).toBe(null);
    expect(nextAppointment(bare, TODAY)).toBe(null);
  });
});

describe('upcomingVisit', () => {
  it('prints the booked appointment rather than the cadence guess', () => {
    const entry = normalizeEntry({
      doctor: 'A', cadence: 'Every 6 months',
      appointments: [{ eventId: 'x', date: '2026-10-01', title: 'Dr Chen' }],
    });
    const out = upcomingVisit(entry, '2026-03-12', TODAY);
    expect(out.label).toBe('10/1/2026');
    expect(out.booked).toBe(true);
    expect(out.daysAway).toBe(24);
    expect(out.title).toBe('Dr Chen');
  });

  it('falls back to the cadence when nothing is booked', () => {
    const entry = normalizeEntry({ doctor: 'A', cadence: 'Every 6 months' });
    const out = upcomingVisit(entry, '2026-03-12', TODAY);
    expect(out.label).toBe('9/12/2026');
    expect(out.booked).toBe(false);
  });

  it('is null when there is neither', () => {
    expect(upcomingVisit(normalizeEntry({ doctor: 'A' }), '', TODAY)).toBe(null);
  });
});

describe('linkAppointment', () => {
  it('files the appointment and writes a past visit into the Date column', () => {
    const l = apptList();
    const f = dateFieldId(l);
    const out = linkAppointment(l, 'e1', ev({ start: '2026-03-12', title: 'Dr Chen' }), { dateFieldId: f, today: TODAY });
    const e1 = out.entries.find((e) => e.id === 'e1');
    expect(e1.appointments).toEqual([{ eventId: 'g1', date: '2026-03-12', title: 'Dr Chen' }]);
    expect(e1.custom[f]).toBe('2026-03-12');
  });

  it('leaves the Date column alone for one still to come', () => {
    const l = apptList();
    const f = dateFieldId(l);
    const out = linkAppointment(l, 'e1', ev({ start: '2026-10-01' }), { dateFieldId: f, today: TODAY });
    expect(out.entries.find((e) => e.id === 'e1').custom[f]).toBe(undefined);
  });

  it('never walks the last visit backwards', () => {
    const l = apptList();
    const f = dateFieldId(l);
    const recent = linkAppointment(l, 'e1', ev({ id: 'new', start: '2026-08-01' }), { dateFieldId: f, today: TODAY });
    const older = linkAppointment(recent, 'e1', ev({ id: 'old', start: '2026-01-05' }), { dateFieldId: f, today: TODAY });
    expect(older.entries.find((e) => e.id === 'e1').custom[f]).toBe('2026-08-01');
    expect(older.entries.find((e) => e.id === 'e1').appointments).toHaveLength(2);
  });

  it('moves an event rather than leaving it on two records', () => {
    const l = apptList();
    const first = linkAppointment(l, 'e1', ev({ start: '2026-03-12' }), { today: TODAY });
    const moved = linkAppointment(first, 'e2', ev({ start: '2026-03-12' }), { today: TODAY });
    expect(moved.entries.find((e) => e.id === 'e1').appointments).toEqual([]);
    expect(moved.entries.find((e) => e.id === 'e2').appointments).toHaveLength(1);
  });

  it('refuses an event with no day, and an unknown record', () => {
    const l = apptList();
    expect(linkAppointment(l, 'e1', ev({ start: 'whenever' }), { today: TODAY }).entries[0].appointments).toEqual([]);
    expect(linkAppointment(l, 'nope', ev({ start: '2026-03-12' }), { today: TODAY }).entries[0].appointments).toEqual([]);
  });
});

describe('ignoring and unlinking', () => {
  it('waves an event off so it stops being offered', () => {
    const out = ignoreAppointment(apptList(), 'g1');
    expect(settledEventIds(out).has('g1')).toBe(true);
    expect(pendingAppointments(out, [ev({ start: '2026-03-12' })])).toEqual([]);
  });

  it('takes an event back off a record without touching the date it wrote', () => {
    const l = apptList();
    const f = dateFieldId(l);
    const linked = linkAppointment(l, 'e1', ev({ start: '2026-03-12' }), { dateFieldId: f, today: TODAY });
    const out = unlinkAppointment(linked, 'g1');
    expect(out.entries.find((e) => e.id === 'e1').appointments).toEqual([]);
    expect(out.entries.find((e) => e.id === 'e1').custom[f]).toBe('2026-03-12');
  });

  it('linking a waved-off event takes it back off the ignore list', () => {
    const ignored = ignoreAppointment(apptList(), 'g1');
    const out = linkAppointment(ignored, 'e1', ev({ start: '2026-03-12' }), { today: TODAY });
    expect(out.ignoredEvents).toEqual([]);
  });

  it('unignoring puts it back among the suggestions', () => {
    const out = unignoreAppointment(ignoreAppointment(apptList(), 'g1'), 'g1');
    expect(pendingAppointments(out, [ev({ start: '2026-03-12' })])).toHaveLength(1);
  });
});

describe('suggestEntryFor', () => {
  const entries = apptList().entries;

  it('matches on the doctor’s name, however the calendar wrote it', () => {
    expect(suggestEntryFor({ title: 'Dr. Chen 2pm' }, entries)).toMatchObject({ entryId: 'e1', reason: 'name' });
    expect(suggestEntryFor({ title: 'Amy Chen follow-up' }, entries)).toMatchObject({ entryId: 'e1' });
  });

  it('matches on the place when the name is not there', () => {
    expect(suggestEntryFor({ title: 'Bloods', location: 'Newport Skin' }, entries)).toMatchObject({ entryId: 'e1', reason: 'place' });
  });

  it('will not name a record off a speciality alone', () => {
    expect(suggestEntryFor({ title: 'Dermatology' }, entries)).toBe(null);
  });

  it('offers nothing for an event with no word worth reading', () => {
    expect(suggestEntryFor({ title: 'Appointment' }, entries)).toBe(null);
    expect(suggestEntryFor({ title: '' }, entries)).toBe(null);
  });

  it('picks the stronger match when two records could fit', () => {
    const both = [
      ...entries,
      normalizeEntry({ id: 'e3', doctor: 'Chen Wu', type: 'Dermatology' }),
    ];
    expect(suggestEntryFor({ title: 'Amy Chen, Newport Skin' }, both).entryId).toBe('e1');
  });
});

describe('pendingAppointments', () => {
  const events = [
    ev({ id: 'a', start: '2026-03-12', title: 'Dr. Chen' }),
    ev({ id: 'b', start: '2026-10-01', title: 'Teeth cleaning — Salk' }),
    ev({ id: 'c', start: '2026-06-01', title: 'Lunch with Kate' }),
  ];

  it('offers everything undecided, latest first, each with its guess', () => {
    const out = pendingAppointments(apptList(), events);
    expect(out.map((e) => e.eventId)).toEqual(['b', 'c', 'a']);
    expect(out.find((e) => e.eventId === 'a').suggestion.entryId).toBe('e1');
    expect(out.find((e) => e.eventId === 'b').suggestion.entryId).toBe('e2');
    expect(out.find((e) => e.eventId === 'c').suggestion).toBe(null);
  });

  it('drops the ones already linked or waved off', () => {
    let l = linkAppointment(apptList(), 'e1', events[0], { today: TODAY });
    l = ignoreAppointment(l, 'c');
    expect(pendingAppointments(l, events).map((e) => e.eventId)).toEqual(['b']);
  });

  it('only ever suggests a check-in record', () => {
    const withIssue = normalizeList({
      entries: [{ id: 'i1', doctor: 'Amy Chen', issue: 'Rash', status: 'Being Treated' }],
    });
    expect(pendingAppointments(withIssue, [events[0]])[0].suggestion).toBe(null);
  });
});

describe('setDoctorCalendar', () => {
  it('remembers which calendar, and forgets it again', () => {
    const on = setDoctorCalendar(apptList(), 'med@group.calendar.google.com', 'Medical');
    expect(on.calendar).toEqual({ id: 'med@group.calendar.google.com', name: 'Medical' });
    expect(setDoctorCalendar(on, '', '').calendar).toEqual({ id: '', name: '' });
  });

  it('keeps what was already linked when the calendar changes', () => {
    const linked = linkAppointment(apptList(), 'e1', ev({ start: '2026-03-12' }), { today: TODAY });
    const swapped = setDoctorCalendar(linked, 'other', 'Other');
    expect(swapped.entries.find((e) => e.id === 'e1').appointments).toHaveLength(1);
  });
});

describe('questions', () => {
  const base = () => normalizeList({
    types: ['Skin', 'Dentist'],
    entries: [
      { id: 'd1', doctor: 'Dr. Uliasz', type: 'Skin' },
      { id: 'd2', place: '34th St Dental', type: 'Dentist' },
    ],
  });

  it('writes one down against a record, newest first', () => {
    let l = addQuestion(base(), { text: 'Is the mole changing?', entryId: 'd1' });
    l = addQuestion(l, { text: 'Night guard worth it?', entryId: 'd2' });
    expect(l.questions.map((q) => q.text)).toEqual(['Night guard worth it?', 'Is the mole changing?']);
    expect(l.questions[1].entryId).toBe('d1');
    expect(l.questions[0].answered).toBe(false);
  });

  it('refuses a blank one', () => {
    expect(addQuestion(base(), { text: '   ', entryId: 'd1' }).questions).toHaveLength(0);
  });

  it('keeps one that is not for anybody in particular', () => {
    const l = addQuestion(base(), { text: 'Ask whoever I see next about the rash' });
    expect(l.questions[0].entryId).toBe('');
  });

  it('tags and untags, and remembers the tag either way', () => {
    let l = addQuestion(base(), { text: 'Is the mole changing?', entryId: 'd1' });
    const id = l.questions[0].id;
    l = toggleQuestionTag(l, id, 'Follow up');
    expect(l.questions[0].tags).toEqual(['Follow up']);
    expect(l.questionTags).toContain('Follow up');
    l = toggleQuestionTag(l, id, 'Follow up');
    expect(l.questions[0].tags).toEqual([]);
    expect(l.questionTags).toContain('Follow up'); // a tag used once is a tag you meant
  });

  it('answers one without losing what was asked', () => {
    let l = addQuestion(base(), { text: 'Night guard worth it?', entryId: 'd2' });
    l = updateQuestion(l, l.questions[0].id, { answered: true, answer: 'Yes — get fitted in spring' });
    expect(l.questions[0]).toMatchObject({
      text: 'Night guard worth it?', answered: true, answer: 'Yes — get fitted in spring',
    });
  });

  it('counts only the ones still to ask on the tab', () => {
    let l = addQuestion(base(), { text: 'One', entryId: 'd1' });
    l = addQuestion(l, { text: 'Two', entryId: 'd1' });
    l = updateQuestion(l, l.questions.find((q) => q.text === 'One').id, { answered: true });
    expect(laneCounts(l).questions).toBe(1);
  });

  it('retires a tag off the vocabulary and off every question', () => {
    let l = addQuestion(base(), { text: 'One', entryId: 'd1' });
    l = toggleQuestionTag(l, l.questions[0].id, 'Meds');
    l = removeQuestionTag(l, 'Meds');
    expect(l.questionTags).not.toContain('Meds');
    expect(l.questions[0].tags).toEqual([]);
    expect(l.questions[0].text).toBe('One'); // the question itself survives
  });

  it('deletes one', () => {
    let l = addQuestion(base(), { text: 'One', entryId: 'd1' });
    l = addQuestion(l, { text: 'Two', entryId: 'd1' });
    l = removeQuestion(l, l.questions.find((q) => q.text === 'One').id);
    expect(l.questions.map((q) => q.text)).toEqual(['Two']);
  });

  it('adds a tag to the vocabulary before anything wears it', () => {
    const l = addQuestionTag(base(), 'Insurance');
    expect(l.questionTags).toEqual(['Insurance']);
    expect(addQuestionTag(l, 'insurance').questionTags).toEqual(['Insurance']); // already there
    expect(addQuestionTag(l, '   ').questionTags).toEqual(['Insurance']);
  });

  it('matches on the question, the answer or a tag', () => {
    const q = normalizeQuestion({ text: 'Is the mole changing?', answer: 'Watch it', tags: ['Follow up'] });
    expect(questionMatches(q, 'mole')).toBe(true);
    expect(questionMatches(q, 'watch')).toBe(true);
    expect(questionMatches(q, 'follow')).toBe(true);
    expect(questionMatches(q, 'mole watch follow')).toBe(true); // every word has to land
    expect(questionMatches(q, 'dentist')).toBe(false);
    expect(questionMatches(q, '')).toBe(true);
  });

  it('groups under the record, in the order the table has them', () => {
    let l = addQuestion(base(), { text: 'Mole?', entryId: 'd1' });
    l = addQuestion(l, { text: 'Guard?', entryId: 'd2' });
    l = addQuestion(l, { text: 'Whoever I see next', entryId: '' });
    const groups = groupQuestions(l, { answered: 'all' });
    expect(groups.map((g) => g.entryId)).toEqual(['d1', 'd2', '']);
    expect(groups[2].entry).toBe(null); // the loose ones come last, under no record
  });

  it('leaves out a record with nothing to ask', () => {
    const l = addQuestion(base(), { text: 'Mole?', entryId: 'd1' });
    expect(groupQuestions(l, { answered: 'all' }).map((g) => g.entryId)).toEqual(['d1']);
  });

  it('sinks the answered ones within a record', () => {
    let l = addQuestion(base(), { text: 'Older', entryId: 'd1' });
    l = addQuestion(l, { text: 'Newer', entryId: 'd1' });
    l = updateQuestion(l, l.questions.find((q) => q.text === 'Newer').id, { answered: true });
    const [group] = groupQuestions(l, { answered: 'all' });
    expect(group.questions.map((q) => q.text)).toEqual(['Older', 'Newer']);
  });

  it('filters by tag, by answeredness and by what is typed', () => {
    let l = addQuestion(base(), { text: 'Is the mole changing?', entryId: 'd1' });
    l = toggleQuestionTag(l, l.questions[0].id, 'Follow up');
    l = addQuestion(l, { text: 'Night guard worth it?', entryId: 'd2' });
    l = updateQuestion(l, l.questions[0].id, { answered: true, answer: 'Yes, in spring' });

    expect(groupQuestions(l, { tag: 'Follow up', answered: 'all' })).toHaveLength(1);
    expect(groupQuestions(l, { answered: 'open' })[0].questions[0].text).toBe('Is the mole changing?');
    expect(groupQuestions(l, { answered: 'answered' })[0].questions[0].text).toBe('Night guard worth it?');
    expect(groupQuestions(l, { query: 'spring', answered: 'all' })[0].questions[0].answer).toBe('Yes, in spring');
    expect(groupQuestions(l, { query: 'nothing here', answered: 'all' })).toEqual([]);
  });

  it('counts each tag, ignoring the answered', () => {
    let l = addQuestion(base(), { text: 'One', entryId: 'd1' });
    l = toggleQuestionTag(l, l.questions[0].id, 'Meds');
    l = addQuestion(l, { text: 'Two', entryId: 'd1' });
    l = toggleQuestionTag(l, l.questions.find((q) => q.text === 'Two').id, 'Meds');
    expect(questionTagCounts(l).Meds).toBe(2);
    l = updateQuestion(l, l.questions.find((q) => q.text === 'Two').id, { answered: true });
    expect(questionTagCounts(l).Meds).toBe(1);
  });

  it('survives a round trip through the saved document', () => {
    let l = addQuestion(base(), { text: 'Is the mole changing?', entryId: 'd1' });
    l = toggleQuestionTag(l, l.questions[0].id, 'Follow up');
    const reloaded = normalizeList(JSON.parse(JSON.stringify(l)));
    expect(reloaded.questions).toEqual(l.questions);
    expect(reloaded.questionTags).toEqual(l.questionTags);
  });

  it('is not eaten by renaming or deleting a speciality', () => {
    let l = addQuestion(base(), { text: 'Is the mole changing?', entryId: 'd1' });
    l = toggleQuestionTag(l, l.questions[0].id, 'Follow up');
    expect(normalizeList(renameType(l, 'Skin', 'Dermatology')).questions).toHaveLength(1);
    expect(normalizeList(removeType(l, 'Skin')).questionTags).toContain('Follow up');
  });
});

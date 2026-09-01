import { describe, it, expect } from 'vitest';
import {
  STATUS, NO_TYPE, parseStatus, normalizeEntry, normalizeList, hasContent, entryTitle,
  entrySubtitle, matchesQuery, groupByType, countByStatus, cardRows, typeUsage,
  addType, renameType, removeType, moveType, sameType, showsStatusBadge,
  telHref, mailHref, mapHref, safeLink, linkLabel, seedDoctors,
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

describe('cardRows', () => {
  it('drops the issue row when the issue is already the card title', () => {
    expect(cardRows(entry({ issue: 'Neck sprain' }))).toEqual([]);
  });

  it('keeps the issue row when something else titles the card', () => {
    expect(cardRows(entry({ doctor: 'Dr. Kim', issue: 'Eczema' }))).toEqual(['issue']);
  });

  it('lists the rest in reading order and skips the empty ones', () => {
    const e = entry({ doctor: 'Dr. Kim', issue: 'Eczema', currentMeds: 'X', cadence: 'Every 1 year(s)' });
    expect(cardRows(e)).toEqual(['issue', 'currentMeds', 'cadence']);
  });

  it('leaves contact details to the buttons', () => {
    expect(cardRows(entry({ doctor: 'Dr. Kim', phone: '555', email: 'a@b.c', location: 'X' }))).toEqual([]);
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
    expect(cardRows(e, 'Ear')).toEqual([]);
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

  it('puts the untyped complaints last, under their own heading', () => {
    const groups = groupByType(seedDoctors());
    expect(groups[groups.length - 1].type).toBe(NO_TYPE);
    expect(groups[groups.length - 1].entries).toHaveLength(4);
  });

  it('files both skin records under the one Skin heading', () => {
    const skin = groupByType(seedDoctors()).find((g) => g.type === 'Skin');
    expect(skin.entries.map((e) => e.doctor)).toEqual(['Dr. Annemarie Uliasz, MD', 'Sochulak, Stephen']);
  });
});

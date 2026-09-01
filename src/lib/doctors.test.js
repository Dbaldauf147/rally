import { describe, it, expect } from 'vitest';
import {
  STATUS, parseStatus, normalizeEntry, normalizeList, hasContent, entryTitle,
  matchesQuery, groupByStatus, countByStatus, cardRows, telHref, mailHref, mapHref,
  safeLink, linkLabel, seedDoctors,
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

describe('groupByStatus', () => {
  const entries = [
    entry({ issue: 'Neck sprain', status: 'Resolved' }),
    entry({ issue: 'Plantar fasciitis (right foot)', status: 'Being Treated' }),
    entry({ type: 'Gastroenterologist', status: '-' }),
    entry({ doctor: 'Aaron Adams', status: 'Resolved' }),
  ];

  it('runs live issues first, then ongoing care, then history', () => {
    expect(groupByStatus(entries).map((g) => g.status))
      .toEqual([STATUS.TREATING, STATUS.NONE, STATUS.RESOLVED]);
  });

  it('sorts alphabetically inside a group by whatever titles the row', () => {
    const resolved = groupByStatus(entries).find((g) => g.status === STATUS.RESOLVED);
    expect(resolved.entries.map(entryTitle)).toEqual(['Aaron Adams', 'Neck sprain']);
  });

  it('leaves out a group with nothing in it rather than a bare heading', () => {
    expect(groupByStatus(entries, { query: 'plantar' }).map((g) => g.status))
      .toEqual([STATUS.TREATING]);
  });

  it('narrows to one status without disturbing the order of the rest', () => {
    const groups = groupByStatus(entries, { status: STATUS.RESOLVED });
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
  });

  it('applies the search and the status filter together', () => {
    expect(groupByStatus(entries, { status: STATUS.RESOLVED, query: 'gastro' })).toEqual([]);
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

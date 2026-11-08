import { describe, it, expect } from 'vitest';
import { steakhouseListOn, steakhouseSummary, guysNightSections, formatGuysNightDate, spotLink, isSteakhouse } from './guysNight.js';
import { steakhouseEmail, steakhouseRecipients } from './guysNightEmail.js';
import { buildNextRound } from './pollSeries.js';

const spot = (o) => ({ status: 'want-to-try', cuisines: ['Steakhouse'], locations: ['Manhattan'], ...o });
// Shaped like the list the owner pasted: 8 to go, 6 done, one ruled out.
const LIST = [
  spot({ id: '1', name: 'Benjamin Steakhouse' }),
  spot({ id: '2', name: "Bobby Van's" }),
  spot({ id: '3', name: 'Peter Luger Steak House', status: 'visited', locations: ['Williamsburg'], lastVisit: '2024-01-01' }),
  spot({ id: '4', name: 'Hawksmoor NYC', status: 'visited', guysNightDone: true, guysNightDates: ['2025-12-22'] }),
  spot({ id: '5', name: 'Keens Steakhouse', status: 'visited', guysNightDone: true, guysNightDates: ['2021-11-04', 'bad'] }),
  spot({ id: '6', name: 'Quality Meats', guysNightDone: true }),
  spot({ id: '7', name: 'Outback', guysNightSkip: true }),
  { id: '8', name: 'Joe’s Pizza', status: 'want-to-try', cuisines: ['Pizza'] },
  spot({ id: '9', name: 'Wolfgang’s', nextSpot: true, notes: 'secret', rating: 5 }),
  { id: '10', name: 'Old categories row', status: 'want-to-try', categories: ['steak'] },
];

describe('steakhouseListOn', () => {
  it('shows on a steak-night title unless switched off, or anywhere switched on', () => {
    expect(steakhouseListOn({ title: 'Steak Night' })).toBe(true);
    expect(steakhouseListOn({ title: 'Steak Night', steakhouseList: false })).toBe(false);
    expect(steakhouseListOn({ title: 'Guys Night Out', steakhouseList: true })).toBe(true);
    expect(steakhouseListOn({ title: 'Mistake review' })).toBe(false);
    expect(steakhouseListOn(null)).toBe(false);
  });
});

describe('steakhouseSummary', () => {
  const s = steakhouseSummary(LIST);
  it('splits steakhouses into still to go and done, leaving ruled-out and non-steak spots off', () => {
    expect(s.todo.map((x) => x.name)).toEqual(['Wolfgang’s', 'Benjamin Steakhouse', "Bobby Van's", 'Old categories row', 'Peter Luger Steak House']);
    expect(s.done.map((x) => x.name)).toEqual(['Hawksmoor NYC', 'Keens Steakhouse', 'Quality Meats']);
    expect(s).toMatchObject({ total: 8, doneCount: 3 });
  });
  it('carries only what the card shows, with clean dates', () => {
    const w = s.todo[0];
    expect(w).toEqual({ id: '9', name: 'Wolfgang’s', url: '', address: '', area: 'Manhattan', dish: '', visited: false, next: true, dates: [] });
    expect(s.done[1].dates).toEqual(['2021-11-04']);
    expect(JSON.stringify(s)).not.toContain('secret');
  });
  it('mirrors Prep Day: a marked spot stays listed even without the steak tag', () => {
    expect(guysNightSections([{ id: 'x', name: 'X', guysNightDone: true }]).done).toHaveLength(1);
    expect(isSteakhouse({ cuisines: ['Pizza'] })).toBe(false);
  });
});

describe('formatting', () => {
  it('reads a day without a timezone shift', () => {
    expect(formatGuysNightDate('2025-12-22')).toBe('Dec 22, 2025');
  });
  it('links to the spot, or to a Maps search for it', () => {
    expect(spotLink({ name: 'A', url: 'https://a.example' })).toBe('https://a.example');
    expect(spotLink({ name: 'Keens', area: 'Manhattan', url: 'javascript:alert(1)' })).toContain('google.com/maps/search');
  });
});

describe('the email', () => {
  const event = {
    title: 'Steak Night',
    hiddenFrom: ['hidden@x.com'],
    members: {
      u1: { name: 'Dan Baldauf', email: 'Dan@x.com', role: 'owner' },
      u2: { name: 'Mike Smith', email: 'mike@x.com' },
      u3: { name: 'No Email' },
      u4: { name: 'Dupe', email: 'mike@x.com' },
      u5: { name: 'Hidden', email: 'hidden@x.com' },
    },
  };
  it('goes to everyone on the event with an email, organizer included, once each', () => {
    expect(steakhouseRecipients(event).map((r) => r.email)).toEqual(['dan@x.com', 'mike@x.com']);
  });
  it('lists still to go and done with dates and a link back', () => {
    const summary = steakhouseSummary(LIST);
    const { subject, html } = steakhouseEmail({ event, eventId: 'E1', summary, member: event.members.u2, fromName: 'Dan' });
    expect(subject).toBe('🥩 Steak Night: the steakhouse list — 3 of 8 done');
    expect(html).toContain('Hey Mike');
    expect(html).toContain('Still to go (5)');
    expect(html).toContain('Done (3)');
    expect(html).toContain('Went Dec 22, 2025');
    expect(html).toContain('★ Next');
    expect(html).toContain('/event/E1');
    expect(html).toContain('Bobby Van&#39;s');
    expect(html).not.toContain('Outback');
  });
});

describe('next round', () => {
  it('keeps the steakhouse setting', () => {
    const base = { title: 'Steak Night', pollSeries: { everyMonths: 12, round: 1 }, members: {}, memberUids: [] };
    expect(buildNextRound({ ...base, steakhouseList: false }, 'E').doc.steakhouseList).toBe(false);
    expect(buildNextRound(base, 'E').doc.steakhouseList).toBeUndefined();
  });
});

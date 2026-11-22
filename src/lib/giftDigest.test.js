import { describe, it, expect } from 'vitest';
import { secretSantaGifts } from './giftDigest';

const today = new Date(2026, 10, 22);
const me = { uid: 'dan', email: 'dan@x.com' };
const friends = [
  { id: 'j', name: 'Joanne (Joo Yeon) Seo', giftIdeas: ['Candle'] },
  { id: 's', name: 'Sally Baldauf', giftIdeas: ['Garden gloves'] },
  { id: 'm', name: 'Milan Sova', email: 'milan@x.com', giftIdeas: ['Whisky'] },
  { id: 'a', name: 'Amy Baldauf', email: 'amy@x.com' },
];
const pair = (g, r) => ({ giver: { key: g, name: g, email: `${g}@x.com` }, receiver: { key: r, name: r, email: `${r}@x.com` } });
const xmas = {
  id: 'e1', title: 'Christmas', secretSanta: { enabled: true }, date: new Date(2026, 11, 25),
  members: { dan: { name: 'Dan' }, milan: { name: 'Milan Sova', email: 'milan@x.com' }, amy: { name: 'Amy Baldauf', email: 'amy@x.com' } },
};
const userDoc = {
  secretSanta: {
    e1: { 2026: { pairs: [pair('dan', 'milan'), pair('milan', 'amy'), pair('amy', 'dan')] }, 2025: { pairs: [pair('dan', 'amy')] } },
    'e1~sibs': { 2026: { pairs: [pair('dan', 'amy'), pair('amy', 'dan')] } },
  },
  secretSantaDraws: { e1: [{ id: 'sibs', name: 'Sibs' }, { id: 'kids', name: 'Kids' }] },
  giftPeople: { e1: ['Uncle Bob'] },
};
const run = (over = {}) => secretSantaGifts({ events: [xmas], userDoc, friends, me, today, ...over });

describe('secretSantaGifts', () => {
  it('lists my pick in each exchange, then Joanne, Mom, Dad and the extras', () => {
    const [g] = run();
    expect(g).toMatchObject({ eventId: 'e1', title: 'Christmas', year: 2026, daysUntil: 33 });
    expect(g.rows).toEqual([
      { role: 'Secret Santa pick', name: 'Milan Sova', found: true, ideas: ['Whisky'] },
      { role: 'Secret Santa pick — Sibs', name: 'Amy Baldauf', found: true, ideas: [] },
      { role: 'Secret Santa pick — Kids', name: null, found: false, ideas: [] },
      { role: 'Also buying for', name: 'Joanne (Joo Yeon) Seo', found: true, ideas: ['Candle'] },
      { role: 'Mom', name: 'Sally Baldauf', found: true, ideas: ['Garden gloves'] },
      { role: 'Dad', name: 'Brian Baldauf', found: false, ideas: [] },
      { role: 'Also buying for', name: 'Uncle Bob', found: false, ideas: [] },
    ]);
  });

  it('waits for names to be drawn, and drops the event once it has passed', () => {
    expect(run({ userDoc: { ...userDoc, secretSanta: { e1: { 2025: userDoc.secretSanta.e1[2025] } } } })).toEqual([]);
    expect(run({ today: new Date(2026, 11, 25) })).toHaveLength(1);
    expect(run({ today: new Date(2026, 11, 26) })).toEqual([]);
  });

  it('follows a yearly event to the occurrence coming next', () => {
    const yearly = { ...xmas, date: new Date(2024, 11, 25), recurrence: { freq: 'yearly', mode: 'date', month: 12, day: 25 } };
    expect(run({ events: [yearly] })[0]).toMatchObject({ year: 2026, daysUntil: 33 });
    expect(run({ events: [yearly], today: new Date(2026, 11, 26) })).toEqual([]); // 2027: nothing drawn yet
  });

  it('skips events that are cancelled or have no Secret Santa', () => {
    expect(run({ events: [{ ...xmas, cancelled: true }, { ...xmas, id: 'e2', secretSanta: null }] })).toEqual([]);
    expect(run({ events: null, userDoc: null })).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  normalizeHiddenFrom, isHiddenFrom, visibleEvents,
  addHiddenFrom, removeHiddenFrom, hiddenPeople,
} from './eventVisibility';

const party = { id: 'p', title: 'Surprise 40th', hiddenFrom: ['Joanne@Example.com'] };

describe('hiddenFrom', () => {
  it('stores addresses lowercased, once each, and ignores what is not one', () => {
    expect(normalizeHiddenFrom([' A@b.com ', 'a@B.com', 'joanne', '', null, 7]))
      .toEqual(['a@b.com']);
    expect(normalizeHiddenFrom('nope')).toEqual([]);
  });

  it('matches the person however their address is typed', () => {
    expect(isHiddenFrom(party, ' JOANNE@example.com ')).toBe(true);
    expect(isHiddenFrom(party, 'someone@example.com')).toBe(false);
    // No address, nobody hidden — a signed-out reader isn't "everyone".
    expect(isHiddenFrom(party, '')).toBe(false);
    expect(isHiddenFrom({}, 'joanne@example.com')).toBe(false);
  });

  it('drops the event from that person’s list and nobody else’s', () => {
    const list = [party, { id: 'o', title: 'Ski trip' }];
    expect(visibleEvents(list, 'joanne@example.com').map((e) => e.id)).toEqual(['o']);
    expect(visibleEvents(list, 'dan@example.com').map((e) => e.id)).toEqual(['p', 'o']);
  });

  it('refuses to hide the event from the organizer or from yourself', () => {
    const except = ['dan@example.com', 'Me@example.com'];
    expect(addHiddenFrom([], 'dan@example.com', { except })).toEqual([]);
    expect(addHiddenFrom([], 'me@example.com', { except })).toEqual([]);
    expect(addHiddenFrom([], 'not an email', { except })).toEqual([]);
    expect(addHiddenFrom(['a@b.com'], 'Joanne@Example.com', { except })).toEqual(['a@b.com', 'joanne@example.com']);
    // Twice is once.
    expect(addHiddenFrom(['joanne@example.com'], 'joanne@example.com')).toEqual(['joanne@example.com']);
  });

  it('unhides', () => {
    expect(removeHiddenFrom(['joanne@example.com', 'a@b.com'], 'JOANNE@example.com')).toEqual(['a@b.com']);
  });

  it('names the hidden people from the guest list where it can', () => {
    const event = {
      hiddenFrom: ['joanne@example.com', 'ghost@example.com'],
      members: { u1: { name: 'Joanne', email: 'Joanne@example.com' }, u2: null, u3: { name: 'Dan', email: 'dan@example.com' } },
    };
    expect(hiddenPeople(event)).toEqual([
      { email: 'joanne@example.com', name: 'Joanne' },
      { email: 'ghost@example.com', name: '' },
    ]);
  });
});

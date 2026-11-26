import { describe, expect, it } from 'vitest';
import { jaroWinkler, nameScore, suggestGuestNames, unclaimedGuests, SUGGEST_THRESHOLD } from './weddingNameSuggest';

const g = (id, firstName, lastName, extra = {}) => ({ id, firstName, lastName, ...extra });

describe('jaroWinkler', () => {
  it('is 1 for the same word and 0 for nothing in common', () => {
    expect(jaroWinkler('smith', 'smith')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
  it('scores a one-letter typo highly', () => {
    expect(jaroWinkler('erlich', 'ehrlich')).toBeGreaterThan(0.9);
  });
});

describe('nameScore', () => {
  const close = (a, b) => expect(nameScore(a, b)).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
  const far = (a, b) => expect(nameScore(a, b)).toBeLessThan(SUGGEST_THRESHOLD);
  it('matches typos, short forms, initials and bracketed notes', () => {
    close('Dave Erlich', 'Dave Ehrlich');
    close('Sebastain Wernecke', 'Sebastian Wernecke');
    close('Matt Wildermuth', 'Matthew Wildermuth');
    close('Amanda L', 'Amanda LeFebrve');
    close('Amanda Smith (Scharali)', 'Amanda Smith');
    close('Alex Cavallo', 'Alex Cavalo');
  });
  it('ignores case, accents and punctuation', () => {
    close("bill o'neill", 'Bill ONeill');
    close('José Perez', 'Jose Perez');
  });
  it('does not match a different person who shares one name', () => {
    far('Adam Herzog', 'Adam Baldauf');
    far('Brian Baldauf', 'Sally Baldauf');
    far('Kenny Smith', 'Kyle Smith');
    far('Brandon Cho', 'Bruce Ihm');
  });
  it('matches a first name alone to a full name with that first name', () => {
    close('Kayleigh', 'Kayleigh Graci');
    close('Brandon', 'Brandon Cho');
    far('Kayla', 'Kayleigh Graci');
  });
});

describe('unclaimedGuests', () => {
  it('leaves out guests a friend already has by link, name, email or phone', () => {
    const friends = [{ id: 'f1', name: 'Ann Way' }, { id: 'f2', name: 'X', email: 'b@x.com' }, { id: 'f3', name: 'Y', phone: '(631) 555-0100' }];
    const contacts = [
      g('linked', 'Zed', 'Q', { friendId: 'f1' }),
      g('dangling', 'Zed', 'R', { friendId: 'gone' }),
      g('byname', 'Ann', 'Way'),
      g('byemail', 'B', 'C', { email: 'B@x.com' }),
      g('byphone', 'D', 'E', { phone: '6315550100' }),
      g('free', 'Free', 'Guest'),
    ];
    expect(unclaimedGuests(contacts, friends).map((c) => c.id)).toEqual(['dangling', 'free']);
  });
});

describe('suggestGuestNames', () => {
  it('suggests the closest unclaimed guest', () => {
    const missing = [{ id: 'f1', name: 'Dave Erlich' }, { id: 'f2', name: 'Nobody Here' }];
    const contacts = [g('a', 'Dave', 'Ehrlich'), g('b', 'Susan', 'Ehrlich')];
    const m = suggestGuestNames(missing, contacts, missing);
    expect(m.get('f1').name).toBe('Dave Ehrlich');
    expect(m.get('f1').guest.id).toBe('a');
    expect(m.has('f2')).toBe(false);
  });
  it('offers nothing when a first name alone fits two guests', () => {
    const missing = [{ id: 'f1', name: 'Brandon' }];
    expect(suggestGuestNames(missing, [g('a', 'Brandon', 'Cho'), g('b', 'Brandon', 'Lee')], missing).has('f1')).toBe(false);
  });
  it('offers nothing when two different guests tie', () => {
    const missing = [{ id: 'f1', name: 'Amanda S' }];
    const contacts = [g('a', 'Amanda', 'Smith'), g('b', 'Amanda', 'Stone')];
    expect(suggestGuestNames(missing, contacts, missing).has('f1')).toBe(false);
  });
  it('does not offer a guest another friend already accounts for', () => {
    const friends = [{ id: 'f1', name: 'Matt Borek' }, { id: 'f2', name: 'Matthew Borek' }];
    const contacts = [g('a', 'Matthew', 'Borek', { friendId: 'f2' })];
    expect(suggestGuestNames([friends[0]], contacts, friends).has('f1')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { cleanNumber, smsLink, recipientsFor, togglePicked, textProgress } from './textDraft';

describe('cleanNumber', () => {
  it('takes numbers as people type them', () => {
    expect(cleanNumber('(917) 555-0142')).toBe('+19175550142');
    expect(cleanNumber('917.555.0142')).toBe('+19175550142');
    expect(cleanNumber('19175550142')).toBe('+19175550142');
    expect(cleanNumber('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('has nothing to say about nothing', () => {
    expect(cleanNumber('')).toBe('');
    expect(cleanNumber(null)).toBe('');
    expect(cleanNumber('no phone')).toBe('');
  });
});

describe('smsLink', () => {
  it('opens one person\'s thread with the message in it', () => {
    expect(smsLink('(917) 555-0142', 'Pick a date?'))
      .toBe('sms:+19175550142?body=Pick%20a%20date%3F');
  });

  it('uses the form iOS will prefill', () => {
    expect(smsLink('9175550142', 'Hi', { ios: true }))
      .toBe('sms:/open?addresses=+19175550142&body=Hi');
  });

  it('puts several people in one thread', () => {
    expect(smsLink(['9175550142', '9175550143'], 'Hi'))
      .toBe('sms:+19175550142,+19175550143?body=Hi');
    expect(smsLink(['9175550142', '9175550143'], 'Hi', { ios: true }))
      .toBe('sms:/open?addresses=+19175550142,+19175550143&body=Hi');
  });

  it('drops the numbers it cannot dial, and gives nothing when none are left', () => {
    expect(smsLink(['9175550142', 'ask Ann'], 'Hi')).toBe('sms:+19175550142?body=Hi');
    expect(smsLink([], 'Hi')).toBe('');
    expect(smsLink(['nope'], 'Hi')).toBe('');
  });
});

describe('recipientsFor', () => {
  const members = [
    ['ann', { name: 'Ann', phone: '9175550142' }],
    ['ben', { name: 'Ben', phone: '9175550143' }],
    ['cal', { name: 'Cal' }], // no phone
  ];

  it('follows the audience when nobody has been picked', () => {
    expect(recipientsFor(members).map(([uid]) => uid)).toEqual(['ann', 'ben']);
    expect(recipientsFor(members, { inAudience: (uid) => uid === 'ben' }).map(([uid]) => uid)).toEqual(['ben']);
  });

  it('follows the ticks once people are picked, audience and all', () => {
    const picked = new Set(['ann']);
    expect(recipientsFor(members, { picked, inAudience: () => false }).map(([uid]) => uid)).toEqual(['ann']);
  });

  it('never includes somebody with no number to text', () => {
    expect(recipientsFor(members, { picked: new Set(['cal']) })).toEqual([]);
    expect(recipientsFor(members, { picked: new Set() })).toEqual([]);
  });
});

describe('togglePicked', () => {
  it('ticks on and off without touching the set it was given', () => {
    const first = togglePicked(null, 'ann');
    expect([...first]).toEqual(['ann']);
    const second = togglePicked(first, 'ben');
    expect([...second]).toEqual(['ann', 'ben']);
    expect([...togglePicked(second, 'ann')]).toEqual(['ben']);
    expect([...second]).toEqual(['ann', 'ben']); // unchanged
  });
});

describe('textProgress', () => {
  const at = (iso) => ({ phone: '9175550142', texted: iso });

  it('counts only the people texted since this draft was opened', () => {
    const openedAt = Date.parse('2026-09-18T10:00:00Z');
    const { done, todo } = textProgress([
      ['ann', at('2026-09-18T10:05:00Z')], // this send
      ['ben', at('2026-08-01T09:00:00Z')], // weeks ago, about something else
      ['cal', { phone: '9175550144' }], // never
    ], openedAt);
    expect(done.map(([uid]) => uid)).toEqual(['ann']);
    expect(todo.map(([uid]) => uid)).toEqual(['ben', 'cal']);
  });

  it('treats everyone as still to do for a fresh draft', () => {
    const { done, todo } = textProgress([['ann', at('2026-09-18T10:05:00Z')]], Date.now() + 1000);
    expect(done).toEqual([]);
    expect(todo).toHaveLength(1);
  });

  it('survives a rubbish timestamp and an empty list', () => {
    expect(textProgress([['ann', at('whenever')]], 0).todo).toHaveLength(1);
    expect(textProgress(null, 0)).toEqual({ done: [], todo: [] });
  });
});

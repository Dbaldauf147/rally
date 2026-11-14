import { describe, it, expect } from 'vitest';
import { shownTabs, tabSetting, eventTabContent, tabsForSave } from './eventTabs';

const off = { day: false, meals: false, notes: false, expenses: false, chat: false };
const none = { itinerary: false, travel: false, lodging: false };

describe('shownTabs', () => {
  it('shows none of them on an event with nothing in them', () => {
    expect(shownTabs({ title: 'Secret Santa', planning: none, date: new Date() })).toEqual(off);
    expect(shownTabs({ tabs: off })).toEqual(off);
  });
  it('shows the ones switched on', () => {
    expect(shownTabs({ tabs: { ...off, chat: true, meals: true } })).toEqual({ ...off, chat: true, meals: true });
  });
  it('keeps an unset tab that has something in it', () => {
    expect(shownTabs({ notes: [{ id: 'n' }] }).notes).toBe(true);
    expect(shownTabs({ foodMenu: { enabled: true } }).meals).toBe(true);
    expect(shownTabs({ members: { a: { foodOrder: { text: 'salmon' } } } }).meals).toBe(true);
    expect(shownTabs({}, { chat: true }).chat).toBe(true);
    expect(shownTabs({}, { expenses: true }).expenses).toBe(true);
  });
  it('lets a tab be switched off even with something in it', () => {
    expect(shownTabs({ tabs: { notes: false }, notes: [{ id: 'n' }] }).notes).toBe(false);
    expect(shownTabs({ tabs: { chat: false } }, { chat: true }).chat).toBe(false);
  });
  it('decides each tab on its own', () => {
    expect(shownTabs({ tabs: { chat: true }, notes: [{ id: 'n' }] }, { expenses: false }))
      .toEqual({ day: false, meals: false, notes: true, expenses: false, chat: true });
  });
});

describe('tabSetting / eventTabContent', () => {
  it('reads only real booleans as a choice', () => {
    expect(tabSetting({ tabs: { chat: true } }, 'chat')).toBe(true);
    expect(tabSetting({ tabs: { chat: false } }, 'chat')).toBe(false);
    expect(tabSetting({ tabs: { chat: 'yes' } }, 'chat')).toBeNull();
    expect(tabSetting({}, 'chat')).toBeNull();
  });
  it('does not count empty leftovers as content', () => {
    expect(eventTabContent({ notes: [], foodMenu: { enabled: false, options: [] }, members: { a: { foodOrder: { choice: '', text: ' ' } }, b: null } }))
      .toEqual({ day: false, meals: false, notes: false });
  });
});

describe('tabsForSave', () => {
  it('spells out all four on a new event', () => {
    expect(tabsForSave({ chat: true }, off, true)).toEqual({ tabs: { ...off, chat: true } });
  });
  it('writes only what changed on an edit', () => {
    expect(tabsForSave({ ...off, chat: true }, off, false)).toEqual({ 'tabs.chat': true });
    expect(tabsForSave({ ...off, notes: true }, { ...off, notes: true, meals: true }, false)).toEqual({ 'tabs.meals': false });
    expect(tabsForSave(off, off, false)).toEqual({});
  });
});

describe('the Day tab', () => {
  const date = new Date(2026, 10, 1);
  it('follows trip planning until it is set by hand', () => {
    expect(shownTabs({ date, planning: none }).day).toBe(false);
    expect(shownTabs({ date, planning: { ...none, itinerary: true } }).day).toBe(true);
    expect(shownTabs({ date, planning: none, dailyNames: { '2026-11-01': 'Arrival' } }).day).toBe(true);
    // An event from before the planning question keeps what it always had.
    expect(shownTabs({ date }).day).toBe(true);
    expect(shownTabs({ planning: { ...none, itinerary: true } }).day).toBe(false);
  });
  it('can be switched on or off regardless', () => {
    expect(shownTabs({ date, planning: none, tabs: { day: true } }).day).toBe(true);
    expect(shownTabs({ date, planning: { ...none, itinerary: true }, tabs: { day: false } }).day).toBe(false);
  });
});

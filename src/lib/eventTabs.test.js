import { describe, it, expect } from 'vitest';
import { shownTabs, tabSetting, eventTabContent, tabsForSave } from './eventTabs';

const off = { meals: false, notes: false, expenses: false, chat: false };

describe('shownTabs', () => {
  it('shows none of them on an event with nothing in them', () => {
    expect(shownTabs({ title: 'Secret Santa' })).toEqual(off);
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
      .toEqual({ meals: false, notes: true, expenses: false, chat: true });
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
      .toEqual({ meals: false, notes: false });
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

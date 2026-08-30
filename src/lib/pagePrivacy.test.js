import { describe, it, expect } from 'vitest';
import { pageKey, pageLabel, canBePrivate, isOwnerEmail } from './pagePrivacy';

describe('pageKey', () => {
  it('uses the first path segment', () => {
    expect(pageKey('/plans')).toBe('plans');
    expect(pageKey('/travel-list')).toBe('travel-list');
  });

  it('calls the root "dashboard"', () => {
    expect(pageKey('/')).toBe('dashboard');
    expect(pageKey('')).toBe('dashboard');
  });

  it('collapses every id under one key, so hiding is stable as ids change', () => {
    expect(pageKey('/event/abc123')).toBe('event');
    expect(pageKey('/event/zzz999')).toBe('event');
    expect(pageKey('/trip/xyz')).toBe('trip');
  });

  it('ignores a query string and a trailing slash', () => {
    expect(pageKey('/plans?view=today')).toBe('plans');
    expect(pageKey('/plans/')).toBe('plans');
  });

  it('is case-insensitive', () => {
    expect(pageKey('/Plans')).toBe('plans');
  });
});

describe('canBePrivate', () => {
  it('refuses the routes that work without an account', () => {
    // Hiding these would break invite and poll links already sent to people.
    for (const key of ['login', 'invite', 'poll', 'boat', 'share']) {
      expect(canBePrivate(key)).toBe(false);
    }
  });

  it('allows ordinary pages', () => {
    for (const key of ['plans', 'friends', 'expenses', 'event', 'dashboard']) {
      expect(canBePrivate(key)).toBe(true);
    }
  });
});

describe('pageLabel', () => {
  it('names known pages', () => {
    expect(pageLabel('expenses')).toBe('Trip Expenses');
    expect(pageLabel('travel-list')).toBe('Travel List');
  });

  it('falls back to the key, so a new route still gets a usable button', () => {
    expect(pageLabel('brand-new-page')).toBe('brand-new-page');
  });
});

describe('isOwnerEmail', () => {
  it('matches the owner regardless of case or padding', () => {
    expect(isOwnerEmail('baldaufdan@gmail.com')).toBe(true);
    expect(isOwnerEmail('  BaldaufDan@Gmail.com ')).toBe(true);
  });

  it('rejects everyone else, including lookalikes', () => {
    expect(isOwnerEmail('baldaufdanwork@gmail.com')).toBe(false);
    expect(isOwnerEmail('baldaufdan@gmail.com.evil.com')).toBe(false);
    expect(isOwnerEmail('')).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
  });
});

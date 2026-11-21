// Wishlists for an event's Secret Santa (see lib/secretSanta.js).
//
// Every guest of an event with a Secret Santa can write down what they would
// like, on a page that needs no sign-in: /wishlist/:eventId. Whoever drew them
// reads it there.
//
// Unlike the draw, a wishlist is meant to be read by the other guests, so it
// sits on the event doc, which they can all read:
//   events/{id}.wishlists.{memberKey} = { items: [{ id, text, link }], updatedAt }
// keyed by the same key the person has in `members`. Nothing about who drew
// whom is kept here — everyone's list is on the page, each one wrapped until
// it is clicked, so opening somebody's says nothing about who you have.
//
// Pure: no Firebase or DOM imports, so it can be tested.
import { APP_URL } from './pollSeriesEmail.js';

export const MAX_WISHES = 30;
export const MAX_WISH_TEXT = 140;
const MAX_LINK = 500;

const clip = (s, n) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const norm = (s) => String(s ?? '').trim().toLowerCase();

/** A link somebody typed, as an http(s) URL — or '' when it isn't one. */
export function cleanLink(raw) {
  let s = String(raw ?? '').trim();
  if (!s || /\s/.test(s) || s.length > MAX_LINK) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname.includes('.')) return '';
    return u.href;
  } catch {
    return '';
  }
}

/** One saved wish, tidied — or null when it says nothing. */
export function cleanWish(raw) {
  const text = clip(raw?.text, MAX_WISH_TEXT);
  if (!text) return null;
  const id = String(raw?.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  return { id: id || newWishId(), text, link: cleanLink(raw?.link) };
}

/** A saved list of wishes with anything malformed dropped. */
export function cleanWishes(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const wish = cleanWish(raw);
    if (!wish) continue;
    while (seen.has(wish.id)) wish.id = newWishId();
    seen.add(wish.id);
    out.push(wish);
    if (out.length >= MAX_WISHES) break;
  }
  return out;
}

export const newWishId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** One person's wishes off the event. */
export function wishesOf(event, key) {
  return cleanWishes(event?.wishlists?.[key]?.items);
}

/**
 * Everyone who has a present on the page, by name: the event's named guests
 * who haven't said no, plus anyone who wrote a list before saying no.
 * [{ key, name, wishes }]
 */
export function wishlistPeople(event) {
  const members = event?.members && typeof event.members === 'object' ? event.members : {};
  const out = [];
  for (const [key, m] of Object.entries(members)) {
    if (!m || typeof m !== 'object') continue;
    const name = clip(m.name, 80);
    if (!name) continue;
    const wishes = wishesOf(event, key);
    if (m.rsvp === 'no' && wishes.length === 0) continue;
    out.push({ key, name, wishes });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Which guest a visitor is, when the page can tell without asking: the first
 * of `candidates` (the key their link named, the one an earlier visit
 * remembered, their account's own row) that is on the page. Null when they
 * have to pick their name.
 */
export function whoAmI(people, candidates = []) {
  return candidates.find((k) => !!k && people.some((p) => p.key === k)) || null;
}

/** The member key of the guest with this email, for a signed-in visitor. */
export function memberKeyByEmail(event, email) {
  const e = norm(email);
  if (!e) return null;
  const hit = Object.entries(event?.members || {}).find(([, m]) => m && typeof m === 'object' && norm(m.email) === e);
  return hit ? hit[0] : null;
}

/** The page's path within the app; `me` makes it open as that guest. */
export function wishlistPath(eventId, me = '') {
  const base = `/wishlist/${encodeURIComponent(eventId)}`;
  return me ? `${base}?me=${encodeURIComponent(me)}` : base;
}

/** Its full address, for an email or a copied link. */
export const wishlistLink = (eventId, me = '') => APP_URL + wishlistPath(eventId, me);

// The link in a Secret Santa email (see lib/secretSanta.js).
//
// The email doesn't say who you drew. It carries a button to a page that keeps
// the name covered until you tap Reveal, so opening the email next to someone
// gives nothing away.
//
// Everything that page shows travels in the link itself, packed and encoded,
// because the draw is stored where only the organizer can read it — there is
// nothing for a guest's browser to look up. The encoding keeps the name from
// being read off the address at a glance; it is not encryption, and the link
// is as private as the email it arrived in.
import { APP_URL } from './pollSeriesEmail.js';

const clip = (s, n) => String(s ?? '').trim().slice(0, n);

/** Pack what the reveal page needs into a URL-safe string. */
export function encodeReveal({ giverName, receiverName, eventTitle, when, location, note, fromName, eventId, giverKey }) {
  const json = JSON.stringify({
    g: clip(giverName, 80), r: clip(receiverName, 80), t: clip(eventTitle, 120),
    w: clip(when, 80), l: clip(location, 160), n: clip(note, 1000), f: clip(fromName, 80),
    // Where the wishlists are (lib/wishlist.js), and who is opening them.
    ...(clip(eventId, 80) ? { e: clip(eventId, 80), k: clip(giverKey, 200) } : {}),
  });
  let bin = '';
  for (const byte of new TextEncoder().encode(json)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Unpack it. Null for anything that isn't one of ours, or names nobody. */
export function decodeReveal(code) {
  try {
    const b64 = String(code || '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (!o || typeof o !== 'object' || !clip(o.r, 80)) return null;
    return {
      giverName: clip(o.g, 80), receiverName: clip(o.r, 80), eventTitle: clip(o.t, 120),
      when: clip(o.w, 80), location: clip(o.l, 160), note: clip(o.n, 1000), fromName: clip(o.f, 80),
      // Links sent before wishlists existed carry neither.
      ...(clip(o.e, 80) ? { eventId: clip(o.e, 80), giverKey: clip(o.k, 200) } : {}),
    };
  } catch {
    return null;
  }
}

export const revealLink = (details) => `${APP_URL}/santa?k=${encodeReveal(details)}`;

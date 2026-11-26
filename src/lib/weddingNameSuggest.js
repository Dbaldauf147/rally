/* "Did you mean…?" for the Friends-not-on-list page.

   A friend lands on that page when no guest shares their link, exact name,
   email or phone (lib/weddingFriendMatch.js). Often the guest is there under a
   slightly different name: a typo ("Erlich" / "Ehrlich"), a short form
   ("Matt" / "Matthew"), an initial ("Amanda L" / "Amanda LeFebrve") or a note
   in brackets ("Amanda Smith (Scharali)"). This finds that guest so the friend
   can be renamed to match, which puts them on the list by name.

   Only guests no friend already accounts for are offered: renaming a friend
   onto a guest who already has their friend would just make a second contact
   with the same name.

   Pure: no React, no Firestore. */

import { normEmail, normName, normPhone } from './weddingFriendMatch';

// The score a suggestion needs, out of 1.
export const SUGGEST_THRESHOLD = 0.86;

const words = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’.]/g, '')
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

// The name with anything in brackets left out: "Amanda Smith (Scharali)".
const withoutBrackets = (s) => String(s || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');

export function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array(a.length).fill(false);
  const bHit = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j += 1) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = true;
      bHit[j] = true;
      matches += 1;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k += 1;
    if (a[i] !== b[k]) t += 1;
    k += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

// One word against another: the same, an initial of it, a short form of it
// (Matt/Matthew, Chris/Christopher), or a near-spelling.
function wordScore(a, b) {
  if (a === b) return 1;
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.9 : 0;
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  return jaroWinkler(a, b);
}

function scoreWords(f, g) {
  if (!f.length || !g.length) return 0;
  const first = wordScore(f[0], g[0]);
  // A one-word name ("Kayleigh") can only be judged on the first name, so it
  // never counts as more than a likely match.
  if (f.length === 1 || g.length === 1) return f.length === g.length ? first : first * 0.9;
  const last = wordScore(f[f.length - 1], g[g.length - 1]);
  // Both halves have to be close: Adam Herzog is not Adam Baldauf.
  if (Math.min(first, last) < 0.8) return Math.min(first, last) * 0.5;
  return (first + last) / 2;
}

/** How alike a friend's name and a guest's full name are, 0–1. */
export function nameScore(friendName, guestName) {
  const g = words(guestName);
  const plain = scoreWords(words(friendName), g);
  const bare = words(withoutBrackets(friendName));
  // Without the bracketed note it's a slightly weaker match, so a guest who
  // really has that note in their name still wins.
  return Math.max(plain, bare.length ? scoreWords(bare, g) * 0.97 : 0);
}

export const guestFullName = (g) => `${g?.firstName || ''} ${g?.lastName || ''}`.trim().replace(/\s+/g, ' ');

/* The guests no friend already accounts for: not linked to a friend who
   exists, and no friend has their name, email or phone. */
export function unclaimedGuests(contacts, friends) {
  const ids = new Set();
  const names = new Set();
  const emails = new Set();
  const phones = new Set();
  for (const f of friends || []) {
    ids.add(f.id);
    const n = normName(f.name);
    if (n) names.add(n);
    for (const e of [f.email, f.workEmail]) if (normEmail(e)) emails.add(normEmail(e));
    if (normPhone(f.phone)) phones.add(normPhone(f.phone));
  }
  return (contacts || []).filter((c) => {
    if (c.friendId && ids.has(c.friendId)) return false;
    const n = normName(`${c.firstName || ''}${c.lastName || ''}`);
    if (!n || names.has(n)) return false;
    if (normEmail(c.email) && emails.has(normEmail(c.email))) return false;
    if (normPhone(c.phone) && phones.has(normPhone(c.phone))) return false;
    return true;
  });
}

/* friendId → { guest, name, score } for every friend in `missing` with a
   guest close enough. When two guests tie for a friend it's a guess, so
   neither is offered. */
export function suggestGuestNames(missing, contacts, friends) {
  const pool = unclaimedGuests(contacts, friends).map((g) => ({ guest: g, name: guestFullName(g) }));
  const out = new Map();
  for (const f of missing || []) {
    let best = null;
    let tie = false;
    for (const p of pool) {
      const score = nameScore(f.name, p.name);
      if (score < SUGGEST_THRESHOLD) continue;
      if (!best || score > best.score + 0.001) { best = { ...p, score }; tie = false; }
      else if (Math.abs(score - best.score) <= 0.001 && normName(p.name) !== normName(best.name)) tie = true;
    }
    if (best && !tie) out.set(f.id, best);
  }
  return out;
}

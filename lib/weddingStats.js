// Guest-list status, computed from the Wedding page's contacts.
//
// The page holds one row per person, but a wedding is mailed to *households* —
// one invitation to "Bill & Laurie O'Neill", not two. Nearly every number worth
// reporting is therefore a household number, and the guest count is the thing
// that gets quoted to a caterer. Both are here.
//
// Pure: no Firestore, no DOM, no network, so the digest and the tests can share
// it. Lives outside api/ so Vercel doesn't route it as a function.

const clean = (v) => String(v ?? '').trim();
const lower = (v) => clean(v).toLowerCase();

export const fullName = (c) => [clean(c?.firstName), clean(c?.lastName)].filter(Boolean).join(' ');

// A mailable address needs all four parts. A street with no city can't be
// posted, so counting it as "has an address" would overstate how ready the
// list is — which is the one thing this digest exists to tell you.
export function hasMailableAddress(c) {
  return !!(clean(c?.address) && clean(c?.city) && clean(c?.state) && clean(c?.zip));
}

/* Group contacts into households by street address.
 *
 * Keyed on address + zip rather than address alone: "147 Highland Avenue"
 * exists in more than one town, and merging two families into one invitation is
 * a worse error than splitting one. Anyone without a street address can't be
 * grouped at all, so each becomes their own household and is flagged. */
export function households(contacts) {
  const byKey = new Map();
  const out = [];
  for (const c of contacts || []) {
    const addr = lower(c?.address);
    if (!addr) {
      // No address to group on — stands alone, and needs one.
      out.push({ key: null, members: [c], mailable: false, address: '' });
      continue;
    }
    const key = `${addr}|${lower(c?.zip)}`;
    if (byKey.has(key)) {
      byKey.get(key).members.push(c);
      continue;
    }
    const h = {
      key,
      members: [c],
      // Judged on the first member seen; the rest of a household shares it.
      mailable: hasMailableAddress(c),
      address: [clean(c.address), clean(c.city), clean(c.state), clean(c.zip)].filter(Boolean).join(', '),
    };
    byKey.set(key, h);
    out.push(h);
  }
  return out;
}

// "Bill & Laurie O'Neill" — how the envelope would read, used in the
// missing-address list so a household is recognisable at a glance.
export function householdLabel(h) {
  const names = (h?.members || []).map(fullName).filter(Boolean);
  if (names.length === 0) return 'Unnamed';
  if (names.length === 1) return names[0];
  const last = clean(h.members[0]?.lastName);
  const shareLast = h.members.every((m) => clean(m?.lastName) === last) && last;
  if (shareLast) {
    const firsts = h.members.map((m) => clean(m?.firstName)).filter(Boolean);
    return `${firsts.join(' & ')} ${last}`;
  }
  return names.join(' & ');
}

// Counts keyed by a field, with blanks collected under one bucket so the
// ungrouped are visible rather than silently missing from the total.
function tally(contacts, field, blankLabel) {
  const counts = new Map();
  for (const c of contacts || []) {
    const key = clean(c?.[field]) || blankLabel;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      // The blank bucket sits last however big it is — it's a gap, not a group.
      if (a.label === blankLabel) return 1;
      if (b.label === blankLabel) return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

/* Everything the weekly email reports, from one pass over the list. */
export function weddingStats(contacts) {
  const list = Array.isArray(contacts) ? contacts.filter(Boolean) : [];
  const hh = households(list);
  const missing = hh.filter((h) => !h.mailable);
  return {
    guests: list.length,
    households: hh.length,
    mailable: hh.length - missing.length,
    missingAddress: missing.length,
    // Named so the email can say who to chase, not just how many.
    missingAddressNames: missing.map(householdLabel).sort((a, b) => a.localeCompare(b)),
    missingEmail: list.filter((c) => !clean(c?.email)).length,
    missingPhone: list.filter((c) => !clean(c?.phone)).length,
    byGroup: tally(list, 'group', 'No group'),
    byCategory: tally(list, 'category', 'No category'),
  };
}

/* Week-over-week movement.
 *
 * Compared against the counts saved on the last send rather than against
 * timestamps on the contacts: rows carry no created-at, and importing a
 * spreadsheet rewrites the whole array, so any per-row date would be fiction.
 * A first run has nothing to compare with and reports no deltas at all rather
 * than pretending the entire list arrived this week. */
export function statsDelta(current, previous) {
  if (!previous || typeof previous !== 'object') return null;
  const d = (key) => {
    const now = Number(current?.[key]);
    const before = Number(previous?.[key]);
    if (!Number.isFinite(now) || !Number.isFinite(before)) return 0;
    return now - before;
  };
  const delta = {
    guests: d('guests'),
    households: d('households'),
    mailable: d('mailable'),
    missingAddress: d('missingAddress'),
  };
  // Nothing moved — the email should say so plainly rather than print zeroes.
  delta.any = Object.values(delta).some((v) => v !== 0);
  return delta;
}

// The subset worth persisting between sends; everything statsDelta compares.
export function snapshotOf(stats) {
  return {
    guests: stats.guests,
    households: stats.households,
    mailable: stats.mailable,
    missingAddress: stats.missingAddress,
  };
}

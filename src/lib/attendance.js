// Who is actually coming.
//
// Read off the date votes, with the same answer everywhere it is asked: the
// meal link deciding whether to show someone a menu, the organiser's meal
// table, and the trip's expenses deciding who a bill is split between. It
// lives on its own rather than inside any one of those because the moment two
// features disagree about who is on a trip, one of them is quietly wrong about
// money or about a headcount.
//
// Pure: no React, no Firestore.

// Per-person vote counts, built from the event's date options. Mirrors what
// EventDetail keeps in state, extracted so the guest-facing meal link can work
// out the same answer without duplicating the rule.
export function buildVoteStats(options = []) {
  const stats = {};
  for (const o of options) {
    if (!o || o.closed || o.noVote) continue;
    for (const [voterId, v] of Object.entries(o.votes || {})) {
      if (!v?.vote || v.vote === 'none') continue;
      if (!stats[voterId]) stats[voterId] = { total: 0, yes: 0, maybe: 0, no: 0 };
      stats[voterId].total++;
      if (v.vote === 'yes') stats[voterId].yes++;
      else if (v.vote === 'maybe') stats[voterId].maybe++;
      else if (v.vote === 'no') stats[voterId].no++;
    }
  }
  return stats;
}

// Is this person eating? Only a yes or a maybe is, which is the whole point of
// asking after the vote: you order for the people who are coming, not for the
// list you started with. A manual Going / Not going always wins; failing that a
// yes or maybe on any open date counts, including one inherited from a linked
// +1 partner, so half a couple isn't left out of dinner.
export function isYesMaybe(uid, m, members = {}, voteStats = {}) {
  if (!m || m.skipVote) return false;
  if (m.attendance === 'going') return true;
  if (m.attendance === 'notgoing') return false;
  const vs = voteStats[uid];
  if (vs && (vs.yes > 0 || vs.maybe > 0)) return true;
  // Somebody who voted has answered, and their answer stands. Only a blank is
  // filled in from the person they come with — otherwise a partner's yes
  // overrode an explicit no, and someone who said they can't make it was
  // counted as coming, fed a menu, and put on the bill.
  if (vs && vs.total > 0) return false;
  const partnerUid = m.plusOneOf
    || Object.entries(members).find(([, mm]) => mm && typeof mm === 'object' && mm.plusOneOf === uid)?.[0];
  const pv = partnerUid ? voteStats[partnerUid] : null;
  return !!pv && (pv.yes > 0 || pv.maybe > 0);
}

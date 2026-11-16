// The Gifts tab on an event with a Secret Santa: a wish list per guest, so
// whoever drew them has something to go on.
//
// Stored on the event, where every guest can read it — that is the point:
//   gifts: { [memberKey]: { ideas: string, updatedAt: ISO, updatedBy: string } }
// Who drew whom is NOT here (see lib/secretSanta.js); a wish list gives
// nothing away about that.

export const MAX_IDEAS = 2000;

export const cleanIdeas = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, MAX_IDEAS);

/** One row per guest, by name: { key, name, ideas, updatedAt, updatedBy }. */
export function giftRows(event) {
  const gifts = event?.gifts && typeof event.gifts === 'object' ? event.gifts : {};
  return Object.entries(event?.members && typeof event.members === 'object' ? event.members : {})
    .filter(([, m]) => m && typeof m === 'object')
    .map(([key, m]) => {
      const g = gifts[key] && typeof gifts[key] === 'object' ? gifts[key] : {};
      return {
        key,
        name: String(m.name || m.email || 'Unnamed guest').trim(),
        ideas: cleanIdeas(g.ideas),
        updatedAt: typeof g.updatedAt === 'string' ? g.updatedAt : '',
        updatedBy: typeof g.updatedBy === 'string' ? g.updatedBy : '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** May this viewer change this guest's list? Their own, or any as organizer/editor. */
export function canEditGifts(event, viewerUid, memberKey) {
  if (!viewerUid) return false;
  if (viewerUid === memberKey) return true;
  const role = event?.members?.[viewerUid]?.role;
  return role === 'owner' || role === 'editor' || event?.createdBy === viewerUid;
}

/**
 * A wish list as pieces to render: plain text and links. Only http(s)
 * addresses become links, and punctuation that ends a sentence stays out of
 * the address.
 */
export function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  const s = String(text ?? '');
  let last = 0;
  for (const m of s.matchAll(re)) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: url, href: url });
    last = m.index + url.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

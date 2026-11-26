/* Groups and categories are shared by both versions of the guest list: delete
   one in either and it comes off the guests in both. The editors count both
   lists so a name that looks unused here (0 guests) shows it's still in use
   on the other, and a delete that would clear guests asks first. */

// How many guests carry each value of `field` ('group' or 'category').
export function countByField(list, field) {
  const counts = new Map();
  for (const c of Array.isArray(list) ? list : []) {
    const v = c?.[field];
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts;
}

const guests = (n) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/* The confirm text for an editor save, or '' when no deleted row has anyone
   in it on either list. `rows` are editor rows ({ from, deleted, count,
   otherCount }); `here`/`there` name the lists ("this list", "the main list"). */
export function deletionWarning(rows, { noun, here, there }) {
  const hit = (rows || []).filter((r) => r.deleted && ((r.count || 0) + (r.otherCount || 0)) > 0);
  if (hit.length === 0) return '';
  const lines = hit.map((r) => {
    const parts = [];
    if (r.count) parts.push(`${guests(r.count)} on ${here}`);
    if (r.otherCount) parts.push(`${guests(r.otherCount)} on ${there}`);
    return `• ${r.from}: ${parts.join(' and ')}`;
  });
  return `Deleting ${hit.length === 1 ? `this ${noun}` : `these ${noun === 'category' ? 'categories' : `${noun}s`}`} clears it off every guest who has it, on both versions of the guest list:\n\n${lines.join('\n')}\n\nThis can't be undone. Delete anyway?`;
}

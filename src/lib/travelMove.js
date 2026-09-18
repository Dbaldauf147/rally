// Where a dragged item lands on the Travel List.
//
// The page's lists are flat arrays with two kinds of entry in them: ordinary
// items, and headers (`isHeader`), which are named dividers — everything under
// one belongs to it until the next header. So "into a group" is a position in
// the same array rather than a container, and the moves below are all about
// which index an item ends up at.
//
// Kept here, pure, because the interesting part isn't the dragging: it's that
// dropping on a group puts the item *in* it, that an item carries its
// sub-items along, and that a header dragged into another list takes nothing
// with it — all things worth a test rather than a careful click.

const sectionsOf = (list) => (Array.isArray(list?.sections) ? list.sections : []);

function lift(list, fromSectionId, itemId) {
  let moved = null;
  const sections = sectionsOf(list).map((s) => {
    if (s.id !== fromSectionId) return s;
    moved = s.items.find((it) => it.id === itemId) || null;
    if (!moved) return s;
    return { ...s, items: s.items.filter((it) => it.id !== itemId) };
  });
  return { moved, sections };
}

const put = (list, sections, toSectionId, at, moved) => ({
  ...list,
  sections: sections.map((s) => {
    if (s.id !== toSectionId) return s;
    const items = s.items.slice();
    items.splice(at === null ? items.length : at, 0, moved);
    return { ...s, items };
  }),
});

/* Onto a list: the end of it, which is where a list you are filling up wants
   its next thing. */
export function moveToSection(list, fromSectionId, itemId, toSectionId) {
  if (!toSectionId) return list;
  const { moved, sections } = lift(list, fromSectionId, itemId);
  if (!moved) return list;
  return put(list, sections, toSectionId, null, moved);
}

/* Onto another item: just above it, which is what the line drawn across that
   item while you drag is promising. */
export function moveBeforeItem(list, fromSectionId, itemId, toSectionId, targetItemId) {
  if (itemId === targetItemId) return list;
  const { moved, sections } = lift(list, fromSectionId, itemId);
  if (!moved) return list;
  const target = sections.find((s) => s.id === toSectionId);
  if (!target) return list;
  const at = target.items.findIndex((it) => it.id === targetItemId);
  return put(list, sections, toSectionId, at === -1 ? null : at, moved);
}

/* Onto a group header: the top of that group, so the thing you just dropped
   is the first one under the heading rather than landing above it — which is
   what dropping "on" a header used to do, putting the item in the group
   before it. A header dropped on a header still goes above: a heading inside
   another heading's group is not a thing this list has. */
export function moveIntoGroup(list, fromSectionId, itemId, toSectionId, headerId) {
  if (itemId === headerId) return list;
  const dragged = sectionsOf(list).find((s) => s.id === fromSectionId)?.items.find((it) => it.id === itemId);
  if (dragged?.isHeader) return moveBeforeItem(list, fromSectionId, itemId, toSectionId, headerId);
  const { moved, sections } = lift(list, fromSectionId, itemId);
  if (!moved) return list;
  const target = sections.find((s) => s.id === toSectionId);
  if (!target) return list;
  const at = target.items.findIndex((it) => it.id === headerId);
  return put(list, sections, toSectionId, at === -1 ? null : at + 1, moved);
}

/* Onto a category chip: the item keeps its place in its list and takes that
   category, which is how the chips filter it. Dropping it on the chip it
   already has takes the category off again, so one gesture does both. */
export function setItemCategory(list, sectionId, itemId, category) {
  return {
    ...list,
    sections: sectionsOf(list).map((s) => (s.id !== sectionId ? s : {
      ...s,
      items: s.items.map((it) => (it.id !== itemId ? it : { ...it, category: it.category === category ? '' : category })),
    })),
  };
}

/* The one call the page makes when a drag ends: a drop target, a dragged
   item, and the list that comes back. Unknown targets, and a drop on the item
   being dragged, leave the list exactly as it was. */
export function applyDrop(list, dragged, target) {
  if (!dragged || !target) return list;
  const { sectionId: from, itemId } = dragged;
  switch (target.type) {
    case 'section': return target.sectionId === from
      // Dropping back on the list it came from is a no-op rather than a jump
      // to the bottom, which would be a surprising way to lose your place.
      ? list
      : moveToSection(list, from, itemId, target.sectionId);
    case 'item': return moveBeforeItem(list, from, itemId, target.sectionId, target.itemId);
    case 'nest': return nestIntoItem(list, from, itemId, target.sectionId, target.itemId);
    case 'header': return moveIntoGroup(list, from, itemId, target.sectionId, target.itemId);
    case 'category': return setItemCategory(list, from, itemId, target.category);
    default: return list;
  }
}

/* Dropping an item onto the middle of another makes it a sub-item of it
   (#260's gesture, kept). Sub-items are one level deep, which is the whole
   shape of this list, so an item that already holds sub-items can't go inside
   another, and a header can't go inside anything. */
export const nestAllowed = (dragged) => !!dragged && !dragged.isHeader && !(dragged.children && dragged.children.length > 0);

// The band down the middle of a row that means "inside this one" rather than
// "above it". The edges stay reordering, so both gestures live on one row.
export function isMiddle(y, rect) {
  if (!rect || !rect.height) return false;
  const rel = y - rect.top;
  return rel > rect.height * 0.3 && rel < rect.height * 0.75;
}

export function nestIntoItem(list, fromSectionId, itemId, toSectionId, targetItemId) {
  if (itemId === targetItemId) return list;
  const { moved, sections } = lift(list, fromSectionId, itemId);
  if (!nestAllowed(moved)) return list;
  return {
    ...list,
    sections: sections.map((s) => (s.id !== toSectionId ? s : {
      ...s,
      items: s.items.map((it) => (it.id !== targetItemId || it.isHeader ? it : {
        ...it,
        isGroup: true,
        children: [...(it.children || []), {
          id: moved.id, label: moved.label, note: moved.note || '',
          checked: !!moved.checked, category: moved.category || '',
        }],
      })),
    })),
  };
}

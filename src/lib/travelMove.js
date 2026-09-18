// Where a dragged thing lands on the Travel List.
//
// The page's lists are flat arrays with two kinds of entry in them: ordinary
// items, and headers (`isHeader`), which are named dividers — everything under
// one belongs to it until the next header. An item can also hold sub-items in
// `children`, one level deep. So "into a group" is a position in the same
// array, while "into an item" is a position in that item's children.
//
// Everything here is pure, because the interesting part isn't the dragging:
// it's that dropping on a group puts the thing *in* it, that a sub-item can be
// reordered among its siblings, moved to another item, or pulled back out to
// stand on its own — all things worth a test rather than a careful click.

const sectionsOf = (list) => (Array.isArray(list?.sections) ? list.sections : []);

// What a thing looks like as a sub-item: sub-items hold no sub-items of their
// own, so anything the dragged item was carrying is left behind by design.
const asChild = (node) => ({
  id: node.id,
  label: node.label,
  note: node.note || '',
  checked: !!node.checked,
  category: node.category || '',
});

// What a sub-item looks like once it stands on its own.
const asItem = (node) => ({ ...node, children: [], isGroup: false });

/* Take the dragged thing out of wherever it is.
   `from` is { sectionId, itemId } for a row, plus `parentId` for a sub-item. */
function lift(list, from) {
  let moved = null;
  const wasChild = !!from?.parentId;
  const sections = sectionsOf(list).map((s) => {
    if (s.id !== from.sectionId) return s;
    if (!wasChild) {
      moved = s.items.find((it) => it.id === from.itemId) || null;
      if (!moved) return s;
      return { ...s, items: s.items.filter((it) => it.id !== from.itemId) };
    }
    return {
      ...s,
      items: s.items.map((it) => {
        if (it.id !== from.parentId) return it;
        const child = (it.children || []).find((c) => c.id === from.itemId);
        if (!child) return it;
        moved = child;
        const children = it.children.filter((c) => c.id !== from.itemId);
        // A row that has just lost its last sub-item is a plain row again.
        return { ...it, children, isGroup: children.length > 0 };
      }),
    };
  });
  return { moved, wasChild, sections };
}

// Put it in a list, as a row.
const putItem = (list, sections, toSectionId, at, node) => ({
  ...list,
  sections: sections.map((s) => {
    if (s.id !== toSectionId) return s;
    const items = s.items.slice();
    items.splice(at === null ? items.length : at, 0, node);
    return { ...s, items };
  }),
});

// Put it inside a row, as a sub-item.
const putChild = (list, sections, toSectionId, parentId, at, node) => ({
  ...list,
  sections: sections.map((s) => {
    if (s.id !== toSectionId) return s;
    return {
      ...s,
      items: s.items.map((it) => {
        if (it.id !== parentId || it.isHeader) return it;
        const children = (it.children || []).slice();
        children.splice(at === null ? children.length : at, 0, asChild(node));
        return { ...it, children, isGroup: true };
      }),
    };
  }),
});

/* Onto a list: the end of it, which is where a list you are filling up wants
   its next thing. A sub-item dropped here comes out to stand on its own. */
export function moveToSection(list, from, toSectionId) {
  if (!toSectionId) return list;
  const { moved, wasChild, sections } = lift(list, from);
  if (!moved) return list;
  return putItem(list, sections, toSectionId, null, wasChild ? asItem(moved) : moved);
}

/* Onto another row: just above it, which is what the line drawn across that
   row while you drag is promising. */
export function moveBeforeItem(list, from, toSectionId, targetItemId) {
  if (from.itemId === targetItemId) return list;
  const { moved, wasChild, sections } = lift(list, from);
  if (!moved) return list;
  const target = sections.find((s) => s.id === toSectionId);
  if (!target) return list;
  const at = target.items.findIndex((it) => it.id === targetItemId);
  return putItem(list, sections, toSectionId, at === -1 ? null : at, wasChild ? asItem(moved) : moved);
}

/* Onto a group header: the top of that group, so the thing you just dropped
   is the first one under the heading rather than landing above it. A header
   dropped on a header still goes above: a heading inside another heading's
   group is not a thing this list has. */
export function moveIntoGroup(list, from, toSectionId, headerId) {
  if (from.itemId === headerId) return list;
  const dragged = findNode(list, from);
  if (dragged?.isHeader) return moveBeforeItem(list, from, toSectionId, headerId);
  const { moved, wasChild, sections } = lift(list, from);
  if (!moved) return list;
  const target = sections.find((s) => s.id === toSectionId);
  if (!target) return list;
  const at = target.items.findIndex((it) => it.id === headerId);
  return putItem(list, sections, toSectionId, at === -1 ? null : at + 1, wasChild ? asItem(moved) : moved);
}

/* Onto the middle of a row: inside it, as a sub-item.
   Sub-items are one level deep, which is the whole shape of this list, so an
   item that already holds sub-items can't go inside another, and a header
   can't go inside anything. A sub-item moving to another row is the same
   move, which is how one is dragged from one row to another. */
export const nestAllowed = (dragged) => !!dragged && !dragged.isHeader && !(dragged.children && dragged.children.length > 0);

export function nestIntoItem(list, from, toSectionId, targetItemId) {
  if (from.itemId === targetItemId) return list;
  const { moved, sections } = lift(list, from);
  if (!nestAllowed(moved)) return list;
  return putChild(list, sections, toSectionId, targetItemId, null, moved);
}

/* Onto another sub-item: above it, among its siblings. Same row, and it is a
   reorder; another row, and it moves across. */
export function moveBeforeChild(list, from, toSectionId, parentId, targetChildId) {
  if (from.itemId === targetChildId) return list;
  const dragged = findNode(list, from);
  if (!nestAllowed(dragged)) return list;
  const { moved, sections } = lift(list, from);
  if (!moved) return list;
  const parent = sections.find((s) => s.id === toSectionId)?.items.find((it) => it.id === parentId);
  if (!parent) return list;
  const at = (parent.children || []).findIndex((c) => c.id === targetChildId);
  return putChild(list, sections, toSectionId, parentId, at === -1 ? null : at, moved);
}

/* Onto a category chip: the thing keeps its place and takes that category,
   which is how the chips filter it. Dropping it on the chip it already has
   takes the category off again, so one gesture does both. */
export function setItemCategory(list, from, category) {
  const tag = (node) => ({ ...node, category: node.category === category ? '' : category });
  return {
    ...list,
    sections: sectionsOf(list).map((s) => (s.id !== from.sectionId ? s : {
      ...s,
      items: s.items.map((it) => {
        if (from.parentId) {
          if (it.id !== from.parentId) return it;
          return { ...it, children: (it.children || []).map((c) => (c.id === from.itemId ? tag(c) : c)) };
        }
        return it.id === from.itemId ? tag(it) : it;
      }),
    })),
  };
}

// The dragged thing itself, row or sub-item.
export function findNode(list, from) {
  if (!from) return null;
  const section = sectionsOf(list).find((s) => s.id === from.sectionId);
  if (!section) return null;
  if (!from.parentId) return section.items.find((it) => it.id === from.itemId) || null;
  const parent = section.items.find((it) => it.id === from.parentId);
  return (parent?.children || []).find((c) => c.id === from.itemId) || null;
}

// The band down the middle of a row that means "inside this one" rather than
// "above it". The edges stay reordering, so both gestures live on one row.
export function isMiddle(y, rect) {
  if (!rect || !rect.height) return false;
  const rel = y - rect.top;
  return rel > rect.height * 0.3 && rel < rect.height * 0.75;
}

/* The one call the page makes when a drag ends: a drop target, a dragged
   thing, and the list that comes back. Unknown targets, and a drop on the
   thing being dragged, leave the list exactly as it was. */
export function applyDrop(list, dragged, target) {
  if (!dragged || !target) return list;
  switch (target.type) {
    case 'section': return target.sectionId === dragged.sectionId && !dragged.parentId
      // Dropping a row back on its own list is a no-op rather than a jump to
      // the bottom, which would be a surprising way to lose your place. A
      // sub-item dropped there does come out to stand on its own.
      ? list
      : moveToSection(list, dragged, target.sectionId);
    case 'item': return moveBeforeItem(list, dragged, target.sectionId, target.itemId);
    case 'nest': return nestIntoItem(list, dragged, target.sectionId, target.itemId);
    case 'header': return moveIntoGroup(list, dragged, target.sectionId, target.itemId);
    case 'child': return moveBeforeChild(list, dragged, target.sectionId, target.parentId, target.itemId);
    case 'category': return setItemCategory(list, dragged, target.category);
    default: return list;
  }
}

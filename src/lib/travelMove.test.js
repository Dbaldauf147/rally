import { describe, it, expect } from 'vitest';
import { moveToSection, moveBeforeItem, moveIntoGroup, setItemCategory, applyDrop, nestIntoItem, nestAllowed, isMiddle } from './travelMove';

// Two lists: "Flying" has a group ("Carry-on") with two things under it, and
// one loose thing above; "Boat" has one.
const build = () => ({
  meta: { categories: ['Flying', 'Boat'] },
  sections: [
    {
      id: 'flying',
      name: 'Flying',
      items: [
        { id: 'passport', label: 'Passport' },
        { id: 'carry', label: 'Carry-on', isHeader: true },
        { id: 'charger', label: 'Charger' },
        { id: 'book', label: 'Book' },
      ],
    },
    { id: 'boat', name: 'Boat', items: [{ id: 'towel', label: 'Towel', category: 'Boat' }] },
  ],
});
const idsIn = (list, sectionId) => list.sections.find((s) => s.id === sectionId).items.map((i) => i.id);

describe('dropping on a list', () => {
  it('moves the item to the end of it', () => {
    const l = moveToSection(build(), 'flying', 'passport', 'boat');
    expect(idsIn(l, 'flying')).toEqual(['carry', 'charger', 'book']);
    expect(idsIn(l, 'boat')).toEqual(['towel', 'passport']);
  });

  it('carries the item\'s sub-items with it', () => {
    const start = build();
    start.sections[0].items[0].children = [{ id: 'kid', label: 'Photocopy', checked: true }];
    const l = moveToSection(start, 'flying', 'passport', 'boat');
    const moved = l.sections[1].items.find((i) => i.id === 'passport');
    expect(moved.children).toEqual([{ id: 'kid', label: 'Photocopy', checked: true }]);
  });

  it('leaves a list alone when the item isn\'t in the one it came from', () => {
    const l = build();
    expect(moveToSection(l, 'boat', 'passport', 'flying')).toEqual(l);
    expect(moveToSection(l, 'flying', 'passport', '')).toEqual(l);
  });
});

describe('dropping on another item', () => {
  it('lands just above it', () => {
    const l = moveBeforeItem(build(), 'boat', 'towel', 'flying', 'charger');
    expect(idsIn(l, 'flying')).toEqual(['passport', 'carry', 'towel', 'charger', 'book']);
    expect(idsIn(l, 'boat')).toEqual([]);
  });

  it('reorders within one list', () => {
    const l = moveBeforeItem(build(), 'flying', 'book', 'flying', 'passport');
    expect(idsIn(l, 'flying')).toEqual(['book', 'passport', 'carry', 'charger']);
  });

  it('does nothing when dropped on itself', () => {
    const l = build();
    expect(moveBeforeItem(l, 'flying', 'book', 'flying', 'book')).toEqual(l);
  });
});

describe('dropping on a group', () => {
  it('puts the item inside it, at the top — not above the heading', () => {
    const l = moveIntoGroup(build(), 'boat', 'towel', 'flying', 'carry');
    expect(idsIn(l, 'flying')).toEqual(['passport', 'carry', 'towel', 'charger', 'book']);
  });

  it('moves an item already in that list into the group', () => {
    const l = moveIntoGroup(build(), 'flying', 'passport', 'flying', 'carry');
    expect(idsIn(l, 'flying')).toEqual(['carry', 'passport', 'charger', 'book']);
  });

  it('a header dropped on a header goes above it, not inside', () => {
    const start = build();
    start.sections[1].items.push({ id: 'deck', label: 'On deck', isHeader: true });
    const l = moveIntoGroup(start, 'boat', 'deck', 'flying', 'carry');
    expect(idsIn(l, 'flying')).toEqual(['passport', 'deck', 'carry', 'charger', 'book']);
  });
});

describe('dropping on a category chip', () => {
  it('tags the item where it stands', () => {
    const l = setItemCategory(build(), 'flying', 'passport', 'Flying');
    expect(l.sections[0].items[0]).toMatchObject({ id: 'passport', category: 'Flying' });
    expect(idsIn(l, 'flying')).toEqual(['passport', 'carry', 'charger', 'book']);
  });

  it('dropping it on the tag it already has takes the tag off', () => {
    const l = setItemCategory(build(), 'boat', 'towel', 'Boat');
    expect(l.sections[1].items[0].category).toBe('');
  });
});

describe('applyDrop', () => {
  const dragged = { sectionId: 'boat', itemId: 'towel' };

  it('sends each kind of target to the right move', () => {
    expect(idsIn(applyDrop(build(), dragged, { type: 'section', sectionId: 'flying' }), 'flying'))
      .toEqual(['passport', 'carry', 'charger', 'book', 'towel']);
    expect(idsIn(applyDrop(build(), dragged, { type: 'item', sectionId: 'flying', itemId: 'book' }), 'flying'))
      .toEqual(['passport', 'carry', 'charger', 'towel', 'book']);
    expect(idsIn(applyDrop(build(), dragged, { type: 'header', sectionId: 'flying', itemId: 'carry' }), 'flying'))
      .toEqual(['passport', 'carry', 'towel', 'charger', 'book']);
    expect(applyDrop(build(), dragged, { type: 'category', category: 'Flying' }).sections[1].items[0].category)
      .toBe('Flying');
  });

  it('leaves the list alone for a drop that means nothing', () => {
    const l = build();
    expect(applyDrop(l, dragged, { type: 'section', sectionId: 'boat' })).toEqual(l); // its own list
    expect(applyDrop(l, dragged, { type: 'nowhere' })).toEqual(l);
    expect(applyDrop(l, null, { type: 'section', sectionId: 'flying' })).toEqual(l);
    expect(applyDrop(l, dragged, null)).toEqual(l);
  });
});

describe('dropping into another item (a sub-item)', () => {
  it('moves it inside, and the target becomes a group', () => {
    const l = nestIntoItem(build(), 'boat', 'towel', 'flying', 'passport');
    const target = l.sections[0].items.find((i) => i.id === 'passport');
    expect(target.isGroup).toBe(true);
    expect(target.children.map((c) => c.id)).toEqual(['towel']);
    expect(idsIn(l, 'boat')).toEqual([]);
    expect(idsIn(l, 'flying')).not.toContain('towel');
  });

  it('keeps what the item carried', () => {
    const start = build();
    start.sections[1].items[0] = { ...start.sections[1].items[0], note: 'the big one', checked: true };
    const l = nestIntoItem(start, 'boat', 'towel', 'flying', 'passport');
    expect(l.sections[0].items[0].children[0]).toMatchObject({ label: 'Towel', note: 'the big one', checked: true, category: 'Boat' });
  });

  it('refuses a header, an item that already holds sub-items, and itself', () => {
    const start = build();
    start.sections[1].items.push({ id: 'parent', label: 'Kit', children: [{ id: 'sock', label: 'Socks' }] });
    expect(nestIntoItem(start, 'flying', 'carry', 'boat', 'towel')).toEqual(start); // a header
    expect(nestIntoItem(start, 'boat', 'parent', 'flying', 'passport')).toEqual(start); // has sub-items
    expect(nestIntoItem(start, 'boat', 'towel', 'boat', 'towel')).toEqual(start); // itself
  });

  it('will not drop an item inside a header', () => {
    const l = nestIntoItem(build(), 'boat', 'towel', 'flying', 'carry');
    expect(l.sections[0].items.find((i) => i.id === 'carry').children).toBeUndefined();
  });

  it('applyDrop routes a nest target', () => {
    const l = applyDrop(build(), { sectionId: 'boat', itemId: 'towel' }, { type: 'nest', sectionId: 'flying', itemId: 'passport' });
    expect(l.sections[0].items[0].children.map((c) => c.id)).toEqual(['towel']);
  });
});

describe('where on a row the pointer is', () => {
  const rect = { top: 100, height: 40 };
  it('the middle means inside, the edges mean reorder', () => {
    expect(isMiddle(120, rect)).toBe(true);
    expect(isMiddle(103, rect)).toBe(false);
    expect(isMiddle(138, rect)).toBe(false);
    expect(isMiddle(120, null)).toBe(false);
  });

  it('nesting is only offered for a plain item', () => {
    expect(nestAllowed({ id: 'a' })).toBe(true);
    expect(nestAllowed({ id: 'a', isHeader: true })).toBe(false);
    expect(nestAllowed({ id: 'a', children: [{ id: 'b' }] })).toBe(false);
    expect(nestAllowed(null)).toBe(false);
  });
});

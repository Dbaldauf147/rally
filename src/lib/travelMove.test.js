import { describe, it, expect } from 'vitest';
import {
  moveToSection, moveBeforeItem, moveIntoGroup, nestIntoItem, moveBeforeChild,
  setItemCategory, applyDrop, nestAllowed, isMiddle, findNode,
} from './travelMove';

/* Two lists. "Flying" has a loose row, a group ("Carry-on") with two rows
   under it, and a row holding two sub-items. "Boat" has one row. */
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
        {
          id: 'washbag',
          label: 'Washbag',
          isGroup: true,
          children: [
            { id: 'brush', label: 'Toothbrush', checked: false, note: '', category: '' },
            { id: 'paste', label: 'Toothpaste', checked: true, note: 'travel size', category: 'Flying' },
          ],
        },
      ],
    },
    { id: 'boat', name: 'Boat', items: [{ id: 'towel', label: 'Towel', category: 'Boat' }] },
  ],
});
const items = (list, sectionId) => list.sections.find((s) => s.id === sectionId).items.map((i) => i.id);
const kids = (list, sectionId, itemId) => (list.sections.find((s) => s.id === sectionId).items.find((i) => i.id === itemId).children || []).map((c) => c.id);
const from = (sectionId, itemId, parentId) => ({ sectionId, itemId, ...(parentId ? { parentId } : {}) });

describe('rows', () => {
  it('drop on a list: the end of it', () => {
    const l = moveToSection(build(), from('flying', 'passport'), 'boat');
    expect(items(l, 'boat')).toEqual(['towel', 'passport']);
  });

  it('drop on a row: just above it', () => {
    const l = moveBeforeItem(build(), from('boat', 'towel'), 'flying', 'charger');
    expect(items(l, 'flying')).toEqual(['passport', 'carry', 'towel', 'charger', 'washbag']);
  });

  it('drop on a heading: inside the group, at the top', () => {
    const l = moveIntoGroup(build(), from('boat', 'towel'), 'flying', 'carry');
    expect(items(l, 'flying')).toEqual(['passport', 'carry', 'towel', 'charger', 'washbag']);
  });

  it('drop in the middle of a row: a sub-item of it', () => {
    const l = nestIntoItem(build(), from('boat', 'towel'), 'flying', 'passport');
    expect(kids(l, 'flying', 'passport')).toEqual(['towel']);
    expect(items(l, 'boat')).toEqual([]);
  });

  it('a row holding sub-items cannot go inside another', () => {
    const l = build();
    expect(nestIntoItem(l, from('flying', 'washbag'), 'boat', 'towel')).toEqual(l);
  });
});

describe('sub-items', () => {
  it('reorder among their siblings', () => {
    const l = moveBeforeChild(build(), from('flying', 'paste', 'washbag'), 'flying', 'washbag', 'brush');
    expect(kids(l, 'flying', 'washbag')).toEqual(['paste', 'brush']);
  });

  it('keep what they carry when they move', () => {
    const l = moveBeforeChild(build(), from('flying', 'paste', 'washbag'), 'flying', 'washbag', 'brush');
    expect(kids(l, 'flying', 'washbag')[0]).toBe('paste');
    const moved = l.sections[0].items.find((i) => i.id === 'washbag').children[0];
    expect(moved).toMatchObject({ label: 'Toothpaste', checked: true, note: 'travel size', category: 'Flying' });
  });

  it('move to another row, above the sub-item they are dropped on', () => {
    const start = build();
    start.sections[1].items[0] = { ...start.sections[1].items[0], isGroup: true, children: [{ id: 'sand', label: 'Sand toys' }] };
    const l = moveBeforeChild(start, from('flying', 'brush', 'washbag'), 'boat', 'towel', 'sand');
    expect(kids(l, 'boat', 'towel')).toEqual(['brush', 'sand']);
    expect(kids(l, 'flying', 'washbag')).toEqual(['paste']);
  });

  it('move to another row by its middle', () => {
    const l = nestIntoItem(build(), from('flying', 'brush', 'washbag'), 'boat', 'towel');
    expect(kids(l, 'boat', 'towel')).toEqual(['brush']);
    expect(kids(l, 'flying', 'washbag')).toEqual(['paste']);
  });

  it('come out to stand on their own when dropped on a list', () => {
    const l = moveToSection(build(), from('flying', 'brush', 'washbag'), 'boat');
    expect(items(l, 'boat')).toEqual(['towel', 'brush']);
    expect(kids(l, 'flying', 'washbag')).toEqual(['paste']);
    expect(l.sections[1].items[1]).toMatchObject({ id: 'brush', children: [], isGroup: false });
  });

  it('come out above a row, or into a group, when dropped there', () => {
    const above = moveBeforeItem(build(), from('flying', 'brush', 'washbag'), 'flying', 'passport');
    expect(items(above, 'flying')).toEqual(['brush', 'passport', 'carry', 'charger', 'washbag']);
    const grouped = moveIntoGroup(build(), from('flying', 'brush', 'washbag'), 'flying', 'carry');
    expect(items(grouped, 'flying')).toEqual(['passport', 'carry', 'brush', 'charger', 'washbag']);
  });

  it('a row that loses its last sub-item is a plain row again', () => {
    let l = moveToSection(build(), from('flying', 'brush', 'washbag'), 'boat');
    l = moveToSection(l, from('flying', 'paste', 'washbag'), 'boat');
    const washbag = l.sections[0].items.find((i) => i.id === 'washbag');
    expect(washbag.children).toEqual([]);
    expect(washbag.isGroup).toBe(false);
  });

  it('take a category where they stand', () => {
    const l = setItemCategory(build(), from('flying', 'brush', 'washbag'), 'Boat');
    expect(l.sections[0].items.find((i) => i.id === 'washbag').children[0]).toMatchObject({ id: 'brush', category: 'Boat' });
    expect(kids(l, 'flying', 'washbag')).toEqual(['brush', 'paste']);
  });

  it('and dropping one on the category it already has clears it', () => {
    const l = setItemCategory(build(), from('flying', 'paste', 'washbag'), 'Flying');
    expect(l.sections[0].items.find((i) => i.id === 'washbag').children[1].category).toBe('');
  });

  it('go to the end of the row when dropped on the row itself', () => {
    const l = nestIntoItem(build(), from('flying', 'brush', 'washbag'), 'flying', 'washbag');
    expect(kids(l, 'flying', 'washbag')).toEqual(['paste', 'brush']);
  });

  it('do nothing when dropped on themselves', () => {
    const l = build();
    expect(moveBeforeChild(l, from('flying', 'brush', 'washbag'), 'flying', 'washbag', 'brush')).toEqual(l);
  });
});

describe('a row dropped on a sub-item', () => {
  it('joins that row\'s sub-items, above the one it landed on', () => {
    const l = moveBeforeChild(build(), from('boat', 'towel'), 'flying', 'washbag', 'paste');
    expect(kids(l, 'flying', 'washbag')).toEqual(['brush', 'towel', 'paste']);
    expect(items(l, 'boat')).toEqual([]);
  });

  it('unless it holds sub-items of its own', () => {
    const l = build();
    expect(moveBeforeChild(l, from('flying', 'washbag'), 'boat', 'towel', 'nothing')).toEqual(l);
  });
});

describe('findNode', () => {
  it('finds a row and a sub-item', () => {
    expect(findNode(build(), from('flying', 'passport'))).toMatchObject({ label: 'Passport' });
    expect(findNode(build(), from('flying', 'paste', 'washbag'))).toMatchObject({ label: 'Toothpaste' });
    expect(findNode(build(), from('flying', 'nope'))).toBe(null);
    expect(findNode(build(), null)).toBe(null);
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

  it('nesting is only offered for a plain thing', () => {
    expect(nestAllowed({ id: 'a' })).toBe(true);
    expect(nestAllowed({ id: 'a', isHeader: true })).toBe(false);
    expect(nestAllowed({ id: 'a', children: [{ id: 'b' }] })).toBe(false);
    expect(nestAllowed(null)).toBe(false);
  });
});

describe('applyDrop', () => {
  it('sends each target to the right move', () => {
    const row = from('boat', 'towel');
    expect(items(applyDrop(build(), row, { type: 'section', sectionId: 'flying' }), 'flying').at(-1)).toBe('towel');
    expect(items(applyDrop(build(), row, { type: 'item', sectionId: 'flying', itemId: 'charger' }), 'flying')[2]).toBe('towel');
    expect(kids(applyDrop(build(), row, { type: 'nest', sectionId: 'flying', itemId: 'passport' }), 'flying', 'passport')).toEqual(['towel']);
    expect(items(applyDrop(build(), row, { type: 'header', sectionId: 'flying', itemId: 'carry' }), 'flying')[2]).toBe('towel');
    expect(kids(applyDrop(build(), row, { type: 'child', sectionId: 'flying', parentId: 'washbag', itemId: 'paste' }), 'flying', 'washbag')).toEqual(['brush', 'towel', 'paste']);
    const sub = from('flying', 'brush', 'washbag');
    // Dropping it above the sibling already below it leaves it where it was.
    expect(kids(applyDrop(build(), sub, { type: 'child', sectionId: 'flying', parentId: 'washbag', itemId: 'paste' }), 'flying', 'washbag')).toEqual(['brush', 'paste']);
    expect(applyDrop(build(), sub, { type: 'category', category: 'Boat' }).sections[0].items[3].children[0].category).toBe('Boat');
  });

  it('leaves the list alone for a drop that means nothing', () => {
    const l = build();
    expect(applyDrop(l, from('boat', 'towel'), { type: 'section', sectionId: 'boat' })).toEqual(l);
    expect(applyDrop(l, from('boat', 'towel'), { type: 'nowhere' })).toEqual(l);
    expect(applyDrop(l, null, { type: 'section', sectionId: 'flying' })).toEqual(l);
    expect(applyDrop(l, from('boat', 'towel'), null)).toEqual(l);
  });

  it('a sub-item dropped on its own list comes out to stand on its own', () => {
    const l = applyDrop(build(), from('flying', 'brush', 'washbag'), { type: 'section', sectionId: 'flying' });
    expect(items(l, 'flying').at(-1)).toBe('brush');
    expect(kids(l, 'flying', 'washbag')).toEqual(['paste']);
  });
});

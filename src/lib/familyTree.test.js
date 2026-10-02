import { describe, it, expect } from 'vitest';
import { normalizeFamilyTree, addPerson, updatePerson, removePerson, familyRows, treePhotoIds } from './familyTree';
import { kidsForEditing, kidsForSaving } from './friendKids';
import { mergeFriends } from './friendMerge';

describe('normalizeFamilyTree', () => {
  it('drops nameless people and unknown relations become Other', () => {
    expect(normalizeFamilyTree({ selfPhoto: 'p1', people: [{ id: 'a', name: ' Linda ', relation: 'parent' }, { id: 'b', name: '' }, { id: 'c', name: 'Zed', relation: 'wizard' }] }))
      .toEqual({ selfPhoto: 'p1', partnerPhoto: '', people: [{ id: 'a', name: 'Linda', relation: 'parent', photoId: '' }, { id: 'c', name: 'Zed', relation: 'other', photoId: '' }] });
  });
  it('tolerates nothing at all', () => {
    expect(normalizeFamilyTree(undefined)).toEqual({ selfPhoto: '', partnerPhoto: '', people: [] });
  });
});

describe('add / update / remove', () => {
  it('edits people by id', () => {
    let t = addPerson(undefined, 'Linda', 'parent');
    t = addPerson(t, '  ', 'parent'); // ignored
    expect(t.people).toHaveLength(1);
    const id = t.people[0].id;
    t = updatePerson(t, id, { name: 'Linda Smith', photoId: 'ph' });
    expect(t.people[0]).toMatchObject({ name: 'Linda Smith', relation: 'parent', photoId: 'ph' });
    expect(removePerson(t, id).people).toEqual([]);
  });
});

describe('familyRows', () => {
  const tree = {
    selfPhoto: 's', partnerPhoto: 'pp',
    people: [
      { id: 'g', name: 'Nana', relation: 'grandparent' },
      { id: 'm', name: 'Linda', relation: 'parent', photoId: 'lp' },
      { id: 'u', name: 'Uncle Bob', relation: 'aunt-uncle' },
      { id: 'b', name: 'Tom', relation: 'sibling' },
      { id: 'c', name: 'Cuz', relation: 'cousin' },
      { id: 'd', name: 'Rex', relation: 'pet' },
    ],
  };
  it('lays people out by generation with the couple in the middle row', () => {
    const rows = familyRows({ name: 'Pat', tree, kids: [{ name: 'Emma', photoId: 'ep' }, { name: '' }], partnerName: 'Sam' });
    expect(rows.map((r) => [r.gen, r.people.map((p) => p.name)])).toEqual([
      [-2, ['Nana']],
      [-1, ['Linda', 'Uncle Bob']],
      [0, ['Tom', 'Pat', 'Sam', 'Cuz']],
      [1, ['Emma', 'Rex']],
    ]);
    const mid = rows.find((r) => r.gen === 0);
    expect(mid.couple).toEqual(['self', 'partner']);
    const emma = rows.find((r) => r.gen === 1).people[0];
    expect(emma).toMatchObject({ kind: 'kid', index: 0, photoId: 'ep' });
    expect(mid.people.find((p) => p.kind === 'partner').photoId).toBe('pp');
  });
  it('always has the friend, even with nothing else', () => {
    const rows = familyRows({ name: 'Pat', tree: undefined, kids: [], partnerName: '' });
    expect(rows).toHaveLength(1);
    expect(rows[0].people.map((p) => p.kind)).toEqual(['self']);
  });
});

describe('treePhotoIds', () => {
  it('collects every photo the tree names', () => {
    expect(treePhotoIds({ selfPhoto: 's', people: [{ id: 'a', name: 'A', photoId: 'x' }] }, [{ name: 'K', photoId: 'k' }])).toEqual(['s', 'x', 'k']);
  });
});

describe('kid photos', () => {
  it('survive editing and saving', () => {
    const saved = kidsForSaving(kidsForEditing([{ name: 'Emma', birthday: '2019-03-14', photoId: 'ep' }, { name: 'Liam', birthday: '' }]));
    expect(saved).toEqual([{ name: 'Emma', birthday: '2019-03-14', photoId: 'ep' }, { name: 'Liam', birthday: '' }]);
  });
  it('survive a merge, from whichever duplicate had one', () => {
    const m = mergeFriends({ id: 'a', name: 'A', kids: [{ name: 'Emma', birthday: '' }] }, [{ id: 'b', name: 'B', kids: [{ name: 'emma', birthday: '03-14', photoId: 'ep' }] }]);
    expect(m.kids).toEqual([{ name: 'Emma', birthday: '03-14', photoId: 'ep' }]);
  });
});

describe('merging family trees', () => {
  it('combines the people once and keeps the kept contact’s photos', () => {
    const m = mergeFriends(
      { id: 'a', name: 'A', familyTree: { selfPhoto: 's1', people: [{ id: '1', name: 'Linda', relation: 'parent' }] } },
      [{ id: 'b', name: 'B', familyTree: { selfPhoto: 's2', partnerPhoto: 'p2', people: [{ id: '2', name: 'linda', relation: 'parent' }, { id: '3', name: 'Tom', relation: 'sibling' }] } }],
    );
    expect(m.familyTree.selfPhoto).toBe('s1');
    expect(m.familyTree.partnerPhoto).toBe('p2');
    expect(m.familyTree.people.map((p) => p.name)).toEqual(['Linda', 'Tom']);
  });
  it('adds no tree when neither had one', () => {
    expect(mergeFriends({ id: 'a', name: 'A' }, [{ id: 'b', name: 'B' }]).familyTree).toBeUndefined();
  });
});

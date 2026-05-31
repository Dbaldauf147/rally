import { useMemo, useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import styles from './TravelListPage.module.css';

// Default master checklist. Editable copies are stored per-user in Firestore;
// this only seeds a brand-new list (or a "Reset to defaults").
const DEFAULT_SECTIONS = [
  {
    name: 'All travel',
    items: [
      { label: 'Empty coffee filter', defaultChecked: true },
      { label: 'Charge phone', defaultChecked: true },
      { label: 'Charge phone backup battery charger', defaultChecked: true },
      { label: 'Take out trash', defaultChecked: true },
      { label: 'Do the dishes', defaultChecked: true },
      { label: 'Turn off AC', defaultChecked: true },
      { label: 'Check fridge for things that will go bad - put fruit or veggies in the fridge', defaultChecked: true },
      { label: 'Rent is due?', note: 'no', defaultChecked: true },
      { label: 'Water plants if needed', defaultChecked: true },
      { label: 'Put PTO away message on email - Schedule to auto turn off', defaultChecked: true },
      { label: 'Check morning meetings for the day you get back', defaultChecked: true },
      { label: 'Kill work alarm', defaultChecked: true },
      { label: 'Take Hunterspoint train if you are traveling on a weekday', defaultChecked: true },
      { label: 'Stretch', defaultChecked: true },
      { label: 'Weigh yourself', defaultChecked: true },
      { label: 'Make sure no fruit is left out', defaultChecked: true },
      { label: 'Leave the windows open', defaultChecked: true },
      { label: 'Leave time? / Change wake up alarm', note: 'Leave at', defaultChecked: true },
    ],
  },
  {
    name: 'Suitcase',
    items: [
      { label: 'Check weather', defaultChecked: true },
      {
        label: 'Pack clothes in bag',
        isGroup: true,
        children: [
          { label: '2 pairs of underwear', note: '7 for a long trip?', defaultChecked: true },
          { label: '2 socks', note: '7 for a long trip?', defaultChecked: true },
          { label: '2 shirts', note: '7 for a long trip?', defaultChecked: false },
          { label: '0.5 sweaters', note: '2 for a long trip?', defaultChecked: false },
          { label: 'Winter hat', defaultChecked: true },
          { label: 'Shorts / Pants', note: '2 for a long trip?', defaultChecked: true },
          { label: 'Workout clothes / shoes for hotel', defaultChecked: false },
          { label: 'Button down work / going out', defaultChecked: false },
          { label: 'Going out shoes', defaultChecked: true },
          { label: 'Sandals', defaultChecked: true },
          { label: 'Dirty clothes bag', defaultChecked: true },
          { label: 'Tiny leg pillow for sleeping', defaultChecked: true },
          { label: 'Bathing suit(s)', defaultChecked: true },
          { label: 'PT stuff', defaultChecked: true },
        ],
      },
      {
        label: 'Toiletry bag (toothbrush, floss, toothpaste, deodorant)',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Nail clippers, clip nails', defaultChecked: true },
          { label: 'Sunscreen', defaultChecked: false },
          { label: 'Clip toe nails', defaultChecked: true },
          { label: 'Smooth moves tea', defaultChecked: true },
          { label: 'Monoxidil', defaultChecked: true },
          { label: 'Mouth guard', defaultChecked: false },
          { label: 'Hair gel', defaultChecked: true },
          { label: 'Use ear cream', defaultChecked: true },
          { label: 'Trim beard, beard trimmer', defaultChecked: true },
          { label: 'Buzzer — empty before you leave', defaultChecked: true },
          { label: 'Medications / things to treat your pain', defaultChecked: true },
          { label: 'Anti-bug stuff', defaultChecked: true },
          { label: 'Travel bidet (charge ahead of time)', defaultChecked: true },
        ],
      },
      {
        label: 'Weed, shrooms, candy',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Plastic bag for drugs', defaultChecked: true },
        ],
      },
      {
        label: 'Gift(s) for the person you are visiting',
        isGroup: true,
        children: [
          { label: 'Katies ring package', defaultChecked: false },
        ],
      },
      { label: 'Plan a surprise', defaultChecked: true },
      { label: 'Things to bring home for the people you will be seeing', defaultChecked: true },
    ],
  },
  {
    name: 'Backpack',
    items: [
      {
        label: 'Front zipper',
        isGroup: true,
        children: [
          { label: 'Tide pen', defaultChecked: true },
          { label: 'Travel tissues', defaultChecked: true },
          { label: 'Creotine', defaultChecked: true },
        ],
      },
      {
        label: 'Front pocket',
        isGroup: true,
        children: [
          { label: 'Protein bar', defaultChecked: true },
          { label: 'Sunglasses', defaultChecked: true },
          { label: 'Phone charger', defaultChecked: true },
          { label: 'Ear plugs?', defaultChecked: true },
          { label: 'Work phone', defaultChecked: true },
          { label: 'Portable battery charger', defaultChecked: true },
          { label: 'Wireless headphones for work calls', defaultChecked: true },
          { label: 'Vitamins and fiber pills', defaultChecked: true },
          { label: 'Pack snacks', note: 'Nuts, seeds', defaultChecked: true },
        ],
      },
      {
        label: 'Middle pocket',
        isGroup: true,
        children: [
          { label: 'Hand sanitizer', defaultChecked: true },
          { label: 'Gum', defaultChecked: true },
          { label: 'Deodorant', defaultChecked: true },
          { label: 'Noise cancelling headphones', defaultChecked: true },
          { label: 'Aurora ring charger', defaultChecked: true },
        ],
      },
      {
        label: 'Largest pocket',
        isGroup: true,
        children: [
          { label: 'Laptop', defaultChecked: true },
          { label: 'Book(s)', defaultChecked: true },
          { label: 'Laptop charger', defaultChecked: false },
          { label: 'Mouse', defaultChecked: false },
          { label: 'Mouse USB', defaultChecked: false },
          { label: 'Work notepad', defaultChecked: false },
        ],
      },
      { label: 'Empty travel water bottle — fill it up in the airport', defaultChecked: true },
    ],
  },
  {
    name: 'General',
    items: [
      { label: 'Check take-home reminders in phone', defaultChecked: false },
      { label: 'Phone', defaultChecked: false },
    ],
  },
  {
    name: 'Formal Event',
    items: [
      { label: 'Watch', defaultChecked: false },
      { label: 'Belt', defaultChecked: false },
      { label: 'Tie', defaultChecked: false },
      { label: 'Jacket', defaultChecked: false },
      { label: 'Dress shirts', defaultChecked: false },
      { label: 'Dress pants', defaultChecked: false },
      { label: 'Dress shoes', defaultChecked: false },
    ],
  },
  {
    name: 'Boat only',
    items: [
      { label: 'Backpack', defaultChecked: false },
      { label: 'Sunscreen', defaultChecked: false },
      { label: 'Rain coat?', defaultChecked: false },
      { label: 'Lip balm', defaultChecked: false },
      { label: 'Sunglasses', defaultChecked: false },
      { label: 'Fan for sleeping', defaultChecked: false },
      { label: 'Drugs', defaultChecked: false },
      { label: 'Speaker', defaultChecked: false },
      { label: 'Check bring-on-the-boat reminder', defaultChecked: false },
    ],
  },
  {
    name: 'Flying only',
    items: [
      { label: 'Passport', note: 'Expires on 8/29/2026 (you can only renew online if it’s within one year)', defaultChecked: false },
      { label: 'Validate travel visa requirements, confirm yours is approved and up to date', defaultChecked: false },
      { label: 'Check into the app of your airline', defaultChecked: false },
      { label: 'International day pass for your phone?', note: 'Look it up. I think it’s $10 per day.', defaultChecked: false },
      { label: 'Bring charger adapter for international', defaultChecked: false },
      { label: 'Non-sweat shirt?', defaultChecked: false },
      { label: 'Download languages', defaultChecked: false },
      { label: 'Download maps', defaultChecked: false },
      { label: 'Add TSA pre-check', defaultChecked: false },
      { label: 'Length of the flight', defaultChecked: false },
      { label: 'Light sweater for the airplane', defaultChecked: false },
      { label: 'Download sheets offline to work on for work', defaultChecked: false },
      { label: 'Confirm no drugs are in your bag / jackets', defaultChecked: false },
      { label: 'iPad', defaultChecked: false },
      { label: 'Deck of cards?', defaultChecked: false },
      { label: 'Rolling carryon', defaultChecked: false },
      { label: 'Check the rental car leg room', defaultChecked: true },
      { label: 'Speakers', defaultChecked: true },
      { label: 'Eye mask — add to backpack', defaultChecked: true },
      { label: 'Reading light', defaultChecked: true },
      { label: 'Benadryl for red-eye flights', defaultChecked: true },
      { label: 'Cord that plugs into the seat TVs so you can watch shows/movies', defaultChecked: true },
      {
        label: 'Download episodes of a show you want to watch or work videos / content you need to review',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Trip there', defaultChecked: true },
          { label: 'Trip back', defaultChecked: true },
        ],
      },
      {
        label: 'Download podcasts',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Trip there', defaultChecked: true },
          { label: 'Trip back', defaultChecked: true },
        ],
      },
      { label: 'Download sudoku', defaultChecked: true },
    ],
  },
];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`);

// Build an editable, id-stamped list from the hardcoded defaults.
function seedTravelList() {
  return {
    sections: DEFAULT_SECTIONS.map((s) => ({
      id: uid(),
      name: s.name,
      items: s.items.map((it) => ({
        id: uid(),
        label: it.label,
        note: it.note || '',
        checked: !!it.defaultChecked,
        isGroup: !!it.isGroup,
        children: (it.children || []).map((c) => ({
          id: uid(),
          label: c.label,
          note: c.note || '',
          checked: !!c.defaultChecked,
        })),
      })),
    })),
    meta: { leaveDate: '', returnDate: '', days: '' },
  };
}

// Defensive normalizer so older/partial documents still render.
function normalizeList(raw) {
  if (!raw || !Array.isArray(raw.sections)) return seedTravelList();
  return {
    sections: raw.sections.map((s) => ({
      id: s.id || uid(),
      name: s.name || 'Untitled',
      items: (s.items || []).map((it) => ({
        id: it.id || uid(),
        label: it.label || '',
        note: it.note || '',
        checked: !!it.checked,
        isGroup: !!it.isGroup || (Array.isArray(it.children) && it.children.length > 0),
        children: (it.children || []).map((c) => ({
          id: c.id || uid(),
          label: c.label || '',
          note: c.note || '',
          checked: !!c.checked,
        })),
      })),
    })),
    meta: {
      leaveDate: raw.meta?.leaveDate || '',
      returnDate: raw.meta?.returnDate || '',
      days: raw.meta?.days || '',
    },
  };
}

// A leaf is any item without children plus every child — these are what we count.
function countLeaves(sections) {
  let total = 0;
  let done = 0;
  for (const s of sections) {
    for (const it of s.items) {
      if (it.children && it.children.length > 0) {
        for (const c of it.children) { total++; if (c.checked) done++; }
      } else {
        total++; if (it.checked) done++;
      }
    }
  }
  return { total, done };
}

function sectionCounts(section) {
  return countLeaves([section]);
}

const CACHE_KEY = 'rally.travelList.doc.v2';
const OPEN_KEY = 'rally.travelList.open.v2';

export function TravelListPage() {
  const { user } = useAuth();

  const [list, setList] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizeList(JSON.parse(raw));
    } catch { /* ignore */ }
    return seedTravelList();
  });
  const [loaded, setLoaded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [open, setOpen] = useState(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
  });

  const writeTimer = useRef(null);
  const userRef = user?.uid ? doc(db, 'users', user.uid) : null;

  // Load the user's saved list from Firestore once on mount. Seeds + persists
  // a fresh default list if the user has none yet.
  useEffect(() => {
    let cancelled = false;
    if (!user?.uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;
        const remote = snap.exists() ? snap.data()?.travelList : null;
        if (remote && Array.isArray(remote.sections)) {
          const normalized = normalizeList(remote);
          setList(normalized);
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(normalized)); } catch { /* ignore */ }
        } else {
          // No saved list yet — persist the current (cached or seeded) one.
          const initial = normalizeList(list);
          setDoc(doc(db, 'users', user.uid), { travelList: initial }, { merge: true }).catch(() => {});
        }
      } catch { /* offline — keep cached/seeded copy */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* ignore */ }
  }, [open]);

  // Single mutation path: updates state, caches locally, debounces a Firestore write.
  function updateList(updater) {
    setList((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      if (userRef) {
        if (writeTimer.current) clearTimeout(writeTimer.current);
        writeTimer.current = setTimeout(() => {
          setDoc(doc(db, 'users', user.uid), { travelList: next }, { merge: true }).catch(() => {});
        }, 500);
      }
      return next;
    });
  }

  useEffect(() => () => { if (writeTimer.current) clearTimeout(writeTimer.current); }, []);

  const { total, done } = useMemo(() => countLeaves(list.sections), [list]);

  if (user && user.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;
  if (!user) return null;

  const setSectionOpen = (id) => setOpen((o) => ({ ...o, [id]: o[id] === false }));
  const isOpen = (id) => open[id] !== false; // default open

  // --- checkbox toggles ---
  function toggleItem(sectionId, itemId) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: s.items.map((it) => it.id !== itemId ? it : { ...it, checked: !it.checked }),
      }),
    }));
  }
  function toggleChild(sectionId, itemId, childId) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: s.items.map((it) => it.id !== itemId ? it : {
          ...it,
          children: it.children.map((c) => c.id !== childId ? c : { ...c, checked: !c.checked }),
        }),
      }),
    }));
  }

  function setAllChecked(value) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => ({
        ...s,
        items: s.items.map((it) => ({
          ...it,
          checked: (it.children && it.children.length > 0) ? it.checked : value,
          children: it.children.map((c) => ({ ...c, checked: value })),
        })),
      })),
    }));
  }

  function resetDefaults() {
    if (!confirm('Reset the whole list — items and checks — back to defaults? This deletes your custom edits.')) return;
    updateList(seedTravelList());
  }

  function setMeta(patch) {
    updateList((l) => ({ ...l, meta: { ...l.meta, ...patch } }));
  }

  // --- editing: items ---
  function updateItemFields(sectionId, itemId, patch) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: s.items.map((it) => it.id !== itemId ? it : { ...it, ...patch }),
      }),
    }));
  }
  function updateChildFields(sectionId, itemId, childId, patch) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: s.items.map((it) => it.id !== itemId ? it : {
          ...it,
          children: it.children.map((c) => c.id !== childId ? c : { ...c, ...patch }),
        }),
      }),
    }));
  }
  function addItem(sectionId) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: [...s.items, { id: uid(), label: '', note: '', checked: false, isGroup: false, children: [] }],
      }),
    }));
  }
  function addChild(sectionId, itemId) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: s.items.map((it) => it.id !== itemId ? it : {
          ...it,
          isGroup: true,
          children: [...(it.children || []), { id: uid(), label: '', note: '', checked: false }],
        }),
      }),
    }));
  }
  function deleteItem(sectionId, itemId) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: s.items.filter((it) => it.id !== itemId),
      }),
    }));
  }
  function deleteChild(sectionId, itemId, childId) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => s.id !== sectionId ? s : {
        ...s,
        items: s.items.map((it) => it.id !== itemId ? it : {
          ...it,
          children: it.children.filter((c) => c.id !== childId),
        }),
      }),
    }));
  }
  function moveItem(sectionId, itemId, delta) {
    updateList((l) => ({
      ...l,
      sections: l.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const idx = s.items.findIndex((it) => it.id === itemId);
        const target = idx + delta;
        if (idx < 0 || target < 0 || target >= s.items.length) return s;
        const items = s.items.slice();
        [items[idx], items[target]] = [items[target], items[idx]];
        return { ...s, items };
      }),
    }));
  }

  // --- editing: sections ---
  function addSection() {
    const id = uid();
    updateList((l) => ({ ...l, sections: [...l.sections, { id, name: 'New section', items: [] }] }));
    setOpen((o) => ({ ...o, [id]: true }));
  }
  function renameSection(sectionId, name) {
    updateList((l) => ({ ...l, sections: l.sections.map((s) => s.id !== sectionId ? s : { ...s, name }) }));
  }
  function deleteSection(sectionId) {
    const s = list.sections.find((x) => x.id === sectionId);
    if (!confirm(`Delete the "${s?.name || ''}" section and all its items?`)) return;
    updateList((l) => ({ ...l, sections: l.sections.filter((x) => x.id !== sectionId) }));
  }
  function moveSection(sectionId, delta) {
    updateList((l) => {
      const idx = l.sections.findIndex((s) => s.id === sectionId);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= l.sections.length) return l;
      const sections = l.sections.slice();
      [sections[idx], sections[target]] = [sections[target], sections[idx]];
      return { ...l, sections };
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Travel List</h1>
        <div className={styles.progress}>{done} / {total} packed{!loaded ? ' · syncing…' : ''}</div>
      </div>
      <p className={styles.subtitle}>Your master packing & pre-trip checklist. Synced to your account.</p>

      <div className={styles.meta}>
        <label className={styles.metaField}>
          <span className={styles.metaLabel}>Leave date</span>
          <input
            className={styles.metaInput}
            type="date"
            value={list.meta.leaveDate}
            onChange={(e) => setMeta({ leaveDate: e.target.value })}
          />
        </label>
        <label className={styles.metaField}>
          <span className={styles.metaLabel}>Return date</span>
          <input
            className={styles.metaInput}
            type="date"
            value={list.meta.returnDate}
            onChange={(e) => setMeta({ returnDate: e.target.value })}
          />
        </label>
        <label className={styles.metaField}>
          <span className={styles.metaLabel}>Days</span>
          <input
            className={styles.metaInput}
            type="number"
            min="0"
            value={list.meta.days}
            onChange={(e) => setMeta({ days: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.toolbar}>
        <button
          className={`${styles.btn} ${editMode ? styles.btnActive : ''}`}
          onClick={() => setEditMode((v) => !v)}
        >{editMode ? '✓ Done editing' : '✏️ Edit list'}</button>
        <button className={styles.btn} onClick={() => setAllChecked(true)}>Check all</button>
        <button className={styles.btn} onClick={() => setAllChecked(false)}>Uncheck all</button>
        {editMode && <button className={styles.btn} onClick={addSection}>+ Add section</button>}
        <button className={`${styles.btn} ${styles.btnDanger}`} onClick={resetDefaults}>Reset to defaults</button>
      </div>

      {list.sections.map((section, sIdx) => {
        const { total: leafTotal, done: leafDone } = sectionCounts(section);
        const sectionOpen = isOpen(section.id);
        return (
          <div key={section.id} className={styles.section}>
            <div className={styles.sectionHeader} onClick={() => !editMode && setSectionOpen(section.id)}>
              <div className={styles.sectionTitle}>
                {!editMode && (
                  <span className={`${styles.caret} ${sectionOpen ? styles.caretOpen : ''}`}>▶</span>
                )}
                {editMode ? (
                  <input
                    className={styles.sectionNameInput}
                    value={section.name}
                    onChange={(e) => renameSection(section.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Section name"
                  />
                ) : section.name}
              </div>
              {editMode ? (
                <div className={styles.sectionActions} onClick={(e) => e.stopPropagation()}>
                  <button className={styles.iconBtn} disabled={sIdx === 0} onClick={() => moveSection(section.id, -1)} title="Move up" aria-label="Move section up">↑</button>
                  <button className={styles.iconBtn} disabled={sIdx === list.sections.length - 1} onClick={() => moveSection(section.id, 1)} title="Move down" aria-label="Move section down">↓</button>
                  <button className={styles.iconBtnDanger} onClick={() => deleteSection(section.id)} title="Delete section" aria-label="Delete section">🗑️</button>
                </div>
              ) : (
                <span className={styles.sectionCount}>{leafDone} / {leafTotal}</span>
              )}
            </div>

            {(editMode || sectionOpen) && (
              <div className={styles.sectionBody}>
                {section.items.map((item, iIdx) => {
                  const hasChildren = item.children && item.children.length > 0;
                  return (
                    <div key={item.id}>
                      {editMode ? (
                        <div className={`${styles.editRow} ${item.isGroup ? styles.itemGroup : ''}`}>
                          <div className={styles.editFields}>
                            <input
                              className={styles.editInput}
                              value={item.label}
                              placeholder="Item"
                              onChange={(e) => updateItemFields(section.id, item.id, { label: e.target.value })}
                            />
                            <input
                              className={styles.editNoteInput}
                              value={item.note}
                              placeholder="Note (optional)"
                              onChange={(e) => updateItemFields(section.id, item.id, { note: e.target.value })}
                            />
                          </div>
                          <div className={styles.editActions}>
                            <button className={styles.iconBtn} disabled={iIdx === 0} onClick={() => moveItem(section.id, item.id, -1)} title="Move up" aria-label="Move up">↑</button>
                            <button className={styles.iconBtn} disabled={iIdx === section.items.length - 1} onClick={() => moveItem(section.id, item.id, 1)} title="Move down" aria-label="Move down">↓</button>
                            <button className={styles.iconBtn} onClick={() => addChild(section.id, item.id)} title="Add sub-item" aria-label="Add sub-item">+↳</button>
                            <button className={styles.iconBtnDanger} onClick={() => deleteItem(section.id, item.id)} title="Delete item" aria-label="Delete item">🗑️</button>
                          </div>
                        </div>
                      ) : (
                        <label className={`${styles.item} ${item.isGroup ? styles.itemGroup : ''}`}>
                          {!hasChildren ? (
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={!!item.checked}
                              onChange={() => toggleItem(section.id, item.id)}
                            />
                          ) : (
                            <span className={styles.checkbox} style={{ background: 'transparent' }} />
                          )}
                          <div className={styles.itemBody}>
                            <div className={`${styles.itemLabel} ${!hasChildren && item.checked ? styles.itemLabelChecked : ''}`}>
                              {item.label}
                            </div>
                            {item.note && <div className={styles.itemNote}>{item.note}</div>}
                          </div>
                        </label>
                      )}

                      {item.children && item.children.map((child) => (
                        editMode ? (
                          <div key={child.id} className={`${styles.editRow} ${styles.editRowChild}`}>
                            <div className={styles.editFields}>
                              <input
                                className={styles.editInput}
                                value={child.label}
                                placeholder="Sub-item"
                                onChange={(e) => updateChildFields(section.id, item.id, child.id, { label: e.target.value })}
                              />
                              <input
                                className={styles.editNoteInput}
                                value={child.note}
                                placeholder="Note (optional)"
                                onChange={(e) => updateChildFields(section.id, item.id, child.id, { note: e.target.value })}
                              />
                            </div>
                            <div className={styles.editActions}>
                              <button className={styles.iconBtnDanger} onClick={() => deleteChild(section.id, item.id, child.id)} title="Delete sub-item" aria-label="Delete sub-item">🗑️</button>
                            </div>
                          </div>
                        ) : (
                          <label key={child.id} className={`${styles.item} ${styles.itemChild}`}>
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={!!child.checked}
                              onChange={() => toggleChild(section.id, item.id, child.id)}
                            />
                            <div className={styles.itemBody}>
                              <div className={`${styles.itemLabel} ${child.checked ? styles.itemLabelChecked : ''}`}>
                                {child.label}
                              </div>
                              {child.note && <div className={styles.itemNote}>{child.note}</div>}
                            </div>
                          </label>
                        )
                      ))}
                    </div>
                  );
                })}

                {editMode && (
                  <button className={styles.addItemBtn} onClick={() => addItem(section.id)}>+ Add item</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

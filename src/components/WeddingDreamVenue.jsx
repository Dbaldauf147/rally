import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  addCategory, addCategoryBeside, addItem, canAddBeside, canSitBeside, categoryRows, dreamProgress, editItem,
  moveCategory, moveItem, normalizeDreamVenue, removeCategory, removeItem, renameCategory, setBeside,
  toggleCategory, toggleItem,
} from '../lib/weddingDreamVenue';
import styles from './WeddingPage.module.css';
import ds from './WeddingDreamVenue.module.css';

const Icon = ({ children }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
// A list with a "+" to its right.
const AddRight = () => <Icon><rect x="2" y="4" width="9" height="16" rx="2" /><line x1="18" y1="8" x2="18" y2="16" /><line x1="14" y1="12" x2="22" y2="12" /></Icon>;
// Two lists side by side / one list over another.
const SideBySide = () => <Icon><rect x="2" y="4" width="8.5" height="16" rx="2" /><rect x="13.5" y="4" width="8.5" height="16" rx="2" /></Icon>;
const Stacked = () => <Icon><rect x="4" y="2" width="16" height="8.5" rx="2" /><rect x="4" y="13.5" width="16" height="8.5" rx="2" /></Icon>;

/* Text you click into and edit in place. Typing stays local and is saved when
   you leave the box (or press Enter on a one-line one); Escape puts it back. */
function InlineText({ value, onSave, onLeaveEmpty, placeholder, multiline = false, className, label, autoFocus = false }) {
  const [val, setVal] = useState(value);
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(value);
  if (seen !== value && !focused) {
    setSeen(value);
    setVal(value);
  }
  const ref = useRef(null);
  // A textarea that's as tall as its text, so a long note doesn't scroll —
  // measured again when its width changes (a phone turning, a window resizing).
  useEffect(() => {
    const el = ref.current;
    if (!multiline || !el) return undefined;
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let w = el.offsetWidth;
    const ro = new ResizeObserver(() => { if (el.offsetWidth !== w) { w = el.offsetWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [val, multiline]);
  const props = {
    ref,
    className,
    value: val,
    placeholder,
    'aria-label': label,
    autoFocus,
    onChange: (e) => setVal(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: (e) => {
      setFocused(false);
      if (val !== value) onSave(val);
      else if (onLeaveEmpty && !val.trim()) onLeaveEmpty(e);
    },
    onKeyDown: (e) => {
      if (e.key === 'Escape') { setVal(value); setTimeout(() => e.target.blur(), 0); }
      else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
    },
  };
  return multiline ? <textarea rows={1} {...props} /> : <input type="text" {...props} />;
}

/* Wedding → Venues → Dream venue: what the venue needs to be, as categories
   of items to tick off. Everything is editable in place; lib/weddingDreamVenue.js
   holds the starting list and the edits. */
export function WeddingDreamVenue({ subnav }) {
  const { user } = useAuth();
  const [cats, setCats] = useState(() => normalizeDreamVenue(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [hideDone, setHideDone] = useState(false);
  const [focusId, setFocusId] = useState(null); // a just-added item or category

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      setCats(normalizeDreamVenue(snap.data()?.weddingDreamVenue));
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  const catsRef = useRef(cats);
  useEffect(() => { catsRef.current = cats; }, [cats]);

  const save = (change) => {
    const next = change(catsRef.current);
    catsRef.current = next;
    setCats(next);
    if (!user) return;
    setDoc(doc(db, 'users', user.uid), { weddingDreamVenue: { categories: next } }, { merge: true })
      .then(() => setError(''))
      .catch((err) => setError(`Could not save: ${err.message}`));
  };

  const addNewItem = (catId) => {
    let newId = null;
    save((c) => { const r = addItem(c, catId); newId = r.id; return r.cats; });
    setCollapsed((x) => ({ ...x, [catId]: false }));
    setFocusId(newId);
  };
  const addNewCategory = () => {
    let newId = null;
    save((c) => { const r = addCategory(c); newId = r.id; return r.cats; });
    setFocusId(newId);
  };
  // A new list to the right of this one, ready to be named.
  const addBeside = (catId) => {
    let newId = null;
    save((c) => { const r = addCategoryBeside(c, catId); newId = r.id; return r.cats; });
    if (newId) setFocusId(newId);
  };
  const deleteCategory = (cat) => {
    if (cat.items.length && !confirm(`Delete “${cat.title || 'this category'}” and its ${cat.items.length} item${cat.items.length === 1 ? '' : 's'}?`)) return;
    save((c) => removeCategory(c, cat.id));
  };
  // Replace whatever is saved with the starting list (Must have / Preference /
  // Unsure). Your own lists and ticks go, so it asks first.
  const resetToStart = () => {
    if (!confirm('Replace your dream venue list with the starting list (Must have, Preference, Unsure)? Your current lists and ticks will be removed.')) return;
    save(() => normalizeDreamVenue(null));
    setCollapsed({});
  };
  // An item left with nothing in it is tidied away rather than kept blank —
  // unless you've only moved on to its own note box.
  const dropIfEmpty = (cat, item, e) => {
    const row = e?.target?.closest?.('li');
    if (row && e.relatedTarget && row.contains(e.relatedTarget)) return;
    const cur = catsRef.current.find((c) => c.id === cat.id)?.items.find((i) => i.id === item.id);
    if (cur && !cur.title.trim() && !cur.detail.trim()) save((c) => removeItem(c, cat.id, item.id));
  };

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;

  const { done, total } = dreamProgress(cats);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        <span className={styles.count}>{done} of {total} checked</span>
      </div>
      {subnav}
      <p className={styles.subtitle}>
        What the venue has to be. Tick things off as you settle them, and click any text to change it.
        Lists can sit side by side: use the buttons on a list&apos;s heading to add one to its right.
      </p>
      <div className={ds.progressBar} aria-hidden="true"><div style={{ width: total ? `${(done / total) * 100}%` : 0 }} /></div>

      <div className={styles.toolbar}>
        <button type="button" className={hideDone ? `${styles.toolButton} ${styles.toolButtonOn}` : styles.toolButton} onClick={() => setHideDone((h) => !h)} aria-pressed={hideDone}>
          {hideDone ? 'Show checked' : 'Hide checked'}
        </button>
        <button type="button" className={styles.toolButton} onClick={() => setCollapsed(Object.fromEntries(cats.map((c) => [c.id, true])))}>Collapse all</button>
        <button type="button" className={styles.toolButton} onClick={() => setCollapsed({})}>Expand all</button>
        <button type="button" className={styles.toolButton} onClick={addNewCategory}>+ Add category</button>
        <button type="button" className={styles.toolButton} onClick={resetToStart}>Reset to starting list</button>
      </div>
      {error && <p className={styles.digestErrMsg} role="status">{error}</p>}

      {cats.length === 0 && <p className={ds.empty}>No categories. Add one to start your list.</p>}

      <div className={ds.list}>
        {categoryRows(cats).map((row) => (
          <div key={row[0].id} className={row.length > 1 ? `${ds.row} ${ds.rowShared}` : ds.row}>
            {row.map((cat) => {
              const ci = cats.indexOf(cat);
              const shared = row.length > 1;
              const catDone = cat.items.filter((i) => i.done).length;
              const allDone = cat.items.length > 0 && catDone === cat.items.length;
              const open = !collapsed[cat.id];
              const items = hideDone ? cat.items.filter((i) => !i.done) : cat.items;
              return (
                <section key={cat.id} className={shared ? `${ds.category} ${ds.categoryShared}` : ds.category} aria-label={cat.title || 'Untitled category'}>
                  <div className={ds.catHeader}>
                    <button type="button" className={ds.chevron} onClick={() => setCollapsed((x) => ({ ...x, [cat.id]: open }))} aria-expanded={open} aria-label={open ? `Collapse ${cat.title}` : `Expand ${cat.title}`}>
                      {open ? '▾' : '▸'}
                    </button>
                    <input
                      type="checkbox"
                      className={ds.check}
                      checked={allDone}
                      ref={(el) => { if (el) el.indeterminate = catDone > 0 && !allDone; }}
                      onChange={() => save((c) => toggleCategory(c, cat.id))}
                      disabled={cat.items.length === 0}
                      aria-label={`Check all of ${cat.title}`}
                    />
                    <InlineText
                      className={ds.catTitle}
                      value={cat.title}
                      placeholder="Category name"
                      label="Category name"
                      autoFocus={focusId === cat.id}
                      onSave={(t) => save((c) => renameCategory(c, cat.id, t))}
                    />
                    <span className={ds.catCount}>{catDone}/{cat.items.length}</span>
                    <div className={ds.actions}>
                      {canAddBeside(cats, cat.id) && (
                        <button type="button" className={ds.iconBtn} onClick={() => addBeside(cat.id)} aria-label={`Add a list to the right of ${cat.title}`} title="Add a list to the right of this one"><AddRight /></button>
                      )}
                      {cat.beside ? (
                        <button type="button" className={ds.iconBtn} onClick={() => save((c) => setBeside(c, cat.id, false))} aria-label={`Move ${cat.title} to its own row`} title="Move to its own row"><Stacked /></button>
                      ) : canSitBeside(cats, cat.id) && (
                        <button type="button" className={ds.iconBtn} onClick={() => save((c) => setBeside(c, cat.id, true))} aria-label={`Put ${cat.title} beside the list above`} title="Put beside the list above"><SideBySide /></button>
                      )}
                      <button type="button" className={ds.iconBtn} onClick={() => save((c) => moveCategory(c, cat.id, -1))} disabled={ci === 0} aria-label={`Move ${cat.title} ${cat.beside ? 'left' : 'up'}`} title={cat.beside ? 'Move left' : 'Move up'}>{cat.beside ? '←' : '↑'}</button>
                      <button type="button" className={ds.iconBtn} onClick={() => save((c) => moveCategory(c, cat.id, 1))} disabled={ci === cats.length - 1} aria-label={`Move ${cat.title} ${cats[ci + 1]?.beside ? 'right' : 'down'}`} title={cats[ci + 1]?.beside ? 'Move right' : 'Move down'}>{cats[ci + 1]?.beside ? '→' : '↓'}</button>
                      <button type="button" className={ds.iconBtn} onClick={() => deleteCategory(cat)} aria-label={`Delete ${cat.title}`} title="Delete category">✕</button>
                    </div>
                  </div>
                  {open && (
                    <ul className={ds.items}>
                      {items.map((item) => {
                        const ii = cat.items.indexOf(item);
                        return (
                          <li key={item.id} className={item.done ? `${ds.item} ${ds.itemDone}` : ds.item}>
                            <input
                              type="checkbox"
                              className={ds.check}
                              checked={item.done}
                              onChange={() => save((c) => toggleItem(c, cat.id, item.id))}
                              aria-label={`Check ${item.title || 'item'}`}
                            />
                            <div className={ds.itemText}>
                              <InlineText
                                className={ds.itemTitle}
                                value={item.title}
                                placeholder="What to look for"
                                label="Item"
                                autoFocus={focusId === item.id}
                                onSave={(t) => save((c) => editItem(c, cat.id, item.id, { title: t }))}
                                onLeaveEmpty={(e) => dropIfEmpty(cat, item, e)}
                              />
                              <InlineText
                                className={ds.itemDetail}
                                value={item.detail}
                                placeholder="Add a note…"
                                label={`Note for ${item.title || 'item'}`}
                                multiline
                                onSave={(t) => save((c) => editItem(c, cat.id, item.id, { detail: t }))}
                                onLeaveEmpty={(e) => dropIfEmpty(cat, item, e)}
                              />
                            </div>
                            <div className={ds.actions}>
                              <button type="button" className={ds.iconBtn} onClick={() => save((c) => moveItem(c, cat.id, item.id, -1))} disabled={ii === 0} aria-label={`Move ${item.title} up`} title="Move up">↑</button>
                              <button type="button" className={ds.iconBtn} onClick={() => save((c) => moveItem(c, cat.id, item.id, 1))} disabled={ii === cat.items.length - 1} aria-label={`Move ${item.title} down`} title="Move down">↓</button>
                              <button type="button" className={ds.iconBtn} onClick={() => save((c) => removeItem(c, cat.id, item.id))} aria-label={`Delete ${item.title}`} title="Delete item">✕</button>
                            </div>
                          </li>
                        );
                      })}
                      {hideDone && catDone > 0 && <li className={ds.hiddenNote}>{catDone} checked hidden</li>}
                      <li>
                        <button type="button" className={ds.addItem} onClick={() => addNewItem(cat.id)}>+ Add item</button>
                      </li>
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

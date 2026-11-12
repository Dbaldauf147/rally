import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyListEdits, categoryState, normalizeReasonList, reasonKey, reasonTree, renameReasons, splitReason, standardReason, subReason,
  toggleCategory, toggleSubReason,
} from '../lib/venueNoFit';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* Asked when a venue is marked "Not a fit": why, as checkboxes, with room
   underneath for notes in your own words. At least one box must be checked;
   the notes are optional. A reason that isn't on the list can be added, and is
   offered as a checkbox next time. "Edit list" renames and removes reasons
   (a rename carries onto every venue that has it). Cancel leaves the status
   as it was.

   Reasons can be categories with sub-reasons under them ("Too expensive" →
   "Venue fee", "Per person"): tick the category for all of it, or just some
   of its sub-reasons (lib/venueNoFit.js). */
export function VenueNoFitPrompt({ venue, options, onSave, onCancel, onEditList }) {
  // Checked reasons by key, with the spelling to show for each.
  const [checked, setChecked] = useState(() => new Map((venue.noFitReasons || []).map((r) => [reasonKey(r), r])));
  // Reasons added in this pop-up, shown with the others until it's saved.
  const [added, setAdded] = useState([]);
  const [typed, setTyped] = useState('');
  // The category a sub-reason is being typed under, and what's typed.
  const [subFor, setSubFor] = useState(null);
  const [subTyped, setSubTyped] = useState('');
  const [notes, setNotes] = useState(venue.noFitNotes || '');
  // Editing the list: rows of { id, from, text, parent } (parent = the id of
  // its category's row, for a sub-reason), or null when checking.
  const [rows, setRows] = useState(null);
  const inputRef = useRef(null);
  const nextId = useRef(0);

  const list = useMemo(() => {
    const base = [...options];
    const keys = new Set(base.map((o) => reasonKey(o.reason)));
    for (const r of added) {
      if (!keys.has(reasonKey(r))) { keys.add(reasonKey(r)); base.push({ reason: r, count: 0, isNew: true }); }
    }
    // A checked reason that's no longer on the list (removed from it, but
    // still on this venue) stays tickable so it can be unticked.
    for (const [k, r] of checked) if (!keys.has(k)) { keys.add(k); base.push({ reason: r, count: 0, offList: true }); }
    return base;
  }, [options, added, checked]);
  const tree = useMemo(() => reasonTree(list), [list]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (subFor) { setSubFor(null); setSubTyped(''); } else if (rows) setRows(null); else onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, rows, subFor]);

  const addTyped = () => {
    const r = standardReason(typed, list.map((o) => o.reason));
    if (!r) return;
    if (!list.some((o) => reasonKey(o.reason) === reasonKey(r))) setAdded((a) => [...a, r]);
    setChecked((m) => new Map(m).set(reasonKey(r), r));
    setTyped('');
    inputRef.current?.focus();
  };
  // A new sub-reason under a category, ticked — unless the whole category
  // already is, which takes it in.
  const addSub = (node) => {
    const r = standardReason(subReason(node.reason, subTyped), list.map((o) => o.reason));
    if (!r || !splitReason(r)[1]) return;
    if (!list.some((o) => reasonKey(o.reason) === reasonKey(r))) setAdded((a) => [...a, r]);
    if (!checked.has(reasonKey(node.reason))) setChecked((m) => new Map(m).set(reasonKey(r), r));
    setSubTyped('');
  };

  const offListKeys = new Set(list.filter((o) => o.offList).map((o) => reasonKey(o.reason)));
  const known = new Set(options.map((o) => reasonKey(o.reason)));
  const chosen = [...checked.values()];
  // New to the list: everything typed in here, and a category that only
  // existed through its sub-reasons. Not ones taken off the list on purpose.
  const save = () => {
    if (!chosen.length) return;
    const withCats = [...added, ...chosen].flatMap((r) => { const [cat, sub] = splitReason(r); return sub ? [cat, r] : [r]; });
    const fresh = normalizeReasonList(withCats).filter((r) => !known.has(reasonKey(r)) && !offListKeys.has(reasonKey(r)));
    onSave(chosen, fresh, notes.trim());
  };

  /* ── Editing the list ── */
  const startEditing = () => {
    const out = [];
    for (const n of tree) {
      if (n.offList && !n.children.length) continue;
      const id = nextId.current++;
      out.push({ id, from: n.isNew || n.implied ? '' : n.reason, text: n.reason, parent: null });
      for (const c of n.children) if (!c.offList) out.push({ id: nextId.current++, from: c.isNew ? '' : c.reason, text: splitReason(c.reason)[1], parent: id });
    }
    setRows(out);
  };
  const setRow = (id, text) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, text } : r)));
  // Removing a category takes its sub-reasons with it.
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id && r.parent !== id));
  const addRow = () => setRows((rs) => [...rs, { id: nextId.current++, from: '', text: '', parent: null }]);
  const addSubRow = (parentId) => setRows((rs) => {
    const at = rs.reduce((last, r, i) => (r.id === parentId || r.parent === parentId ? i : last), -1);
    const next = [...rs];
    next.splice(at + 1, 0, { id: nextId.current++, from: '', text: '', parent: parentId });
    return next;
  });
  const finishEditing = () => {
    // Sub-reasons are saved as "Category › Sub-reason", so renaming a
    // category renames each of them too.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const flat = rows.map((r) => {
      if (r.parent === null) return { from: r.from, text: r.text };
      const cat = byId.get(r.parent)?.text || '';
      return { from: r.from, text: cat.trim() && r.text.trim() ? subReason(cat, r.text) : '' };
    });
    const { list: nextList, renames } = applyListEdits(flat);
    const removedKeys = new Set();
    for (const o of list) if (!o.offList && !nextList.some((r) => reasonKey(r) === reasonKey(renames[o.reason] ?? o.reason))) removedKeys.add(reasonKey(o.reason));
    setChecked((m) => {
      const next = new Map();
      for (const [k, r] of m) {
        if (removedKeys.has(k)) continue;
        const [to] = renameReasons([r], renames);
        if (to) next.set(reasonKey(to), to);
      }
      return next;
    });
    setAdded([]);
    setRows(null);
    onEditList(nextList, renames);
  };

  const count = (o) => o.count > 0 && <span className={vs.noFitCount} title={`On ${o.count} other venue${o.count === 1 ? '' : 's'}`}>{o.count}</span>;
  const tags = (o) => (
    <>
      {o.isNew && <span className={vs.noFitCount}>new</span>}
      {o.offList && <span className={vs.noFitCount} title="Removed from the list, still on this venue">not on list</span>}
    </>
  );

  return (
    <div className={`${styles.modalOverlay} ${vs.noFitOverlay}`} onClick={onCancel}>
      <form
        className={`${styles.modal} ${vs.noFitModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Why is ${venue.name || 'this venue'} not a fit?`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (rows) finishEditing(); else save(); }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{rows ? 'Edit the reasons' : `Why isn’t ${venue.name || 'this venue'} a fit?`}</h2>
          <button className={styles.modalClose} type="button" onClick={onCancel} aria-label="Close">×</button>
        </div>
        {rows ? (
          <div className={styles.modalBody}>
            <p className={styles.modalHint}>Renaming a reason changes it on every venue. Give two the same name to merge them. Removing one takes it off this list; venues that already have it keep it. Use “+ sub-reason” to put reasons under a category.</p>
            <div className={vs.noFitList}>
              {rows.map((r) => (
                <div key={r.id} className={r.parent === null ? vs.noFitEditRow : `${vs.noFitEditRow} ${vs.noFitSubRow}`}>
                  {r.parent !== null && <span className={vs.noFitSubMark} aria-hidden="true">↳</span>}
                  <input
                    className={styles.contactInput}
                    value={r.text}
                    maxLength={60}
                    placeholder={r.parent === null ? 'Reason or category' : 'Sub-reason'}
                    aria-label={r.from ? `Rename ${r.from}` : r.parent === null ? 'New reason' : 'New sub-reason'}
                    autoFocus={!r.from && !r.text}
                    onChange={(e) => setRow(r.id, e.target.value.replace(/›/g, ''))}
                  />
                  {r.parent === null && (
                    <button type="button" className={vs.noFitSubBtn} onClick={() => addSubRow(r.id)} title="Add a sub-reason under this one">+ sub-reason</button>
                  )}
                  <button type="button" className={vs.noFitRemove} onClick={() => removeRow(r.id)} aria-label={`Remove ${r.text || r.from || 'reason'}`} title={r.parent === null ? 'Remove from the list (and its sub-reasons)' : 'Remove from the list'}>×</button>
                </div>
              ))}
              {rows.length === 0 && <p className={styles.modalHint}>No reasons left — add one below or when you mark a venue.</p>}
            </div>
            <button type="button" className={`${styles.modalSecondary} ${vs.noFitAddRow}`} onClick={addRow}>+ Add a reason</button>
          </div>
        ) : (
          <div className={styles.modalBody}>
            <p className={styles.modalHint}>
              Check at least one. Tick a category for all of it, or just some of its sub-reasons. Reasons you add are kept here for the next venue.{' '}
              <button type="button" className={vs.noFitEditLink} onClick={startEditing}>Edit list</button>
            </p>
            <div className={vs.noFitList}>
              {tree.map((n) => {
                const state = categoryState(n, checked);
                return (
                  <div key={n.reason} className={vs.noFitGroup}>
                    <div className={vs.noFitCatRow}>
                      <label className={vs.noFitOption}>
                        <input
                          type="checkbox"
                          checked={state === 'all'}
                          ref={(el) => { if (el) el.indeterminate = state === 'some'; }}
                          onChange={() => setChecked((m) => toggleCategory(m, n))}
                          aria-label={n.children.length ? `${n.reason} (all)` : n.reason}
                        />
                        <span>{n.reason}</span>
                        {count(n)}
                        {tags(n)}
                      </label>
                      <button
                        type="button"
                        className={vs.noFitSubBtn}
                        onClick={() => { setSubFor(subFor === n.reason ? null : n.reason); setSubTyped(''); }}
                        aria-label={`Add a sub-reason under ${n.reason}`}
                        title="Add a sub-reason under this one"
                      >+ sub-reason</button>
                    </div>
                    {(n.children.length > 0 || subFor === n.reason) && (
                      <div className={vs.noFitSubs}>
                        {n.children.map((c) => (
                          <label key={c.reason} className={`${vs.noFitOption} ${vs.noFitSubOption}`}>
                            <input
                              type="checkbox"
                              checked={state === 'all' || checked.has(reasonKey(c.reason))}
                              onChange={() => setChecked((m) => toggleSubReason(m, n, c))}
                              aria-label={c.reason}
                            />
                            <span>{splitReason(c.reason)[1]}</span>
                            {count(c)}
                            {tags(c)}
                          </label>
                        ))}
                        {subFor === n.reason && (
                          <div className={vs.noFitAdd}>
                            <input
                              className={styles.contactInput}
                              value={subTyped}
                              maxLength={60}
                              autoFocus
                              placeholder={`Under “${n.reason}”…`}
                              aria-label={`New sub-reason under ${n.reason}`}
                              onChange={(e) => setSubTyped(e.target.value.replace(/›/g, ''))}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(n); } }}
                            />
                            <button type="button" className={styles.modalSecondary} onClick={() => addSub(n)} disabled={!subTyped.trim()}>Add</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={vs.noFitAdd}>
              <input
                ref={inputRef}
                className={styles.contactInput}
                value={typed}
                maxLength={60}
                placeholder="Another reason or category…"
                aria-label="Another reason"
                onChange={(e) => setTyped(e.target.value.replace(/›/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
              />
              <button type="button" className={styles.modalSecondary} onClick={addTyped} disabled={!typed.trim()}>Add</button>
            </div>
            <label className={vs.noFitNotes}>
              <span className={styles.contactLabel}>Notes</span>
              <textarea
                className={styles.contactInput}
                rows={4}
                maxLength={2000}
                value={notes}
                placeholder="Anything else worth remembering about why — in your own words."
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && chosen.length) { e.preventDefault(); save(); } }}
              />
            </label>
          </div>
        )}
        <div className={styles.modalFooter}>
          {rows ? (
            <>
              <span className={styles.modalCount}>{rows.length} reason{rows.length === 1 ? '' : 's'}</span>
              <button className={styles.modalSecondary} type="button" onClick={() => setRows(null)}>Discard changes</button>
              <button className={styles.modalPrimary} type="submit">Save list</button>
            </>
          ) : (
            <>
              <span className={styles.modalCount}>{chosen.length ? `${chosen.length} checked` : 'Check at least one reason'}</span>
              <button className={styles.modalSecondary} type="button" onClick={onCancel}>Cancel</button>
              <button className={styles.modalPrimary} type="submit" disabled={!chosen.length}>Mark not a fit</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

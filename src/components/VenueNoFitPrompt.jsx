import { useEffect, useMemo, useRef, useState } from 'react';
import { applyListEdits, reasonKey, renameReasons, standardReason } from '../lib/venueNoFit';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* Asked when a venue is marked "Not a fit": why, as checkboxes, with room
   underneath for notes in your own words. At least one box must be checked;
   the notes are optional. A reason that isn't on the list can be added, and is
   offered as a checkbox next time. "Edit list" renames and removes reasons
   (a rename carries onto every venue that has it). Cancel leaves the status
   as it was. */
export function VenueNoFitPrompt({ venue, options, onSave, onCancel, onEditList }) {
  // Checked reasons by key, with the spelling to show for each.
  const [checked, setChecked] = useState(() => new Map((venue.noFitReasons || []).map((r) => [reasonKey(r), r])));
  // Reasons added in this pop-up, shown with the others until it's saved.
  const [added, setAdded] = useState([]);
  const [typed, setTyped] = useState('');
  const [notes, setNotes] = useState(venue.noFitNotes || '');
  // Editing the list: rows of { id, from, text }, or null when checking.
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (rows) setRows(null); else onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, rows]);

  const toggle = (reason) => setChecked((m) => {
    const next = new Map(m);
    const k = reasonKey(reason);
    if (next.has(k)) next.delete(k); else next.set(k, reason);
    return next;
  });

  const addTyped = () => {
    const r = standardReason(typed, list.map((o) => o.reason));
    if (!r) return;
    if (!list.some((o) => reasonKey(o.reason) === reasonKey(r))) setAdded((a) => [...a, r]);
    setChecked((m) => new Map(m).set(reasonKey(r), r));
    setTyped('');
    inputRef.current?.focus();
  };

  const chosen = list.filter((o) => checked.has(reasonKey(o.reason))).map((o) => o.reason);
  const save = () => { if (chosen.length) onSave(chosen, added.filter((r) => chosen.includes(r)), notes.trim()); };

  /* ── Editing the list ── */
  const startEditing = () => setRows(list.filter((o) => !o.offList).map((o) => ({ id: nextId.current++, from: o.isNew ? '' : o.reason, text: o.reason })));
  const setRow = (id, text) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, text } : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () => setRows((rs) => [...rs, { id: nextId.current++, from: '', text: '' }]);
  const finishEditing = () => {
    const { list: nextList, renames } = applyListEdits(rows);
    // Every row was saved, the ones added in this pop-up included.
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
            <p className={styles.modalHint}>Renaming a reason changes it on every venue. Give two the same name to merge them. Removing one takes it off this list; venues that already have it keep it.</p>
            <div className={vs.noFitList}>
              {rows.map((r) => (
                <div key={r.id} className={vs.noFitEditRow}>
                  <input
                    className={styles.contactInput}
                    value={r.text}
                    maxLength={60}
                    placeholder="Reason"
                    aria-label={r.from ? `Rename ${r.from}` : 'New reason'}
                    autoFocus={!r.from && !r.text}
                    onChange={(e) => setRow(r.id, e.target.value)}
                  />
                  <button type="button" className={vs.noFitRemove} onClick={() => removeRow(r.id)} aria-label={`Remove ${r.text || r.from || 'reason'}`} title="Remove from the list">×</button>
                </div>
              ))}
              {rows.length === 0 && <p className={styles.modalHint}>No reasons left — add one below or when you mark a venue.</p>}
            </div>
            <button type="button" className={`${styles.modalSecondary} ${vs.noFitAddRow}`} onClick={addRow}>+ Add a reason</button>
          </div>
        ) : (
          <div className={styles.modalBody}>
            <p className={styles.modalHint}>
              Check at least one. Reasons you add are kept here for the next venue.{' '}
              <button type="button" className={vs.noFitEditLink} onClick={startEditing}>Edit list</button>
            </p>
            <div className={vs.noFitList}>
              {list.map((o) => (
                <label key={o.reason} className={vs.noFitOption}>
                  <input type="checkbox" checked={checked.has(reasonKey(o.reason))} onChange={() => toggle(o.reason)} />
                  <span>{o.reason}</span>
                  {o.count > 0 && <span className={vs.noFitCount} title={`On ${o.count} other venue${o.count === 1 ? '' : 's'}`}>{o.count}</span>}
                  {o.isNew && <span className={vs.noFitCount}>new</span>}
                  {o.offList && <span className={vs.noFitCount} title="Removed from the list, still on this venue">not on list</span>}
                </label>
              ))}
            </div>
            <div className={vs.noFitAdd}>
              <input
                ref={inputRef}
                className={styles.contactInput}
                value={typed}
                maxLength={60}
                placeholder="Another reason…"
                aria-label="Another reason"
                onChange={(e) => setTyped(e.target.value)}
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

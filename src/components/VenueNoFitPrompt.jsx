import { useEffect, useMemo, useRef, useState } from 'react';
import { reasonKey, standardReason } from '../lib/venueNoFit';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* Asked when a venue is marked "Not a fit": why, as checkboxes. At least one
   must be checked. A reason that isn't on the list can be added, and is
   offered as a checkbox next time. Cancel leaves the status as it was. */
export function VenueNoFitPrompt({ venue, options, onSave, onCancel }) {
  const [checked, setChecked] = useState(() => new Set((venue.noFitReasons || []).map(reasonKey)));
  // Reasons added in this pop-up, shown with the others until it's saved.
  const [added, setAdded] = useState([]);
  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);

  const list = useMemo(() => {
    const base = [...options];
    const keys = new Set(base.map((o) => reasonKey(o.reason)));
    // A reason the venue already has that's no longer offered stays tickable.
    for (const r of [...(venue.noFitReasons || []), ...added]) {
      if (!keys.has(reasonKey(r))) { keys.add(reasonKey(r)); base.push({ reason: r, count: 0, isNew: added.includes(r) }); }
    }
    return base;
  }, [options, added, venue.noFitReasons]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const toggle = (reason) => setChecked((s) => {
    const next = new Set(s);
    const k = reasonKey(reason);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const addTyped = () => {
    const r = standardReason(typed, list.map((o) => o.reason));
    if (!r) return;
    if (!list.some((o) => reasonKey(o.reason) === reasonKey(r))) setAdded((a) => [...a, r]);
    setChecked((s) => new Set(s).add(reasonKey(r)));
    setTyped('');
    inputRef.current?.focus();
  };

  const chosen = list.filter((o) => checked.has(reasonKey(o.reason))).map((o) => o.reason);
  const save = () => { if (chosen.length) onSave(chosen, added.filter((r) => chosen.includes(r))); };

  return (
    <div className={`${styles.modalOverlay} ${vs.noFitOverlay}`} onClick={onCancel}>
      <form
        className={`${styles.modal} ${vs.noFitModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Why is ${venue.name || 'this venue'} not a fit?`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Why isn’t {venue.name || 'this venue'} a fit?</h2>
          <button className={styles.modalClose} type="button" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.modalHint}>Check at least one. Reasons you add are kept here for the next venue.</p>
          <div className={vs.noFitList}>
            {list.map((o) => (
              <label key={o.reason} className={vs.noFitOption}>
                <input type="checkbox" checked={checked.has(reasonKey(o.reason))} onChange={() => toggle(o.reason)} />
                <span>{o.reason}</span>
                {o.count > 0 && <span className={vs.noFitCount} title={`On ${o.count} other venue${o.count === 1 ? '' : 's'}`}>{o.count}</span>}
                {o.isNew && <span className={vs.noFitCount}>new</span>}
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
        </div>
        <div className={styles.modalFooter}>
          <span className={styles.modalCount}>{chosen.length ? `${chosen.length} checked` : 'Check at least one reason'}</span>
          <button className={styles.modalSecondary} type="button" onClick={onCancel}>Cancel</button>
          <button className={styles.modalPrimary} type="submit" disabled={!chosen.length}>Mark not a fit</button>
        </div>
      </form>
    </div>
  );
}

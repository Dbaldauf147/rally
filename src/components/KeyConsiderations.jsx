import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import styles from './KeyConsiderations.module.css';

// Every mounted cell registers its flush here, so the page being closed or
// backgrounded can drain them all at once. Returns an unregister.
const FlushContext = createContext(() => () => {});

// How long a pause in typing counts as "done for now". Long enough that a
// normal sentence is one write, short enough that a refresh a moment later
// still finds the text.
const SAVE_DELAY = 700;

/* One editable cell.

   Uncontrolled, the same idiom DoctorsPage uses: the stored shape trims its
   strings, so writing state per keystroke would eat the space the moment you
   typed it. A textarea rather than an input because a want and a plan are both
   sentences, and one that scrolls sideways in a 40-character box is one you
   can't read back.

   Saving on blur alone was not enough: type a line, hit refresh without
   clicking away, and it was never written. So it also saves as you type (after
   a pause), flushes when the tab it lives on goes away, and flushes when the
   whole page does. */
function Cell({ value, placeholder, ariaLabel, onCommit }) {
  const timer = useRef(null);
  const pending = useRef(null);
  // Held in a ref so `flush` is stable: it is registered with the parent, and a
  // new identity every render would churn that registration.
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; });

  // Write whatever is waiting, now. A second call is a no-op.
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    commitRef.current(text);
  }, []);

  const register = useContext(FlushContext);
  useEffect(() => register(flush), [register, flush]);
  // Leaving the tab unmounts these; the half-typed line should still land.
  useEffect(() => flush, [flush]);

  return (
    <textarea
      className={styles.cell}
      defaultValue={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={2}
      onChange={(e) => {
        pending.current = e.target.value;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY);
      }}
      onBlur={flush}
    />
  );
}

const STATUS_TEXT = {
  saving: 'Saving…',
  saved: 'All changes saved',
  error: "Couldn't save — check your connection",
};

/**
 * Key considerations — what I want out of this event, and what I'll do to get it.
 *
 * Two columns rather than one list with the plan tucked inside each item: the
 * pairing IS the content. A want with nothing beside it is the thing this tab
 * exists to make visible, so the empty half has to be as legible as the full
 * one — which is why an unanswered plan shows a prompt rather than blank space.
 *
 * Rows keep the order they were added. Not sorted, not grouped: this is a short
 * hand-written list, and re-ordering it under the person writing it is the same
 * mistake as sorting a shopping list while someone is reading it.
 */
export function KeyConsiderations({ event, onSave, currentUser, canManageAll }) {
  const items = Array.isArray(event?.keyConsiderations) ? event.keyConsiderations : [];
  const [status, setStatus] = useState(null);

  // The newest list, readable at the moment a queued write actually runs.
  // Mirrored from the snapshot, but never while our own writes are in flight:
  // between queueing a write and its snapshot coming back, the prop is a
  // version behind, and adopting it would undo what we just wrote.
  const itemsRef = useRef(items);
  const inFlight = useRef(0);
  useEffect(() => { if (inFlight.current === 0) itemsRef.current = items; });

  const uid = currentUser?.uid;
  const isMember = !!(uid && event?.members?.[uid]);
  const canEdit = isMember || canManageAll;

  /* Writes are serialized, and each one builds from the list as it stands when
     its turn comes. Two cells finishing their pause together would otherwise
     both start from the same array, and whichever landed second would drop the
     other's edit. `build` returns null to mean "nothing to write". */
  const queue = useRef(Promise.resolve());
  const commit = useCallback((build) => {
    setStatus('saving');
    inFlight.current += 1;
    queue.current = queue.current
      .then(async () => {
        const next = build(itemsRef.current);
        if (!next) return;
        // Keep the local view in step for whatever is queued behind this, in
        // case the snapshot has not come back round yet.
        itemsRef.current = next;
        await onSave({ keyConsiderations: next });
      })
      .then(() => setStatus('saved'))
      .catch((err) => {
        console.error('Could not save key considerations', err);
        setStatus('error');
      })
      .finally(() => { inFlight.current -= 1; });
    return queue.current;
  }, [onSave]);

  // Every mounted cell's flush, so the page going away can drain them.
  const flushers = useRef(new Set());
  const register = useCallback((fn) => {
    flushers.current.add(fn);
    return () => flushers.current.delete(fn);
  }, []);

  useEffect(() => {
    const flushAll = () => { for (const f of [...flushers.current]) f(); };
    // pagehide covers the PWA being backgrounded or closed on iOS, where
    // beforeunload never fires; visibilitychange covers switching apps.
    const onHidden = () => { if (document.hidden) flushAll(); };
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  function addRow() {
    return commit(current => [
      ...current,
      { id: crypto.randomUUID(), want: '', action: '', createdAt: new Date().toISOString() },
    ]);
  }

  function setField(id, field, value) {
    return commit(current => {
      const clean = value.trim();
      const row = current.find(it => it.id === id);
      // Nothing to do if the row is gone, or the text came back unchanged —
      // every no-op write is a Firestore round trip plus a re-render for
      // everyone else on the event.
      if (!row || (row[field] || '') === clean) return null;
      return current.map(it => (
        it.id === id ? { ...it, [field]: clean, updatedAt: new Date().toISOString() } : it
      ));
    });
  }

  function removeRow(id) {
    const it = items.find(x => x.id === id);
    const label = (it?.want || '').trim();
    // An empty row is a mis-tap, not a decision — don't make them confirm it.
    if (label && !confirm(`Remove “${label}”?`)) return;
    return commit(current => current.filter(x => x.id !== id));
  }

  return (
    <FlushContext.Provider value={register}>
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.heading}>Key considerations</h3>
          <p className={styles.sub}>
            What matters to you about this trip, and what you'll do to make it happen.
          </p>
        </div>
        <div className={styles.headerActions}>
          {status && (
            <span
              className={status === 'error' ? styles.statusError : styles.status}
              role="status"
              aria-live="polite"
            >
              {STATUS_TEXT[status]}
            </span>
          )}
          {canEdit && (
            <button type="button" className={styles.addBtn} onClick={addRow}>
              + Add
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className={styles.empty}>
          {canEdit
            ? 'Nothing here yet — add the first thing you want out of this.'
            : 'Nothing here yet.'}
        </p>
      ) : (
        <div className={styles.table}>
          <div className={styles.headRow}>
            <span className={styles.headCell}>What I want</span>
            <span className={styles.headCell}>What I'll do to make it happen</span>
            <span aria-hidden="true" />
          </div>
          {items.map(it => (
            <div key={it.id} className={styles.row}>
              {canEdit ? (
                <>
                  <div className={styles.field}>
                    <span className={styles.cellLabel}>What I want</span>
                    <Cell
                      value={it.want}
                      placeholder="Something you want out of this"
                      ariaLabel="What I want"
                      onCommit={v => setField(it.id, 'want', v)}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.cellLabel}>What I'll do</span>
                    <Cell
                      value={it.action}
                      placeholder="What you'll do about it"
                      ariaLabel="What I'll do to make it happen"
                      onCommit={v => setField(it.id, 'action', v)}
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeRow(it.id)}
                    aria-label={`Remove ${it.want || 'this row'}`}
                    title="Remove"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <div className={styles.field}>
                    <span className={styles.cellLabel}>What I want</span>
                    <span className={styles.readCell}>{it.want || '—'}</span>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.cellLabel}>What I'll do</span>
                    <span className={`${styles.readCell} ${it.action ? '' : styles.unanswered}`}>
                      {it.action || 'No plan yet'}
                    </span>
                  </div>
                  <span aria-hidden="true" />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </FlushContext.Provider>
  );
}

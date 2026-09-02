import { useState } from 'react';
import styles from './KeyConsiderations.module.css';

/* One editable cell.

   Uncontrolled and committing on blur, the same idiom DoctorsPage uses: the
   stored shape trims its strings, so writing state per keystroke would eat the
   space the moment you typed it. A textarea rather than an input because a
   want and a plan are both sentences, and one that scrolls sideways in a
   40-character box is one you can't read back. */
function Cell({ value, placeholder, ariaLabel, onCommit }) {
  return (
    <textarea
      className={styles.cell}
      defaultValue={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={2}
      onBlur={(e) => onCommit(e.target.value)}
    />
  );
}

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
  const [busy, setBusy] = useState(false);

  const uid = currentUser?.uid;
  const isMember = !!(uid && event?.members?.[uid]);
  const canEdit = isMember || canManageAll;

  async function commit(next) {
    setBusy(true);
    try {
      await onSave({ keyConsiderations: next });
    } finally {
      setBusy(false);
    }
  }

  async function addRow() {
    await commit([
      ...items,
      { id: crypto.randomUUID(), want: '', action: '', createdAt: new Date().toISOString() },
    ]);
  }

  async function setField(id, field, value) {
    const clean = value.trim();
    const current = items.find(it => it.id === id);
    // Blur fires whether or not anything changed, and every no-op write here is
    // a Firestore round trip plus a re-render for everyone else on the event.
    if (!current || (current[field] || '') === clean) return;
    await commit(items.map(it => (
      it.id === id ? { ...it, [field]: clean, updatedAt: new Date().toISOString() } : it
    )));
  }

  async function removeRow(id) {
    const it = items.find(x => x.id === id);
    const label = (it?.want || '').trim();
    // An empty row is a mis-tap, not a decision — don't make them confirm it.
    if (label && !confirm(`Remove “${label}”?`)) return;
    await commit(items.filter(x => x.id !== id));
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.heading}>Key considerations</h3>
          <p className={styles.sub}>
            What matters to you about this trip, and what you'll do to make it happen.
          </p>
        </div>
        {canEdit && (
          <button type="button" className={styles.addBtn} onClick={addRow} disabled={busy}>
            + Add
          </button>
        )}
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
  );
}

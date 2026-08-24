import { useState, useMemo } from 'react';
import {
  evenShares, sumShares, unassigned, money, expenseStatus, toCents, toDollars,
} from '../lib/expenses';
import styles from './ExpensesPage.module.css';

/* The editor for one expense: who was in on it, for how much, and who has
   paid you back.

   Shared by the Expenses page and the tab on an event, because the same
   decisions apply whichever screen you arrived from. */
export function ExpenseSplitter({ expense, events, memberOptions, actions, onDone }) {
  const {
    assignEvent, setParticipants, setSplit, setPaidBy, toggleSettled, settleAll, archive,
  } = actions;

  const participants = useMemo(
    () => (expense.participants || []).filter(Boolean),
    [expense.participants],
  );

  const status = useMemo(() => expenseStatus(expense, participants), [expense, participants]);

  // Draft shares live here while the user types. Committing on every keystroke
  // would write to Firestore per character and fight the cursor.
  //
  // The draft records which expense and mode it was typed against, so switching
  // rows or flipping to Even discards it by simply not matching any more —
  // no effect needed to clear it, and no window where a half-typed share from
  // the previous row is shown against this one.
  const [draft, setDraft] = useState(null);
  const custom = expense.splitMode === 'custom';
  const liveDraft = draft && draft.forId === expense.id && draft.forMode === expense.splitMode
    ? draft.shares
    : null;

  const shownShares = liveDraft || status.shares;
  const left = unassigned(expense, shownShares);

  const nameFor = (key) => memberOptions.find(m => m.key === key)?.name || key;

  function startCustom() {
    // Seed the custom split from the even one, so the first edit is a nudge
    // rather than a blank form that has to be filled from scratch.
    const seed = evenShares(expense.amount, participants);
    setDraft({ forId: expense.id, forMode: 'custom', shares: seed });
    setSplit(expense, { splitMode: 'custom', shares: seed });
  }

  function editShare(key, text) {
    const next = { ...(liveDraft || status.shares) };
    const value = text === '' ? 0 : Number(text);
    next[key] = Number.isFinite(value) ? value : 0;
    setDraft({ forId: expense.id, forMode: 'custom', shares: next });
  }

  function commitShares() {
    if (!liveDraft) return;
    setSplit(expense, { splitMode: 'custom', shares: liveDraft });
    setDraft(null);
  }

  /* Push whatever is unassigned onto one person — the usual fix when a custom
     split is a few cents out after rounding. */
  function giveRemainder(key) {
    const next = { ...(liveDraft || status.shares) };
    next[key] = toDollars(toCents(next[key] || 0) + toCents(left));
    setSplit(expense, { splitMode: 'custom', shares: next });
    setDraft(null);
  }

  const owedKeys = participants.filter(k => k !== expense.paidBy);

  return (
    <div className={styles.editor}>
      <div className={styles.editorRow}>
        <label className={styles.fieldLabel} htmlFor={`event-${expense.id}`}>Event</label>
        <select
          id={`event-${expense.id}`}
          className={styles.select}
          value={expense.eventId || ''}
          onChange={(e) => {
            const ev = events.find(x => x.id === e.target.value);
            assignEvent(expense, e.target.value, ev ? Object.keys(ev.members || {}) : []);
          }}
        >
          <option value="">Not on an event yet</option>
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>{ev.title || 'Untitled event'}</option>
          ))}
        </select>
      </div>

      {!expense.eventId ? (
        <p className={styles.hint}>
          Put this on an event and everyone on it becomes someone you can split with.
        </p>
      ) : (
        <>
          <div className={styles.editorRow}>
            <label className={styles.fieldLabel} htmlFor={`paid-${expense.id}`}>Paid by</label>
            <select
              id={`paid-${expense.id}`}
              className={styles.select}
              value={expense.paidBy || ''}
              onChange={(e) => setPaidBy(expense, e.target.value)}
            >
              {memberOptions.map(m => (
                <option key={m.key} value={m.key}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.fieldLabel} style={{ marginTop: '0.9rem' }}>Who's in on it</div>
          <div className={styles.chips}>
            {memberOptions.map(m => {
              const on = participants.includes(m.key);
              const isPayer = m.key === expense.paidBy;
              return (
                <button
                  key={m.key}
                  type="button"
                  className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                  disabled={isPayer}
                  title={isPayer ? 'Whoever paid is always in on it' : undefined}
                  onClick={() => setParticipants(
                    expense,
                    on ? participants.filter(k => k !== m.key) : [...participants, m.key],
                  )}
                >
                  {m.name}
                </button>
              );
            })}
          </div>

          <div className={styles.splitHead}>
            <div className={styles.fieldLabel}>Shares</div>
            <div className={styles.toggle}>
              <button
                type="button"
                className={!custom ? styles.toggleOn : styles.toggleOff}
                onClick={() => setSplit(expense, { splitMode: 'even', shares: {} })}
              >
                Even
              </button>
              <button
                type="button"
                className={custom ? styles.toggleOn : styles.toggleOff}
                onClick={startCustom}
              >
                Custom
              </button>
            </div>
          </div>

          <ul className={styles.shareList}>
            {participants.map(key => {
              const isPayer = key === expense.paidBy;
              const settled = !!expense.settled?.[key];
              return (
                <li key={key} className={styles.shareRow}>
                  <span className={styles.shareName}>
                    {nameFor(key)}
                    {isPayer && <span className={styles.payerTag}>paid</span>}
                  </span>

                  {custom ? (
                    <input
                      className={styles.shareInput}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={shownShares[key] ?? 0}
                      onChange={(e) => editShare(key, e.target.value)}
                      onBlur={commitShares}
                    />
                  ) : (
                    <span className={styles.shareAmount}>{money(shownShares[key] || 0)}</span>
                  )}

                  {isPayer ? (
                    <span className={styles.shareNote}>their own</span>
                  ) : (
                    <button
                      type="button"
                      className={settled ? styles.settledOn : styles.settledOff}
                      onClick={() => toggleSettled(expense, key)}
                    >
                      {settled ? '✓ paid up' : 'mark paid'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {custom && left !== 0 && (
            <div className={styles.remainder}>
              {left > 0
                ? `${money(left)} not assigned to anyone yet`
                : `${money(-left)} more than the charge`}
              {owedKeys.length > 0 && (
                <span className={styles.remainderActions}>
                  {[expense.paidBy, ...owedKeys].filter(Boolean).map(key => (
                    <button key={key} type="button" className={styles.linkBtn} onClick={() => giveRemainder(key)}>
                      give to {nameFor(key)}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}

          <div className={styles.editorFooter}>
            <div className={styles.footerSummary}>
              {status.unsplit
                ? 'Nobody else is in on this yet'
                : status.outstanding === 0
                  ? `All square — ${money(status.owedTotal)} collected`
                  : `${money(status.outstanding)} still owed to you`}
              {custom && <span className={styles.checkSum}> · shares total {money(sumShares(shownShares))}</span>}
            </div>
            <div className={styles.footerActions}>
              {owedKeys.some(k => !expense.settled?.[k]) && (
                <button type="button" className={styles.secondaryBtn} onClick={() => settleAll(expense, owedKeys)}>
                  Everyone paid
                </button>
              )}
              <button type="button" className={styles.dangerBtn} onClick={() => { archive(expense); onDone?.(); }}>
                Remove
              </button>
            </div>
          </div>
        </>
      )}

      {!expense.eventId && (
        <div className={styles.editorFooter}>
          <div className={styles.footerSummary}>{money(expense.amount)}</div>
          <button type="button" className={styles.dangerBtn} onClick={() => { archive(expense); onDone?.(); }}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

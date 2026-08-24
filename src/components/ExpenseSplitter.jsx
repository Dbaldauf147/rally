import { useState, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  evenShares, sumShares, unassigned, money, expenseStatus, toCents, toDollars,
  remainingFor, amountPaid, paymentsFor,
} from '../lib/expenses';
import styles from './ExpensesPage.module.css';

/* The editor for one expense: who was in on it, for how much, and who has
   paid you back.

   Shared by the Expenses page and the tab on an event, because the same
   decisions apply whichever screen you arrived from. */
export function ExpenseSplitter({ expense, events, memberOptions, actions, onDone }) {
  const {
    assignEvent, setParticipants, setSplit, setPaidBy,
    addPayment, removePayment, payRemaining, archive,
  } = actions;

  // Which person's payment box is open, and what's typed in it.
  const [paying, setPaying] = useState(null);
  const [reminding, setReminding] = useState(false);
  const [remindResult, setRemindResult] = useState(null);
  // Defaults to {} so this component can be rendered outside an AuthProvider
  // without crashing on the destructure — reminders simply aren't offered.
  const { user } = useAuth() || {};

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

  /* Email people what they still owe. Explicit, never scheduled: nagging your
     friends on a cron is a good way to lose both the money and the friends. */
  const remind = useCallback(async (keys) => {
    if (!user || reminding) return;
    setReminding(true);
    setRemindResult(null);
    try {
      const recipients = keys.map(key => {
        const share = shownShares[key] || 0;
        const person = memberOptions.find(m => m.key === key);
        return {
          key,
          name: person?.name || key,
          email: person?.email || null,
          amount: remainingFor(expense, key, share),
          paid: amountPaid(expense, key, share),
        };
      }).filter(r => r.amount > 0);

      if (!recipients.length) {
        setRemindResult({ ok: false, message: 'Nothing outstanding to remind about' });
        return;
      }
      const withoutEmail = recipients.filter(r => !r.email).map(r => r.name);

      const res = await fetch('/api/expense-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({
          recipients: recipients.filter(r => r.email),
          expenseTitle: expense.description,
          eventTitle: events.find(e => e.id === expense.eventId)?.title || '',
          fromName: user.displayName || user.email || 'Someone',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      const parts = [];
      if (data.skipped) parts.push('Email isn\'t set up on this deployment');
      else parts.push(`Reminded ${data.sent} of ${data.total}`);
      if (withoutEmail.length) parts.push(`no email on file for ${withoutEmail.join(', ')}`);
      setRemindResult({ ok: !data.skipped && data.sent > 0, message: parts.join(' · ') });
    } catch (err) {
      setRemindResult({ ok: false, message: err.message });
    } finally {
      setReminding(false);
    }
  }, [user, reminding, shownShares, memberOptions, expense, events]);

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
              const share = shownShares[key] || 0;
              const paid = isPayer ? 0 : amountPaid(expense, key, share);
              const left = isPayer ? 0 : remainingFor(expense, key, share);
              const settled = !isPayer && paid > 0 && left === 0;
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
                      onClick={() => setPaying(paying?.key === key
                        ? null
                        : { key, amount: String(left) })}
                    >
                      {settled ? '✓ paid up' : paid > 0 ? `${money(left)} left` : 'record payment'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {paying && (() => {
            const share = shownShares[paying.key] || 0;
            const left = remainingFor(expense, paying.key, share);
            const typed = Number(paying.amount);
            const valid = Number.isFinite(typed) && typed > 0;
            const over = valid && toCents(typed) > toCents(left);
            return (
              <div className={styles.payBox}>
                <div className={styles.payHead}>
                  {nameFor(paying.key)} owes {money(left)}
                </div>
                <div className={styles.payRow}>
                  <input
                    className={styles.shareInput}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    autoFocus
                    value={paying.amount}
                    onChange={(e) => setPaying({ ...paying, amount: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={!valid}
                    onClick={() => { addPayment(expense, paying.key, typed); setPaying(null); }}
                  >
                    Record
                  </button>
                  {toCents(left) > 0 && (
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => setPaying({ ...paying, amount: String(left) })}
                    >
                      all of it
                    </button>
                  )}
                  <button type="button" className={styles.linkBtn} onClick={() => setPaying(null)}>
                    cancel
                  </button>
                </div>
                {over && (
                  <div className={styles.payWarn}>
                    That's {money(typed - left)} more than they owe on this one.
                  </div>
                )}
                {paymentsFor(expense, paying.key).length > 0 && (
                  <ul className={styles.payLog}>
                    {paymentsFor(expense, paying.key).map(p => (
                      <li key={p.id}>
                        {money(p.amount)} on {String(p.at).slice(0, 10)}
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => removePayment(expense, p.id)}
                        >
                          undo
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}

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

          {remindResult && (
            <div className={remindResult.ok ? styles.remindOk : styles.remindWarn}>
              {remindResult.message}
            </div>
          )}

          <div className={styles.editorFooter}>
            <div className={styles.footerSummary}>
              {status.unsplit
                ? 'Nobody else is in on this yet'
                : status.outstanding === 0
                  ? `All square — ${money(status.owedTotal)} collected`
                  : status.collected > 0
                    ? `${money(status.outstanding)} still owed · ${money(status.collected)} in`
                    : `${money(status.outstanding)} still owed to you`}
              {custom && <span className={styles.checkSum}> · shares total {money(sumShares(shownShares))}</span>}
            </div>
            <div className={styles.footerActions}>
              {status.outstanding > 0 && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={reminding}
                  onClick={() => remind(owedKeys)}
                >
                  {reminding ? 'Sending…' : 'Remind them'}
                </button>
              )}
              {status.outstanding > 0 && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => payRemaining(
                    expense,
                    Object.fromEntries(owedKeys.map(k => [k, remainingFor(expense, k, shownShares[k] || 0)])),
                  )}
                >
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

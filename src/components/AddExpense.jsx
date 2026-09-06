import { useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { expenseDraftError, memberListFor } from '../lib/expenses';
import { DateField } from './DateField';
import styles from './ExpensesPage.module.css';

/* Writing a charge down by hand.

   Not everything that gets split reaches the bank feed. Cash for the fuel, the
   deposit paid back in March, the friend who fronted the house — those never
   touch a card Wealth Architect can see, and until now there was no way to
   record them at all.

   Collapsed to a single button until it is wanted, because the common case is
   still a charge that arrived on its own and only needs splitting. The form
   asks for the four things nothing downstream can be worked out without —
   what it was, how much, when, and who paid — and leaves the split to the
   splitter that already exists, which is why it saves straight to an even
   split across everyone on the event.

   `events` decides whether the event picker appears: hand it one event (the
   trip's own tab) and the charge lands there silently; hand it the list (the
   Trip Expenses page) and the charge needs somewhere to go. */
export function AddExpense({ events = [], fixedEventId = null, onCreate }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(() => blank(fixedEventId));

  const eventId = fixedEventId || draft.eventId;
  const event = useMemo(() => events.find(e => e.id === eventId) || null, [events, eventId]);
  const members = useMemo(() => memberListFor(event), [event]);

  // Default to whoever is signed in — they are the one entering it, and the
  // overwhelming case is that they are also the one out of pocket.
  const mine = useMemo(
    () => members.find(m => m.key === user?.uid)
      || members.find(m => m.email && user?.email && m.email.toLowerCase() === user.email.toLowerCase())
      || null,
    [members, user],
  );
  const paidBy = draft.paidBy || mine?.key || members[0]?.key || user?.uid || '';

  const set = (patch) => setDraft(prev => ({ ...prev, ...patch }));
  const close = () => { setOpen(false); setDraft(blank(fixedEventId)); setError(''); };

  async function save() {
    const problem = expenseDraftError(draft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      await onCreate({
        description: draft.description,
        amount: draft.amount,
        date: draft.date,
        note: draft.note,
        eventId: eventId || null,
        paidBy,
        // Everyone on the event is in on it by default, split evenly — the
        // same starting point assigning a bank charge to an event gives you.
        participants: eventId ? members.map(m => m.key) : [paidBy],
      });
      close();
    } catch (err) {
      setError(err?.message || 'Could not save that charge.');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.secondaryBtn} onClick={() => setOpen(true)}>
        + Add an expense
      </button>
    );
  }

  return (
    <div className={styles.addBox}>
      <div className={styles.fieldLabel}>Add an expense</div>

      <div className={styles.addGrid}>
        <label className={styles.addField} style={{ gridColumn: '1 / -1' }}>
          <span className={styles.addLabel}>What was it</span>
          <input
            className={styles.addInput}
            value={draft.description}
            placeholder="Boat fuel, house deposit, groceries…"
            autoFocus
            onChange={e => set({ description: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
          />
        </label>

        <label className={styles.addField}>
          <span className={styles.addLabel}>Amount</span>
          <input
            className={styles.addInput}
            value={draft.amount}
            inputMode="decimal"
            placeholder="0.00"
            onChange={e => set({ amount: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
          />
        </label>

        <label className={styles.addField}>
          <span className={styles.addLabel}>Date</span>
          <DateField
            value={draft.date}
            onChange={e => set({ date: e.target.value })}
            ariaLabel="Date of the charge"
          />
        </label>

        {!fixedEventId && (
          <label className={styles.addField}>
            <span className={styles.addLabel}>Event</span>
            <select
              className={styles.select}
              value={draft.eventId}
              onChange={e => set({ eventId: e.target.value, paidBy: '' })}
            >
              <option value="">Not on an event yet</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.title || 'Untitled event'}</option>
              ))}
            </select>
          </label>
        )}

        <label className={styles.addField}>
          <span className={styles.addLabel}>Who paid</span>
          {members.length > 0 ? (
            <select
              className={styles.select}
              value={paidBy}
              onChange={e => set({ paidBy: e.target.value })}
            >
              {members.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
          ) : (
            <span className={styles.addNote}>
              {eventId ? 'Nobody on this event yet' : 'You — pick an event to split it'}
            </span>
          )}
        </label>
      </div>

      {error && <div className={styles.error} style={{ marginTop: '0.6rem' }}>{error}</div>}

      <div className={styles.addActions}>
        <span className={styles.addNote}>
          {eventId
            ? `Splits evenly across everyone on the event — change that after saving.`
            : `Saved without an event. Put it on one to split it.`}
        </span>
        <button type="button" className={styles.linkBtn} onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className={styles.secondaryBtn} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save expense'}
        </button>
      </div>
    </div>
  );
}

// Today, in the local calendar day — not the UTC one an ISO timestamp slices
// to, which is yesterday for anyone west of Greenwich for most of the evening.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const blank = (fixedEventId) => ({
  description: '',
  amount: '',
  date: today(),
  note: '',
  eventId: fixedEventId || '',
  paidBy: '',
});

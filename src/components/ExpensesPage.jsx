import { useState, useMemo } from 'react';
import { useExpenses } from '../hooks/useExpenses';
import { useEvents } from '../hooks/useEvents';
import { balances, expenseStatus, money } from '../lib/expenses';
import { ExpenseSplitter } from './ExpenseSplitter';
import styles from './ExpensesPage.module.css';

/* Everything somebody owes you.

   Charges arrive here from Wealth Architect the moment they're tagged as
   needing a split. They land unassigned; putting one on an event is what
   turns it from a charge into something splittable, because an event is where
   the people are. */

const FILTERS = [
  { id: 'open', label: 'Still owed' },
  { id: 'unassigned', label: 'Needs an event' },
  { id: 'settled', label: 'Squared up' },
  { id: 'all', label: 'All' },
];

function memberListFor(event) {
  if (!event) return [];
  return Object.entries(event.members || {})
    .map(([key, m]) => ({ key, name: m?.name || m?.email || key }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function ExpensesPage() {
  const { expenses, loading, error, ...actions } = useExpenses();
  const { events } = useEvents();
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState(null);

  const eventsById = useMemo(() => new Map(events.map(e => [e.id, e])), [events]);
  const participantsFor = useMemo(
    () => (expense) => (expense.participants || []),
    [],
  );

  const rows = useMemo(() => expenses.map((expense) => {
    const event = expense.eventId ? eventsById.get(expense.eventId) : null;
    const status = expenseStatus(expense, expense.participants || []);
    return { expense, event, status };
  }), [expenses, eventsById]);

  const shown = useMemo(() => rows.filter(({ expense, status }) => {
    if (filter === 'all') return true;
    if (filter === 'unassigned') return !expense.eventId;
    if (filter === 'settled') return status.fullySettled;
    return !status.fullySettled; // "open" — anything still owed, or not split yet
  }), [rows, filter]);

  const people = useMemo(() => balances(expenses, participantsFor), [expenses, participantsFor]);
  const totalOutstanding = people.reduce((sum, p) => sum + p.outstanding, 0);

  const nameFor = (key) => {
    for (const { event } of rows) {
      const m = event?.members?.[key];
      if (m?.name) return m.name;
    }
    return key;
  };

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading expenses…</p></div>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Expenses</h1>
        {totalOutstanding > 0 && (
          <div className={styles.headline}>{money(totalOutstanding)} owed to you</div>
        )}
      </header>
      <p className={styles.subtitle}>
        Charges you tagged to split in Wealth Architect. Put one on an event, pick who's in,
        and tick people off as they pay you back.
      </p>

      {error && <div className={styles.error}>Couldn’t load expenses: {error}</div>}

      {people.length > 0 && (
        <section className={styles.balances}>
          {people.map(p => (
            <div key={p.key} className={styles.balanceCard}>
              <div className={styles.balanceName}>{nameFor(p.key)}</div>
              <div className={p.outstanding > 0 ? styles.balanceOwed : styles.balanceClear}>
                {p.outstanding > 0 ? money(p.outstanding) : 'all square'}
              </div>
              <div className={styles.balanceMeta}>
                across {p.count} charge{p.count === 1 ? '' : 's'}
              </div>
            </div>
          ))}
        </section>
      )}

      <div className={styles.filters}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? styles.filterOn : styles.filter}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>
          {expenses.length === 0
            ? 'Nothing here yet. Tap Split on a charge in the Wealth Architect categorizer and it shows up here.'
            : 'Nothing matches that filter.'}
        </div>
      ) : (
        <ul className={styles.list}>
          {shown.map(({ expense, event, status }) => {
            const open = openId === expense.id;
            return (
              <li key={expense.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.itemHead}
                  onClick={() => setOpenId(open ? null : expense.id)}
                  aria-expanded={open}
                >
                  <span className={styles.itemMain}>
                    <span className={styles.itemDesc}>{expense.description}</span>
                    <span className={styles.itemMeta}>
                      {expense.date || 'no date'}
                      {event ? ` · ${event.title || 'Untitled event'}` : ' · not on an event'}
                      {status.unsplit ? ' · not split yet' : status.outstanding > 0
                        ? ` · ${money(status.outstanding)} owed`
                        : ' · all square'}
                    </span>
                  </span>
                  <span className={styles.itemAmount}>{money(expense.amount)}</span>
                  <span className={styles.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <ExpenseSplitter
                    expense={expense}
                    events={events}
                    memberOptions={memberListFor(event)}
                    actions={actions}
                    onDone={() => setOpenId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

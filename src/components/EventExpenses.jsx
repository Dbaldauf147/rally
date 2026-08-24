import { useState, useMemo } from 'react';
import { useExpenses } from '../hooks/useExpenses';
import { expenseStatus, money } from '../lib/expenses';
import { ExpenseSplitter } from './ExpenseSplitter';
import styles from './ExpensesPage.module.css';

/* The Expenses tab on one event.

   Same splitter as the Expenses page, scoped to this event's charges — plus
   the ones not yet on any event, so a charge tagged on the phone can be pulled
   onto the trip you're already looking at without going and finding it. */
export function EventExpenses({ event }) {
  const { expenses, loading, ...actions } = useExpenses();
  const [openId, setOpenId] = useState(null);

  const memberOptions = useMemo(() => Object.entries(event?.members || {})
    .map(([key, m]) => ({ key, name: m?.name || m?.email || key }))
    .sort((a, b) => a.name.localeCompare(b.name)), [event]);

  const mine = useMemo(
    () => expenses.filter(e => e.eventId === event.id),
    [expenses, event.id],
  );
  const loose = useMemo(() => expenses.filter(e => !e.eventId), [expenses]);

  const outstanding = mine.reduce(
    (sum, e) => sum + expenseStatus(e, e.participants || []).outstanding,
    0,
  );

  if (loading) return <p className={styles.muted}>Loading expenses…</p>;

  return (
    <div className={`${styles.page} ${styles.embedded}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>Expenses</h2>
        {outstanding > 0 && <div className={styles.headline}>{money(outstanding)} owed to you</div>}
      </header>

      {mine.length === 0 ? (
        <p className={styles.hint}>
          No charges on this event yet. Tag one to split in the Wealth Architect categorizer,
          then put it on this event — either here or from the Expenses page.
        </p>
      ) : (
        <ul className={styles.list}>
          {mine.map((expense) => {
            const status = expenseStatus(expense, expense.participants || []);
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
                    events={[event]}
                    memberOptions={memberOptions}
                    actions={actions}
                    onDone={() => setOpenId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {loose.length > 0 && (
        <>
          <div className={styles.fieldLabel} style={{ marginTop: '1.5rem' }}>
            Not on an event yet
          </div>
          <ul className={styles.list} style={{ marginTop: '0.5rem' }}>
            {loose.map((expense) => (
              <li key={expense.id} className={styles.item}>
                <div className={styles.itemHead} style={{ cursor: 'default' }}>
                  <span className={styles.itemMain}>
                    <span className={styles.itemDesc}>{expense.description}</span>
                    <span className={styles.itemMeta}>{expense.date || 'no date'}</span>
                  </span>
                  <span className={styles.itemAmount}>{money(expense.amount)}</span>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => actions.assignEvent(expense, event.id, Object.keys(event.members || {}))}
                  >
                    Add to this event
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

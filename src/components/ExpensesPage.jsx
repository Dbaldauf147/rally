import { useState, useMemo, Fragment } from 'react';
import { useExpenses } from '../hooks/useExpenses';
import { useEvents } from '../hooks/useEvents';
import { balances, expenseStatus, money, remainingFor } from '../lib/expenses';
import { ExpenseSplitter } from './ExpenseSplitter';
import styles from './ExpensesPage.module.css';

/* Everything somebody owes you.

   Charges arrive here from Wealth Architect the moment they're tagged as
   needing a split. They land unassigned; putting one on an event is what
   turns it from a charge into something splittable, because an event is where
   the people are.

   The page is a table because the job is nearly always comparative — twenty
   charges off one trip, and you want to see which ones aren't on an event yet
   and which still have money outstanding without opening any of them. Columns
   line the numbers up; the tick boxes and the per-row event picker let you fix
   a whole batch without opening any of them either. */

const FILTERS = [
  { id: 'open', label: 'Still owed' },
  { id: 'unassigned', label: 'Needs an event' },
  { id: 'settled', label: 'Squared up' },
  { id: 'all', label: 'All' },
];

// key → how to read a sortable value off a row. Sorting happens on the shown
// rows only, so it never changes what is selected or acted on.
const SORTS = {
  date: ({ expense }) => expense.date || '',
  description: ({ expense }) => (expense.description || '').toLowerCase(),
  event: ({ event }) => (event?.title || '￿').toLowerCase(), // unassigned sorts last
  amount: ({ expense }) => Number(expense.amount) || 0,
  owed: ({ status }) => status.outstanding,
};

/* A sortable column header. The arrow shows only on the column in force, so
   the header row doesn't read as a wall of arrows. */
function SortHeader({ id, label, className, sort, onSort }) {
  const on = sort.key === id;
  return (
    <th scope="col" className={className} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={on ? styles.thBtnOn : styles.thBtn}
        onClick={() => onSort(id)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className={styles.sortArrow} aria-hidden="true">
          {on ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  );
}

function memberListFor(event) {
  if (!event) return [];
  return Object.entries(event.members || {})
    .map(([key, m]) => ({ key, name: m?.name || m?.email || key, email: m?.email || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function ExpensesPage() {
  const { expenses, loading, error, ...actions } = useExpenses();
  const { events } = useEvents();
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState(null);
  // Newest first, matching the order the charges arrive in.
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  // Ticked charges, by id. Kept as ids rather than rows so a snapshot from
  // Firestore mid-selection doesn't drop the ticks.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');

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

  const shown = useMemo(() => {
    const kept = rows.filter(({ expense, status }) => {
      if (filter === 'all') return true;
      if (filter === 'unassigned') return !expense.eventId;
      if (filter === 'settled') return status.fullySettled;
      return !status.fullySettled; // "open" — anything still owed, or not split yet
    });
    const read = SORTS[sort.key] || SORTS.date;
    const flip = sort.dir === 'desc' ? -1 : 1;
    // Sorted off a copy: `rows` is memoised and mutating it in place would
    // leave the next render sorted by whatever was clicked last.
    return [...kept].sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * flip;
    });
  }, [rows, filter, sort]);

  // Clicking the column you're already on flips the direction. Text reads best
  // A→Z first; dates and money read best largest-first.
  const sortBy = (key) => setSort(prev => (
    prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'description' || key === 'event' ? 'asc' : 'desc' }
  ));

  /* ── Bulk edit ─────────────────────────────────────────────
     Everything here is the same write the splitter does to one charge, run
     across several. A charge that's ticked but filtered out of view isn't
     acted on: acting on rows you can't see is how you assign forty charges to
     the wrong trip. It stays ticked, so switching back to that filter finds
     the selection intact. */
  const selectedRows = useMemo(
    () => shown.filter(({ expense }) => selected.has(expense.id)),
    [shown, selected],
  );
  const allShownSelected = shown.length > 0 && selectedRows.length === shown.length;

  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAllShown = () => setSelected(
    allShownSelected ? new Set() : new Set(shown.map(({ expense }) => expense.id)),
  );

  /* One write per charge, in parallel. Only the ones that failed stay ticked,
     so hitting the button again retries exactly those and doesn't re-apply the
     action to the charges that already took it. */
  async function runBulk(rows, verb, fn, { keepSelection = false } = {}) {
    if (!rows.length || bulkBusy) return;
    setBulkBusy(true);
    setBulkError('');
    const results = await Promise.allSettled(rows.map(fn));
    const failed = rows.filter((_, i) => results[i].status === 'rejected');
    // A single-row edit made from its own dropdown shouldn't touch the tick
    // boxes — the user never selected anything.
    if (!keepSelection) setSelected(new Set(failed.map(({ expense }) => expense.id)));
    if (failed.length) {
      const reason = results.find(r => r.status === 'rejected')?.reason;
      setBulkError(`Couldn’t ${verb} ${failed.length} of ${rows.length}: ${reason?.message || 'the write failed'}`);
    }
    setBulkBusy(false);
  }

  /* Moving charges onto an event, from the bulk bar or from one row's own
     dropdown. Both go through here so the warning is the same either way. */
  function assignRowsToEvent(rows, eventId, opts) {
    if (!rows.length) return;
    const event = eventId ? eventsById.get(eventId) : null;
    if (eventId && !event) return;
    // Moving a charge re-seeds who's in on it and resets the split to even
    // (see assignEvent) — worth asking about when some of these were already
    // divided up by hand. Payments already recorded survive it.
    const split = rows.filter(({ status }) => !status.unsplit).length;
    const where = event ? `“${event.title || 'Untitled event'}”` : 'no event';
    if (split > 0 && !window.confirm(
      `${split} of these ${split === 1 ? 'is' : 'are'} already split. Moving `
      + `${rows.length === 1 ? 'it' : 'them'} to ${where} puts everyone on that `
      + 'event in on it and resets the shares to an even split. Payments already recorded stay. Continue?',
    )) return;
    const memberKeys = Object.keys(event?.members || {});
    runBulk(rows, 'move', ({ expense }) => actions.assignEvent(expense, eventId, memberKeys), opts);
  }

  function bulkEveryonePaid() {
    // Only rows with something outstanding — payRemaining on a settled charge
    // is a no-op, but counting them would make "12 charges" read as work done
    // that wasn't.
    const rows = selectedRows.filter(({ status }) => status.outstanding > 0);
    if (!rows.length) {
      setBulkError('Nothing outstanding on the ones you picked.');
      return;
    }
    const total = rows.reduce((sum, { status }) => sum + status.outstanding, 0);
    if (!window.confirm(
      `Record ${money(total)} paid across ${rows.length} charge${rows.length === 1 ? '' : 's'}? `
      + 'Everyone still owing on them is marked paid in full.',
    )) return;
    runBulk(rows, 'settle', ({ expense, status }) => actions.payRemaining(
      expense,
      Object.fromEntries(
        (expense.participants || [])
          .filter(key => key && key !== expense.paidBy)
          .map(key => [key, remainingFor(expense, key, status.shares[key] || 0)]),
      ),
    ));
  }

  function bulkRemove() {
    const rows = selectedRows;
    if (!window.confirm(
      `Remove ${rows.length} charge${rows.length === 1 ? '' : 's'} from this page? `
      + 'They stay in your bank feed — this just takes them off the split list.',
    )) return;
    runBulk(rows, 'remove', ({ expense }) => actions.archive(expense));
  }

  const people = useMemo(() => balances(expenses, participantsFor), [expenses, participantsFor]);
  const totalOutstanding = people.reduce((sum, p) => sum + p.outstanding, 0);

  // Totals for what's on screen, so a filter doubles as a running tally.
  const shownTotal = shown.reduce((sum, { expense }) => sum + (Number(expense.amount) || 0), 0);
  const shownOwed = shown.reduce((sum, { status }) => sum + status.outstanding, 0);

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
        <h1 className={styles.title}>Trip Expenses</h1>
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

      {selectedRows.length > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>
            {selectedRows.length} selected
          </span>
          <div className={styles.bulkActions}>
            <select
              className={styles.bulkSelect}
              value=""
              disabled={bulkBusy || events.length === 0}
              aria-label="Put the selected charges on an event"
              onChange={(e) => assignRowsToEvent(selectedRows, e.target.value)}
            >
              <option value="">Put on an event…</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.title || 'Untitled event'}</option>
              ))}
            </select>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={bulkBusy}
              onClick={bulkEveryonePaid}
            >
              Everyone paid
            </button>
            <button
              type="button"
              className={styles.dangerBtn}
              disabled={bulkBusy}
              onClick={bulkRemove}
            >
              Remove
            </button>
            <button
              type="button"
              className={styles.linkBtn}
              disabled={bulkBusy}
              onClick={() => { setSelected(new Set()); setBulkError(''); }}
            >
              clear
            </button>
          </div>
        </div>
      )}

      {bulkError && <div className={styles.error}>{bulkError}</div>}

      {shown.length === 0 ? (
        <div className={styles.empty}>
          {expenses.length === 0
            ? 'Nothing here yet. Tap Split on a charge in the Wealth Architect categorizer and it shows up here.'
            : 'Nothing matches that filter.'}
        </div>
      ) : (
        /* The table scrolls sideways rather than squeezing: money columns that
           wrap stop being comparable, which is the whole point of a table. */
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.colPick}>
                  <label className={styles.pickBox}>
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      // Some but not all: the box shows a dash, and clicking it
                      // takes the rest rather than clearing what's already ticked.
                      ref={el => { if (el) el.indeterminate = selectedRows.length > 0 && !allShownSelected; }}
                      onChange={toggleAllShown}
                      aria-label={allShownSelected ? 'Clear selection' : `Select all ${shown.length}`}
                    />
                  </label>
                </th>
                <SortHeader id="date" label="Date" className={styles.colDate} sort={sort} onSort={sortBy} />
                <SortHeader id="description" label="Charge" sort={sort} onSort={sortBy} />
                <SortHeader id="event" label="Event" className={styles.colEvent} sort={sort} onSort={sortBy} />
                <th scope="col" className={styles.colSplit}>Split</th>
                <SortHeader id="amount" label="Amount" className={styles.colNum} sort={sort} onSort={sortBy} />
                <SortHeader id="owed" label="Owed" className={styles.colNum} sort={sort} onSort={sortBy} />
                <th scope="col" className={styles.colOpen}><span className={styles.srOnly}>Details</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ expense, event, status }) => {
                const open = openId === expense.id;
                const ticked = selected.has(expense.id);
                return (
                  <Fragment key={expense.id}>
                  <tr className={ticked ? `${styles.row} ${styles.rowOn}` : styles.row}>
                    <td className={styles.colPick}>
                      <label className={styles.pickBox}>
                        <input
                          type="checkbox"
                          checked={ticked}
                          onChange={() => toggleOne(expense.id)}
                          aria-label={`Select ${expense.description || 'this charge'}`}
                        />
                      </label>
                    </td>
                    <td className={styles.colDate}>{expense.date || '—'}</td>
                    <td className={styles.cellDesc} title={expense.description}>
                      {expense.description || 'Untitled charge'}
                    </td>
                    {/* Editable in place: reassigning is the single most common
                        thing done on this page, and it shouldn't need the row
                        open or the tick boxes involved. */}
                    <td className={styles.colEvent}>
                      <select
                        className={expense.eventId ? styles.rowSelect : `${styles.rowSelect} ${styles.rowSelectEmpty}`}
                        value={expense.eventId || ''}
                        disabled={bulkBusy}
                        aria-label={`Event for ${expense.description || 'this charge'}`}
                        onChange={(e) => assignRowsToEvent(
                          [{ expense, event, status }],
                          e.target.value,
                          { keepSelection: true },
                        )}
                      >
                        <option value="">— none —</option>
                        {events.map(ev => (
                          <option key={ev.id} value={ev.id}>{ev.title || 'Untitled event'}</option>
                        ))}
                      </select>
                    </td>
                    <td className={styles.colSplit}>
                      {status.unsplit
                        ? <span className={styles.tagWarn}>not split</span>
                        : `${status.people} ${status.people === 1 ? 'person' : 'people'}`}
                    </td>
                    <td className={styles.colNum}>{money(expense.amount)}</td>
                    <td className={styles.colNum}>
                      {status.unsplit
                        ? <span className={styles.muted}>—</span>
                        : status.outstanding > 0
                          ? <span className={styles.owed}>{money(status.outstanding)}</span>
                          : <span className={styles.clear}>square</span>}
                    </td>
                    <td className={styles.colOpen}>
                      <button
                        type="button"
                        className={styles.openBtn}
                        onClick={() => setOpenId(open ? null : expense.id)}
                        aria-expanded={open}
                        aria-label={open ? 'Hide the split' : 'Edit the split'}
                      >{open ? '▾' : '▸'}</button>
                    </td>
                  </tr>
                  {open && (
                    <tr className={styles.editorRowWrap}>
                      <td colSpan={8} className={styles.editorCell}>
                        <ExpenseSplitter
                          expense={expense}
                          events={events}
                          memberOptions={memberListFor(event)}
                          actions={actions}
                          onDone={() => setOpenId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.colPick} />
                <td className={styles.colDate} />
                <td className={styles.footLabel} colSpan={3}>
                  {shown.length} charge{shown.length === 1 ? '' : 's'} shown
                </td>
                <td className={styles.colNum}>{money(shownTotal)}</td>
                <td className={styles.colNum}>
                  {shownOwed > 0 ? <span className={styles.owed}>{money(shownOwed)}</span> : 'square'}
                </td>
                <td className={styles.colOpen} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

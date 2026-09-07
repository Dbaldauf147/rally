import { useMemo } from 'react';
import { personStatement, money } from '../lib/expenses';
import { normalizeHandle, venmoUrl, chargeNote } from '../lib/venmo';
import styles from './ExpensesPage.module.css';

/* One person's trip expenses, read only.

   The grid next door answers the organiser's question — what does everybody owe
   me — by putting people down the side and charges across the top. That is the
   wrong shape for the question everybody else on the trip has, which is "what
   was I charged for, and what do I still owe". Read across a row of the grid to
   answer it and you are reading the one row that matters through eleven
   columns that don't, on a phone, sideways.

   So the same numbers, turned ninety degrees: one person, their charges down
   the page, the payer named on every line.

   Nothing here writes. Splitting a bill is the organiser's call and the grid is
   where it is made; a guest opening this needs to see the bill, not be handed
   the controls for it. That also means it stays safe to show this to somebody
   whose Firestore rules would technically let them edit — the tab simply never
   offers them the button. */
export function PersonExpenses({ expenses, people, participantsFor, event, personKey, onPickPerson, selfKey }) {
  const statement = useMemo(
    () => personStatement(expenses, personKey, participantsFor),
    [expenses, personKey, participantsFor],
  );

  const nameFor = (key) => people.find(p => p.key === key)?.name
    || event?.members?.[key]?.name || key;

  // Second person when you are looking at your own, third when you are looking
  // at somebody else's. "You owe Dan $30" and "Ben owes Dan $30" are both worth
  // reading; "Their total" for your own money is not.
  const isSelf = personKey === selfKey;
  const who = isSelf ? 'You' : nameFor(personKey);
  const whose = isSelf ? 'Your' : `${nameFor(personKey)}'s`;
  const owes = isSelf ? 'owe' : 'owes';

  if (!people.length) return null;

  return (
    <div className={styles.statement}>
      <div className={styles.personPick} role="group" aria-label="Whose expenses to show">
        {people.map(p => (
          <button
            key={p.key}
            type="button"
            className={p.key === personKey ? styles.chipOn : styles.chip}
            aria-pressed={p.key === personKey}
            onClick={() => onPickPerson(p.key)}
          >
            {p.key === selfKey ? `${p.name} (you)` : p.name}
          </button>
        ))}
      </div>

      <div className={styles.statementHead}>
        <div>
          <div className={styles.statementWho}>{whose} share of this trip</div>
          <div className={styles.statementTotal}>{money(statement.share)}</div>
        </div>
        <div className={styles.statementRight}>
          {statement.outstanding > 0 ? (
            <>
              <div className={styles.statementWho}>Still to pay</div>
              <div className={styles.statementOwed}>{money(statement.outstanding)}</div>
            </>
          ) : statement.lines.length > 0 ? (
            <div className={styles.statementClear}>All square</div>
          ) : null}
        </div>
      </div>

      {/* Who the money actually goes to. A trip's debts aren't owed to a pot:
          when three people fronted different things, "$84 still to pay" can't
          be acted on until it says how much of it is Dan's. Each one carries
          its own Venmo link — a pay link, not the charge link the grid uses,
          because here you are the one settling up. */}
      {statement.owedTo.length > 0 && (
        <ul className={styles.owedTo}>
          {statement.owedTo.map(to => {
            const handle = normalizeHandle(event?.members?.[to.key]?.venmo);
            const url = isSelf && venmoUrl({
              handle,
              amount: to.amount,
              txn: 'pay',
              note: chargeNote(event?.title, to.count === 1
                ? statement.lines.find(l => l.paidBy === to.key && !l.settled)?.description
                : `${to.count} charges`),
            });
            return (
              <li key={to.key} className={styles.owedToRow}>
                <span>
                  {who} {owes} <strong>{nameFor(to.key)}</strong>{' '}
                  <span className={styles.owedToAmount}>{money(to.amount)}</span>
                  <span className={styles.owedToCount}>
                    {' '}on {to.count} {to.count === 1 ? 'charge' : 'charges'}
                  </span>
                </span>
                {url && (
                  <a className={styles.payLink} href={url} target="_blank" rel="noopener noreferrer">
                    Pay on Venmo<span aria-hidden="true"> ⇗</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {statement.lines.length === 0 ? (
        <p className={styles.hint}>
          {who} {isSelf ? 'aren’t' : 'isn’t'} in on any of the charges on this trip yet.
        </p>
      ) : (
        <div className={styles.statementWrap}>
          <table className={styles.statementTable}>
            <thead>
              <tr>
                <th scope="col">Charge</th>
                <th scope="col" className={styles.stNum}>Whole charge</th>
                <th scope="col" className={styles.stNum}>{whose} share</th>
                <th scope="col" className={styles.stNum}>Still owed</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map(line => (
                <tr key={line.id}>
                  <th scope="row" className={styles.stDesc}>
                    <span className={styles.stDescName}>{line.description}</span>
                    <span className={styles.stDescMeta}>
                      {line.date || 'no date'}
                      {' · '}
                      {line.isPayer
                        ? `${who} paid this`
                        : `${nameFor(line.paidBy)} paid`}
                      {' · split '}
                      {line.people} {line.people === 1 ? 'way' : 'ways'}
                    </span>
                  </th>
                  <td className={styles.stAmount}>{money(line.amount)}</td>
                  <td className={styles.stShare}>{money(line.share)}</td>
                  <td className={styles.stOwed}>
                    {/* A charge they paid for has no "still owed" — their share
                        of their own bill is their money, not a debt. Saying
                        $0.00 there would read as settled-up rather than
                        not-applicable. */}
                    {line.isPayer ? <span className={styles.stNa}>—</span>
                      : line.remaining > 0
                        ? <span className={styles.stOwedAmount}>{money(line.remaining)}</span>
                        : <span className={styles.stPaid}>
                          ✓ paid{line.paid > 0 && line.paid < line.share ? ` ${money(line.paid)}` : ''}
                        </span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  {statement.fronted > 0 && (
                    <span className={styles.stDescMeta}>
                      {who} fronted {money(statement.fronted)} of it
                    </span>
                  )}
                </th>
                <td className={styles.stAmount} />
                <td className={styles.stShare}>{money(statement.share)}</td>
                <td className={styles.stOwed}>
                  {statement.outstanding > 0
                    ? <span className={styles.stOwedAmount}>{money(statement.outstanding)}</span>
                    : <span className={styles.stPaid}>all square</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

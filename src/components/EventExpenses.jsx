import { useState, useMemo, useEffect } from 'react';
import { collection, doc, onSnapshot, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useExpenses } from '../hooks/useExpenses';
import { expenseStatus, expenseMatrix, money, memberListFor } from '../lib/expenses';
import { buildVoteStats, isYesMaybe } from '../lib/attendance';
import { normalizeHandle, displayHandle, venmoUrl, chargeNote } from '../lib/venmo';
import { matchGroupMembers, buildExpense } from '../lib/splitwise';
import { ExpenseSplitter } from './ExpenseSplitter';
import { PersonExpenses } from './PersonExpenses';
import { AddExpense } from './AddExpense';
import styles from './ExpensesPage.module.css';

/* The Expenses tab on one event.

   Same splitter as the Expenses page, scoped to this event's charges — plus
   the ones not yet on any event, so a charge tagged on the phone can be pulled
   onto the trip you're already looking at without going and finding it.

   Two things make this different from the standalone page. Only people who are
   a yes or a maybe are in on anything: an invite list of twenty-seven divided a
   $45 pizza into $1.67 shares owed by people who were never coming, which is
   both wrong and unusable. And the charges are shown as a grid — people down
   the side, charges across the top — because by the end of a trip the question
   is "what does Katie owe me, across all of it", which a list of charges can
   only answer by opening every one and adding up. */
export function EventExpenses({ event }) {
  const { user } = useAuth() || {};
  const { expenses, loading, ...actions } = useExpenses();
  const [openId, setOpenId] = useState(null);
  const [dateOptions, setDateOptions] = useState([]);

  // The date votes are what say who is coming, so the tab needs them.
  useEffect(() => {
    if (!event?.id) return undefined;
    const unsub = onSnapshot(
      collection(db, 'events', event.id, 'dateOptions'),
      (snap) => setDateOptions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => unsub();
  }, [event?.id]);

  // Whoever is coming, by the same rule the Meals tab uses — a manual Going or
  // Not going wins, else a yes or maybe on any open date, else a linked +1
  // rides in on their partner.
  //
  // Plus you, always. Organisers routinely never vote on their own dates, and
  // being filtered off your own trip means you cannot be picked as the one who
  // paid — which is most of what this tab is for.
  const memberOptions = useMemo(() => {
    const members = event?.members || {};
    const voteStats = buildVoteStats(dateOptions);
    return memberListFor(event).filter(m =>
      m.key === user?.uid || isYesMaybe(m.key, members[m.key], members, voteStats));
  }, [event, dateOptions, user?.uid]);
  const eligibleKeys = useMemo(() => memberOptions.map(m => m.key), [memberOptions]);
  const nameFor = (key) => memberOptions.find(m => m.key === key)?.name
    || event?.members?.[key]?.name || key;

  // Who a charge is split between, here: whoever is on it and still coming.
  // Whoever paid stays regardless — they are owed the money either way.
  const participantsFor = useMemo(() => {
    const allowed = new Set(eligibleKeys);
    return (expense) => (expense.participants || [])
      .filter(Boolean)
      .filter(k => allowed.has(k) || k === expense.paidBy);
  }, [eligibleKeys]);

  const mine = useMemo(
    () => expenses.filter(e => e.eventId === event.id),
    [expenses, event.id],
  );
  const loose = useMemo(() => expenses.filter(e => !e.eventId), [expenses]);

  // Rows are the people who are coming, plus anyone who paid for something —
  // otherwise a charge fronted by someone who has since dropped out shows in
  // the column total with no row accounting for it, and the grid stops adding
  // up.
  const gridPeople = useMemo(() => {
    const shown = new Set(memberOptions.map(m => m.key));
    const extra = [];
    for (const e of mine) {
      if (!e.paidBy || shown.has(e.paidBy)) continue;
      shown.add(e.paidBy);
      extra.push({ key: e.paidBy, name: event?.members?.[e.paidBy]?.name || e.paidBy });
    }
    return [...memberOptions, ...extra];
  }, [memberOptions, mine, event]);

  const grid = useMemo(
    () => expenseMatrix(mine, gridPeople, participantsFor),
    [mine, gridPeople, participantsFor],
  );

  // Somebody in on nothing drops off the grid rather than sitting there as a
  // row of dashes — but they have to be gettable back, so they line up
  // underneath it instead of disappearing from the tab.
  const shownRows = grid.rows.filter(r => r.cells.some(c => c.on));
  const sittingOut = grid.rows.filter(r => !r.cells.some(c => c.on));

  /* One cell: is this person in on this one charge.

     Writes back the narrowed participant list rather than the stored one, so
     ticking anybody on a charge also drops whoever was on it but is no longer
     coming — the same pruning a chip in the splitter does. No confirm here,
     unlike the row × : this is one charge, and clicking the cell again undoes
     it. */
  const toggleCell = (row, col) => {
    const expense = col.expense;
    if (expense.paidBy === row.key) return; // whoever paid is always in on it
    const current = participantsFor(expense);
    const on = current.includes(row.key);
    actions.setParticipants(
      expense,
      on ? current.filter(k => k !== row.key) : [...current, row.key],
    );
  };

  /* Venmo handles, stored on the member row beside their phone and email so
     they carry across every charge on the trip. Held in a draft while typed and
     written on blur, and normalized on the way in — people paste "@dan" or a
     whole profile URL off the share sheet, and either should just work. */
  const [venmoDrafts, setVenmoDrafts] = useState({});
  const saveVenmo = async (key, raw) => {
    const handle = normalizeHandle(raw);
    const stored = normalizeHandle(event?.members?.[key]?.venmo);
    setVenmoDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
    if (handle === stored) return;
    await updateDoc(doc(db, 'events', event.id), {
      [`members.${key}.venmo`]: handle || deleteField(),
    }).catch(() => {});
  };

  /* ── Splitwise ──────────────────────────────────────────────────────
     Push-only. Rally decides the split; Splitwise is where the people who
     live in Splitwise see what they owe. The key is a personal one held on
     the server, so everything here goes through /api/splitwise rather than
     talking to Splitwise from the browser. */
  const [sw, setSw] = useState({ loading: true, configured: false, groups: [], me: null, error: '' });
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/splitwise', {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setSw({ loading: false, configured: false, groups: [], me: null, error: data.error || `Failed (${res.status})` });
        else setSw({ loading: false, configured: !!data.configured, groups: data.groups || [], me: data.me || null, error: '' });
      } catch (err) {
        // A deployment without the route at all (or offline) is not worth
        // shouting about — the section simply doesn't appear.
        if (live) setSw({ loading: false, configured: false, groups: [], me: null, error: err.message });
      }
    })();
    return () => { live = false; };
  }, [user]);

  const swGroupId = event?.splitwiseGroupId || '';
  const swGroup = sw.groups.find(g => String(g.id) === String(swGroupId)) || null;
  const setSwGroup = (id) => updateDoc(doc(db, 'events', event.id), {
    splitwiseGroupId: id ? Number(id) : deleteField(),
  }).catch(() => {});

  /* Send one charge across, with the shares exactly as Rally has them.

     Anyone with a share who isn't in the group is named rather than quietly
     left out: dropping them would make the shares stop adding up to the cost,
     and Splitwise would refuse it with an arithmetic complaint that says
     nothing about the real problem. */
  const sendToSplitwise = async (expense, shares) => {
    if (!swGroup) throw new Error('Pick a Splitwise group first.');
    // You are the account the key belongs to, so you match by that rather
    // than by email — an organiser's own row rarely carries one.
    const { matched } = matchGroupMembers(memberOptions, swGroup.members,
      sw.me?.id != null && user?.uid ? { key: user.uid, splitwiseId: sw.me.id } : null);
    const missing = Object.entries(shares || {})
      .filter(([key, value]) => Number(value) > 0 && !matched.has(key))
      .map(([key]) => nameFor(key));
    if (missing.length) {
      throw new Error(
        `No Splitwise match for ${missing.join(', ')} — they need the same email on both sides.`,
      );
    }
    const body = buildExpense({
      description: expense.description,
      amount: expense.amount,
      date: expense.date,
      groupId: swGroup.id,
      shares,
      payerKey: expense.paidBy,
      matched,
    });
    const res = await fetch('/api/splitwise', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ expense: body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) throw new Error(data.error || `Splitwise refused it (${res.status})`);
    await actions.markSplitwise(expense, { id: data.id, groupId: swGroup.id });
    return `Sent to ${swGroup.name}`;
  };

  const [busyKey, setBusyKey] = useState(null);
  async function setOnEverything(person, on) {
    // Whoever paid a charge can't come off it — they are owed the money either
    // way — so say what will actually happen before doing it.
    const stuck = on ? [] : mine.filter(e => e.paidBy === person.key);
    if (!on) {
      const n = mine.length - stuck.length;
      if (n === 0) return;
      const tail = stuck.length
        ? `\n\nThey stay on the ${stuck.length} they paid for — you can't take the payer off their own bill.`
        : '';
      if (!window.confirm(
        `Take ${person.name} off ${n} charge${n === 1 ? '' : 's'} on this trip?`
        + `\n\nWhat they were in for gets divided between everyone else.${tail}`,
      )) return;
    }
    setBusyKey(person.key);
    try {
      await actions.setParticipantEverywhere(mine, person.key, on);
    } finally {
      setBusyKey(null);
    }
  }

  /* Which of the two views the tab is showing.

     The grid is the collector's tool — it edits every split on the trip. Most
     people on a trip aren't collecting anything; they opened this tab to find
     out what they were charged for, and handing them a spreadsheet of everyone
     else's shares to read their own row out of is the wrong answer, especially
     on a phone. So whoever fronted something opens on the grid and everybody
     else opens on their own statement, and the switch is right there either way.

     `view` stays null until somebody picks, so the default is re-derived rather
     than frozen at a moment when the charges hadn't loaded — and the one edit
     that could flip it, adding a charge you paid for, is only reachable from
     the grid, which sets `view` on the way in. */
  const [view, setView] = useState(null);
  const mode = view ?? (mine.some(e => e.paidBy === user?.uid) ? 'grid' : 'person');

  // Whose statement is on screen. Falls back to you, then to whoever is first,
  // and re-picks if the person showing drops off the trip.
  const [personKey, setPersonKey] = useState(null);
  const shownPerson = personKey && gridPeople.some(p => p.key === personKey)
    ? personKey
    : (gridPeople.find(p => p.key === user?.uid)?.key || gridPeople[0]?.key || null);

  const outstanding = grid.grandOutstanding;
  // What a Venmo charge is for. A row's total spans the whole trip, so naming
  // one charge only reads right when there is only one.
  const tripNote = mine.length === 1
    ? (mine[0].description || '')
    : `${mine.length} charges`;

  if (loading) return <p className={styles.muted}>Loading expenses…</p>;

  return (
    <div className={`${styles.page} ${styles.embedded}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>Trip Expenses</h2>
        {mode === 'grid' && outstanding > 0 && (
          <div className={styles.headline}>{money(outstanding)} owed to you</div>
        )}
      </header>

      {mine.length > 0 && gridPeople.length > 0 && (
        <div className={styles.viewSwitch} role="group" aria-label="How to show the expenses">
          <button
            type="button"
            className={mode === 'person' ? styles.toggleOn : styles.toggleOff}
            aria-pressed={mode === 'person'}
            onClick={() => setView('person')}
          >
            One person
          </button>
          <button
            type="button"
            className={mode === 'grid' ? styles.toggleOn : styles.toggleOff}
            aria-pressed={mode === 'grid'}
            onClick={() => setView('grid')}
          >
            Everyone
          </button>
        </div>
      )}

      <p className={styles.subtitle}>
        Split between the {memberOptions.length} {memberOptions.length === 1 ? 'person' : 'people'}
        {memberOptions.length === 1 ? ' who is' : ' who are'} a yes or a maybe on the dates.
        Anyone who said no, or hasn’t said, is left out.
      </p>

      {/* One person's statement, or everybody's grid. The statement is read
          only, so everything that writes — adding a charge, the splitter, the
          loose charges waiting to be pulled onto the trip — belongs to the
          grid side and isn't rendered at all on the other. Not disabled:
          hidden, because a column of greyed-out buttons is worse than no
          buttons when none of them were ever yours to press. */}
      {mode === 'person' && mine.length > 0 && gridPeople.length > 0 ? (
        <PersonExpenses
          expenses={mine}
          people={gridPeople}
          participantsFor={participantsFor}
          event={event}
          personKey={shownPerson}
          onPickPerson={setPersonKey}
          selfKey={user?.uid}
        />
      ) : (
      <>
      <div style={{ margin: '0 0 1rem' }}>
        <AddExpense
          events={[event]}
          fixedEventId={event.id}
          people={memberOptions}
          onCreate={actions.create}
        />
      </div>

      {mine.length > 0 && gridPeople.length > 0 && (
        <>
        <p className={styles.gridHint}>
          Click a cell to put someone in on that charge or take them out — the rest of it
          re-divides. The × by a name takes them off the whole trip.
        </p>
        <div className={styles.gridWrap}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th scope="col" className={styles.gridCorner}>Person</th>
                {grid.columns.map(col => (
                  <th
                    key={col.id}
                    scope="col"
                    className={styles.gridCol}
                    title={`${col.description} · ${col.date || 'no date'} · paid by ${nameFor(col.paidBy)}`}
                  >
                    <span className={styles.gridColName}>{col.description}</span>
                    <span className={styles.gridColAmount}>{money(col.amount)}</span>
                  </th>
                ))}
                <th scope="col" className={styles.gridTotalCol}>Their total</th>
                <th scope="col" className={styles.gridTotalCol}>Still owes</th>
                <th scope="col" className={styles.gridTotalCol}>Venmo</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map(row => (
                <tr key={row.key}>
                  <th scope="row" className={styles.gridName}>
                    <span className={styles.gridNameRow}>
                      <span className={styles.gridNameText}>{row.name}</span>
                      <button
                        type="button"
                        className={styles.gridDrop}
                        disabled={busyKey === row.key}
                        title={`Take ${row.name} off everything on this trip`}
                        aria-label={`Take ${row.name} off everything on this trip`}
                        onClick={() => setOnEverything(row, false)}
                      >
                        ×
                      </button>
                    </span>
                  </th>
                  {row.cells.map((cell, i) => {
                    const col = grid.columns[i];
                    const state = !cell.on ? 'Not in on this one'
                      : cell.isPayer ? 'They paid this one'
                        : cell.paid ? 'Paid up' : `${money(cell.remaining)} still owed`;
                    const face = !cell.on ? <span className={styles.gridOut}>–</span>
                      : cell.isPayer ? <span className={styles.gridPayer}>paid</span>
                        : (
                          <span className={cell.paid ? styles.gridDone : undefined}>
                            {money(cell.share)}
                          </span>
                        );
                    // The payer's cell isn't a toggle — they can't come off
                    // their own bill — so it stays plain text rather than a
                    // button that does nothing when you press it.
                    if (cell.isPayer) {
                      return (
                        <td key={cell.id} className={styles.gridCell} title={`${row.name} paid for ${col.description}`}>
                          {face}
                        </td>
                      );
                    }
                    return (
                      <td key={cell.id} className={styles.gridCellPad}>
                        <button
                          type="button"
                          className={styles.gridCellBtn}
                          aria-pressed={cell.on}
                          title={`${row.name} · ${col.description} — ${state}\nClick to ${cell.on ? 'take them off' : 'put them in on'} it`}
                          onClick={() => toggleCell(row, col)}
                        >
                          {face}
                        </button>
                      </td>
                    );
                  })}
                  <td className={styles.gridTotal}>{money(row.total)}</td>
                  {(() => {
                    // What they owe doubles as the charge button: the amount is
                    // already the thing you want to ask them for, so clicking it
                    // opens Venmo with exactly that filled in. Venmo can't tell
                    // us when they pay, so recording it stays a separate step.
                    const handle = normalizeHandle(event?.members?.[row.key]?.venmo);
                    const url = venmoUrl({
                      handle,
                      amount: row.outstanding,
                      note: chargeNote(event?.title, tripNote),
                    });
                    if (!url) {
                      return (
                        <td className={row.outstanding > 0 ? styles.gridOwed : styles.gridTotal}>
                          {row.outstanding > 0 ? money(row.outstanding) : '—'}
                        </td>
                      );
                    }
                    return (
                      <td className={styles.gridCellPad}>
                        <a
                          className={styles.gridCharge}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Charge ${displayHandle(handle)} ${money(row.outstanding)} on Venmo`}
                        >
                          {money(row.outstanding)}<span className={styles.gridChargeMark} aria-hidden="true"> ⇗</span>
                        </a>
                      </td>
                    );
                  })()}
                  <td className={styles.gridCellPad}>
                    <input
                      className={styles.gridVenmo}
                      value={venmoDrafts[row.key] ?? displayHandle(event?.members?.[row.key]?.venmo)}
                      placeholder="@handle"
                      aria-label={`Venmo handle for ${row.name}`}
                      onChange={(e) => setVenmoDrafts(prev => ({ ...prev, [row.key]: e.target.value }))}
                      onBlur={(e) => { if (venmoDrafts[row.key] !== undefined) saveVenmo(row.key, e.target.value); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className={styles.gridName}>Split up</th>
                {grid.footers.map(f => (
                  <td
                    key={f.id}
                    className={f.split !== f.amount ? styles.gridGap : styles.gridTotal}
                    title={f.split !== f.amount
                      ? `${money(f.amount)} charged, ${money(f.split)} split up — ${money(f.amount - f.split)} unassigned`
                      : undefined}
                  >
                    {money(f.split)}
                  </td>
                ))}
                <td className={styles.gridTotal}>{money(grid.grandTotal)}</td>
                <td className={grid.grandOutstanding > 0 ? styles.gridOwed : styles.gridTotal}>
                  {grid.grandOutstanding > 0 ? money(grid.grandOutstanding) : '—'}
                </td>
                <td className={styles.gridTotal} />
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}

      {sw.configured && (
        <div className={styles.swBar}>
          <span className={styles.addNote}>Splitwise</span>
          <select
            className={styles.select}
            style={{ flex: '0 1 16rem' }}
            value={swGroupId}
            aria-label="Splitwise group for this trip"
            onChange={(e) => setSwGroup(e.target.value)}
          >
            <option value="">Not sending to Splitwise</option>
            {sw.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <span className={styles.addNote}>
            {swGroup
              ? 'Open a charge below and send it across. Rally stays the source of truth — nothing reads back.'
              : 'Pick a group to send this trip’s charges to.'}
          </span>
        </div>
      )}

      {mine.length > 0 && sittingOut.length > 0 && (
        <div className={styles.sittingOut}>
          <span className={styles.addNote}>In on nothing:</span>
          {sittingOut.map(row => (
            <button
              key={row.key}
              type="button"
              className={styles.chip}
              disabled={busyKey === row.key}
              title={`Put ${row.name} back on every charge`}
              onClick={() => setOnEverything(row, true)}
            >
              {row.name} <span aria-hidden="true">+</span>
            </button>
          ))}
        </div>
      )}

      {mine.length === 0 ? (
        <p className={styles.hint}>
          No charges on this event yet. Add one above, or tag one to split in the Wealth
          Architect categorizer and put it on this event — either here or from the Trip
          Expenses page.
        </p>
      ) : (
        <ul className={styles.list}>
          {mine.map((expense) => {
            const status = expenseStatus(expense, participantsFor(expense));
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
                    eligibleKeys={eligibleKeys}
                    actions={actions}
                    splitwise={swGroup ? { groupName: swGroup.name, send: sendToSplitwise } : null}
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
                    onClick={() => actions.assignEvent(expense, event.id, eligibleKeys)}
                  >
                    Add to this event
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      </>
      )}
    </div>
  );
}

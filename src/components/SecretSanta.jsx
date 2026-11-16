import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  MIN_PARTICIPANTS,
  personLabel,
  personRef,
  partnersOf,
  defaultParticipants,
  lastDraw,
  buildExclusions,
  drawNames,
  drawProblems,
  drawMatchesParticipants,
  resolvePerson,
  cleanDrawName,
  MAX_EXTRA_DRAWS,
} from '../lib/secretSanta';
import { drawYears } from '../lib/secretSantaImport';
import { useSecretSantaHistory } from '../hooks/useSecretSantaHistory';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { planMemberUpserts } from '../lib/members';

// The organizer's Secret Santa panel on an event with it switched on
// (lib/secretSanta.js): pick who is in, draw, review, then email everyone the
// name they drew. The pairs are saved on the organizer's own user doc, never
// on the event, so no guest can read them.
//
// `draw` ({ id, name }) makes this the panel of an extra exchange on the same
// event: its own people, its own draw and history. Nobody is in one of those
// until added — it exists because it is for only some of the guests.
export function SecretSanta({ event, eventId, user, year, date, onOpenHistory, friends = [], draw: extra = null, onRename, onRemove }) {
  const { history, loadError, saveYear } = useSecretSantaHistory(user, eventId, extra?.id || '');
  const [showPairs, setShowPairs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'ok' | 'error', message }
  const [noteDraft, setNoteDraft] = useState(null);
  // Adding somebody who isn't a guest of the event yet: null, or { name, email }.
  const [newPerson, setNewPerson] = useState(null);

  const members = useMemo(
    () => Object.fromEntries(Object.entries(event.members || {}).filter(([, m]) => m && typeof m === 'object')),
    [event.members],
  );
  const everyone = useMemo(
    () => Object.entries(members).sort((a, b) => personLabel(a[1]).localeCompare(personLabel(b[1]))),
    [members],
  );

  const record = history?.[year] || null;
  // Until the organizer has chosen, everyone who hasn't said no is in.
  const outKeys = useMemo(() => {
    if (record?.out) {
      const out = new Set(record.out);
      // Once a list has been edited or drawn it is settled: a guest who joins
      // the event afterwards isn't on it until added here. Otherwise adding
      // somebody to one draw would quietly change — and un-draw — another.
      if (Array.isArray(record.seen)) {
        const seen = new Set(record.seen);
        for (const k of Object.keys(members)) if (!seen.has(k)) out.add(k);
      }
      return out;
    }
    if (extra) return new Set(Object.keys(members));
    const inByDefault = new Set(defaultParticipants(members));
    return new Set(Object.keys(members).filter((k) => !inByDefault.has(k)));
  }, [record, members, extra]);
  const participants = useMemo(() => everyone.map(([k]) => k).filter((k) => !outKeys.has(k)), [everyone, outKeys]);

  const last = useMemo(() => lastDraw(history || {}, year, members), [history, year, members]);
  const partners = useMemo(() => partnersOf(members), [members]);
  const exclusions = useMemo(() => buildExclusions(participants, members, last.map), [participants, members, last]);

  // The saved draw, in today's member keys.
  const drawn = useMemo(() => {
    if (!record?.pairs?.length) return null;
    const map = {};
    for (const p of record.pairs) {
      const g = resolvePerson(p.giver, members);
      const r = resolvePerson(p.receiver, members);
      if (g && r) map[g] = r;
    }
    return map;
  }, [record, members]);
  const drawCurrent = !!drawn && drawMatchesParticipants(drawn, participants);
  const problems = drawCurrent ? drawProblems(drawn, participants, exclusions) : [];
  const sentMap = record?.sent || {};
  const note = noteDraft ?? record?.note ?? '';

  async function run(fn) {
    setBusy(true);
    setStatus(null);
    try { await fn(); } catch (err) { setStatus({ type: 'error', message: err.message || String(err) }); }
    setBusy(false);
  }

  const pairsFrom = (map) => Object.entries(map).map(([g, r]) => ({ giver: personRef(g, members[g]), receiver: personRef(r, members[r]) }));

  // Put somebody on this draw's list, or take them off. `knownKey` is a guest
  // being added to the event in the same breath, who isn't in `members` yet.
  function toggleParticipant(key, knownKey = null) {
    const next = new Set(outKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    if (knownKey) next.delete(knownKey);
    if (drawn && Object.keys(sentMap).length > 0
      && !window.confirm('Names have already been emailed. Changing who is in throws that draw away — you would need to draw and email again. Continue?')) return false;
    // Changing who is in makes any draw stale, so it is dropped rather than
    // left half-valid.
    const seen = [...new Set([...Object.keys(members), ...(knownKey ? [knownKey] : [])])];
    run(() => saveYear(year, { out: [...next], seen, note }));
    return true;
  }

  // Somebody who isn't a guest of the event: they are added to the event's
  // guest list (the email is sent from there) and put on this draw.
  async function addNewPerson() {
    const name = (newPerson?.name || '').trim().replace(/\s+/g, ' ');
    const email = (newPerson?.email || '').trim();
    if (!name) { setStatus({ type: 'error', message: 'Type the person’s name.' }); return; }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { setStatus({ type: 'error', message: 'That email address doesn’t look right.' }); return; }
    const plan = planMemberUpserts(members, [{ name, email }]);
    const key = plan.keys[0];
    if (!plan.added.length && !outKeys.has(key)) { setStatus({ type: 'error', message: `${name} is already on this list.` }); return; }
    if (drawn && Object.keys(sentMap).length > 0
      && !window.confirm('Names have already been emailed. Changing who is in throws that draw away — you would need to draw and email again. Continue?')) return;
    await run(async () => {
      await updateDoc(doc(db, 'events', eventId), { ...plan.updates, updatedAt: serverTimestamp() });
      const next = new Set(outKeys);
      next.delete(key);
      await saveYear(year, { out: [...next], seen: [...new Set([...Object.keys(members), key])], note });
      setNewPerson(null);
      setStatus({ type: 'ok', message: plan.added.length ? `${name} added, and to this event’s guest list.` : `${name} added.` });
    });
  }

  function setLastYear(giverKey, receiverKey) {
    const map = { ...last.map };
    if (receiverKey) map[giverKey] = receiverKey; else delete map[giverKey];
    const y = last.year ?? year - 1;
    // Picks that involve somebody who isn't a guest (a loaded past draw can
    // have some) aren't in `map`, but they are history too, and stay — all but
    // the pick being changed here.
    const others = (history?.[y]?.pairs || []).filter((p) => {
      const g = resolvePerson(p.giver, members);
      return g !== giverKey && !(g && resolvePerson(p.receiver, members));
    });
    run(() => saveYear(y, { ...(history?.[y] || {}), pairs: [...others, ...pairsFrom(map)], ...(history?.[y]?.drawnAt ? {} : { manual: true }) }));
  }

  function draw() {
    if (drawCurrent && Object.keys(sentMap).length > 0
      && !window.confirm('Names have already been emailed. Drawing again changes who has whom — everyone would need a new email. Draw again?')) return;
    const map = drawNames(participants, exclusions);
    if (!map) {
      setStatus({ type: 'error', message: 'No draw fits the rules with this group — with so few people, partners and last year’s picks rule everyone out. Add someone, or clear a “last year” pick.' });
      return;
    }
    setShowPairs(false);
    run(async () => {
      await saveYear(year, { out: [...outKeys], seen: Object.keys(members), note, pairs: pairsFrom(map), drawnAt: new Date().toISOString(), sent: {} });
      setStatus({ type: 'ok', message: `Names drawn for ${participants.length} people.` });
    });
  }

  async function send(onlyKeys = null) {
    const targets = (onlyKeys || participants).filter((k) => members[k]?.email);
    if (targets.length === 0) { setStatus({ type: 'error', message: 'Nobody in the draw has an email address.' }); return; }
    const again = targets.every((k) => sentMap[k]);
    const whom = targets.length === 1 ? personLabel(members[targets[0]]) : `${targets.length} people`;
    if (!window.confirm(`Email ${whom} the name they drew${again ? ' again' : ''}?`)) return;
    await run(async () => {
      if (noteDraft !== null) await saveYear(year, { ...record, note });
      const token = await user.getIdToken();
      const res = await fetch('/api/secret-santa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          eventId,
          pairs: Object.entries(drawn).map(([giver, receiver]) => ({ giver, receiver })),
          only: onlyKeys || undefined,
          note,
          drawName: extra?.name || undefined,
          when: date ? format(date, 'EEEE, MMMM d, yyyy') : '',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const stamp = new Date().toISOString();
      const sent = { ...sentMap, ...Object.fromEntries((body.sent || []).map((k) => [k, stamp])) };
      await saveYear(year, { ...record, note, sent, sentAt: stamp });
      setNoteDraft(null);
      const failed = body.failed || [];
      setStatus(failed.length
        ? { type: 'error', message: `Sent to ${body.sent.length}. Couldn't reach: ${failed.map((f) => `${personLabel(members[f.key])} (${f.error})`).join(', ')}` }
        : { type: 'ok', message: `Sent to ${body.sent.length} ${body.sent.length === 1 ? 'person' : 'people'}.` });
    });
  }

  const noEmail = participants.filter((k) => !members[k]?.email);
  const unsent = participants.filter((k) => members[k]?.email && !sentMap[k]);
  const sentCount = participants.filter((k) => sentMap[k]).length;
  // Emailing is possible once there is a draw that fits the people and the rules.
  const canSend = drawCurrent && problems.length === 0;

  return (
    <div data-testid={extra ? `secret-santa-${extra.id}` : 'secret-santa'} style={box}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div data-testid="ss-title" style={{ fontSize: '0.95rem', fontWeight: 700, color: '#991B1B' }}>🎅 {extra ? extra.name : 'Secret Santa'} {year}</div>
        {extra && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem' }}>
            <button type="button" style={link} data-testid="ss-rename" disabled={busy} onClick={onRename}>Rename</button>
            <button type="button" style={{ ...link, color: '#6B7280' }} data-testid="ss-remove" disabled={busy} onClick={onRemove}>Remove</button>
          </span>
        )}
      </div>
      <p style={hint}>
        {extra ? 'A separate draw on this event — add the people it is for. ' : ''}
        Nobody draws themselves, their partner (the guest they come with), or the person they had last time.
        Guests can’t see the draw.
      </p>
      {loadError && <p style={{ ...hint, color: '#B91C1C' }}>Couldn’t load the saved draw: {loadError}</p>}

      {history === null && !loadError ? (
        <p style={hint}>Loading…</p>
      ) : (
        <>
          <div style={subhead}>Who’s in ({participants.length})</div>
          <div style={{ overflowX: 'auto', marginBottom: '0.75rem', background: '#fff', border: '1px solid #FECACA', borderRadius: '8px' }}>
            <table data-testid="ss-table" style={{ width: '100%', minWidth: canSend ? '640px' : '480px', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>Comes with</th>
                  <th style={th}>Had last time</th>
                  {canSend && showPairs && <th style={th}>Has this year</th>}
                  {canSend && <th style={th}>Email</th>}
                  {canSend && <th style={{ ...th, textAlign: 'right' }} aria-label="Send" />}
                  <th style={{ ...th, width: '2rem' }} aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {participants.length === 0 && (
                  <tr><td style={{ ...td, color: '#6B7280' }} colSpan={7}>Nobody on this list yet. Add people below.</td></tr>
                )}
                {everyone.filter(([key]) => !outKeys.has(key)).map(([key, m]) => {
                  const isIn = true;
                  const partnerNames = [...(partners.get(key) || [])].map((p) => personLabel(members[p]));
                  return (
                    <tr key={key} data-testid={`ss-row-${key}`}>
                      <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{personLabel(m)}</td>
                      <td style={{ ...td, color: '#6B7280', whiteSpace: 'nowrap' }}>{partnerNames.join(', ') || '—'}</td>
                      <td style={td}>
                        {isIn ? (
                          <select
                            value={last.map[key] || ''}
                            disabled={busy}
                            onChange={(e) => setLastYear(key, e.target.value)}
                            aria-label={`Who ${personLabel(m)} had last time`}
                            style={{ padding: '0.15rem 0.3rem', border: '1px solid #E5E7EB', borderRadius: '6px', background: '#fff', color: '#1F2937', fontFamily: 'inherit', fontSize: '0.78rem', maxWidth: '10.5rem' }}
                          >
                            <option value="">—</option>
                            {everyone.filter(([k]) => k !== key).map(([k, o]) => <option key={k} value={k}>{personLabel(o)}</option>)}
                          </select>
                        ) : '—'}
                      </td>
                      {canSend && showPairs && (
                        <td style={{ ...td, whiteSpace: 'nowrap' }} data-testid={`ss-has-${key}`}>{isIn && drawn[key] ? personLabel(members[drawn[key]]) : '—'}</td>
                      )}
                      {canSend && (
                        <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '0.78rem' }} data-testid={`ss-email-${key}`}>
                          {!isIn ? '—'
                            : !m.email ? <span style={{ color: '#B45309' }}>No email — tell them yourself</span>
                              : sentMap[key] ? <span style={{ color: '#166534' }}>Sent {format(new Date(sentMap[key]), 'MMM d')}</span>
                                : <span style={{ color: '#6B7280' }}>Not sent yet</span>}
                        </td>
                      )}
                      {canSend && (
                        <td style={{ ...td, textAlign: 'right' }}>
                          {isIn && m.email && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => send([key])}
                              data-testid={`ss-resend-${key}`}
                              title={sentMap[key] ? `Email ${personLabel(m)} their person again` : `Email ${personLabel(m)} their person`}
                              style={rowBtn(busy)}
                            >{sentMap[key] ? '✉ Resend' : '✉ Send'}</button>
                          )}
                        </td>
                      )}
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleParticipant(key)}
                          data-testid={`ss-remove-${key}`}
                          aria-label={`Remove ${personLabel(m)} from this list`}
                          title={`Take ${personLabel(m)} off this list (they stay a guest of the event)`}
                          style={{ border: 'none', background: 'none', color: '#9CA3AF', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', padding: '0 0.2rem' }}
                        >×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div data-testid="ss-add" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '-0.25rem 0 0.75rem' }}>
            {newPerson === null ? (
              <select
                value=""
                disabled={busy}
                aria-label="Add someone to this list"
                data-testid="ss-add-select"
                onChange={(e) => {
                  if (e.target.value === '__new') setNewPerson({ name: '', email: '' });
                  else if (e.target.value) toggleParticipant(e.target.value);
                }}
                style={{ padding: '0.3rem 0.5rem', border: '1px dashed #F87171', borderRadius: '8px', background: '#fff', color: '#B91C1C', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600, maxWidth: '100%' }}
              >
                <option value="">+ Add someone…</option>
                {everyone.filter(([key]) => outKeys.has(key)).length > 0 && (
                  <optgroup label="Guests of this event">
                    {everyone.filter(([key]) => outKeys.has(key)).map(([key, m]) => <option key={key} value={key}>{personLabel(m)}</option>)}
                  </optgroup>
                )}
                <option value="__new">Someone who isn’t a guest yet…</option>
              </select>
            ) : (
              <>
                <input
                  autoFocus
                  list="ss-friend-names"
                  placeholder="Name"
                  aria-label="New person’s name"
                  value={newPerson.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    // Picking a friend by name brings their email with them.
                    const friend = friends.find((f) => (f.name || '').trim().toLowerCase() === name.trim().toLowerCase());
                    setNewPerson((p) => ({ name, email: friend?.email && !p.email ? friend.email : p.email }));
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') addNewPerson(); }}
                  style={addInput}
                />
                <datalist id="ss-friend-names">
                  {friends.filter((f) => (f.name || '').trim()).map((f) => <option key={f.id} value={f.name.trim()} />)}
                </datalist>
                <input
                  type="email"
                  placeholder="Email (to send them their person)"
                  aria-label="New person’s email"
                  value={newPerson.email}
                  onChange={(e) => setNewPerson((p) => ({ ...p, email: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') addNewPerson(); }}
                  style={{ ...addInput, flex: '1 1 220px' }}
                />
                <button type="button" disabled={busy} onClick={addNewPerson} data-testid="ss-add-new" style={rowBtn(busy)}>Add</button>
                <button type="button" onClick={() => setNewPerson(null)} style={{ ...link, color: '#6B7280' }}>Cancel</button>
              </>
            )}
          </div>

          {participants.length < MIN_PARTICIPANTS ? (
            <p style={hint}>Add at least {MIN_PARTICIPANTS} people to draw names.</p>
          ) : !drawCurrent ? (
            <>
              {drawn && <p style={{ ...hint, color: '#B45309' }}>The people taking part have changed since names were drawn, so that draw no longer fits.</p>}
              <button type="button" onClick={draw} disabled={busy} data-testid="ss-draw" style={primary(busy)}>🎲 Draw names</button>
            </>
          ) : (
            <>
              <div data-testid="ss-drawn" style={{ fontSize: '0.84rem', fontWeight: 600, color: problems.length ? '#B91C1C' : '#166534', marginBottom: '0.5rem' }}>
                {problems.length
                  ? `⚠ ${problems.length} pick${problems.length === 1 ? '' : 's'} in this draw now break${problems.length === 1 ? 's' : ''} a rule (a partner or “last time” changed) — draw again.`
                  : `✓ Names drawn for ${participants.length} people — every rule checked.`}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                <button type="button" onClick={() => setShowPairs((v) => !v)} data-testid="ss-toggle-pairs" style={link}>
                  {showPairs ? 'Hide who has whom' : 'Review who has whom'}
                </button>
                <button type="button" onClick={draw} disabled={busy} data-testid="ss-redraw" style={link}>Draw again</button>
              </div>
              <p style={hint}>{showPairs ? 'Who each person has is in the “Has this year” column above.' : 'The names stay hidden until you choose to review them, so you can keep your own a surprise.'}</p>

              <label style={{ display: 'block', fontSize: '0.76rem', color: '#6B7280', marginBottom: '0.6rem' }}>
                Note to include in the email (optional)
                <textarea
                  value={note}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="e.g. $50 limit. Gifts get opened after dinner."
                  style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '0.25rem', padding: '0.4rem 0.5rem', border: '1px solid #E5E7EB', borderRadius: '8px', fontFamily: 'inherit', fontSize: '0.84rem', resize: 'vertical' }}
                />
              </label>

              {problems.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {unsent.length > 0 ? (
                    <button type="button" onClick={() => send(sentCount > 0 ? unsent : null)} disabled={busy} data-testid="ss-send" style={primary(busy)}>
                      {busy ? 'Working…' : sentCount > 0
                        ? `✉ Email the ${unsent.length} who haven’t been sent theirs`
                        : `✉ Email all ${unsent.length} their person`}
                    </button>
                  ) : (
                    <span data-testid="ss-all-sent" style={{ fontSize: '0.84rem', fontWeight: 600, color: '#166534' }}>
                      ✓ Everyone with an email has been sent their person.
                    </span>
                  )}
                  {sentCount > 0 && unsent.length > 0 && <span style={{ fontSize: '0.78rem', color: '#6B7280' }}>{sentCount} already sent</span>}
                  {sentCount > 0 && (
                    <button type="button" onClick={() => send(null)} disabled={busy} data-testid="ss-resend-all" style={link}>Resend to everyone</button>
                  )}
                </div>
              )}
              {noEmail.length > 0 && (
                <p style={{ ...hint, marginTop: '0.5rem', color: '#B45309' }}>
                  No email for {noEmail.map((k) => personLabel(members[k])).join(', ')} — add one in the guest list, or review the draw and tell them yourself.
                </p>
              )}
            </>
          )}
          {status && (
            <p data-testid="ss-status" style={{ margin: '0.6rem 0 0', fontSize: '0.8rem', color: status.type === 'error' ? '#B91C1C' : '#166534' }}>{status.message}</p>
          )}
          <div data-testid="ss-history-link" style={{ marginTop: '0.9rem', paddingTop: '0.7rem', borderTop: '1px solid #FECACA', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#6B7280' }}>
            <span>
              {drawYears(history, year).length === 0
                ? 'No past draws saved yet.'
                : `Past draws saved: ${drawYears(history, year).join(', ')}.`}
            </span>
            <button type="button" onClick={onOpenHistory} style={link}>
              {drawYears(history, year).length === 0 ? 'Load past draws' : 'View and edit history'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Every Secret Santa on the event: the main one, any extra ones for a smaller
// group ("Sibs Secret Santa"), and the way to add another.
export function SecretSantaPanels(props) {
  const { user, eventId } = props;
  const { draws, saveDraws, removeDraw } = useSecretSantaHistory(user, eventId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const guard = (fn) => async () => {
    setError('');
    try { await fn(); } catch (err) { setError(err.message || String(err)); }
  };
  const taken = (n, exceptId) => draws.some((d) => d.id !== exceptId && d.name.toLowerCase() === n.toLowerCase());

  const add = guard(async () => {
    const clean = cleanDrawName(name);
    if (!clean) { setError('Give it a name.'); return; }
    if (taken(clean)) { setError(`There is already one called “${clean}”.`); return; }
    const id = newDrawId();
    await saveDraws([...draws, { id, name: clean }]);
    setName('');
    setAdding(false);
  });
  const rename = (d) => guard(async () => {
    const clean = cleanDrawName(window.prompt('Name of this Secret Santa', d.name));
    if (!clean || clean === d.name) return;
    if (taken(clean, d.id)) { setError(`There is already one called “${clean}”.`); return; }
    await saveDraws(draws.map((x) => (x.id === d.id ? { ...x, name: clean } : x)));
  });
  const remove = (d) => guard(async () => {
    if (!window.confirm(`Remove “${d.name}” from this event? Its draw and its past years are deleted. The event’s other Secret Santa is not touched.`)) return;
    await removeDraw(d.id);
  });

  return (
    <>
      <SecretSanta {...props} />
      {draws.map((d) => (
        <SecretSanta key={d.id} {...props} draw={d} onRename={rename(d)} onRemove={remove(d)} />
      ))}
      <div data-testid="ss-add-draw" style={{ margin: '-0.9rem 0 1.5rem', fontSize: '0.8rem' }}>
        {!adding ? (
          draws.length < MAX_EXTRA_DRAWS && (
            <button type="button" style={link} data-testid="ss-add-draw-open" onClick={() => { setAdding(true); setError(''); }}>
              + Add another Secret Santa for some of these guests
            </button>
          )
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); add(); }} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Sibs Secret Santa"
              aria-label="Name of the new Secret Santa"
              data-testid="ss-add-draw-name"
              style={{ flex: '1 1 14rem', maxWidth: '20rem', padding: '0.4rem 0.55rem', border: '1px solid #FECACA', borderRadius: '8px', fontFamily: 'inherit', fontSize: '0.85rem' }}
            />
            <button type="submit" data-testid="ss-add-draw-save" style={primary(false)}>Add</button>
            <button type="button" style={{ ...link, color: '#6B7280' }} onClick={() => { setAdding(false); setName(''); setError(''); }}>Cancel</button>
          </form>
        )}
        {error && <p data-testid="ss-add-draw-error" style={{ margin: '0.4rem 0 0', color: '#B91C1C' }}>{error}</p>}
      </div>
    </>
  );
}

const newDrawId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const box = { marginBottom: '1.5rem', padding: '0.85rem 1rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius-md)' };
const hint = { margin: '0.25rem 0 0.6rem', fontSize: '0.78rem', color: '#6B7280', lineHeight: 1.45 };
const subhead = { fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7280', margin: '0.5rem 0 0.35rem' };
const th = { textAlign: 'left', padding: '0.4rem 0.6rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7280', borderBottom: '1px solid #FECACA', whiteSpace: 'nowrap' };
const td = { padding: '0.3rem 0.6rem', borderBottom: '1px solid #FEE2E2', verticalAlign: 'middle' };
const addInput = { flex: '1 1 150px', minWidth: 0, padding: '0.3rem 0.5rem', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#fff', fontFamily: 'inherit', fontSize: '0.84rem' };
const rowBtn = (busy) => ({
  padding: '0.2rem 0.6rem', border: '1px solid #B91C1C', borderRadius: '999px', background: '#fff', color: '#B91C1C',
  fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600, whiteSpace: 'nowrap', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
});
const link = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', textDecoration: 'underline' };
const primary = (busy) => ({
  padding: '0.5rem 1rem', border: 'none', borderRadius: 'var(--radius-md)', background: '#B91C1C', color: '#fff',
  fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
});

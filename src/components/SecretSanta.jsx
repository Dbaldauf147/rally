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
} from '../lib/secretSanta';
import { drawYears } from '../lib/secretSantaImport';
import { useSecretSantaHistory } from '../hooks/useSecretSantaHistory';

// The organizer's Secret Santa panel on an event with it switched on
// (lib/secretSanta.js): pick who is in, draw, review, then email everyone the
// name they drew. The pairs are saved on the organizer's own user doc, never
// on the event, so no guest can read them.
export function SecretSanta({ event, eventId, user, year, date, onOpenHistory }) {
  const { history, loadError, saveYear } = useSecretSantaHistory(user, eventId);
  const [showPairs, setShowPairs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'ok' | 'error', message }
  const [noteDraft, setNoteDraft] = useState(null);

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
    if (record?.out) return new Set(record.out);
    const inByDefault = new Set(defaultParticipants(members));
    return new Set(Object.keys(members).filter((k) => !inByDefault.has(k)));
  }, [record, members]);
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

  function toggleParticipant(key) {
    const next = new Set(outKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    if (drawn && Object.keys(sentMap).length > 0
      && !window.confirm('Names have already been emailed. Changing who is in throws that draw away — you would need to draw and email again. Continue?')) return;
    // Changing who is in makes any draw stale, so it is dropped rather than
    // left half-valid.
    run(() => saveYear(year, { out: [...next], note }));
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
      await saveYear(year, { out: [...outKeys], note, pairs: pairsFrom(map), drawnAt: new Date().toISOString(), sent: {} });
      setStatus({ type: 'ok', message: `Names drawn for ${participants.length} people.` });
    });
  }

  async function send(onlyKeys = null) {
    const targets = (onlyKeys || participants).filter((k) => members[k]?.email);
    if (targets.length === 0) { setStatus({ type: 'error', message: 'Nobody in the draw has an email address.' }); return; }
    if (!window.confirm(`Email ${targets.length} ${targets.length === 1 ? 'person' : 'people'} the name they drew?`)) return;
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

  return (
    <div data-testid="secret-santa" style={box}>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#991B1B' }}>🎅 Secret Santa {year}</div>
      <p style={hint}>
        Nobody draws themselves, their partner (the guest they come with), or the person they had last time.
        Guests can’t see the draw.
      </p>
      {loadError && <p style={{ ...hint, color: '#B91C1C' }}>Couldn’t load the saved draw: {loadError}</p>}

      {history === null && !loadError ? (
        <p style={hint}>Loading…</p>
      ) : (
        <>
          <div style={subhead}>Who’s in ({participants.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginBottom: '0.75rem' }}>
            {everyone.map(([key, m]) => {
              const isIn = !outKeys.has(key);
              const partnerNames = [...(partners.get(key) || [])].map((p) => personLabel(members[p]));
              return (
                <div key={key} data-testid={`ss-row-${key}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.85rem', minWidth: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', flex: '1 1 150px', minWidth: 0, opacity: isIn ? 1 : 0.5 }}>
                    <input type="checkbox" checked={isIn} disabled={busy} onChange={() => toggleParticipant(key)} style={{ width: '16px', height: '16px', accentColor: '#B91C1C', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personLabel(m)}</span>
                    {partnerNames.length > 0 && <span style={tag}>with {partnerNames.join(', ')}</span>}
                    {isIn && !m.email && <span style={{ ...tag, color: '#B45309' }}>no email</span>}
                  </label>
                  {isIn && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.74rem', color: '#6B7280' }}>
                      had last time
                      <select
                        value={last.map[key] || ''}
                        disabled={busy}
                        onChange={(e) => setLastYear(key, e.target.value)}
                        aria-label={`Who ${personLabel(m)} had last time`}
                        style={{ padding: '0.15rem 0.3rem', border: '1px solid #E5E7EB', borderRadius: '6px', background: '#fff', color: '#1F2937', fontFamily: 'inherit', fontSize: '0.76rem', maxWidth: '9.5rem' }}
                      >
                        <option value="">—</option>
                        {everyone.filter(([k]) => k !== key).map(([k, o]) => <option key={k} value={k}>{personLabel(o)}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          {participants.length < MIN_PARTICIPANTS ? (
            <p style={hint}>Tick at least {MIN_PARTICIPANTS} people to draw names.</p>
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
              {!showPairs && <p style={hint}>The names stay hidden until you choose to review them, so you can keep your own a surprise.</p>}

              {showPairs && (
                <div data-testid="ss-pairs" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.75rem', padding: '0.6rem 0.75rem', background: '#fff', border: '1px solid #FECACA', borderRadius: '8px' }}>
                  {participants.map((g) => (
                    <div key={g} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 600 }}>{personLabel(members[g])}</span>
                      <span style={{ color: '#9CA3AF' }}>→</span>
                      <span>{personLabel(members[drawn[g]])}</span>
                      {sentMap[g]
                        ? <span style={{ ...tag, color: '#166534' }}>emailed {format(new Date(sentMap[g]), 'MMM d')}</span>
                        : !members[g]?.email && <span style={{ ...tag, color: '#B45309' }}>no email — tell them yourself</span>}
                      {members[g]?.email && sentMap[g] && (
                        <button type="button" disabled={busy} onClick={() => send([g])} style={{ ...link, fontSize: '0.72rem' }}>send again</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

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

const box = { marginBottom: '1.5rem', padding: '0.85rem 1rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius-md)' };
const hint = { margin: '0.25rem 0 0.6rem', fontSize: '0.78rem', color: '#6B7280', lineHeight: 1.45 };
const subhead = { fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7280', margin: '0.5rem 0 0.35rem' };
const tag = { fontSize: '0.68rem', color: '#6B7280', whiteSpace: 'nowrap' };
const link = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', textDecoration: 'underline' };
const primary = (busy) => ({
  padding: '0.5rem 1rem', border: 'none', borderRadius: 'var(--radius-md)', background: '#B91C1C', color: '#fff',
  fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
});

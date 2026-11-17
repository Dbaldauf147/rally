import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, FieldPath } from 'firebase/firestore';
import { db } from '../firebase';
import { useSecretSantaHistory } from '../hooks/useSecretSantaHistory';
import { giftPeople, findFriend, giftIdeasOf, myPick, linkify } from '../lib/gifts';

// The owner's own gift list on an event with a Secret Santa (lib/gifts.js):
// who they drew in each draw, plus the people they always buy for, each with
// the gift ideas saved for them on the Friends page. It names the owner's
// Secret Santa pick, so the event page shows this tab to the owner alone.
export function GiftsTab({ event, eventId, user, friends, year }) {
  const { history, draws, loadError } = useSecretSantaHistory(user, eventId);
  const [saved, setSaved] = useState(undefined); // the extra people; undefined until read
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const firstName = (user?.displayName || '').trim().split(/\s+/)[0];

  useEffect(() => {
    if (!user?.uid) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const list = snap.exists() ? snap.data().giftPeople?.[eventId] : undefined;
      setSaved(Array.isArray(list) ? list : null);
    }, () => setSaved(null));
  }, [user?.uid, eventId]);

  const people = giftPeople(saved ?? undefined);
  const me = { uid: user?.uid, email: user?.email };
  // A pick is stored as it was at the draw; show the guest as they are now.
  const current = (ref) => {
    const m = ref?.key ? event.members?.[ref.key] : null;
    return m && typeof m === 'object' ? { name: m.name || ref.name, email: m.email || ref.email } : ref;
  };

  async function savePeople(list) {
    setError('');
    try {
      await setDoc(doc(db, 'users', user.uid), { giftPeople: { [eventId]: giftPeople(list) } }, { mergeFields: [new FieldPath('giftPeople', eventId)] });
    } catch (err) {
      setError(`Couldn't save: ${err.message || err}`);
    }
  }
  function addPerson() {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    if (people.some((p) => p.toLowerCase() === clean.toLowerCase())) { setError(`${clean} is already on the list.`); return; }
    savePeople([...people, clean]);
    setName('');
    setAdding(false);
  }

  const mainPick = history ? myPick(history[year], me) : null;

  return (
    <div data-testid="gifts-tab" style={{ maxWidth: '760px' }}>
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#991B1B' }}>🎁 {firstName ? `${firstName}’s` : 'My'} Gifts</h3>
      <p style={hint}>
        Everyone you’re buying for this year, with the gift ideas saved for each of them on the Friends page. Only you can see this page.
      </p>
      {loadError && <p style={{ ...hint, color: '#B91C1C' }}>Couldn’t load your Secret Santa picks: {loadError}</p>}

      {history === null && !loadError ? (
        <p style={hint}>Loading…</p>
      ) : (
        <PersonCard
          testid="gift-pick-main"
          label={`Your Secret Santa pick${draws.length ? ' — Secret Santa' : ''}`}
          person={mainPick ? current(mainPick) : null}
          empty={`No pick yet — names haven’t been drawn for ${year}, or you aren’t in that draw.`}
          friends={friends}
          user={user}
        />
      )}

      {people.map((p) => (
        <PersonCard key={p} testid={`gift-person-${p}`} label="Also buying for" person={{ name: p, email: '' }} friends={friends} user={user} onRemove={() => savePeople(people.filter((x) => x !== p))} />
      ))}

      {draws.map((d, i) => (
        <DrawPick key={d.id} draw={d} nth={i + 2} eventId={eventId} user={user} year={year} me={me} current={current} friends={friends} />
      ))}

      <div data-testid="gift-add-person" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
        {!adding ? (
          <button type="button" style={link} onClick={() => { setAdding(true); setError(''); }}>+ Add someone else you’re buying for</button>
        ) : (
          <>
            <input
              autoFocus
              list="gift-friend-names"
              placeholder="Name"
              aria-label="Person to add"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addPerson(); }}
              style={input}
            />
            <datalist id="gift-friend-names">
              {(friends || []).filter((f) => (f.name || '').trim()).map((f) => <option key={f.id} value={f.name.trim()} />)}
            </datalist>
            <button type="button" style={btn} onClick={addPerson}>Add</button>
            <button type="button" style={{ ...link, color: '#6B7280' }} onClick={() => { setAdding(false); setName(''); setError(''); }}>Cancel</button>
          </>
        )}
      </div>
      {error && <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#B91C1C' }}>{error}</p>}
    </div>
  );
}

// Who the owner drew in one of the event's extra draws ("Sibs Secret Santa").
function DrawPick({ draw, nth, eventId, user, year, me, current, friends }) {
  const { history, loadError } = useSecretSantaHistory(user, eventId, draw.id);
  const ordinal = nth === 2 ? '2nd' : nth === 3 ? '3rd' : `${nth}th`;
  if (history === null && !loadError) return null;
  const pick = history ? myPick(history[year], me) : null;
  return (
    <PersonCard
      testid={`gift-pick-${draw.id}`}
      label={`Your ${ordinal} Secret Santa pick — ${draw.name}`}
      person={pick ? current(pick) : null}
      empty={`No pick yet — names haven’t been drawn for ${draw.name} in ${year}, or you aren’t in that draw.`}
      friends={friends}
      user={user}
    />
  );
}

// One person: who they are to this list, and their gift ideas from Friends.
function PersonCard({ testid, label, person, empty, friends, user, onRemove }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const friend = person ? findFriend(friends, person) : null;
  const ideas = giftIdeasOf(friend);

  async function addIdea() {
    const text = draft.trim();
    if (!text || !friend) return;
    setBusy(true);
    setError('');
    try {
      await updateDoc(doc(db, 'users', user.uid, 'friends', friend.id), { giftIdeas: arrayUnion(text) });
      setDraft('');
    } catch (err) {
      setError(`Couldn't save: ${err.message || err}`);
    }
    setBusy(false);
  }

  return (
    <div data-testid={testid} style={{ marginBottom: '0.65rem', padding: '0.75rem 1rem', background: '#fff', border: '1px solid #FECACA', borderRadius: 'var(--radius-md)' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#991B1B' }}>{label}</div>
      {!person ? (
        <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#6B7280' }}>{empty}</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
            <span data-testid="gift-name" style={{ fontSize: '1rem', fontWeight: 700, color: '#1F2937' }}>{friend?.name || person.name || person.email || 'Someone'}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem' }}>
              {friend && <button type="button" style={link} onClick={() => navigate('/friends')} title="Gift ideas are kept on this person’s Friends page">Open Friends</button>}
              {onRemove && <button type="button" style={{ ...link, color: '#6B7280' }} onClick={onRemove} aria-label={`Remove ${person.name} from this list`}>Remove</button>}
            </span>
          </div>
          {!friend ? (
            <div style={{ marginTop: '0.25rem', fontSize: '0.82rem', color: '#B45309' }}>
              Not found on your Friends page, so there are no gift ideas to show. Add them there under this name to see their ideas here.
            </div>
          ) : (
            <>
              {ideas.length === 0 ? (
                <div style={{ marginTop: '0.25rem', fontSize: '0.82rem', color: '#9CA3AF' }}>No gift ideas saved for them yet.</div>
              ) : (
                <ul data-testid="gift-ideas" style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', fontSize: '0.88rem', color: '#374151', lineHeight: 1.5 }}>
                  {ideas.map((idea, i) => (
                    <li key={i} style={{ overflowWrap: 'anywhere' }}>
                      {linkify(idea).map((piece, j) => (piece.href
                        ? <a key={j} href={piece.href} target="_blank" rel="noopener noreferrer" style={{ color: '#B91C1C' }}>{piece.text}</a>
                        : <span key={j}>{piece.text}</span>))}
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addIdea(); }}
                  placeholder="Add a gift idea"
                  aria-label={`Add a gift idea for ${friend.name}`}
                  style={{ ...input, flex: 1 }}
                />
                <button type="button" style={{ ...btn, opacity: busy || !draft.trim() ? 0.5 : 1 }} disabled={busy || !draft.trim()} onClick={addIdea}>Add</button>
              </div>
              {error && <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#B91C1C' }}>{error}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

const hint = { margin: '0 0 0.9rem', fontSize: '0.82rem', color: '#6B7280', lineHeight: 1.45 };
const link = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', textDecoration: 'underline' };
const input = { minWidth: 0, padding: '0.35rem 0.55rem', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#fff', fontFamily: 'inherit', fontSize: '0.85rem' };
const btn = { padding: '0.35rem 0.8rem', border: '1px solid #B91C1C', borderRadius: '999px', background: '#fff', color: '#B91C1C', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' };

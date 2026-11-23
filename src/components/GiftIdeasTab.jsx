import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { genericGiftIdeas, addGenericIdea, linkify, MAX_GENERIC_IDEA_TEXT } from '../lib/gifts';

// "Gift Ideas" on an event with a Secret Santa (lib/gifts.js): ideas that
// would suit nearly anyone, for a pick with none of their own. One list per
// person, kept on their own user doc, so it is the same on every event and
// nobody else sees it.
export function GiftIdeasTab({ user }) {
  const [saved, setSaved] = useState(undefined); // undefined until read
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.uid) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      setSaved(snap.exists() ? snap.data().genericGiftIdeas ?? null : null);
    }, (err) => { setSaved(null); setError(`Couldn't load your ideas: ${err.message || err}`); });
  }, [user?.uid]);

  const ideas = genericGiftIdeas(saved);

  async function save(list) {
    setBusy(true);
    setError('');
    try {
      await setDoc(doc(db, 'users', user.uid), { genericGiftIdeas: list }, { merge: true });
    } catch (err) {
      setError(`Couldn't save: ${err.message || err}`);
      setBusy(false);
      return false;
    }
    setBusy(false);
    return true;
  }
  async function add() {
    const next = addGenericIdea(ideas, draft);
    if (next.error) { setError(next.error); return; }
    // Cleared before the write, not after: whatever is typed while it saves
    // is the next idea, and mustn't be wiped when the save lands.
    const typed = draft;
    setDraft('');
    if (!(await save(next.list))) setDraft((now) => now || typed);
  }

  return (
    <div data-testid="gift-ideas-tab" style={{ maxWidth: '760px' }}>
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#991B1B' }}>💡 Gift Ideas</h3>
      <p style={hint}>
        Ideas that would suit nearly anyone, for when the person you drew is hard to buy for. The list is yours alone and is the same on every Secret Santa event. Paste a link and it becomes clickable.
      </p>

      <div style={{ padding: '0.75rem 1rem', background: '#fff', border: '1px solid #FECACA', borderRadius: 'var(--radius-md)' }}>
        {saved === undefined ? (
          <div style={empty}>Loading…</div>
        ) : ideas.length === 0 ? (
          <div data-testid="gift-ideas-empty" style={empty}>No ideas yet. Add the first one below.</div>
        ) : (
          <ul data-testid="gift-ideas-list" style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.88rem', color: '#374151', lineHeight: 1.5 }}>
            {ideas.map((idea) => (
              <li key={idea} data-testid="gift-idea" style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', padding: '0.3rem 0', borderBottom: '1px solid #FEE2E2' }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {linkify(idea).map((piece, j) => (piece.href
                    ? <a key={j} href={piece.href} target="_blank" rel="noopener noreferrer" style={{ color: '#B91C1C' }}>{piece.text}</a>
                    : <span key={j}>{piece.text}</span>))}
                </span>
                <button type="button" style={{ ...link, color: '#6B7280' }} disabled={busy} onClick={() => save(ideas.filter((x) => x !== idea))} aria-label={`Remove ${idea}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
          <input
            value={draft}
            maxLength={MAX_GENERIC_IDEA_TEXT}
            onChange={(e) => { setDraft(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Add a gift idea — e.g. a nice candle, or a link"
            aria-label="Add a gift idea"
            data-testid="gift-idea-input"
            style={{ ...input, flex: 1 }}
          />
          <button type="button" data-testid="gift-idea-add" style={{ ...btn, opacity: busy || !draft.trim() ? 0.5 : 1 }} disabled={busy || !draft.trim()} onClick={add}>Add</button>
        </div>
        {error && <p data-testid="gift-ideas-error" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#B91C1C' }}>{error}</p>}
      </div>
    </div>
  );
}

const hint = { margin: '0 0 0.9rem', fontSize: '0.82rem', color: '#6B7280', lineHeight: 1.45 };
const empty = { fontSize: '0.85rem', color: '#9CA3AF' };
const link = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', textDecoration: 'underline' };
const input = { minWidth: 0, padding: '0.35rem 0.55rem', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#fff', fontFamily: 'inherit', fontSize: '0.85rem' };
const btn = { padding: '0.35rem 0.8rem', border: '1px solid #B91C1C', borderRadius: '999px', background: '#fff', color: '#B91C1C', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' };

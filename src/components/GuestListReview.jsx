import { useState } from 'react';
import { doc, collection, updateDoc, getDocs, arrayRemove, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { suggestedGuests, confirmGuestListUpdates } from '../lib/guestListReview';

// The organizer's once-a-year prompt on a yearly event that has "Confirm the
// guest list each year" switched on: last year's guests, pre-ticked, with one
// button to carry the ticked ones into the new year (lib/guestListReview.js).
export function GuestListReview({ event, eventId, year }) {
  const guests = suggestedGuests(event.members);
  // Only what has been UNticked is tracked, so somebody added to the event
  // while this is open arrives ticked like everyone else.
  const [dropped, setDropped] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const keep = guests.filter(([key]) => !dropped.has(key)).map(([key]) => key);
  const dropCount = guests.length - keep.length;

  function toggle(key) {
    setDropped(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function confirm() {
    if (dropCount > 0) {
      const names = guests.filter(([key]) => dropped.has(key)).map(([, m]) => m.name || 'Unnamed guest');
      const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? ` and ${names.length - 8} more` : '');
      if (!window.confirm(`Take ${dropCount} ${dropCount === 1 ? 'person' : 'people'} off the ${year} guest list?\n\n${shown}`)) return;
    }
    setSaving(true);
    setError('');
    try {
      const { updates, removed } = confirmGuestListUpdates(event, keep, year, deleteField());
      // memberUids has to lose them too — it's what `array-contains` matches, so
      // a leftover key keeps the event on that person's dashboard.
      if (removed.length > 0) updates.memberUids = arrayRemove(...removed);
      await updateDoc(doc(db, 'events', eventId), { ...updates, updatedAt: serverTimestamp() });
      // Their date-poll votes go as well, or they resurface in the tallies.
      if (removed.length > 0) {
        try {
          const snap = await getDocs(collection(db, 'events', eventId, 'dateOptions'));
          for (const d of snap.docs) {
            const votes = d.data().votes || {};
            const stale = removed.filter(key => votes[key] !== undefined);
            if (stale.length === 0) continue;
            await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id),
              Object.fromEntries(stale.map(key => [`votes.${key}`, deleteField()])));
          }
        } catch { /* the guest list itself is already saved */ }
      }
    } catch (err) {
      setError(`Couldn't save the guest list: ${err.message || err}`);
      setSaving(false);
    }
    // On success the event doc changes and this prompt unmounts.
  }

  return (
    <div
      data-testid="guest-list-review"
      style={{
        marginBottom: '1.25rem', padding: '0.85rem 1rem',
        background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#92400E' }}>
        📋 Confirm the {year} guest list
      </div>
      <p style={{ margin: '0.25rem 0 0.65rem', fontSize: '0.8rem', color: '#92400E', lineHeight: 1.45 }}>
        {guests.length === 0
          ? 'Nobody was on last year’s list. Confirm to start this year, then add guests below.'
          : 'These are last year’s guests, suggested for this year. Untick anyone who isn’t invited again. Confirming clears last year’s RSVPs so everyone can answer fresh.'}
      </p>

      {guests.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.4rem', fontSize: '0.75rem' }}>
            <button type="button" onClick={() => setDropped(new Set())} style={linkBtn}>Select all</button>
            <button type="button" onClick={() => setDropped(new Set(guests.map(([key]) => key)))} style={linkBtn}>Select none</button>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.15rem 0.75rem',
            maxHeight: '260px', overflowY: 'auto', marginBottom: '0.75rem',
          }}>
            {guests.map(([key, m]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.25rem 0', fontSize: '0.86rem', color: '#1F2937', cursor: 'pointer', minWidth: 0 }}>
                <input
                  type="checkbox"
                  checked={!dropped.has(key)}
                  onChange={() => toggle(key)}
                  style={{ width: '16px', height: '16px', accentColor: '#4f46e5', flexShrink: 0 }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: dropped.has(key) ? 'line-through' : 'none', opacity: dropped.has(key) ? 0.55 : 1 }}>
                  {m.name || m.email || 'Unnamed guest'}
                </span>
                {['yes', 'maybe', 'no'].includes(m.rsvp) && (
                  <span style={{ fontSize: '0.68rem', color: '#6B7280', whiteSpace: 'nowrap' }}>
                    last year: {m.rsvp}
                  </span>
                )}
              </label>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={confirm}
          disabled={saving}
          data-testid="guest-list-confirm"
          style={{
            padding: '0.5rem 1rem', border: 'none', borderRadius: 'var(--radius-md)',
            background: 'var(--color-accent)', color: '#fff', fontFamily: 'inherit',
            fontSize: '0.85rem', fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : `Confirm ${keep.length} ${keep.length === 1 ? 'guest' : 'guests'} for ${year}`}
        </button>
        {dropCount > 0 && (
          <span style={{ fontSize: '0.78rem', color: '#92400E' }}>
            {dropCount} will be removed
          </span>
        )}
      </div>
      {error && <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#B91C1C' }}>{error}</p>}
    </div>
  );
}

const linkBtn = {
  padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: 'inherit',
  fontWeight: 600, color: '#4f46e5', cursor: 'pointer', textDecoration: 'underline',
};

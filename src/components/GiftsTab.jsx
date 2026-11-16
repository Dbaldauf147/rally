import { useState } from 'react';
import { format } from 'date-fns';
import { giftRows, canEditGifts, cleanIdeas, linkify, MAX_IDEAS } from '../lib/gifts';

// The event's Gifts tab: a wish list for each guest (lib/gifts.js). Every
// guest of the event can read all of them; each edits their own, and the
// organizer or an editor can fill in anyone's.
export function GiftsTab({ event, eventId, user, updateEvent }) {
  const rows = giftRows(event);
  const [editing, setEditing] = useState(null); // member key
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mine = rows.find((r) => r.key === user?.uid);
  // Your own list first, so it is the first thing to fill in.
  const ordered = mine ? [mine, ...rows.filter((r) => r !== mine)] : rows;
  const filled = rows.filter((r) => r.ideas).length;

  const begin = (r) => { setEditing(r.key); setDraft(r.ideas); setError(''); };
  async function save(r) {
    setSaving(true);
    setError('');
    try {
      await updateEvent(eventId, {
        [`gifts.${r.key}`]: { ideas: cleanIdeas(draft), updatedAt: new Date().toISOString(), updatedBy: user?.displayName || user?.email || '' },
      });
      setEditing(null);
    } catch (err) {
      setError(`Couldn't save: ${err.message || err}`);
    }
    setSaving(false);
  }

  return (
    <div data-testid="gifts-tab" style={{ maxWidth: '760px' }}>
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#991B1B' }}>🎁 Gifts</h3>
      <p style={{ margin: '0 0 0.9rem', fontSize: '0.82rem', color: '#6B7280', lineHeight: 1.45 }}>
        A wish list for each person: sizes, favourites, links, things to avoid. Everyone on this event can see them, so whoever drew you has something to go on.
        {rows.length > 0 && <> {filled} of {rows.length} filled in.</>}
      </p>
      {rows.length === 0 && <p style={{ fontSize: '0.85rem', color: '#6B7280' }}>No guests on this event yet.</p>}

      {ordered.map((r) => {
        const editable = canEditGifts(event, user?.uid, r.key);
        const isMine = r.key === user?.uid;
        return (
          <div key={r.key} data-testid={`gift-row-${r.key}`} style={{ marginBottom: '0.65rem', padding: '0.75rem 1rem', background: '#fff', border: `1px solid ${isMine ? '#F87171' : '#FECACA'}`, borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1F2937' }}>{r.name}</span>
              {isMine && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#991B1B', background: '#FEE2E2', borderRadius: '999px', padding: '0.1rem 0.5rem' }}>You</span>}
              {r.updatedAt && !isNaN(new Date(r.updatedAt)) && editing !== r.key && (
                <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>updated {format(new Date(r.updatedAt), 'MMM d')}</span>
              )}
              {editable && editing !== r.key && (
                <button type="button" onClick={() => begin(r)} data-testid={`gift-edit-${r.key}`} style={{ ...link, marginLeft: 'auto' }}>
                  {r.ideas ? 'Edit' : isMine ? 'Add your wish list' : 'Add'}
                </button>
              )}
            </div>

            {editing === r.key ? (
              <div style={{ marginTop: '0.5rem' }}>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={5}
                  maxLength={MAX_IDEAS}
                  aria-label={`Wish list for ${r.name}`}
                  placeholder={'One idea per line. Links work too.\ne.g. Size M sweaters, anything for the kitchen, no candles'}
                  style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem', border: '1px solid #E5E7EB', borderRadius: '8px', fontFamily: 'inherit', fontSize: '0.88rem', lineHeight: 1.45, resize: 'vertical' }}
                />
                {error && <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#B91C1C' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem' }}>
                  <button type="button" disabled={saving} onClick={() => save(r)} data-testid="gift-save" style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 'var(--radius-md)', background: '#B91C1C', color: '#fff', fontFamily: 'inherit', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditing(null)} style={{ ...link, color: '#6B7280' }}>Cancel</button>
                </div>
              </div>
            ) : r.ideas ? (
              <div data-testid={`gift-ideas-${r.key}`} style={{ marginTop: '0.35rem', fontSize: '0.88rem', color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {linkify(r.ideas).map((piece, i) => (piece.href
                  ? <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer" style={{ color: '#B91C1C' }}>{piece.text}</a>
                  : <span key={i}>{piece.text}</span>))}
              </div>
            ) : (
              <div style={{ marginTop: '0.25rem', fontSize: '0.82rem', color: '#9CA3AF' }}>Nothing yet.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const link = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', textDecoration: 'underline' };

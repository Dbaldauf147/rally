import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { doc, updateDoc, arrayUnion, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { findMemberKey, normName } from '../lib/members';
import { normalizeMenu, normalizeOrder, offerableOptions, OTHER } from '../lib/foodOrders';
import { formatWhen } from '../lib/eventTime';
import styles from './PollPage.module.css';

// The food order link — its own page, sent once the date is settled.
//
// It used to be a block on the poll page, riding along with the date vote. That
// put the question in front of people at the wrong moment: you don't know what
// you want to eat on a night nobody has agreed to yet, and the answers went
// stale as the date moved. So it is a second link, sent after voting, built to
// be the whole message: "we're on for Friday — what do you want?"
//
// Identity works exactly as the poll link does: ?vid= pins the order to an
// existing member row, and without one the guest picks their name off the list.
// Storage is unchanged (members.<key>.foodOrder) so the organiser's table and
// tally read the same thing they always did.

class FoodPageErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#dc2626' }}>Something went wrong</h2>
          <pre style={{ fontSize: '0.8rem', color: '#666', whiteSpace: 'pre-wrap', maxWidth: '500px', margin: '1rem auto', textAlign: 'left', background: '#f5f5f5', padding: '1rem', borderRadius: '8px' }}>
            {this.state.error.message}{'\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function FoodPage() {
  return (
    <FoodPageErrorBoundary>
      <FoodPageInner />
    </FoodPageErrorBoundary>
  );
}

function FoodPageInner() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const nameParam = decodeURIComponent(searchParams.get('name') || 'Guest');
  const isGenericName = nameParam === 'Friend' || nameParam === 'Guest';
  const hasVid = !!searchParams.get('vid');
  const [editedName, setEditedName] = useState(isGenericName ? '' : nameParam);
  // Same rule as the poll link: make people pick themselves unless the link
  // names them, so a forwarded link can't order under someone else's name.
  const [nameConfirmed, setNameConfirmed] = useState(hasVid && !isGenericName);
  const [selectedMemberUid, setSelectedMemberUid] = useState(null);
  const guestName = nameConfirmed ? editedName : nameParam;
  // An explicit pick outranks the link's ?vid= — otherwise "not you?" can't
  // take effect on a personalized link that got handed around.
  const visitorId = selectedMemberUid
    || searchParams.get('vid')
    || guestName.replace(/\s+/g, '_').toLowerCase();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [order, setOrder] = useState({ choice: '', other: '', note: '' });
  const [savedAt, setSavedAt] = useState(null);
  const initedRef = useRef(null); // visitorId whose stored order has been loaded
  const timerRef = useRef(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'events', eventId), (snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      else setLoadError('not-found');
      setLoading(false);
    }, (err) => {
      setLoadError(err.code === 'permission-denied' ? 'permission' : 'error');
      setLoading(false);
    });
    return () => unsub();
  }, [eventId]);

  // Their existing order, loaded once per person so a re-render mid-typing
  // cannot overwrite what they are in the middle of writing.
  useEffect(() => {
    if (!visitorId || !event) return;
    if (initedRef.current === visitorId) return;
    initedRef.current = visitorId;
    const stored = normalizeOrder(event.members?.[visitorId]?.foodOrder);
    setOrder(stored ? { choice: stored.choice, other: stored.other, note: stored.note } : { choice: '', other: '', note: '' });
  }, [visitorId, event]);

  // Record the guest on the event without flattening what's already there — a
  // path per field, so ordering never wipes the email, phone or +1 link the
  // organiser entered. Mirrors PollPage.memberWrite.
  function memberWrite(id, name) {
    const isNew = !event?.members?.[id];
    const write = { [`members.${id}.name`]: name, memberUids: arrayUnion(id) };
    if (isNew) { write[`members.${id}.role`] = 'viewer'; write[`members.${id}.rsvp`] = 'pending'; }
    return write;
  }

  const menu = normalizeMenu(event?.foodMenu);

  // Saves as it is filled in. Text fields debounce and also flush on blur: an
  // order half-typed and then abandoned is still worth having.
  function writeOrder(next) {
    if (!visitorId) return;
    const clean = {
      choice: next.choice || '',
      other: (next.other || '').trim(),
      note: (next.note || '').trim(),
      at: new Date().toISOString(),
    };
    updateDoc(doc(db, 'events', eventId), {
      ...memberWrite(visitorId, guestName),
      [`members.${visitorId}.foodOrder`]: clean,
    }).then(() => setSavedAt(Date.now())).catch(() => {});
  }

  function setFood(patch, { immediate = false } = {}) {
    setOrder((prev) => {
      const next = { ...prev, ...patch };
      if (timerRef.current) clearTimeout(timerRef.current);
      if (immediate) writeOrder(next);
      else timerRef.current = setTimeout(() => writeOrder(next), 600);
      return next;
    });
  }

  if (loading) return <div className={styles.page}><div className={styles.card}><p>Loading...</p></div></div>;
  if (!event) return (
    <div className={styles.page}>
      <div className={styles.card}>
        {loadError === 'permission' ? (
          <>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>Access Required</h2>
            <p style={{ color: '#525252' }}>This event requires you to sign in first.</p>
            <a href="/login" style={{ display: 'inline-block', marginTop: '1rem', padding: '0.6rem 1.5rem', background: '#4f46e5', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontWeight: 600 }}>Sign In</a>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>Event not found</h2>
            <p style={{ color: '#525252' }}>This event may have been deleted or the link may be incorrect.</p>
          </>
        )}
      </div>
    </div>
  );

  const date = event.date?.toDate ? event.date.toDate() : event.date ? new Date(event.date) : null;
  const whenStr = date && !isNaN(date.getTime()) && !event.dateTBD
    ? formatWhen(event, date, 'EEEE, MMMM d')
    : '';

  const optionCard = (checked) => ({
    display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
    padding: '0.6rem 0.75rem', borderRadius: '10px', fontSize: '0.92rem',
    border: `2px solid ${checked ? '#4f46e5' : '#e5e5e5'}`,
    background: checked ? '#eef2ff' : '#fff',
  });

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.inviteLabel}>🍽 Food order</p>
        <h1 className={styles.title}>{event.title}</h1>
        {whenStr && <p className={styles.date}>{whenStr}</p>}
        {event.location && <p className={styles.location}>{event.location}</p>}

        {!menu.enabled ? (
          <div className={styles.section}>
            <p className={styles.sectionDesc}>
              No orders are being taken for this one yet. Check with whoever sent you the link.
            </p>
          </div>
        ) : !nameConfirmed ? (() => {
          const allMembers = Object.entries(event.members || {})
            .filter(([, m]) => m && typeof m === 'object' && m.name)
            .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''));

          // Match a typed name to someone already on the roster — preferring a
          // real member entry — so "mike baldauf" lands on the organiser's
          // "Mike Baldauf" instead of spawning a second row beside them.
          function confirmName(name, memberUid) {
            let finalName = name.trim();
            if (!finalName) return;
            let id = memberUid;
            if (!id) {
              const realKey = findMemberKey(event.members || {}, { name: finalName });
              const match = realKey
                ? [realKey, event.members[realKey]]
                : allMembers.find(([, m]) => normName(m?.name) === normName(finalName));
              if (match) { [id] = match; finalName = match[1].name || finalName; }
              else id = finalName.replace(/\s+/g, '_').toLowerCase();
            }
            setEditedName(finalName);
            setSelectedMemberUid(id);
            setNameConfirmed(true);
            updateDoc(doc(db, 'events', eventId), memberWrite(id, finalName)).catch(() => {});
          }

          return (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Who are you?</h3>
              <p className={styles.sectionDesc}>Tap your name to order.</p>
              {allMembers.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  {allMembers.map(([uid, m]) => (
                    <button
                      key={uid}
                      onClick={() => confirmName(m.name, uid)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.7rem', border: '2px solid #e5e5e5', borderRadius: '10px', background: '#fff', fontSize: '0.88rem', fontWeight: 600, color: '#1a1a1a', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#4f46e5'; e.currentTarget.style.background = '#eef2ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e5e5'; e.currentTarget.style.background = '#fff'; }}
                    >
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.4rem', fontWeight: 500 }}>
                {allMembers.length > 0 ? 'Not on the list?' : 'Enter your name to order'}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={editedName}
                  onChange={e => { setEditedName(e.target.value); setSelectedMemberUid(null); }}
                  placeholder="Type your name…"
                  autoComplete="off"
                  style={{ flex: 1, padding: '0.6rem 0.75rem', border: '2px solid #e5e5e5', borderRadius: '10px', fontSize: '0.92rem', fontFamily: 'inherit' }}
                  onKeyDown={e => { if (e.key === 'Enter' && editedName.trim()) confirmName(editedName, selectedMemberUid); }}
                />
                <button
                  onClick={() => confirmName(editedName, selectedMemberUid)}
                  disabled={!editedName.trim()}
                  style={{ padding: '0.6rem 1.2rem', border: 'none', borderRadius: '10px', background: editedName.trim() ? '#4f46e5' : '#e5e5e5', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: editedName.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}
                >
                  Continue
                </button>
              </div>
            </div>
          );
        })() : (
          <>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', textAlign: 'center', margin: '0 0 1rem' }}>
              Ordering as <strong style={{ color: '#1a1a1a' }}>{guestName}</strong>
              {' · '}
              <button
                onClick={() => { setNameConfirmed(false); setSelectedMemberUid(null); setEditedName(''); }}
                style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: '0.82rem', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
              >
                not you?
              </button>
            </p>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>{menu.prompt}</h3>
              <p className={styles.sectionDesc}>
                Saved as you go — no need to submit.
                {savedAt && <span style={{ color: '#16a34a', fontWeight: 600 }}> ✓ Saved</span>}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.6rem' }}>
                {offerableOptions(menu).map((o) => (
                  <label key={o.id} style={optionCard(order.choice === o.id)}>
                    <input
                      type="radio"
                      name="food-choice"
                      checked={order.choice === o.id}
                      onChange={() => setFood({ choice: o.id }, { immediate: true })}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
                <label style={optionCard(order.choice === OTHER)}>
                  <input
                    type="radio"
                    name="food-choice"
                    checked={order.choice === OTHER}
                    onChange={() => setFood({ choice: OTHER }, { immediate: true })}
                  />
                  <span style={{ whiteSpace: 'nowrap' }}>Something else:</span>
                  <input
                    type="text"
                    value={order.other}
                    placeholder="What would you like?"
                    onChange={(e) => setFood({ choice: OTHER, other: e.target.value })}
                    onBlur={() => setFood({}, { immediate: true })}
                    style={{ flex: 1, minWidth: 0, padding: '0.35rem 0.5rem', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '0.9rem', fontFamily: 'inherit' }}
                  />
                </label>
              </div>
              <input
                type="text"
                value={order.note}
                placeholder="Anything else? (allergies, no onion, …)"
                onChange={(e) => setFood({ note: e.target.value })}
                onBlur={() => setFood({}, { immediate: true })}
                style={{ width: '100%', boxSizing: 'border-box', marginTop: '0.6rem', padding: '0.55rem 0.65rem', border: '1px solid #e5e5e5', borderRadius: '10px', fontSize: '0.9rem', fontFamily: 'inherit' }}
              />
            </div>
          </>
        )}

        <p className={styles.footer}>Rally</p>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { BoatDay } from './BoatDay';
// The public boat page shares the poll page's shell — same "opened a link, not
// logged in" context, so it should look the same.
import styles from './PollPage.module.css';

/**
 * Public, no-login boat roster: /boat/:eventId?name=Mike&vid=<uid>
 * Identity comes from the link, exactly like /poll/:eventId.
 */
export function BoatDayPage() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const nameParam = decodeURIComponent(searchParams.get('name') || 'Guest');
  const isGenericName = nameParam === 'Friend' || nameParam === 'Guest';
  const vid = searchParams.get('vid');

  const [editedName, setEditedName] = useState(isGenericName ? '' : nameParam);
  // Require picking from the attendee list on arrival unless a vid is present —
  // stops a forwarded link from adding people as the wrong person.
  const [nameConfirmed, setNameConfirmed] = useState(!!vid && !isGenericName);
  const [selectedMemberUid, setSelectedMemberUid] = useState(null);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const viewerName = nameConfirmed ? editedName : nameParam;
  const viewerId = vid || selectedMemberUid || viewerName.replace(/\s+/g, '_').toLowerCase();

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'events', eventId), (snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      else setLoadError('not-found');
      setLoading(false);
    }, (err) => {
      setLoadError(err.code === 'permission-denied' ? 'permission' : 'error');
      setLoading(false);
    });
    return unsub;
  }, [eventId]);

  function confirmName(name, memberUid) {
    const finalName = name.trim();
    if (!finalName) return;
    setEditedName(finalName);
    if (memberUid) setSelectedMemberUid(memberUid);
    setNameConfirmed(true);
    const id = memberUid || finalName.replace(/\s+/g, '_').toLowerCase();
    // Only create the member if they're new. Writing the whole entry would clobber
    // plusOneOf, which is what "your people" is built from.
    if (!event?.members?.[id]) {
      updateDoc(doc(db, 'events', eventId), {
        [`members.${id}`]: { role: 'viewer', rsvp: 'pending', name: finalName },
        memberUids: arrayUnion(id),
      }).catch(() => {});
    }
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

  if (!event.boatDay?.enabled) return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>⛵ Boat Day isn't on yet</h2>
        <p style={{ color: '#525252' }}>The organizer hasn't enabled Boat Day for {event.title}. Check back once they do.</p>
      </div>
    </div>
  );

  const allMembers = Object.entries(event.members || {})
    .filter(([, m]) => m && typeof m === 'object' && m.name)
    .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.inviteLabel}>⛵ Boat Day</p>
        <h1 className={styles.title}>{event.title}</h1>

        {!nameConfirmed ? (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Who are you?</h3>
            <p className={styles.sectionDesc}>Tap your name to add people to the boat.</p>

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
              {allMembers.length > 0 ? 'Not on the list?' : 'Enter your name'}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={editedName}
                onChange={e => { setEditedName(e.target.value); setSelectedMemberUid(null); }}
                placeholder="Type your name…"
                autoComplete="off"
                style={{ flex: 1, minWidth: 0, padding: '0.6rem 0.75rem', border: '2px solid #e5e5e5', borderRadius: '10px', fontSize: '0.92rem', fontFamily: 'inherit' }}
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
        ) : (
          <>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', textAlign: 'center', margin: '0 0 1rem' }}>
              Adding as <strong style={{ color: '#1a1a1a' }}>{viewerName}</strong>
              {' · '}
              <button
                onClick={() => { setNameConfirmed(false); setSelectedMemberUid(null); setEditedName(''); }}
                style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: '0.82rem', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
              >
                not you?
              </button>
            </p>
            <BoatDay
              event={event}
              eventId={eventId}
              viewerId={viewerId}
              viewerName={viewerName}
            />
          </>
        )}
      </div>
    </div>
  );
}

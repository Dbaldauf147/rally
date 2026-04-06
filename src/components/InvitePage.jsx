import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import styles from './InvitePage.module.css';

export function InvitePage() {
  const { token } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    async function load() {
      try {
        const q = query(collection(db, 'events'), where('shareToken', '==', token));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          setEvent({ id: d.id, ...d.data() });
        }
      } catch (err) {
        console.error('Invite load error:', err);
        setNeedsAuth(true);
      }
      clearTimeout(timeout);
      setLoading(false);
    }
    load();
    return () => clearTimeout(timeout);
  }, [token]);

  async function handleJoin() {
    if (!user || !event) return;
    setJoining(true);
    const updates = {
      [`members.${user.uid}`]: { role: 'viewer', rsvp: 'pending', name: user.displayName || user.email || '', email: user.email || '' },
      memberUids: arrayUnion(user.uid),
    };
    // Check if user's email already exists as a member under a different key — merge their data
    const userEmail = (user.email || '').toLowerCase();
    if (userEmail && event.members) {
      for (const [key, m] of Object.entries(event.members)) {
        if (key !== user.uid && m && (m.email || '').toLowerCase() === userEmail) {
          // Merge existing member data (rsvp, phone, etc.) into the UID-keyed entry
          updates[`members.${user.uid}`] = { ...m, name: user.displayName || m.name || '', email: user.email || m.email || '' };
          // Remove the old email-keyed entry
          updates[`members.${key}`] = null;
          break;
        }
      }
    }
    await updateDoc(doc(db, 'events', event.id), updates);
    setJoined(true);
    setJoining(false);
    setTimeout(() => navigate(`/event/${event.id}`), 1000);
  }

  if (loading) return <div className={styles.page}><p className={styles.loading}>Loading invite...</p></div>;
  if (needsAuth || (!event && !user)) return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.inviteLabel}>You've been invited!</p>
        <h1 className={styles.title}>Sign in to view this event</h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', margin: '0 0 1.5rem' }}>Create a free account or sign in to see the event details and RSVP.</p>
        <button className={styles.joinBtn} onClick={() => navigate(`/login?redirect=/invite/${token}`)}>Sign In or Create Account</button>
      </div>
    </div>
  );
  if (!event) return <div className={styles.page}><p className={styles.loading}>Invite not found or expired.</p></div>;

  const date = event.date?.toDate ? event.date.toDate() : new Date(event.date);
  const alreadyMember = user && event.members?.[user.uid];

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.inviteLabel}>You're invited to</p>
        <h1 className={styles.title}>{event.title}</h1>
        <p className={styles.date}>{format(date, 'EEEE, MMMM d, yyyy · h:mm a')}</p>
        {event.location && <p className={styles.location}>📍 {event.location}</p>}
        {event.description && <p className={styles.desc}>{event.description}</p>}

        <div className={styles.actions}>
          {joined ? (
            <p className={styles.joinedMsg}>You're in! Redirecting...</p>
          ) : alreadyMember ? (
            <button className={styles.joinBtn} onClick={() => navigate(`/event/${event.id}`)}>View Event</button>
          ) : user ? (
            <button className={styles.joinBtn} onClick={handleJoin} disabled={joining}>{joining ? 'Joining...' : 'Join Event'}</button>
          ) : (
            <button className={styles.joinBtn} onClick={() => navigate('/login')}>Sign in to Join</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.75rem' }}>
          <a
            href={`/api/calendar-invite?title=${encodeURIComponent(event.title)}&start=${encodeURIComponent(date.toISOString())}&end=${encodeURIComponent(new Date(date.getTime() + 3600000).toISOString())}${event.location ? `&location=${encodeURIComponent(event.location)}` : ''}&description=${encodeURIComponent(event.description || '')}`}
            style={{ fontSize: '0.78rem', color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}
          >
            📅 Download .ics
          </a>
          <span style={{ color: 'var(--color-border)' }}>·</span>
          <a
            href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}/${new Date(date.getTime() + 3600000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}${event.location ? `&location=${encodeURIComponent(event.location)}` : ''}&details=${encodeURIComponent(event.description || '')}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.78rem', color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}
          >
            📅 Add to Google Calendar
          </a>
        </div>
      </div>
    </div>
  );
}

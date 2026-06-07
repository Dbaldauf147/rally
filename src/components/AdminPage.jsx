import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, getDocs, onSnapshot, doc, updateDoc,
  deleteField, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import styles from './AdminPage.module.css';

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

// Firestore lastLogin is a serverTimestamp; handle Timestamp, Date, or millis.
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return null;
}

function formatLastLogin(value) {
  const d = toDate(value);
  if (!d) return '—';
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.round(diffMs / 60000);
  let relative;
  if (diffMin < 1) relative = 'just now';
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffMin < 1440) relative = `${Math.round(diffMin / 60)}h ago`;
  else if (diffMin < 43200) relative = `${Math.round(diffMin / 1440)}d ago`;
  else relative = null;
  const absolute = d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  return relative ? `${absolute} · ${relative}` : absolute;
}

function eventDateLabel(evt) {
  if (evt.dateTBD) return 'Date TBD';
  const d = evt.date?.toDate ? evt.date.toDate() : (evt.date ? new Date(evt.date) : null);
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name, email) {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

// Mirror FriendsPage/useEvents: member keys replace . @ # $ / [ ] with _.
function sanitizeKey(str) {
  return (str || '').replace(/[.@#$/[\]]/g, '_');
}

// Every key a user might appear under in an event: their uid, plus the
// sanitized lowercase email key used when someone is invited before signup.
function userKeys(u) {
  const keys = [u.uid];
  if (u.email) {
    const emailKey = sanitizeKey(u.email.toLowerCase());
    if (emailKey && emailKey !== u.uid) keys.push(emailKey);
  }
  return keys;
}

function isOwner(evt, u) {
  return evt.createdBy === u.uid;
}

// A user is "on" an event if they own it, their uid/email key is in
// memberUids, or they have a (non-null) entry in the members map.
function isMember(evt, u) {
  if (isOwner(evt, u)) return true;
  const memberUids = evt.memberUids || [];
  const members = evt.members || {};
  return userKeys(u).some(k => memberUids.includes(k) || members[k]);
}

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedUid, setExpandedUid] = useState(null);
  const [busyId, setBusyId] = useState(null); // event id currently being written

  const isAdmin = user?.email === ADMIN_EMAIL;

  // Load all users once.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDocs(collection(db, 'users'));
        if (cancelled) return;
        const rows = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const ad = toDate(a.lastLogin)?.getTime() || 0;
          const bd = toDate(b.lastLogin)?.getTime() || 0;
          return bd - ad;
        });
        setUsers(rows);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Live-subscribe to all events so membership edits reflect immediately.
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(
      collection(db, 'events'),
      snap => setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return unsub;
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.uid || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  function eventsForUser(u) {
    return events
      .filter(e => isMember(e, u))
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  function eventsNotForUser(u) {
    return events
      .filter(e => !isMember(e, u))
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  async function addToEvent(evt, u) {
    setBusyId(evt.id);
    try {
      const key = u.uid;
      await updateDoc(doc(db, 'events', evt.id), {
        [`members.${key}`]: {
          role: 'viewer',
          rsvp: 'pending',
          name: u.displayName || u.email || '',
          email: u.email || '',
        },
        memberUids: arrayUnion(key),
      });
    } catch (err) {
      setError(err.message || 'Failed to add to event');
    } finally {
      setBusyId(null);
    }
  }

  async function removeFromEvent(evt, u) {
    setBusyId(evt.id);
    try {
      const keys = userKeys(u);
      const updates = {};
      for (const k of keys) {
        if ((evt.memberUids || []).includes(k) || (evt.members || {})[k]) {
          updates[`members.${k}`] = deleteField();
        }
      }
      updates.memberUids = arrayRemove(...keys);
      await updateDoc(doc(db, 'events', evt.id), updates);
    } catch (err) {
      setError(err.message || 'Failed to remove from event');
    } finally {
      setBusyId(null);
    }
  }

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Users</h1>
        <span className={styles.count}>
          {loading ? 'Loading…' : `${users.length} user${users.length !== 1 ? 's' : ''}`}
        </span>
      </div>
      <p className={styles.subtitle}>Everyone who has signed in to Rally. Expand a user to see and edit the trips they’re on.</p>

      <input
        type="text"
        className={styles.search}
        placeholder="Search by name, email, or ID…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.empty}>Loading users…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {users.length === 0 ? 'No users yet.' : 'No users match your search.'}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Last login</th>
                <th>Trips</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const userEvents = eventsForUser(u);
                const expanded = expandedUid === u.uid;
                return (
                  <React.Fragment key={u.uid}>
                    <tr
                      className={styles.userRow}
                      onClick={() => setExpandedUid(expanded ? null : u.uid)}
                    >
                      <td>
                        <div className={styles.userCell}>
                          {u.photoURL ? (
                            <img className={styles.avatar} src={u.photoURL} alt="" referrerPolicy="no-referrer" />
                          ) : (
                            <span className={styles.avatarFallback}>{initials(u.displayName, u.email)}</span>
                          )}
                          <span className={styles.name}>{u.displayName || '(no name)'}</span>
                        </div>
                      </td>
                      <td className={styles.email}>{u.email || '—'}</td>
                      <td className={styles.lastLogin}>{formatLastLogin(u.lastLogin)}</td>
                      <td>
                        <span className={styles.tripsToggle}>
                          {userEvents.length} {userEvents.length === 1 ? 'trip' : 'trips'}
                          <span className={styles.caret}>{expanded ? '▾' : '▸'}</span>
                        </span>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className={styles.detailRow}>
                        <td colSpan={4}>
                          <TripEditor
                            user={u}
                            userEvents={userEvents}
                            availableEvents={eventsNotForUser(u)}
                            busyId={busyId}
                            onAdd={addToEvent}
                            onRemove={removeFromEvent}
                            isOwner={isOwner}
                            eventDateLabel={eventDateLabel}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TripEditor({ user, userEvents, availableEvents, busyId, onAdd, onRemove, isOwner, eventDateLabel }) {
  const [addId, setAddId] = useState('');

  function handleAdd() {
    const evt = availableEvents.find(e => e.id === addId);
    if (!evt) return;
    onAdd(evt, user);
    setAddId('');
  }

  return (
    <div className={styles.tripPanel}>
      {userEvents.length === 0 ? (
        <p className={styles.tripEmpty}>Not on any trips yet.</p>
      ) : (
        <ul className={styles.tripList}>
          {userEvents.map(evt => {
            const owner = isOwner(evt, user);
            return (
              <li key={evt.id} className={styles.tripItem}>
                <div className={styles.tripInfo}>
                  <span className={styles.tripTitle}>{evt.title || '(untitled trip)'}</span>
                  <span className={styles.tripMeta}>
                    {eventDateLabel(evt)}
                    {owner && <span className={styles.ownerBadge}>Owner</span>}
                  </span>
                </div>
                {owner ? (
                  <span className={styles.ownerNote}>can’t remove owner</span>
                ) : (
                  <button
                    type="button"
                    className={styles.removeBtn}
                    disabled={busyId === evt.id}
                    onClick={() => onRemove(evt, user)}
                  >
                    {busyId === evt.id ? '…' : 'Remove'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.addRow}>
        <select
          className={styles.addSelect}
          value={addId}
          onChange={e => setAddId(e.target.value)}
        >
          <option value="">Add to a trip…</option>
          {availableEvents.map(evt => (
            <option key={evt.id} value={evt.id}>
              {evt.title || '(untitled)'}{eventDateLabel(evt) ? ` · ${eventDateLabel(evt)}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.addBtn}
          disabled={!addId || busyId != null}
          onClick={handleAdd}
        >
          Add
        </button>
      </div>
    </div>
  );
}

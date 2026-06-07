import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
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

function initials(name, email) {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const isAdmin = user?.email === ADMIN_EMAIL;

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
          return bd - ad; // most recent login first
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.uid || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Users</h1>
        <span className={styles.count}>
          {loading ? 'Loading…' : `${users.length} user${users.length !== 1 ? 's' : ''}`}
        </span>
      </div>
      <p className={styles.subtitle}>Everyone who has signed in to Rally.</p>

      <input
        type="text"
        className={styles.search}
        placeholder="Search by name, email, or ID…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {error && <div className={styles.error}>Couldn’t load users: {error}</div>}

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
                <th>User ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.uid}>
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
                  <td className={styles.uid} title={u.uid}>{u.uid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

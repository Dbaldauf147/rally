import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { friendsNotOnList, friendAddress, guestFromFriend } from '../lib/weddingFriendMatch';
import styles from './WeddingPage.module.css';

/* Everyone on the Friends page who isn't on the guest list — the people you
   might have forgotten. Read-only apart from "Add": adding writes a guest row
   linked to the friend, and they drop off this list on the next snapshot. */
export function WeddingFriendsNotInvited() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState(null);
  const [friends, setFriends] = useState(null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(() => new Set());
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setContacts(Array.isArray(data.weddingContacts) ? data.weddingContacts : []);
      },
      (err) => { console.error('Wedding contacts snapshot error:', err); setContacts([]); },
    );
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      collection(db, 'users', user.uid, 'friends'),
      (snap) => setFriends(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => { console.error('Friends snapshot error:', err); setFriends([]); },
    );
  }, [user]);

  const loading = contacts === null || friends === null;
  const missing = useMemo(
    () => (loading ? [] : friendsNotOnList(friends, contacts)),
    [loading, friends, contacts],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missing;
    return missing.filter((f) => [f.name, f.email, f.workEmail, f.phone, friendAddress(f)]
      .some((v) => (v || '').toLowerCase().includes(q)));
  }, [missing, search]);

  const addToList = async (f) => {
    if (!user || adding.size > 0) return;
    setAdding((s) => new Set(s).add(f.id));
    setError(null);
    try {
      const id = `friend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(
        doc(db, 'users', user.uid),
        { weddingContacts: [...(contacts || []), guestFromFriend(f, id)] },
        { merge: true },
      );
    } catch (err) {
      setError(`Couldn’t add ${f.name || 'them'}: ${err.message}`);
    } finally {
      setAdding((s) => { const n = new Set(s); n.delete(f.id); return n; });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        {!loading && (
          <div className={styles.count}>
            {missing.length} of {friends.length} friends not on the guest list
          </div>
        )}
      </div>
      <p className={styles.subtitle}>
        Everyone on your Friends page who isn&apos;t on the guest list yet — matched by link, name,
        email or phone. Add someone and they move to the Guest List.
      </p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search friends by name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error && <p className={styles.digestErrMsg} role="alert">{error}</p>}

      <div className={styles.tableWrap}>
        <div className={styles.tableScroll}>
          <table className={styles.table} data-testid="friends-not-invited">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className={styles.loadingState}>Loading…</td></tr>
              )}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={5} className={styles.empty}>
                  {missing.length === 0
                    ? (friends.length === 0 ? 'No friends yet — add some on the Friends page.' : 'Every friend is on the guest list.')
                    : 'No friends match.'}
                </td></tr>
              )}
              {!loading && shown.map((f) => (
                <tr key={f.id}>
                  <td>{f.name || '—'}</td>
                  <td>{f.email || f.workEmail || ''}</td>
                  <td>{f.phone || ''}</td>
                  <td>{friendAddress(f)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button
                      type="button"
                      className={styles.toolButton}
                      onClick={() => addToList(f)}
                      // One at a time: each add rewrites the whole guest array,
                      // so a second click before the first lands would drop it.
                      disabled={adding.size > 0}
                    >
                      {adding.has(f.id) ? 'Adding…' : '+ Add to guest list'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

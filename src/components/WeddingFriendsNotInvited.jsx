import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { arrayRemove, arrayUnion, collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { friendsNotOnList, friendAddress, guestFromFriend, normName } from '../lib/weddingFriendMatch';
import { guestSearchPool, searchGuestPool, suggestGuestNames } from '../lib/weddingNameSuggest';
import { saveGuestLists } from '../lib/weddingGuestStore';
import styles from './WeddingPage.module.css';
import listStyles from './WeddingPartyCell.module.css';

/* Everyone on the Friends page who isn't on the guest list — the people you
   might have forgotten. "Add" writes a guest row linked to the friend, and they
   drop off this list on the next snapshot. "Hide" is for the friends you've
   decided not to invite: their ids go in users/{uid}.weddingHiddenFriendIds,
   they leave the list, and "Show hidden" brings them back to unhide. Hiding
   touches nothing on the friend or the guest list.

   "Suggested name" is the guest this friend most likely is, under a slightly
   different name (lib/weddingNameSuggest.js). The box holds that guess and
   can be typed in to search the whole guest list for someone else, with the
   matching guests listed under it as you type. A guest some other friend
   already accounts for is listed too, marked with that friend. "Use this
   name" renames the friend to match the guest picked, which puts them on the
   list by name — the guest is left as it is. */
export function WeddingFriendsNotInvited() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState(null);
  const [friends, setFriends] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(() => new Set());
  const [onlySuggested, setOnlySuggested] = useState(false);
  // What's been typed in a row's guest search, by friend id.
  const [picks, setPicks] = useState({});

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setContacts(Array.isArray(data.weddingContacts) ? data.weddingContacts : []);
        setHiddenIds(new Set(Array.isArray(data.weddingHiddenFriendIds) ? data.weddingHiddenFriendIds : []));
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
  // Only count hidden friends who'd otherwise be on this list — a hidden friend
  // who has since been added as a guest is just a stale id.
  const hiddenCount = useMemo(() => missing.filter((f) => hiddenIds.has(f.id)).length, [missing, hiddenIds]);
  const visible = useMemo(
    () => (showHidden ? missing : missing.filter((f) => !hiddenIds.has(f.id))),
    [missing, hiddenIds, showHidden],
  );
  const suggestions = useMemo(
    () => (loading ? new Map() : suggestGuestNames(missing, contacts, friends)),
    [loading, missing, contacts, friends],
  );
  // Every guest the search can find, and `byName` to tell who's been typed.
  const guestPool = useMemo(() => {
    const list = loading ? [] : guestSearchPool(contacts, friends);
    return { list, byName: new Map(list.map((p) => [normName(p.name), p])) };
  }, [loading, contacts, friends]);
  const suggestedCount = useMemo(() => visible.filter((f) => suggestions.has(f.id)).length, [visible, suggestions]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = onlySuggested ? visible.filter((f) => suggestions.has(f.id)) : visible;
    if (!q) return pool;
    return pool.filter((f) => [f.name, f.email, f.workEmail, f.phone, friendAddress(f), suggestions.get(f.id)?.name]
      .some((v) => (v || '').toLowerCase().includes(q)));
  }, [visible, search, onlySuggested, suggestions]);

  // The friend takes the guest's name, split the way the guest has it, so the
  // Friends pop-up's first/middle/last fields agree with it (lib/friendName.js).
  // They then match the guest by name and leave this list on the next snapshot.
  const applySuggestedName = async (f, s) => {
    if (!user || !s) return;
    setRenaming((r) => new Set(r).add(f.id));
    setError(null);
    try {
      const tidy = (v) => String(v || '').trim().replace(/\s+/g, ' ');
      await updateDoc(doc(db, 'users', user.uid, 'friends', f.id), {
        name: s.name,
        firstName: tidy(s.guest.firstName),
        middleName: '',
        lastName: tidy(s.guest.lastName),
      });
      setPicks((p) => { const n = { ...p }; delete n[f.id]; return n; });
    } catch (err) {
      setError(`Couldn’t rename ${f.name || 'them'}: ${err.message}`);
    } finally {
      setRenaming((r) => { const n = new Set(r); n.delete(f.id); return n; });
    }
  };

  // arrayUnion/arrayRemove rather than rewriting the array, so two quick hides
  // can't overwrite each other.
  const setHidden = async (f, hide) => {
    if (!user) return;
    setError(null);
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { weddingHiddenFriendIds: hide ? arrayUnion(f.id) : arrayRemove(f.id) },
        { merge: true },
      );
    } catch (err) {
      setError(`Couldn’t ${hide ? 'hide' : 'unhide'} ${f.name || 'them'}: ${err.message}`);
    }
  };

  const addToList = async (f) => {
    if (!user || adding.size > 0) return;
    setAdding((s) => new Set(s).add(f.id));
    setError(null);
    try {
      const id = `friend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Merged into the stored list rather than laid over it, so adding one
      // friend can't replace everyone (lib/weddingGuestStore.js).
      const base = contacts || [];
      await saveGuestLists(user.uid, { weddingContacts: { base, next: [...base, guestFromFriend(f, id)] } });
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
            {missing.length - hiddenCount} of {friends.length} friends not on the guest list
            {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
          </div>
        )}
      </div>
      <p className={styles.subtitle}>
        Everyone on your Friends page who isn&apos;t on the guest list yet — matched by link, name,
        email or phone. Add someone and they move to the Guest List; hide the ones you
        aren&apos;t inviting.
      </p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search friends by name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {(suggestedCount > 0 || onlySuggested) && (
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setOnlySuggested((v) => !v)}
            aria-pressed={onlySuggested}
          >
            {onlySuggested ? 'Show everyone' : `Only with a suggested name (${suggestedCount})`}
          </button>
        )}
        {(hiddenCount > 0 || showHidden) && (
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => setShowHidden((v) => !v)}
            aria-pressed={showHidden}
          >
            {showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}
          </button>
        )}
      </div>
      {error && <p className={styles.digestErrMsg} role="alert">{error}</p>}

      <div className={styles.tableWrap}>
        <div className={styles.tableScroll}>
          <table className={styles.table} data-testid="friends-not-invited">
            <thead>
              <tr>
                <th>Name</th>
                <th>Suggested name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className={styles.loadingState}>Loading…</td></tr>
              )}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={6} className={styles.empty}>
                  {missing.length === 0
                    ? (friends.length === 0 ? 'No friends yet — add some on the Friends page.' : 'Every friend is on the guest list.')
                    : visible.length === 0
                      ? 'Every friend not on the guest list is hidden.'
                      : onlySuggested && !search.trim()
                        ? 'No suggested names left.'
                      : 'No friends match.'}
                </td></tr>
              )}
              {!loading && shown.map((f) => {
                const hidden = hiddenIds.has(f.id);
                const s = suggestions.get(f.id);
                // The box shows the guess until it's typed over; the guest it
                // names (if it names one) is who "Use this name" applies.
                const typed = picks[f.id] ?? s?.name ?? '';
                const pick = guestPool.byName.get(normName(typed)) || null;
                return (
                <tr key={f.id} style={hidden ? { opacity: 0.55 } : undefined} data-hidden={hidden || undefined}>
                  <td>{f.name || '—'}{hidden && ' (hidden)'}</td>
                  <td data-testid="suggested-name">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <GuestSearchInput
                        value={typed}
                        pool={guestPool.list}
                        label={`Guest list name for ${f.name || 'this friend'}`}
                        title={s && picks[f.id] === undefined ? `On the guest list as ${s.name}` : undefined}
                        onChange={(v) => setPicks((p) => ({ ...p, [f.id]: v }))}
                        onEnter={() => { if (pick && !renaming.has(f.id)) applySuggestedName(f, pick); }}
                      />
                      {pick && (
                        <button
                          type="button"
                          className={styles.toolButton}
                          onClick={() => applySuggestedName(f, pick)}
                          disabled={renaming.has(f.id)}
                          title={`Rename ${f.name || 'this friend'} to ${pick.name} on the Friends page, so they match the guest`}
                        >
                          {renaming.has(f.id) ? 'Renaming…' : 'Use this name'}
                        </button>
                      )}
                      {pick?.claimedBy && (
                        <span className={styles.guestSearchNote} title="Renaming gives you two Friends contacts with this name; merge them on the Friends page if they're the same person.">
                          Already matched to {pick.claimedBy}
                        </span>
                      )}
                      {!pick && typed.trim() && (
                        <span className={styles.guestSearchNote}>Pick a guest from the list</span>
                      )}
                    </span>
                  </td>
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
                    {' '}
                    <button
                      type="button"
                      className={styles.toolButton}
                      onClick={() => setHidden(f, !hidden)}
                    >
                      {hidden ? 'Unhide' : 'Hide'}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* A row's guest search: the matching guests are listed under the box as you
   type (lib/weddingNameSuggest.js searchGuestPool). ↑/↓ and Enter or a click
   pick one, which fills the box in; Enter with the list closed applies it.
   The table clips what overflows it, so the list is drawn on <body> and kept
   under the input on scroll — as WeddingPartyCell does, whose list styles
   these are. */
function GuestSearchInput({ value, pool, label, title, onChange, onEnter }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null);
  const inputRef = useRef(null);
  const options = open ? searchGuestPool(pool, value) : [];

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 300), above: r.top });
  };
  const openList = () => { place(); setOpen(true); };
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const pick = (o) => { onChange(o.name); setOpen(false); setActive(-1); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      const n = options.length;
      if (!n) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && options[active]) pick(options[active]);
      else { setOpen(false); onEnter(); }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      setActive(-1);
    }
  };

  const listHeight = Math.min(options.length, 7) * 34 + 8;
  const left = box && Math.max(8, Math.min(box.left, window.innerWidth - box.width - 8));
  const style = box && (box.top + listHeight > window.innerHeight && box.above > listHeight
    ? { left, top: box.above - listHeight - 2, width: box.width }
    : { left, top: box.top, width: box.width });

  return (
    <>
      <input
        ref={inputRef}
        className={styles.guestSearch}
        value={value}
        placeholder="Search guest list…"
        aria-label={label}
        title={title}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => { openList(); setActive(-1); }}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { onChange(e.target.value); if (!open) openList(); setActive(-1); }}
        onKeyDown={onKeyDown}
        onBlur={() => { setOpen(false); setActive(-1); }}
      />
      {open && style && options.length > 0 && createPortal(
        <ul className={listStyles.list} style={style} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {options.map((o, i) => (
            <li
              key={o.guest.id}
              role="option"
              aria-selected={i === active}
              className={[listStyles.option, i === active ? listStyles.active : ''].filter(Boolean).join(' ')}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.name}
              {o.claimedBy && <span className={styles.guestSearchNote}> · matched to {o.claimedBy}</span>}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

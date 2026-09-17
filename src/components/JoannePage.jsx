import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { OWNER_EMAIL } from '../lib/pagePrivacy';
import {
  WANT, DONE, statusLabel, normalizeList, addItem, updateItem, removeItem, setStatus,
  addKind, removeKind, kindUsage, counts, visibleItems, makeId, sameKind,
} from '../lib/joanneList';
import { safeLink, linkLabel } from '../lib/doctors';
import styles from './JoannePage.module.css';

/* The things you mean to do with Joanne.

   Owner-only, and like the Doctors page that is not only a display rule: the
   list lives on the owner's own `users/{uid}` document, which the Firestore
   rules let nobody else read.

   One list rather than a page per kind — a film, a restaurant and a present
   are the same thought, written down so it isn't lost — with the kind as a
   label you can filter by when you're picking a film rather than browsing. */

const CACHE_KEY = 'rally.joanne.doc.v1';

/* The saved list, kept in step with Firestore.

   The same shape as the Doctors list: subscribe so a note typed on the phone
   lands on the laptop, cache locally so the page renders offline, and hold a
   local edit that hasn't been acknowledged rather than letting the older
   server copy snap back over it. */
function useJoanneList(userId) {
  const [list, setList] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizeList(JSON.parse(raw));
    } catch { /* a corrupt cache just means an empty list until the snapshot */ }
    return null;
  });
  const [loaded, setLoaded] = useState(false);

  const localEdits = useRef(0);
  const syncedEdits = useRef(0);
  const appliedJson = useRef(null);
  const listRef = useRef(list);
  const writeTimer = useRef(null);
  const pendingWrite = useRef(null);
  useEffect(() => { listRef.current = list; }, [list]);

  const flushWrite = useCallback(() => {
    if (writeTimer.current) { clearTimeout(writeTimer.current); writeTimer.current = null; }
    const next = pendingWrite.current;
    if (!next || !userId) return;
    pendingWrite.current = null;
    const version = localEdits.current;
    setDoc(doc(db, 'users', userId), { joanne: next }, { merge: true })
      .catch(() => {}) // offline: the local cache still holds the edit
      .then(() => { syncedEdits.current = Math.max(syncedEdits.current, version); });
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const ref = doc(db, 'users', userId);
    return onSnapshot(ref, (snap) => {
      setLoaded(true);
      if (snap.metadata.hasPendingWrites) return; // our own write echoing back
      if (localEdits.current !== syncedEdits.current) return; // an unsent edit wins
      const normalized = normalizeList(snap.exists() ? snap.data()?.joanne : null);
      const json = JSON.stringify(normalized);
      if (json === appliedJson.current) return;
      appliedJson.current = json;
      setList(normalized);
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
    }, () => setLoaded(true) /* offline — keep the cached copy */);
  }, [userId]);

  // The last edit would otherwise die with the debounce timer when the page
  // unmounts or the app is backgrounded on the phone.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushWrite(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushWrite(); };
  }, [flushWrite]);

  const update = useCallback((updater) => {
    setList((prev) => {
      const base = prev || normalizeList(null);
      const next = normalizeList(typeof updater === 'function' ? updater(base) : updater);
      const json = JSON.stringify(next);
      appliedJson.current = json;
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
      localEdits.current += 1;
      pendingWrite.current = next;
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(flushWrite, 600);
      return next;
    });
  }, [flushWrite]);

  return { list, loaded, update };
}

/* A field that reads as text until you reach for it.

   Uncontrolled and committed on blur, like the Doctors page's cells and for
   the same reason: the stored shape trims, so writing state per keystroke
   would eat the space the moment you typed it. Keyed on the stored value by
   the caller, so an edit syncing in from another device replaces it. */
function Field({ label, value, onCommit, placeholder, type = 'text', long = false, className }) {
  const commit = (e) => { if (e.target.value.trim() !== String(value || '')) onCommit(e.target.value); };
  const fit = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } };
  const common = {
    className: className ? `${styles.field} ${className}` : styles.field,
    defaultValue: value || '',
    placeholder,
    'aria-label': label,
    onBlur: commit,
  };
  if (long) return <textarea rows={1} ref={fit} onInput={(e) => fit(e.target)} {...common} />;
  return <input type={type} {...common} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }} />;
}

// Out of five, and only once it's done — a star rating on something you
// haven't seen yet is a wish, not a rating.
function Stars({ title, rating, onRate }) {
  return (
    <div className={styles.stars} role="group" aria-label={`Rating for ${title}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= rating ? styles.starOn : styles.star}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={n <= rating}
          // Tapping the star you're already on clears it, which is the only
          // way back to no rating at all.
          onClick={() => onRate(n === rating ? 0 : n)}
        >★</button>
      ))}
    </div>
  );
}

function Entry({ item, kinds, update, isNew }) {
  const commit = (key) => (value) => update((l) => updateItem(l, item.id, { [key]: value }));
  /* A date and a link are worth having and rarely filled in, so an empty pair
     of boxes on every card would be most of the list. They show once there's
     something in them — or once you ask. */
  const [showDetails, setShowDetails] = useState(false);
  const href = safeLink(item.link);
  const done = item.status === DONE;
  const title = item.title || 'Untitled';
  const k = (key) => `${item.id}:${key}:${item[key] || ''}`;

  return (
    <li className={[styles.entry, done && styles.entryDone, isNew && styles.entryNew].filter(Boolean).join(' ')}>
      <div className={styles.entryTop}>
        <button
          type="button"
          className={done ? styles.tickOn : styles.tick}
          aria-pressed={done}
          title={done ? `Put ${title} back on the list` : `Tick ${title} off`}
          aria-label={done ? `Put ${title} back on the list` : `Tick ${title} off`}
          onClick={() => update((l) => setStatus(l, item.id, done ? WANT : DONE))}
        >{done ? '✓' : ''}</button>

        <div className={styles.entryBody}>
          <Field
            key={k('title')}
            label={`Title of ${title}`}
            className={styles.entryTitle}
            value={item.title}
            onCommit={commit('title')}
            placeholder="What is it?"
          />
          <div className={styles.entryMeta}>
            <select
              className={styles.kindSelect}
              aria-label={`Kind of ${title}`}
              value={kinds.find((kk) => sameKind(kk, item.kind)) || ''}
              onChange={(e) => commit('kind')(e.target.value)}
            >
              <option value="">No kind</option>
              {kinds.map((kk) => <option key={kk} value={kk}>{kk}</option>)}
            </select>
            <span className={styles.statusWord}>{statusLabel(item.kind, item.status)}</span>
            {done && <Stars title={title} rating={item.rating} onRate={(n) => commit('rating')(n)} />}
          </div>
        </div>

        <button
          type="button"
          className={styles.delete}
          title={`Delete ${title}`}
          aria-label={`Delete ${title}`}
          onClick={() => { if (window.confirm(`Delete ${title}? This cannot be undone.`)) update((l) => removeItem(l, item.id)); }}
        >×</button>
      </div>

      <Field
        key={k('notes')}
        label={`Notes on ${title}`}
        className={styles.entryNotes}
        value={item.notes}
        onCommit={commit('notes')}
        placeholder="Why, where, who said so…"
        long
      />

      {(showDetails || done || item.date || href) ? (
      <div className={styles.entryFoot}>
        <label className={styles.footField}>
          <span className={styles.footLabel}>{done ? 'When' : 'Planned for'}</span>
          <Field key={k('date')} label={`Date for ${title}`} type="date" value={item.date} onCommit={commit('date')} />
        </label>
        <label className={styles.footField}>
          <span className={styles.footLabel}>Link</span>
          <Field key={k('link')} label={`Link for ${title}`} type="url" value={item.link} onCommit={commit('link')} placeholder="Where to watch, book or buy" />
        </label>
        {href && (
          <a className={styles.linkOut} href={href} target="_blank" rel="noreferrer">{linkLabel(item.link)} ↗</a>
        )}
      </div>
      ) : (
        <button type="button" className={styles.addDetail} onClick={() => setShowDetails(true)}>
          + a date or a link
        </button>
      )}
    </li>
  );
}

// The kinds are the owner's own: the six the list starts with are a starting
// point, not the set.
function KindManager({ list, update, onClose }) {
  const [name, setName] = useState('');
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitle}>Kinds</div>
        <button type="button" className={styles.btn} onClick={onClose}>Close</button>
      </div>
      <p className={styles.hint}>
        The labels on each thing, and the tabs above the list. Deleting one keeps
        whatever was filed under it.
      </p>
      <ul className={styles.kindList}>
        {list.kinds.map((kind) => (
          <li key={kind} className={styles.kindRow}>
            <span className={styles.kindName}>{kind}</span>
            <span className={styles.kindCount}>{kindUsage(list.items, kind)}</span>
            <button
              type="button"
              className={styles.delete}
              title={`Delete ${kind}`}
              aria-label={`Delete the kind ${kind}`}
              onClick={() => {
                const used = kindUsage(list.items, kind);
                const warning = used
                  ? `Delete the kind “${kind}”? ${used} thing${used === 1 ? '' : 's'} keep${used === 1 ? 's' : ''} its details and lose the label.`
                  : `Delete the kind “${kind}”?`;
                if (window.confirm(warning)) update((l) => removeKind(l, kind));
              }}
            >×</button>
          </li>
        ))}
        {list.kinds.length === 0 && <li className={styles.hint}>No kinds yet.</li>}
      </ul>
      <form
        className={styles.kindAdd}
        onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; update((l) => addKind(l, name)); setName(''); }}
      >
        <input className={styles.input} value={name} placeholder="Add a kind" aria-label="Add a kind" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={styles.btnPrimary} disabled={!name.trim()}>Add</button>
      </form>
    </div>
  );
}

export function JoannePage() {
  const { user } = useAuth();
  const { list, loaded, update } = useJoanneList(user?.uid);
  const safeList = useMemo(() => list || normalizeList(null), [list]);
  const [kind, setKind] = useState('all');
  const [status, setPick] = useState('all'); // 'all' | WANT | DONE
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState('');
  const [managingKinds, setManagingKinds] = useState(false);
  const [addedId, setAddedId] = useState(null);

  const tally = useMemo(() => counts(safeList.items), [safeList.items]);
  const shown = useMemo(
    () => visibleItems(safeList, { kind, query, status }),
    [safeList, kind, query, status],
  );
  // The kind the add box starts on: whichever tab you're looking at, else the
  // first one — adding a film while filtered to Movies shouldn't need a pick.
  const addKindValue = draftKind || (kind !== 'all' ? kind : safeList.kinds[0] || '');

  function handleAdd(e) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    const id = makeId();
    update((l) => addItem(l, { id, title, kind: addKindValue }));
    setDraft('');
    setAddedId(id);
  }

  if (user && user.email !== OWNER_EMAIL) return <Navigate to="/" replace />;
  if (!user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Joanne</h1>
        <div className={styles.summary}>
          {tally[WANT] > 0 && <span className={styles.summaryLive}>{tally[WANT]} to do</span>}
          <span>{tally.all} thing{tally.all === 1 ? '' : 's'}</span>
        </div>
      </div>
      <p className={styles.subtitle}>
        Films to watch, places to eat, things to give her — written down before they
        get forgotten. Only you can see this page.
      </p>

      <form className={styles.addRow} onSubmit={handleAdd}>
        <input
          className={styles.addInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add something — a film, a place, an idea…"
          aria-label="Add something"
        />
        <select
          className={styles.addKind}
          value={addKindValue}
          aria-label="What kind"
          onChange={(e) => setDraftKind(e.target.value)}
        >
          <option value="">No kind</option>
          {safeList.kinds.map((kk) => <option key={kk} value={kk}>{kk}</option>)}
        </select>
        <button type="submit" className={styles.btnPrimary} disabled={!draft.trim()}>Add</button>
      </form>

      <div className={styles.kinds} role="tablist" aria-label="Which kind to show">
        {[{ key: 'all', label: 'All', n: tally.all }, ...safeList.kinds.map((kk) => ({ key: kk, label: kk, n: tally.byKind[kk] || 0 }))]
          .map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={kind === t.key}
              className={kind === t.key ? styles.kindTabOn : styles.kindTab}
              onClick={() => setKind(t.key)}
            >
              {t.label} <span className={styles.kindTabCount}>{t.n}</span>
            </button>
          ))}
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a title, a note…"
          aria-label="Search the list"
        />
        <div className={styles.pills}>
          {[{ key: 'all', label: 'All' }, { key: WANT, label: `Still to do (${tally[WANT]})` }, { key: DONE, label: `Done (${tally[DONE]})` }].map((p) => (
            <button
              key={p.key}
              type="button"
              className={status === p.key ? styles.pillOn : styles.pill}
              onClick={() => setPick(p.key)}
            >{p.label}</button>
          ))}
        </div>
        <button type="button" className={styles.btn} onClick={() => setManagingKinds((m) => !m)}>Kinds</button>
      </div>

      {managingKinds && <KindManager list={safeList} update={update} onClose={() => setManagingKinds(false)} />}

      {!loaded && safeList.items.length === 0 && <div className={styles.empty}>Loading…</div>}

      {loaded && safeList.items.length === 0 && (
        <div className={styles.empty}>Nothing on the list yet. Add the first thing.</div>
      )}

      {safeList.items.length > 0 && shown.length === 0 && (
        <div className={styles.empty}>
          Nothing matches{query.trim() ? ` “${query.trim()}”` : ' that filter'}.{' '}
          <button type="button" className={styles.linkBtn} onClick={() => { setQuery(''); setKind('all'); setPick('all'); }}>
            Clear the filters
          </button>
        </div>
      )}

      {shown.length > 0 && (
        <ul className={styles.list}>
          {shown.map((item) => (
            <Entry
              key={item.id}
              item={item}
              kinds={safeList.kinds}
              update={update}
              // The thing you just added is the one you are about to write a
              // note on, so it stays marked until you add another.
              isNew={item.id === addedId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

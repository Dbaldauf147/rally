import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  FIELDS, STATUS, STATUS_ORDER, statusLabel, statusHeading,
  normalizeEntry, normalizeList, hasContent, entryTitle, entrySubtitle,
  groupByStatus, countByStatus, cardRows, telHref, mailHref, mapHref, safeLink, linkLabel,
  makeId, seedDoctors,
} from '../lib/doctors';
import styles from './DoctorsPage.module.css';

/* The owner's doctor list: who was seen for what, and how to reach them again.

   Owner-only, and unusually for Rally that is not just a display rule. Medical
   history lives on the owner's own `users/{uid}` document, which the Firestore
   rules let nobody else read — so unlike a page hidden with the privacy toggle
   (see lib/pagePrivacy.js, which is explicit that it guards the page and not
   the data), the records behind this one are private too. */
const OWNER_EMAIL = 'baldaufdan@gmail.com';
const CACHE_KEY = 'rally.doctors.doc.v1';

const FIELD_OF = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

/* The saved list, kept in step with Firestore.

   Same shape as the Travel List: subscribe so an edit on the phone lands on the
   laptop, cache locally so the page renders offline, and hold a local edit that
   hasn't been acknowledged yet rather than letting the older server copy snap
   back over it. */
function useDoctorList(userId) {
  const [list, setList] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizeList(JSON.parse(raw));
    } catch { /* ignore a corrupt cache and fall through to the seed */ }
    return null;
  });
  const [loaded, setLoaded] = useState(false);

  const localEdits = useRef(0);
  const syncedEdits = useRef(0);
  const appliedJson = useRef(null);
  const seeded = useRef(false);
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
    setDoc(doc(db, 'users', userId), { doctors: next }, { merge: true })
      .catch(() => {}) // offline: the local cache still holds the edit
      .then(() => { syncedEdits.current = Math.max(syncedEdits.current, version); });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    seeded.current = false;
    const ref = doc(db, 'users', userId);
    const unsub = onSnapshot(ref, (snap) => {
      setLoaded(true);
      if (snap.metadata.hasPendingWrites) return; // our own write echoing back
      const remote = snap.exists() ? snap.data()?.doctors : null;
      if (!remote || !Array.isArray(remote.entries)) {
        // Nothing saved yet — plant the list transcribed from the spreadsheet,
        // once, so a slow first snapshot can't write it twice.
        if (seeded.current) return;
        seeded.current = true;
        const initial = listRef.current || seedDoctors();
        setList(initial);
        setDoc(ref, { doctors: initial }, { merge: true }).catch(() => {});
        return;
      }
      if (localEdits.current !== syncedEdits.current) return; // unsent edit wins
      const normalized = normalizeList(remote);
      const json = JSON.stringify(normalized);
      if (json === appliedJson.current) return;
      appliedJson.current = json;
      setList(normalized);
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
    }, () => setLoaded(true) /* offline — keep the cached copy */);
    return unsub;
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
      const base = prev || seedDoctors();
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

// A blank record, so "Add" opens the same form an existing row opens.
const emptyEntry = () => normalizeEntry({ id: makeId(), status: STATUS.NONE });

/* The draft is seeded from the record once and then owned by the form.

   Callers key this on the record's id, so switching rows builds a fresh form
   rather than syncing the prop back into state on every change — which would
   also mean a snapshot arriving mid-edit overwrote what was being typed. */
function EntryForm({ entry, onSave, onCancel, onDelete }) {
  const [draft, setDraft] = useState(entry);
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const canSave = hasContent(normalizeEntry(draft));

  return (
    <form
      className={styles.form}
      onSubmit={(e) => { e.preventDefault(); if (canSave) onSave(normalizeEntry(draft)); }}
    >
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Status</span>
          <select className={styles.input} value={draft.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className={f.long ? styles.fieldWide : styles.field}>
            <span className={styles.fieldLabel}>{f.label}</span>
            {f.key === 'notes' ? (
              <textarea
                className={styles.input}
                rows={2}
                value={draft[f.key]}
                placeholder={f.placeholder || ''}
                onChange={(e) => set(f.key, e.target.value)}
              />
            ) : (
              <input
                className={styles.input}
                type={f.type || 'text'}
                value={draft[f.key]}
                placeholder={f.placeholder || ''}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <div className={styles.formActions}>
        <button type="submit" className={styles.btnPrimary} disabled={!canSave}>Save</button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
        {onDelete && (
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={onDelete}>Delete</button>
        )}
        {!canSave && <span className={styles.hint}>Fill in at least one field.</span>}
      </div>
    </form>
  );
}

function EntryCard({ entry, onEdit }) {
  const tel = telHref(entry.phone);
  const mail = mailHref(entry.email);
  const map = mapHref(entry.location);
  const link = safeLink(entry.link);
  const subtitle = entrySubtitle(entry);
  const rows = cardRows(entry);

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.cardTitleWrap}>
          <h3 className={styles.cardTitle}>{entryTitle(entry)}</h3>
          {subtitle && <div className={styles.cardSubtitle}>{subtitle}</div>}
        </div>
        <button type="button" className={styles.editBtn} onClick={onEdit} title="Edit this record">Edit</button>
      </header>

      {rows.length > 0 && (
        <dl className={styles.rows}>
          {rows.map((k) => (
            <div key={k} className={styles.row}>
              <dt className={styles.rowLabel}>{FIELD_OF[k].label}</dt>
              <dd className={styles.rowValue}>{entry[k]}</dd>
            </div>
          ))}
        </dl>
      )}

      {(tel || mail || map || link) && (
        <div className={styles.actions}>
          {tel && <a className={styles.action} href={tel}>Call {entry.phone}</a>}
          {mail && <a className={styles.action} href={mail}>{entry.email}</a>}
          {map && <a className={styles.action} href={map} target="_blank" rel="noreferrer">{entry.location}</a>}
          {link && <a className={styles.action} href={link} target="_blank" rel="noreferrer">{linkLabel(entry.link)} ↗</a>}
        </div>
      )}
    </article>
  );
}

export function DoctorsPage() {
  const { user } = useAuth();
  const { list, loaded, update } = useDoctorList(user?.uid);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(null);

  const entries = useMemo(() => list?.entries || [], [list]);
  const counts = useMemo(() => countByStatus(entries), [entries]);
  const groups = useMemo(() => groupByStatus(entries, { query, status }), [entries, query, status]);

  function saveEntry(next) {
    update((l) => ({
      entries: l.entries.some((e) => e.id === next.id)
        ? l.entries.map((e) => (e.id === next.id ? next : e))
        : [...l.entries, next],
    }));
    setEditingId(null);
    setAdding(null);
  }

  function deleteEntry(id) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    update((l) => ({ entries: l.entries.filter((e) => e.id !== id) }));
    setEditingId(null);
  }

  if (user && user.email !== OWNER_EMAIL) return <Navigate to="/" replace />;
  if (!user) return null;

  const filtering = query.trim() !== '' || status !== 'all';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Doctors</h1>
        <div className={styles.summary}>
          {counts[STATUS.TREATING] > 0 && (
            <span className={styles.summaryLive}>{counts[STATUS.TREATING]} being treated</span>
          )}
          <span>{entries.length} record{entries.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <p className={styles.subtitle}>
        Who was seen for what, and how to reach them again. Only you can see this page.
      </p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name, a drug, a street, a complaint…"
        />
        <div className={styles.pills}>
          <button
            type="button"
            className={status === 'all' ? styles.pillOn : styles.pill}
            onClick={() => setStatus('all')}
          >All</button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={status === s ? styles.pillOn : styles.pill}
              onClick={() => setStatus(s)}
            >{statusLabel(s)} <span className={styles.pillCount}>{counts[s]}</span></button>
          ))}
        </div>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => { setAdding(emptyEntry()); setEditingId(null); }}
        >+ Add</button>
      </div>

      {adding && (
        <div className={styles.formCard}>
          <div className={styles.formTitle}>New record</div>
          <EntryForm key={adding.id} entry={adding} onSave={saveEntry} onCancel={() => setAdding(null)} />
        </div>
      )}

      {!loaded && entries.length === 0 && <div className={styles.empty}>Loading…</div>}

      {loaded && entries.length === 0 && !adding && (
        <div className={styles.empty}>No records yet. Add the first one.</div>
      )}

      {entries.length > 0 && groups.length === 0 && (
        <div className={styles.empty}>
          Nothing matches{query.trim() ? ` “${query.trim()}”` : ' that filter'}.{' '}
          <button type="button" className={styles.linkBtn} onClick={() => { setQuery(''); setStatus('all'); }}>
            Clear the filters
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.status} className={styles.group}>
          <h2 className={styles.groupHead}>
            {filtering ? statusLabel(group.status) : statusHeading(group.status)}
            <span className={styles.groupCount}>{group.entries.length}</span>
          </h2>
          <div className={styles.grid}>
            {group.entries.map((entry) => (
              editingId === entry.id ? (
                <div key={entry.id} className={styles.formCard}>
                  <div className={styles.formTitle}>{entryTitle(entry)}</div>
                  <EntryForm
                    key={entry.id}
                    entry={entry}
                    onSave={saveEntry}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => deleteEntry(entry.id)}
                  />
                </div>
              ) : (
                <EntryCard key={entry.id} entry={entry} onEdit={() => { setEditingId(entry.id); setAdding(null); }} />
              )
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

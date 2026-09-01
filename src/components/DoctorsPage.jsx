import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  FIELDS, STATUS, STATUS_ORDER, NO_TYPE, statusLabel, showsStatusBadge, typeHeading,
  normalizeEntry, normalizeList, hasContent, entryTitle, entrySubtitle,
  groupByType, countByStatus, cardRows, typeUsage,
  addType, renameType, removeType, moveType,
  telHref, mailHref, mapHref, safeLink, linkLabel, makeId, seedDoctors,
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

// The sentinel the type <select> uses for "let me type a new one". It starts
// with a space, which a real type name never does once trimmed.
const NEW_TYPE = ' new';

/* The draft is seeded from the record once and then owned by the form.

   Callers key this on the record's id, so switching rows builds a fresh form
   rather than syncing the prop back into state on every change — which would
   also mean a snapshot arriving mid-edit overwrote what was being typed. */
function EntryForm({ entry, types, onSave, onCancel, onDelete }) {
  const [draft, setDraft] = useState(entry);
  // A type typed in here joins the shared list on save, so the heading exists
  // from then on without a separate trip to the type editor.
  const [addingType, setAddingType] = useState(false);
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const canSave = hasContent(normalizeEntry(draft));

  return (
    <form
      className={styles.form}
      onSubmit={(e) => { e.preventDefault(); if (canSave) onSave(normalizeEntry(draft)); }}
    >
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          {addingType ? (
            <input
              className={styles.input}
              autoFocus
              value={draft.type}
              placeholder="New type"
              onChange={(e) => set('type', e.target.value)}
              onBlur={() => { if (!draft.type.trim()) setAddingType(false); }}
            />
          ) : (
            <select
              className={styles.input}
              value={draft.type}
              onChange={(e) => {
                if (e.target.value === NEW_TYPE) { set('type', ''); setAddingType(true); return; }
                set('type', e.target.value);
              }}
            >
              <option value={NO_TYPE}>{typeHeading(NO_TYPE)}</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value={NEW_TYPE}>+ New type…</option>
            </select>
          )}
        </label>

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

/* Renaming, reordering and deleting the headings themselves.

   Behind a toggle because it's a rarer job than adding a doctor, and it edits
   the shape of the page rather than its contents. */
function TypeManager({ list, onChange, onClose }) {
  const [newName, setNewName] = useState('');
  const { types, entries } = list;

  function handleRename(from, to) {
    if (!to.trim() || to.trim() === from) return;
    onChange(renameType(list, from, to));
  }

  function handleRemove(name) {
    const used = typeUsage(entries, name);
    const warning = used
      ? `${used} record${used === 1 ? '' : 's'} use “${name}”. Delete the type? They keep their details and move to “${typeHeading(NO_TYPE)}”.`
      : `Delete the type “${name}”?`;
    if (window.confirm(warning)) onChange(removeType(list, name));
  }

  function handleAdd(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    onChange(addType(list, newName));
    setNewName('');
  }

  return (
    <div className={styles.formCard}>
      <div className={styles.typeHead}>
        <div className={styles.formTitle}>Types</div>
        <button type="button" className={styles.btn} onClick={onClose}>Done</button>
      </div>
      <p className={styles.hint}>
        The headings the page is organised by, in order. Renaming one carries its
        records along; deleting one keeps them.
      </p>

      <ul className={styles.typeList}>
        {types.map((t, i) => (
          <li key={t} className={styles.typeRow}>
            <input
              className={styles.input}
              defaultValue={t}
              aria-label={`Rename ${t}`}
              onBlur={(e) => handleRename(t, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
            />
            <span className={styles.typeCount} title={`${typeUsage(entries, t)} record(s)`}>
              {typeUsage(entries, t)}
            </span>
            <button
              type="button" className={styles.iconBtn} title={`Move ${t} up`}
              disabled={i === 0} onClick={() => onChange(moveType(list, t, -1))}
            >↑</button>
            <button
              type="button" className={styles.iconBtn} title={`Move ${t} down`}
              disabled={i === types.length - 1} onClick={() => onChange(moveType(list, t, 1))}
            >↓</button>
            <button
              type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
              title={`Delete ${t}`} onClick={() => handleRemove(t)}
            >×</button>
          </li>
        ))}
        {types.length === 0 && <li className={styles.hint}>No types yet.</li>}
      </ul>

      <form className={styles.typeAdd} onSubmit={handleAdd}>
        <input
          className={styles.input}
          value={newName}
          placeholder="Add a type"
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className={styles.btnPrimary} disabled={!newName.trim()}>Add</button>
      </form>
    </div>
  );
}

function EntryCard({ entry, groupType, onEdit }) {
  const tel = telHref(entry.phone);
  const mail = mailHref(entry.email);
  const map = mapHref(entry.location);
  const link = safeLink(entry.link);
  const subtitle = entrySubtitle(entry, groupType);
  const rows = cardRows(entry, groupType);

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.cardTitleWrap}>
          <h3 className={styles.cardTitle}>{entryTitle(entry, groupType)}</h3>
          {subtitle && <div className={styles.cardSubtitle}>{subtitle}</div>}
        </div>
        <div className={styles.cardTools}>
          {showsStatusBadge(entry.status) && (
            <span className={entry.status === STATUS.TREATING ? styles.badgeLive : styles.badge}>
              {statusLabel(entry.status)}
            </span>
          )}
          <button type="button" className={styles.editBtn} onClick={onEdit} title="Edit this record">Edit</button>
        </div>
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
  const [managingTypes, setManagingTypes] = useState(false);

  const safeList = useMemo(() => list || { types: [], entries: [] }, [list]);
  const entries = safeList.entries;
  const counts = useMemo(() => countByStatus(entries), [entries]);
  const groups = useMemo(() => groupByType(safeList, { query, status }), [safeList, query, status]);

  function saveEntry(next) {
    // A type typed into the form needs no separate write: normalizeList appends
    // any type a record uses that the list is missing.
    update((l) => ({
      types: l.types,
      entries: l.entries.some((e) => e.id === next.id)
        ? l.entries.map((e) => (e.id === next.id ? next : e))
        : [...l.entries, next],
    }));
    setEditingId(null);
    setAdding(null);
  }

  function deleteEntry(id) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    update((l) => ({ ...l, entries: l.entries.filter((e) => e.id !== id) }));
    setEditingId(null);
  }

  if (user && user.email !== OWNER_EMAIL) return <Navigate to="/" replace />;
  if (!user) return null;

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
          className={styles.btn}
          onClick={() => { setManagingTypes((m) => !m); setAdding(null); setEditingId(null); }}
        >Manage types</button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => { setAdding(emptyEntry()); setEditingId(null); setManagingTypes(false); }}
        >+ Add</button>
      </div>

      {managingTypes && (
        <TypeManager list={safeList} onChange={update} onClose={() => setManagingTypes(false)} />
      )}

      {adding && (
        <div className={styles.formCard}>
          <div className={styles.formTitle}>New record</div>
          <EntryForm
            key={adding.id}
            entry={adding}
            types={safeList.types}
            onSave={saveEntry}
            onCancel={() => setAdding(null)}
          />
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
        <section key={group.type || '__none__'} className={styles.group}>
          <h2 className={styles.groupHead}>
            {typeHeading(group.type)}
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
                    types={safeList.types}
                    onSave={saveEntry}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => deleteEntry(entry.id)}
                  />
                </div>
              ) : (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  groupType={group.type}
                  onEdit={() => { setEditingId(entry.id); setAdding(null); setManagingTypes(false); }}
                />
              )
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

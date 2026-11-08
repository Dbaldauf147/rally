import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  VENUE_FIELDS, VENUE_STATUSES, gmailThreadUrl, mergeScannedVenues, newVenueId,
  normalizeVenue, sortVenues, venueNameKey,
} from '../lib/weddingVenues';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

// The inbox the venue mail goes to. Only a hint for Google's account picker —
// any inbox can be linked.
const DEFAULT_INBOX = 'jodanbaldauf@gmail.com';

const STATUS_CLASS = {
  Researching: vs.stResearching, Inquired: vs.stInquired, Replied: vs.stReplied, 'Tour scheduled': vs.stTour,
  Toured: vs.stToured, 'Quote received': vs.stQuote, Booked: vs.stBooked, 'Not a fit': vs.stNo,
};

async function callVenuesApi(user, body) {
  const token = await user.getIdToken();
  const res = await fetch('/api/wedding-venues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.code = json.code;
    throw err;
  }
  return json;
}

const fmtDate = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00`);
  return isNaN(d) ? ymd : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const fmtWhen = (ts) => {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};
const siteHref = (w) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

/* Wedding venues: the places being considered, filled in from a linked Gmail
   inbox (api/wedding-venues.js reads it; lib/weddingVenues.js folds the
   results in) and editable by hand. Edits in the pop-up save themselves. */
export function WeddingVenues() {
  const { user } = useAuth();
  const [venues, setVenues] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [gmail, setGmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null); // a venue draft, or null

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() || {};
      setVenues(Array.isArray(data.weddingVenues) ? data.weddingVenues.map((v) => normalizeVenue(v)) : []);
      setDismissed(Array.isArray(data.weddingVenueDismissed) ? data.weddingVenueDismissed : []);
      setGmail(data.weddingGmail?.email ? data.weddingGmail : null);
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  // The latest list for writes that happen after a wait (autosave, scans).
  const venuesRef = useRef(venues);
  useEffect(() => { venuesRef.current = venues; }, [venues]);

  const persist = async (next, extra = {}) => {
    if (!user) return;
    venuesRef.current = next;
    setVenues(next);
    await setDoc(doc(db, 'users', user.uid), { weddingVenues: next, ...extra }, { merge: true });
  };

  /* ── Gmail ── */
  const connect = async () => {
    setMessage(null);
    // Opened before the await so the browser treats it as the click's pop-up.
    const popup = window.open('', 'rally-gmail', 'width=520,height=680');
    setBusy('connect');
    try {
      const { url } = await callVenuesApi(user, { action: 'connect', loginHint: gmail?.email || DEFAULT_INBOX });
      if (popup) popup.location.href = url;
      else window.location.href = url;
    } catch (err) {
      popup?.close();
      setBusy('');
      setMessage({ type: 'error', text: err.message });
    }
  };
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'gmail-connected') {
        setBusy('');
        setMessage({ type: 'ok', text: `Connected ${e.data.email}. Scan it to pull in the venues.` });
      } else if (e.data?.type === 'gmail-error') {
        setBusy('');
        setMessage({ type: 'error', text: e.data.error || 'Could not connect Gmail' });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // A pop-up closed without finishing leaves the button spinning otherwise.
  useEffect(() => {
    if (busy !== 'connect') return undefined;
    const t = setTimeout(() => setBusy(''), 120000);
    return () => clearTimeout(t);
  }, [busy]);

  const scan = async ({ full = false } = {}) => {
    setBusy('scan');
    setMessage(null);
    try {
      const res = await callVenuesApi(user, { action: 'scan', full });
      const { list, added, updated } = mergeScannedVenues(venuesRef.current, res.venues, dismissed);
      if (added.length || updated.length) await persist(list);
      const parts = [`Read ${res.threadCount} email thread${res.threadCount === 1 ? '' : 's'}${res.since ? ' since the last scan' : ''}`];
      if (added.length) parts.push(`${added.length} new: ${added.join(', ')}`);
      if (updated.length) parts.push(`${updated.length} updated`);
      if (!added.length && !updated.length) parts.push('nothing new');
      setMessage({ type: 'ok', text: `${parts.join(' · ')}.` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!confirm(`Disconnect ${gmail?.email}? The venues stay; Rally just stops reading the inbox.`)) return;
    setBusy('disconnect');
    try {
      await callVenuesApi(user, { action: 'disconnect' });
      setMessage({ type: 'ok', text: 'Gmail disconnected.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  };

  /* ── Editing (autosaves, like the contact pop-ups) ── */
  const saveTimer = useRef(null);
  const editingRef = useRef(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  const writeDraft = (draft) => {
    if (!draft) return;
    const clean = normalizeVenue(draft);
    if (!clean.name) return; // nothing to file it under yet
    const list = venuesRef.current;
    const at = list.findIndex((v) => v.id === clean.id);
    const prev = at >= 0 ? list[at] : null;
    if (prev && JSON.stringify(prev) === JSON.stringify(clean)) return;
    const next = at >= 0 ? list.map((v, i) => (i === at ? clean : v)) : [...list, clean];
    persist(next).catch((err) => setMessage({ type: 'error', text: `Could not save: ${err.message}` }));
  };
  useEffect(() => {
    if (!editing) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; writeDraft(editingRef.current); }, 600);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const closeEditor = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const draft = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    writeDraft(draft);
  };
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeEditor(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!editing]);
  const setField = (key, value) => setEditing((e) => (e ? { ...e, [key]: value } : e));

  const deleteVenue = async (v) => {
    if (!confirm(`Delete ${v.name || 'this venue'}?${v.source === 'gmail' ? ' A later scan won’t add it back.' : ''}`)) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    editingRef.current = null;
    setEditing(null);
    const key = venueNameKey(v.name);
    const extra = v.source === 'gmail' && key && !dismissed.includes(key)
      ? { weddingVenueDismissed: [...dismissed, key] } : {};
    await persist(venuesRef.current.filter((x) => x.id !== v.id), extra);
  };

  const setStatus = (v, status) => persist(venuesRef.current.map((x) => (x.id === v.id ? { ...x, status } : x)));

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sortVenues(venues).filter((v) => {
      if (statusFilter && v.status !== statusFilter) return false;
      if (!term) return true;
      return [v.name, v.contactName, v.email, v.location, v.notes, v.summary].some((s) => (s || '').toLowerCase().includes(term));
    });
  }, [venues, search, statusFilter]);

  const counts = useMemo(() => {
    const m = new Map();
    venues.forEach((v) => m.set(v.status, (m.get(v.status) || 0) + 1));
    return m;
  }, [venues]);

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        <span className={styles.count}>{venues.length} venue{venues.length === 1 ? '' : 's'}</span>
      </div>
      <p className={styles.subtitle}>Venues you're talking to, pulled from the wedding inbox and kept up to date each time you scan.</p>

      <section className={vs.gmailCard} aria-label="Gmail inbox">
        {gmail ? (
          <>
            <div className={vs.gmailText}>
              <strong>📬 {gmail.email}</strong>
              <span className={styles.muted}>
                {gmail.lastScanAt ? `Last scanned ${fmtWhen(gmail.lastScanAt)}` : 'Not scanned yet'}
              </span>
            </div>
            <div className={vs.gmailActions}>
              <button type="button" className={styles.modalPrimary} onClick={() => scan()} disabled={!!busy}>
                {busy === 'scan' ? 'Scanning…' : 'Scan inbox'}
              </button>
              {gmail.lastScanAt && (
                <button type="button" className={styles.modalSecondary} onClick={() => scan({ full: true })} disabled={!!busy} title="Read the last two years again, not just mail since the last scan">
                  Rescan all
                </button>
              )}
              <button type="button" className={vs.textBtn} onClick={disconnect} disabled={!!busy}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <div className={vs.gmailText}>
              <strong>Connect the wedding inbox</strong>
              <span className={styles.muted}>Sign in as {DEFAULT_INBOX} to let Rally read (never send or delete) venue emails.</span>
            </div>
            <div className={vs.gmailActions}>
              <button type="button" className={styles.modalPrimary} onClick={connect} disabled={!!busy}>
                {busy === 'connect' ? 'Waiting for Google…' : 'Connect Gmail'}
              </button>
            </div>
          </>
        )}
      </section>
      {busy === 'scan' && <p className={styles.muted} role="status">Reading venue emails — this can take a minute.</p>}
      {message && (
        <p className={message.type === 'error' ? styles.digestErrMsg : styles.digestOkMsg} role="status">
          {message.text}{' '}
          <button type="button" className={styles.tierLegendEdit} onClick={() => setMessage(null)}>Dismiss</button>
        </p>
      )}

      <div className={styles.toolbar}>
        <input className={styles.search} placeholder="Search venues…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search venues" />
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {VENUE_STATUSES.map((s) => <option key={s} value={s}>{s}{counts.get(s) ? ` (${counts.get(s)})` : ''}</option>)}
        </select>
        <button type="button" className={styles.toolButton} onClick={() => setEditing(normalizeVenue({ id: newVenueId(), status: 'Researching' }))}>+ Add venue</button>
      </div>

      {shown.length === 0 ? (
        <div className={styles.tableWrap}>
          <p className={vs.empty}>
            {venues.length === 0
              ? (gmail ? 'No venues yet — scan the inbox, or add one by hand.' : 'No venues yet — connect the inbox above, or add one by hand.')
              : 'No venues match.'}
          </p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${vs.venueTable}`}>
              <thead>
                <tr>
                  <th>Venue</th><th>Status</th><th>Contact</th><th>Location</th><th>Pricing</th><th>Next step</th><th>Last contact</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.id}>
                    <td className={styles.nameCell}>
                      <button type="button" className={styles.nameButton} onClick={() => setEditing({ ...v })} title="Edit venue">{v.name}</button>
                      {v.website && <div><a className={styles.link} href={siteHref(v.website)} target="_blank" rel="noreferrer">{v.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></div>}
                    </td>
                    <td>
                      <select className={`${vs.statusSelect} ${STATUS_CLASS[v.status] || ''}`} value={v.status} onChange={(e) => setStatus(v, e.target.value)} aria-label={`Status of ${v.name}`}>
                        {VENUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      {v.contactName && <div>{v.contactName}</div>}
                      {v.email && <div><a className={styles.link} href={`mailto:${v.email}`}>{v.email}</a></div>}
                      {v.phone && <div><a className={styles.link} href={`tel:${v.phone.replace(/[^+\d]/g, '')}`}>{v.phone}</a></div>}
                      {!v.contactName && !v.email && !v.phone && <span className={styles.muted}>—</span>}
                    </td>
                    <td>{v.location || <span className={styles.muted}>—</span>}</td>
                    <td>{v.price || <span className={styles.muted}>—</span>}{v.capacity && <div className={styles.muted}>{v.capacity}</div>}</td>
                    <td>{v.nextStep || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.mono}>
                      {fmtDate(v.lastContactDate) || <span className={styles.muted}>—</span>}
                      {v.threadIds.length > 0 && (
                        <div><a className={styles.link} href={gmailThreadUrl(v.threadIds[v.threadIds.length - 1], gmail?.email)} target="_blank" rel="noreferrer">
                          {v.threadIds.length} email{v.threadIds.length === 1 ? '' : 's'} ↗
                        </a></div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <div className={styles.contactOverlay} onClick={closeEditor}>
          <form
            className={styles.contactModal}
            role="dialog"
            aria-modal="true"
            aria-label="Edit venue"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); closeEditor(); }}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{editing.name || 'New venue'}</h2>
              <button className={styles.modalClose} type="button" onClick={closeEditor} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              {editing.summary && <p className={vs.summary}>{editing.summary}</p>}
              <div className={styles.contactGrid}>
                {VENUE_FIELDS.map((f) => (
                  <label key={f.key} className={f.wide ? `${styles.contactField} ${styles.contactWide}` : styles.contactField}>
                    <span className={styles.contactLabel}>{f.label}</span>
                    {f.key === 'status' ? (
                      <select className={styles.contactInput} value={editing.status} onChange={(e) => setField('status', e.target.value)}>
                        {VENUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : f.multiline ? (
                      <textarea className={styles.contactInput} rows={3} value={editing[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)} />
                    ) : (
                      <input
                        className={styles.contactInput}
                        type={f.type || 'text'}
                        value={editing[f.key] || ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                        autoFocus={f.key === 'name' && !editing.name}
                        autoComplete="off"
                      />
                    )}
                  </label>
                ))}
              </div>
              {editing.threadIds?.length > 0 && (
                <div className={vs.threads}>
                  <span className={styles.contactLabel}>Emails</span>
                  {editing.threadIds.map((t, i) => (
                    <a key={t} className={styles.link} href={gmailThreadUrl(t, gmail?.email)} target="_blank" rel="noreferrer">Thread {i + 1} ↗</a>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              {venues.some((v) => v.id === editing.id) && (
                <button className={styles.bulkDelete} type="button" onClick={() => deleteVenue(editing)}>Delete</button>
              )}
              <span className={styles.modalCount}>{editing.name ? 'Changes save automatically' : 'Give it a name to save it'}</span>
              <button className={styles.modalPrimary} type="submit">Done</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

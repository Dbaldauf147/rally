import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  VENUE_FIELDS, VENUE_STATUSES, gmailThreadUrl, mergeScannedVenues, newVenueId,
  normalizeVenue, venueNameKey,
} from '../lib/weddingVenues';
import {
  addCustomColumn, allVenueColumns, autoMapVenueHeaders, cellValue, guessVenueColumns, looksLikeVenueHeader,
  dropColumn, moveColumn, normalizeColumnConfig, toggleFavoriteColumn, setColumnWidth, planVenuePaste, removeCustomColumn, renameCustomColumn, sortVenueRows,
  toggleColumn, venueSearchUrl, withCellValue,
} from '../lib/venueTable';
import { applyColumnFilters } from '../lib/columnFilters';
import { parsePastedCells } from '../lib/weddingGuestImport';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';
import { VenueReplyDraft } from './VenueReplyDraft';

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

// A paste that spans more than one cell is a range from a spreadsheet, not
// a value for the cell it landed in.
const isGrid = (text) => /\t/.test(text) || /\n\s*\S/.test(String(text).trim());

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

const STAR_COL_WIDTH = 90;

/* One editable cell. Typing stays local and saves when you leave the cell or
   press Enter (Escape puts it back), so a save never lands mid-word. */
function EditCell({ venue, col, gmailEmail, onCommit, onPasteGrid }) {
  const saved = cellValue(venue, col.key);
  const [val, setVal] = useState(saved);
  const [focused, setFocused] = useState(false);
  // The name reads as a link to a Google search; ✎ swaps it for the input.
  const [editingName, setEditingName] = useState(false);
  // A save or scan from elsewhere shows up, unless you're mid-edit here.
  const [seen, setSeen] = useState(saved);
  if (seen !== saved && !focused) {
    setSeen(saved);
    setVal(saved);
  }

  if (col.key === 'emails') {
    return venue.threadIds.length > 0 ? (
      <a className={styles.link} href={gmailThreadUrl(venue.threadIds[venue.threadIds.length - 1], gmailEmail)} target="_blank" rel="noreferrer">
        {venue.threadIds.length} email{venue.threadIds.length === 1 ? '' : 's'} ↗
      </a>
    ) : <span className={styles.muted}>—</span>;
  }
  if (col.key === 'status') {
    return (
      <select className={`${vs.statusSelect} ${STATUS_CLASS[venue.status] || ''}`} value={venue.status} onChange={(e) => onCommit(e.target.value)} aria-label={`Status of ${venue.name}`}>
        {VENUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  }
  if (col.key === 'allInclusive') {
    const opts = ['', 'Yes', 'No', ...(saved && !['Yes', 'No'].includes(saved) ? [saved] : [])];
    return (
      <select className={`${vs.statusSelect} ${saved === 'Yes' ? vs.stBooked : ''}`} value={saved} onChange={(e) => onCommit(e.target.value)} aria-label={`All-inclusive for ${venue.name}`}>
        {opts.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
      </select>
    );
  }
  const commit = () => {
    if (val === saved) return;
    // A venue's name can't be emptied from here — it's what it's filed under.
    if (col.key === 'name' && !val.trim()) setVal(saved);
    else onCommit(val);
  };
  const input = (
    <input
      className={vs.cellInput}
      type={col.key === 'lastContactDate' ? 'date' : 'text'}
      value={val}
      aria-label={`${col.label} for ${venue.name || 'venue'}`}
      onChange={(e) => {
        setVal(e.target.value);
        // A date picker has no "leaving the cell" moment worth waiting for.
        if (col.key === 'lastContactDate') onCommit(e.target.value);
      }}
      autoFocus={editingName}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setEditingName(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') { e.stopPropagation(); setVal(saved); setTimeout(() => e.target.blur(), 0); }
      }}
      onPaste={(e) => {
        const text = e.clipboardData?.getData('text/plain') || '';
        if (isGrid(text)) { e.preventDefault(); onPasteGrid(text); }
      }}
    />
  );
  if (col.key === 'name' && saved && !editingName) {
    return (
      <div className={vs.cellWithLink}>
        <a className={vs.nameLink} href={venueSearchUrl(venue)} target="_blank" rel="noreferrer" title={`Search Google for ${saved}`}>
          {saved}
        </a>
        <button type="button" className={vs.nameEdit} onClick={() => setEditingName(true)} title="Rename" aria-label={`Rename ${saved}`}>✎</button>
      </div>
    );
  }
  const link = !saved ? null
    : col.key === 'email' ? `mailto:${saved}`
      : col.key === 'phone' ? `tel:${saved.replace(/[^+\d]/g, '')}`
        : col.key === 'website' ? siteHref(saved) : null;
  if (!link) return input;
  return (
    <div className={vs.cellWithLink}>
      {input}
      <a className={vs.cellLink} href={link} target={col.key === 'website' ? '_blank' : undefined} rel="noreferrer" title={col.key === 'website' ? 'Open website' : col.key === 'email' ? 'Send email' : 'Call'}>
        {col.key === 'website' ? '↗' : col.key === 'email' ? '✉' : '☎'}
      </a>
    </div>
  );
}

/* Wedding venues: the places being considered, filled in from a linked Gmail
   inbox (api/wedding-venues.js reads it; lib/weddingVenues.js folds the
   results in) and editable by hand. Edits in the pop-up save themselves. */
export function WeddingVenues({ subnav } = {}) {
  const { user } = useAuth();
  const [venues, setVenues] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [gmail, setGmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // a venue draft, or null
  const [replyTo, setReplyTo] = useState(null); // the venue a reply is being drafted for
  // The table's columns: order, hidden, and the ones added by hand.
  const [colConfig, setColConfig] = useState(() => normalizeColumnConfig(null));
  const [colFilters, setColFilters] = useState({});
  const [sort, setSort] = useState(null); // { key, dir } or null = newest contact first
  const [colMenuOpen, setColMenuOpen] = useState(false);
  // Dragging a row of the column picker: which one, and where it'd land.
  const [dragCol, setDragCol] = useState(null);
  const [dropAt, setDropAt] = useState(null); // { key, after }
  const colMenuRef = useRef(null);
  // Pasting a range in: the text, whether its first row is headings, and
  // where each of its columns goes (null = the automatic guess).
  const [pasteText, setPasteText] = useState(null);
  const [pasteHeader, setPasteHeader] = useState(null);
  const [pasteMap, setPasteMap] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() || {};
      setVenues(Array.isArray(data.weddingVenues) ? data.weddingVenues.map((v) => normalizeVenue(v)) : []);
      setDismissed(Array.isArray(data.weddingVenueDismissed) ? data.weddingVenueDismissed : []);
      setGmail(data.weddingGmail?.email ? data.weddingGmail : null);
      setColConfig(normalizeColumnConfig(data.weddingVenueColumns));
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

  const callApi = useCallback((body) => callVenuesApi(user, body), [user]);
  const closeReply = useCallback(() => setReplyTo(null), []);

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

  /* ── The table ── */
  const saveError = (err) => setMessage({ type: 'error', text: `Could not save: ${err.message}` });

  const updateVenue = (id, change) => {
    const next = venuesRef.current.map((x) => (x.id === id ? change(x) : x));
    persist(next).catch(saveError);
  };
  const setCell = (v, key, value) => {
    if (key === 'name' && !String(value).trim()) return;
    updateVenue(v.id, (x) => withCellValue(x, key, value));
  };
  const toggleStar = (v) => updateVenue(v.id, (x) => ({ ...x, starred: !x.starred }));

  const saveColumns = (next, extra = {}) => {
    setColConfig(next);
    if (!user) return Promise.resolve();
    return setDoc(doc(db, 'users', user.uid), { weddingVenueColumns: next, ...extra }, { merge: true }).catch(saveError);
  };
  const addColumn = () => {
    const label = prompt('Name the new column');
    if (!label || !label.trim()) return;
    saveColumns(addCustomColumn(colConfig, label).config);
  };
  const renameColumn = (col) => {
    const label = prompt('Rename column', col.label);
    if (!label || !label.trim()) return;
    saveColumns(renameCustomColumn(colConfig, col.key, label));
  };
  const deleteColumn = async (col) => {
    const used = venues.filter((v) => cellValue(v, col.key)).length;
    if (!confirm(`Delete the “${col.label}” column?${used ? ` Its values on ${used} venue${used === 1 ? '' : 's'} go too.` : ''}`)) return;
    const list = venuesRef.current.map((v) => {
      if (!v.custom?.[col.key]) return v;
      const custom = { ...v.custom };
      delete custom[col.key];
      return { ...v, custom };
    });
    venuesRef.current = list;
    setVenues(list);
    setColFilters((f) => { const n = { ...f }; delete n[col.key]; return n; });
    if (sort?.key === col.key) setSort(null);
    await saveColumns(removeCustomColumn(colConfig, col.key), { weddingVenues: list });
  };

  useEffect(() => {
    if (!colMenuOpen) return undefined;
    const onDown = (e) => { if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colMenuOpen]);

  const columns = useMemo(() => allVenueColumns(colConfig), [colConfig]);
  const visible = useMemo(() => columns.filter((c) => !c.hidden), [columns]);

  /* Dragging a header's right edge. The width follows the pointer locally and
     is saved once, when you let go. A click right after a drag isn't a sort. */
  const colConfigRef = useRef(colConfig);
  useEffect(() => { colConfigRef.current = colConfig; }, [colConfig]);
  const justResized = useRef(false);
  const startResize = (e, col) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = col.width;
    document.body.classList.add('rally-col-resizing');
    let width = w0;
    const onMove = (ev) => {
      width = w0 + ev.clientX - x0;
      setColConfig((c) => setColumnWidth(c, col.key, width));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('rally-col-resizing');
      justResized.current = true;
      setTimeout(() => { justResized.current = false; }, 0);
      // From the drag's own last width: the ref can be a render behind.
      if (width !== w0) saveColumns(setColumnWidth(colConfigRef.current, col.key, width));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };
  const resetWidth = (e, col) => {
    e.stopPropagation();
    const c = normalizeColumnConfig(colConfigRef.current);
    const widths = { ...c.widths };
    delete widths[col.key];
    saveColumns(normalizeColumnConfig({ ...c, widths }));
  };
  const tableWidth = STAR_COL_WIDTH + visible.reduce((sum, c) => sum + c.width, 0);

  const clickSort = (key) => { if (justResized.current) return; doSort(key); };
  const doSort = (key) => setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = sortVenueRows(venues, sort);
    if (term) {
      rows = rows.filter((v) => [v.name, v.contactName, v.email, v.location, v.notes, v.summary, ...Object.values(v.custom || {})]
        .some((x) => (x || '').toLowerCase().includes(term)));
    }
    const { star, status, ...text } = colFilters;
    if (star) rows = rows.filter((v) => (star === 'starred' ? v.starred : !v.starred));
    if (status) rows = rows.filter((v) => v.status === status);
    const textOf = (v, key) => (key === 'lastContactDate' ? `${v.lastContactDate} ${fmtDate(v.lastContactDate)}` : cellValue(v, key));
    return applyColumnFilters(rows, text, textOf, ['phone']);
  }, [venues, search, sort, colFilters]);
  const filtersOn = Object.values(colFilters).some((x) => String(x || '').trim());

  /* ── Pasting a spreadsheet range ── */
  const openPaste = (text = '') => {
    setPasteText(text);
    setPasteHeader(null);
    setPasteMap(null);
  };
  const closePaste = () => setPasteText(null);
  // Pasting anywhere on the tab (not into a box) opens the dialog with it.
  useEffect(() => {
    const onPaste = (e) => {
      if (pasteText !== null || editing || isTyping(document.activeElement)) return;
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text.trim()) return;
      e.preventDefault();
      openPaste(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pasteText, editing]);

  const pasteRows = useMemo(() => parsePastedCells(pasteText || '').filter((r) => r.some((c) => String(c).trim())), [pasteText]);
  const pasteWidth = Math.max(0, ...pasteRows.map((r) => r.length));
  const hasHeader = pasteHeader ?? looksLikeVenueHeader(pasteRows);
  const pasteBody = hasHeader ? pasteRows.slice(1) : pasteRows;
  const pasteHeads = hasHeader ? pasteRows[0] || [] : [];
  const autoMap = useMemo(() => {
    const m = hasHeader ? autoMapVenueHeaders(pasteRows[0], colConfig.custom) : guessVenueColumns(pasteRows);
    return Array.from({ length: pasteWidth }, (_, i) => m[i] || '');
  }, [pasteRows, hasHeader, pasteWidth, colConfig.custom]);
  const mapping = pasteMap && pasteMap.length === pasteWidth ? pasteMap : autoMap;
  const setMapAt = (i, key) => setPasteMap(mapping.map((k, j) => (j === i ? key : k === key && key && key !== 'new' ? '' : k)));
  const newColName = (i) => String(pasteHeads[i] || '').trim() || `Column ${i + 1}`;

  // 'new' columns become real ones; the preview uses stand-in keys.
  const resolveMapping = (config, makeKey) => {
    let cfg = config;
    const keys = mapping.map((k, i) => {
      if (k !== 'new') return k;
      const { config: c, key } = addCustomColumn(cfg, newColName(i), makeKey ? makeKey(i) : undefined);
      cfg = c;
      return key;
    });
    return { config: cfg, keys };
  };
  const pastePlan = useMemo(() => {
    if (pasteText === null || !pasteBody.length) return null;
    const { keys } = resolveMapping(colConfig, (i) => `c_preview${i}`);
    return planVenuePaste(venues, pasteBody, keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteText, pasteBody, mapping, venues, colConfig]);

  const applyPaste = async () => {
    const { config, keys } = resolveMapping(colConfig);
    const { list, added, updated, skipped } = planVenuePaste(venuesRef.current, pasteBody, keys, { makeId: newVenueId });
    closePaste();
    try {
      setColConfig(config);
      await persist(list, { weddingVenueColumns: config });
      const parts = [];
      if (added.length) parts.push(`${added.length} venue${added.length === 1 ? '' : 's'} added`);
      if (updated.length) parts.push(`${updated.length} updated`);
      if (skipped) parts.push(`${skipped} row${skipped === 1 ? '' : 's'} with no venue name skipped`);
      setMessage({ type: 'ok', text: `${parts.join(' · ') || 'Nothing new in that paste'}.` });
    } catch (err) {
      saveError(err);
    }
  };

  const fieldOptions = columns.filter((c) => !c.readOnly);

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        <span className={styles.count}>{venues.length} venue{venues.length === 1 ? '' : 's'}</span>
      </div>
      {subnav}
      <p className={styles.subtitle}>Venues you're talking to, pulled from the wedding inbox and kept up to date each time you scan.</p>

      <section className={vs.gmailCard} aria-label="Gmail inbox">
        {gmail ? (
          <>
            <div className={vs.gmailText}>
              <strong>📬 {gmail.email}</strong>
              <span className={styles.muted}>
                {gmail.lastScanAt ? `Last scanned ${fmtWhen(gmail.lastScanAt)}` : 'Not scanned yet'}
                {gmail.lastAutoScan?.error ? ` · Daily scan failed: ${gmail.lastAutoScan.error}`
                  : gmail.lastAutoScan?.added?.length ? ` · Daily scan added ${gmail.lastAutoScan.added.join(', ')}` : ''}
              </span>
              <label className={vs.autoScan} title="Rally scans this inbox for you every morning and adds what it finds">
                <input
                  type="checkbox"
                  checked={gmail.autoScan !== false}
                  onChange={(e) => setDoc(doc(db, 'users', user.uid), { weddingGmail: { autoScan: e.target.checked } }, { merge: true }).catch(saveError)}
                />
                Scan automatically every day at 9 AM (Eastern)
              </label>
              {gmail.canDraft !== true && (
                <span className={styles.muted}>
                  To save reply drafts to this inbox, <button type="button" className={styles.tierLegendEdit} onClick={connect} disabled={!!busy}>reconnect Gmail</button> and allow drafts.
                </span>
              )}
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
        {filtersOn && <button type="button" className={styles.toolButton} onClick={() => setColFilters({})}>Clear filters</button>}
        <div className={styles.colMenu} ref={colMenuRef}>
          <button type="button" className={styles.toolButton} onClick={() => setColMenuOpen((o) => !o)} aria-expanded={colMenuOpen}>Columns ▾</button>
          {colMenuOpen && (
            <div className={`${styles.colMenuPopover} ${vs.colMenu}`} role="menu" aria-label="Columns">
              <p className={vs.colMenuHint}>Tick to show · ★ to pin to the left · drag to reorder</p>
              {columns.map((col, i) => {
                const moved = (dir) => moveColumn(colConfig, col.key, dir);
                const same = (c) => c.order.join() === colConfig.order.join();
                const dropClass = dropAt?.key === col.key && dragCol && dragCol !== col.key
                  ? (dropAt.after ? vs.dropAfter : vs.dropBefore) : '';
                const lastFav = col.favorite && !columns[i + 1]?.favorite;
                return (
                  <div
                    key={col.key}
                    className={`${vs.colMenuRow} ${dragCol === col.key ? vs.colDragging : ''} ${dropClass} ${lastFav ? vs.colLastFav : ''}`}
                    draggable
                    data-col={col.key}
                    onDragStart={(e) => {
                      setDragCol(col.key);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', col.key);
                    }}
                    onDragOver={(e) => {
                      if (!dragCol) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const r = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > r.top + r.height / 2;
                      if (dropAt?.key !== col.key || dropAt.after !== after) setDropAt({ key: col.key, after });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragCol && dropAt) saveColumns(dropColumn(colConfig, dragCol, dropAt.key, dropAt.after));
                      setDragCol(null);
                      setDropAt(null);
                    }}
                    onDragEnd={() => { setDragCol(null); setDropAt(null); }}
                  >
                    <span className={vs.dragHandle} aria-hidden="true" title="Drag to reorder">⋮⋮</span>
                    <button
                      type="button"
                      className={col.favorite ? vs.colStarOn : vs.colStar}
                      onClick={() => saveColumns(toggleFavoriteColumn(colConfig, col.key))}
                      aria-pressed={col.favorite}
                      aria-label={col.favorite ? `Unstar ${col.label}` : `Star ${col.label}`}
                      title={col.favorite ? 'Unstar' : 'Star — pins it to the left of the table'}
                    >
                      {col.favorite ? '★' : '☆'}
                    </button>
                    <label className={vs.colMenuLabel}>
                      <input type="checkbox" checked={!col.hidden} onChange={() => saveColumns(toggleColumn(colConfig, col.key))} />
                      <span>{col.label}</span>
                    </label>
                    {col.custom && (
                      <>
                        <button type="button" className={vs.iconBtn} onClick={() => renameColumn(col)} title="Rename" aria-label={`Rename ${col.label}`}>✎</button>
                        <button type="button" className={vs.iconBtn} onClick={() => deleteColumn(col)} title="Delete column" aria-label={`Delete ${col.label}`}>🗑</button>
                      </>
                    )}
                    <button type="button" className={vs.iconBtn} disabled={col.hidden || same(moved(-1))} onClick={() => saveColumns(moved(-1))} title="Move left" aria-label={`Move ${col.label} left`}>↑</button>
                    <button type="button" className={vs.iconBtn} disabled={col.hidden || same(moved(1))} onClick={() => saveColumns(moved(1))} title="Move right" aria-label={`Move ${col.label} right`}>↓</button>
                  </div>
                );
              })}
              <button type="button" className={vs.colMenuAdd} onClick={addColumn}>+ Add column</button>
            </div>
          )}
        </div>
        <button type="button" className={styles.toolButton} onClick={() => openPaste('')} title="Paste a range copied from Google Sheets or Excel">📋 Paste from sheet</button>
        <button type="button" className={styles.toolButton} onClick={() => setEditing(normalizeVenue({ id: newVenueId(), status: 'Researching' }))}>+ Add venue</button>
      </div>

      {venues.length === 0 ? (
        <div className={styles.tableWrap}>
          <p className={vs.empty}>
            {gmail ? 'No venues yet — scan the inbox, add one by hand, or paste rows from a spreadsheet.' : 'No venues yet — connect the inbox above, add one by hand, or paste rows from a spreadsheet.'}
          </p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <div className={`${styles.tableScroll} ${vs.venueScroll}`}>
            <table className={`${styles.table} ${vs.venueTable}`} style={{ width: tableWidth }}>
              <colgroup>
                <col style={{ width: STAR_COL_WIDTH }} />
                {visible.map((col) => <col key={col.key} style={{ width: col.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className={vs.starCol} onClick={() => setColFilters((f) => ({ ...f, star: f.star === 'starred' ? '' : 'starred' }))} title="Show only starred venues">★</th>
                  {visible.map((col) => (
                    <th key={col.key} className={vs.resizableTh} onClick={() => clickSort(col.key)} aria-sort={sort?.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} title={col.label}>
                      {col.label}
                      {sort?.key === col.key && <span className={styles.sortArrow}>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                      <span
                        className={vs.resizer}
                        onPointerDown={(e) => startResize(e, col)}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => resetWidth(e, col)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${col.label}`}
                        title="Drag to resize · double-click to reset"
                      />
                    </th>
                  ))}
                </tr>
                <tr className={styles.filterRow}>
                  <th className={vs.starCol}>
                    <select className={styles.filterSelect} value={colFilters.star || ''} onChange={(e) => setColFilters((f) => ({ ...f, star: e.target.value }))} aria-label="Filter by star">
                      <option value="">All</option>
                      <option value="starred">★</option>
                      <option value="unstarred">☆</option>
                    </select>
                  </th>
                  {visible.map((col) => (
                    <th key={col.key}>
                      {col.key === 'status' ? (
                        <select className={styles.filterSelect} value={colFilters.status || ''} onChange={(e) => setColFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Filter by status">
                          <option value="">All</option>
                          {VENUE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                      ) : (
                        <input className={styles.filterInput} value={colFilters[col.key] || ''} onChange={(e) => setColFilters((f) => ({ ...f, [col.key]: e.target.value }))} placeholder="Filter…" aria-label={`Filter ${col.label}`} />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={visible.length + 1} className={vs.empty}>No venues match.</td></tr>
                )}
                {shown.map((v) => (
                  <tr key={v.id} className={v.starred ? vs.starredRow : undefined}>
                    <td className={vs.starCol}>
                      <button type="button" className={v.starred ? vs.starOn : vs.star} onClick={() => toggleStar(v)} aria-pressed={v.starred} aria-label={v.starred ? `Unstar ${v.name}` : `Star ${v.name}`} title={v.starred ? 'Unstar' : 'Star — keeps it at the top'}>
                        {v.starred ? '★' : '☆'}
                      </button>
                      <button type="button" className={vs.openBtn} onClick={() => setEditing({ ...v })} title="Open venue details" aria-label={`Open ${v.name}`}>⤢</button>
                      <button type="button" className={vs.draftBtn} onClick={() => setReplyTo(v)} title="Draft a reply with your wedding details" aria-label={`Draft a reply to ${v.name}`}>✉</button>
                    </td>
                    {visible.map((col) => (
                      <td key={col.key} className={vs.cell}>
                        <EditCell venue={v} col={col} gmailEmail={gmail?.email} onCommit={(val) => setCell(v, col.key, val)} onPasteGrid={openPaste} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className={styles.muted + ' ' + vs.tableHint}>Click a cell to edit it, or a venue name to search Google for it (✎ renames). Copy a range from Google Sheets or Excel and paste it onto the page to add or update venues.</p>

      {pasteText !== null && (
        <div className={styles.modalOverlay} onClick={closePaste}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Paste venues from a spreadsheet" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Paste venues from a spreadsheet</h2>
              <button className={styles.modalClose} type="button" onClick={closePaste} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Copy a range of cells from Google Sheets or Excel and paste it here, then say where each column goes.
                Venues already on the list (same name or email) are updated with the pasted values; blank cells leave
                what's there alone. Everything else is added.
              </p>
              <textarea
                className={styles.modalTextarea}
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPasteMap(null); setPasteHeader(null); }}
                placeholder={'Paste here — e.g.\nVenue\tContact\tEmail\tPrice\nThe Foundry\tMaria\tmaria@foundry.com\t$12,000'}
                rows={5}
                autoFocus
                aria-label="Pasted cells"
              />
              {pasteWidth > 0 && (
                <>
                  <label className={styles.modalCheckRow}>
                    <input type="checkbox" checked={hasHeader} onChange={(e) => { setPasteHeader(e.target.checked); setPasteMap(null); }} />
                    First row is headings
                  </label>
                  <div className={styles.mapScroll}>
                    <table className={styles.mapTable}>
                      <thead>
                        <tr>
                          {Array.from({ length: pasteWidth }).map((_, i) => (
                            <th key={i}>
                              <select className={styles.mapSelect} value={mapping[i] || ''} onChange={(e) => setMapAt(i, e.target.value)} aria-label={`Column ${i + 1} goes to`}>
                                <option value="">— Skip —</option>
                                {fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                                <option value="new">+ New column “{newColName(i)}”</option>
                              </select>
                            </th>
                          ))}
                        </tr>
                        {hasHeader && (
                          <tr>{Array.from({ length: pasteWidth }).map((_, i) => <th key={i} className={styles.mapHeaderCell}>{pasteHeads[i]}</th>)}</tr>
                        )}
                      </thead>
                      <tbody>
                        {pasteBody.slice(0, 5).map((r, ri) => (
                          <tr key={ri}>{Array.from({ length: pasteWidth }).map((_, i) => <td key={i}>{r[i]}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pasteBody.length > 5 && <p className={styles.modalHint}>…and {pasteBody.length - 5} more row{pasteBody.length - 5 === 1 ? '' : 's'}.</p>}
                  {!mapping.includes('name') && <p className={styles.digestErrMsg}>Pick which column is the Venue — rows are matched and filed by it.</p>}
                </>
              )}
            </div>
            <div className={styles.modalFooter}>
              <span className={styles.modalCount}>
                {!pastePlan ? 'Paste cells to begin'
                  : `${pastePlan.added.length} new · ${pastePlan.updated.length} updated${pastePlan.skipped ? ` · ${pastePlan.skipped} without a name skipped` : ''}`}
              </span>
              <button className={styles.modalSecondary} type="button" onClick={closePaste}>Cancel</button>
              <button className={styles.modalPrimary} type="button" onClick={applyPaste} disabled={!pastePlan || !mapping.includes('name') || (!pastePlan.added.length && !pastePlan.updated.length)}>
                Import
              </button>
            </div>
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
                    ) : f.type === 'yesno' ? (
                      <select className={styles.contactInput} value={editing[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)}>
                        {['', 'Yes', 'No', ...(editing[f.key] && !['Yes', 'No'].includes(editing[f.key]) ? [editing[f.key]] : [])].map((o) => <option key={o} value={o}>{o || 'Not known'}</option>)}
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
                {colConfig.custom.map((c) => (
                  <label key={c.key} className={styles.contactField}>
                    <span className={styles.contactLabel}>{c.label}</span>
                    <input
                      className={styles.contactInput}
                      value={editing.custom?.[c.key] || ''}
                      onChange={(e) => setEditing((d) => (d ? { ...d, custom: { ...(d.custom || {}), [c.key]: e.target.value } } : d))}
                      autoComplete="off"
                    />
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
              {venues.some((v) => v.id === editing.id) && (
                <button className={styles.modalSecondary} type="button" onClick={() => { const v = editing; closeEditor(); setReplyTo(v); }}>✉ Draft reply</button>
              )}
              <span className={styles.modalCount}>{editing.name ? 'Changes save automatically' : 'Give it a name to save it'}</span>
              <button className={styles.modalPrimary} type="submit">Done</button>
            </div>
          </form>
        </div>
      )}
      {replyTo && (
        <VenueReplyDraft
          venue={replyTo}
          gmail={gmail}
          callApi={callApi}
          onReconnect={connect}
          onClose={closeReply}
        />
      )}
    </div>
  );
}

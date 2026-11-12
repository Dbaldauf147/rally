import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  VENUE_FIELDS, VENUE_STATUSES, gmailThreadUrl, mergeScannedVenues, newVenueId,
  cleanMoney, formatAvailableDate, normalizeDateList, normalizeVenue, venueNameKey,
  REACH_VIAS, reachedLabel, withReachedOut,
} from '../lib/weddingVenues';
import {
  addCustomColumn, allVenueColumns, autoMapVenueHeaders, cellValue, guessVenueColumns, looksLikeVenueHeader,
  canDeleteColumn, deleteBuiltinColumn, deletedColumns, restoreColumn, dropColumn, moveColumn, normalizeColumnConfig, toggleFavoriteColumn, setColumnWidth, planVenuePaste, removeCustomColumn, renameCustomColumn, sortVenueRows,
  toggleColumn, venueSearchUrl, withCellValue, foldGuestYesNoColumn,
} from '../lib/venueTable';
import { applyColumnFilters } from '../lib/columnFilters';
import { parsePastedCells } from '../lib/weddingGuestImport';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';
import { VenueReplyDraft } from './VenueReplyDraft';
import { VenueNoFitPrompt } from './VenueNoFitPrompt';
import { VenueMapsImport } from './VenueMapsImport';
import { extractMapsLinks, mapsSearchUrl } from '../lib/venueMaps';
import { bulkNoFitReasons, formatReasons, noFitReasonList, noFitReasonOptions, normalizeReasonList, renameReasons, standardReason } from '../lib/venueNoFit';
import { NO_AREA, areaName, normalizeAreas, unmappedVenues, venueArea } from '../lib/venueAreas';
import { HIDDEN, REACHED_OUT, TO_VISIT, bulkSetField, rowsToTsv, venueExportRows } from '../lib/venueBulk';

// The bulk bar's Reasons-not-a-fit choice (add / remove / clear one reason).
const NO_FIT_REASONS = { key: 'noFitReasons', label: 'Reasons not a fit' };

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

const EyeOff = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const Eye = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// A flag: outlined, or filled once the venue is tagged as a place to visit.
const Flag = ({ on }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

// A tick in a circle: outlined, or filled once we've reached out to the venue.
// The filled circle says how: an envelope for email, a globe for their website.
const Reached = ({ on, via = '' }) => {
  const ink = on ? '#fff' : 'currentColor';
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill={on ? 'currentColor' : 'none'} stroke="currentColor" />
      {on && via === 'email' ? (
        <g stroke={ink} strokeWidth="1.6"><rect x="6.5" y="8" width="11" height="8" rx="1" /><path d="M7 9l5 3.6L17 9" /></g>
      ) : on && via === 'website' ? (
        <g stroke={ink} strokeWidth="1.5"><circle cx="12" cy="12" r="5.2" /><path d="M6.8 12h10.4" /><ellipse cx="12" cy="12" rx="2.2" ry="5.2" /></g>
      ) : <path d="M7.5 12.5l3 3 6-6.5" stroke={ink} />}
    </svg>
  );
};

const STAR_COL_WIDTH = 172;

/* Which of the couple's locations a venue is in: matched from its address
   ("Auto"), or picked. A venue that matches none is flagged ⚠ until a
   keyword is added for its town or a location is picked for it. */
function AreaSelect({ venue, areas, onCommit, className = '' }) {
  if (!areas.length) return <span className={styles.muted} title="Set up your locations on the Locations tab">—</span>;
  const r = venueArea(venue, areas);
  const warn = r.how === 'unmapped';
  const auto = venueArea({ ...venue, area: '' }, areas);
  const title = warn
    ? `“${venue.location || venue.name}” doesn't match any of your locations — add a keyword for it on the Locations tab, or pick one here`
    : r.how === 'auto' ? `Matched on “${r.term}”` : r.how === 'manual' ? 'Picked by hand' : 'Marked as in none of your locations';
  return (
    <select
      className={`${vs.statusSelect} ${warn ? vs.areaUnmapped : r.how === 'none' ? '' : vs.areaMapped} ${className}`}
      value={venue.area && (venue.area === NO_AREA || areas.some((a) => a.id === venue.area)) ? venue.area : ''}
      onChange={(e) => onCommit(e.target.value)}
      aria-label={`Area of ${venue.name}`}
      title={title}
    >
      <option value="">{auto.area ? auto.area.name : '⚠ Can’t map'}</option>
      {areas.map((a) => <option key={a.id} value={a.id}>{a.name} (picked)</option>)}
      <option value={NO_AREA}>None of these</option>
    </select>
  );
}

/* The venue pop-up's Dates available: each open date as a chip with ✕, and a
   date picker to add another. Saved as a sorted list of YYYY-MM-DD. */
function DateListEditor({ dates, onChange }) {
  const [draft, setDraft] = useState('');
  const list = normalizeDateList(dates);
  const add = () => {
    if (!draft) return;
    onChange(normalizeDateList([...list, draft]));
    setDraft('');
  };
  return (
    <span className={vs.dateList}>
      {list.length === 0 && <span className={styles.muted}>None yet</span>}
      {list.map((d) => (
        <span key={d} className={vs.dateChip}>
          {formatAvailableDate(d)}
          <button type="button" className={vs.dateChipX} onClick={(e) => { e.preventDefault(); onChange(list.filter((x) => x !== d)); }} aria-label={`Remove ${formatAvailableDate(d)}`}>✕</button>
        </span>
      ))}
      <span className={vs.dateAdd}>
        <input
          type="date"
          className={styles.contactInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          aria-label="Add a date available"
        />
        <button type="button" className={vs.dateAddBtn} onClick={(e) => { e.preventDefault(); add(); }} disabled={!draft}>Add date</button>
      </span>
    </span>
  );
}

/* One editable cell. Typing stays local and saves when you leave the cell or
   press Enter (Escape puts it back), so a save never lands mid-word. */
function EditCell({ venue, col, gmailEmail, onCommit, onPasteGrid, onNoFitWhy, whyHasColumn = false, areas = [] }) {
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

  if (col.key === 'area') return <AreaSelect venue={venue} areas={areas} onCommit={onCommit} />;
  if (col.key === 'noFit') {
    if (venue.status !== 'Not a fit') return <span className={styles.muted} title="Only for venues marked Not a fit">—</span>;
    const why = venue.noFitReasons || [];
    return (
      <button type="button" className={`${vs.noFitCell} ${why.length ? '' : vs.noFitWhyEmpty}`} onClick={onNoFitWhy} title={[formatReasons(why, '\n'), venue.noFitNotes].filter(Boolean).join('\n') || 'Say why it isn’t a fit'} aria-label={`Why ${venue.name} isn’t a fit`}>
        <span className={vs.noFitCellReasons}>{why.length ? formatReasons(why) : '+ Why not a fit?'}</span>
        {venue.noFitNotes && <span className={vs.noFitNote}>{venue.noFitNotes}</span>}
      </button>
    );
  }
  if (col.key === 'emails') {
    return venue.threadIds.length > 0 ? (
      <a className={styles.link} href={gmailThreadUrl(venue.threadIds[venue.threadIds.length - 1], gmailEmail)} target="_blank" rel="noreferrer">
        {venue.threadIds.length} email{venue.threadIds.length === 1 ? '' : 's'} ↗
      </a>
    ) : <span className={styles.muted}>—</span>;
  }
  if (col.key === 'status') {
    const select = (
      <select className={`${vs.statusSelect} ${STATUS_CLASS[venue.status] || ''}`} value={venue.status} onChange={(e) => onCommit(e.target.value)} aria-label={`Status of ${venue.name}`}>
        {VENUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    );
    // With the "Why not a fit" column on the table, the reasons live there.
    if (venue.status !== 'Not a fit' || whyHasColumn) return select;
    const why = venue.noFitReasons || [];
    return (
      <>
        {select}
        <button type="button" className={`${vs.noFitWhy} ${why.length ? '' : vs.noFitWhyEmpty}`} onClick={onNoFitWhy} title="Why it isn't a fit — click to change">
          {why.length ? formatReasons(why) : '+ Why not a fit?'}
          {venue.noFitNotes && <span className={vs.noFitNote} title={venue.noFitNotes}>{venue.noFitNotes}</span>}
        </button>
      </>
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
      className={col.type === 'money' ? `${vs.cellInput} ${vs.moneyInput}` : vs.cellInput}
      type={col.key === 'lastContactDate' ? 'date' : 'text'}
      inputMode={col.type === 'money' ? 'decimal' : undefined}
      placeholder={col.type === 'money' ? '—' : col.type === 'dates' ? 'e.g. 6/12/2027; 6/19/2027' : undefined}
      title={col.type === 'dates' ? 'Dates the venue has open — separate them with ; or ,' : undefined}
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
        : col.key === 'website' || col.key === 'mapsUrl' ? siteHref(saved) : null;
  if (!link) return input;
  const opens = col.key === 'website' || col.key === 'mapsUrl';
  return (
    <div className={vs.cellWithLink}>
      {input}
      <a className={vs.cellLink} href={link} target={opens ? '_blank' : undefined} rel="noreferrer" title={col.key === 'mapsUrl' ? 'Open in Google Maps' : col.key === 'website' ? 'Open website' : col.key === 'email' ? 'Send email' : 'Call'}>
        {opens ? '↗' : col.key === 'email' ? '✉' : '☎'}
      </a>
    </div>
  );
}

/* Wedding venues: the places being considered, filled in from a linked Gmail
   inbox (api/wedding-venues.js reads it; lib/weddingVenues.js folds the
   results in) and editable by hand. Edits in the pop-up save themselves. */
/* `hiddenOnly`: the Venues → Hidden subtab, the same table showing only the
   venues hidden from All venues (the eye button brings one back). */
export function WeddingVenues({ subnav, hiddenOnly = false } = {}) {
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const [venues, setVenues] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [gmail, setGmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // a venue draft, or null
  const [replyTo, setReplyTo] = useState(null); // the venue a reply is being drafted for
  // The couple's list of locations, and whether its editor is open.
  const [areas, setAreas] = useState([]);
  // The reasons offered for "Not a fit", as the user has edited them.
  const [noFitList, setNoFitList] = useState([]);
  // The "why not a fit?" pop-up: the venue, and whether it came from the
  // table or the venue pop-up (which saves through its own draft).
  const [noFitFor, setNoFitFor] = useState(null); // { venue, from: 'table' | 'editor' }
  // The table's columns: order, hidden, and the ones added by hand.
  const [colConfig, setColConfig] = useState(() => normalizeColumnConfig(null));
  const [colFilters, setColFilters] = useState({});
  // Which venues the table shows: the hidden ones on the Hidden subtab; on
  // All venues the ones not hidden, or every one with the first column's All.
  const showing = hiddenOnly ? 'hidden' : colFilters.shown === 'all' ? 'all' : '';
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
  const fileRef = useRef(null);
  // The rows ticked for a bulk change, and the change being set up.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkKey, setBulkKey] = useState('status');
  const [bulkValue, setBulkValue] = useState('');
  // Reasons not a fit, in bulk: add / remove / clear, and which reason.
  const [bulkNoFitMode, setBulkNoFitMode] = useState('add');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkReasonNew, setBulkReasonNew] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() || {};
      const loaded = Array.isArray(data.weddingVenues) ? data.weddingVenues.map((v) => normalizeVenue(v)) : [];
      // One-time: a hand-made yes/no "Holds my guests" column becomes the
      // built-in Max guests column, saved so it only happens once.
      const folded = foldGuestYesNoColumn(data.weddingVenueColumns, loaded);
      if (folded.changed) {
        setDoc(doc(db, 'users', user.uid), { weddingVenues: folded.venues, weddingVenueColumns: folded.config }, { merge: true })
          .catch((err) => console.error('Could not save the Max guests column', err));
      }
      setVenues(folded.venues);
      setDismissed(Array.isArray(data.weddingVenueDismissed) ? data.weddingVenueDismissed : []);
      setGmail(data.weddingGmail?.email ? data.weddingGmail : null);
      setColConfig(folded.changed ? folded.config : normalizeColumnConfig(data.weddingVenueColumns));
      setAreas(normalizeAreas(data.weddingVenueAreas));
      setNoFitList(noFitReasonList(data, folded.venues));
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
    // Marking a venue Not a fit asks why first; Cancel leaves it as it was.
    if (key === 'status' && value === 'Not a fit' && v.status !== 'Not a fit') {
      setNoFitFor({ venue: v, from: 'table' });
      return;
    }
    updateVenue(v.id, (x) => withCellValue(x, key, value));
  };
  // Hiding takes a row off the table (not off the list); Undo puts it back.
  const setHidden = (v, hidden) => {
    updateVenue(v.id, (x) => ({ ...x, hidden }));
    setMessage(hidden
      ? { type: 'ok', text: `Hid ${v.name}. Hidden venues are on the Hidden tab.`, undo: () => setHidden(v, false) }
      : { type: 'ok', text: `${v.name} is back on the table.` });
  };

  // The flag: this is a place to go and see. Separate from the status, so a
  // venue can be tagged before anyone has written to it, or after a tour.
  const setToVisit = (v, toVisit) => updateVenue(v.id, (x) => ({ ...x, toVisit }));
  // The tick: we've reached out to this venue. A venue still being
  // researched moves to Inquired with it (lib/weddingVenues.js).
  const setReachedOut = (v, on, via) => updateVenue(v.id, (x) => normalizeVenue(withReachedOut(x, on, undefined, via)));
  // The tick's little menu — emailed, or via their website — placed by the
  // button it came from (fixed, so the table's scroll box can't clip it).
  const [reachMenu, setReachMenu] = useState(null); // { id, top, left }
  const reachMenuRef = useRef(null);
  const openReachMenu = (e, v) => {
    const r = e.currentTarget.getBoundingClientRect();
    setReachMenu((m) => (m?.id === v.id ? null : { id: v.id, top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 228)) }));
  };
  useEffect(() => {
    if (!reachMenu) return undefined;
    const close = () => setReachMenu(null);
    const onDown = (e) => { if (!reachMenuRef.current?.contains(e.target) && !e.target.closest?.('[data-reach-btn]')) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [reachMenu]);
  const reachMenuVenue = reachMenu ? venues.find((v) => v.id === reachMenu.id) : null;

  /* ── Not a fit: why ── */
  const noFitOptions = useMemo(
    () => noFitReasonOptions(noFitList, noFitFor ? venues.filter((v) => v.id !== noFitFor.venue.id) : venues),
    [noFitList, venues, noFitFor],
  );
  const closeNoFit = useCallback(() => setNoFitFor(null), []);
  const saveNoFit = (reasons, newReasons, noFitNotes = '') => {
    const { venue, from } = noFitFor;
    setNoFitFor(null);
    const extra = {};
    if (newReasons.length) {
      const nextList = normalizeReasonList([...noFitList, ...newReasons]);
      setNoFitList(nextList);
      extra.weddingVenueNoFitReasonList = nextList;
    }
    if (from === 'editor') {
      setEditing((d) => (d ? { ...d, status: 'Not a fit', noFitReasons: reasons, noFitNotes } : d));
      if (extra.weddingVenueNoFitReasonList && user) setDoc(doc(db, 'users', user.uid), extra, { merge: true }).catch(saveError);
      return;
    }
    const next = venuesRef.current.map((x) => (x.id === venue.id ? normalizeVenue({ ...x, status: 'Not a fit', noFitReasons: reasons, noFitNotes }) : x));
    persist(next, extra).catch(saveError);
  };
  // The list edited in the pop-up: saved whole, and renames carried onto
  // every venue (and the open venue's draft) that has the old name.
  const editNoFitList = (list, renames) => {
    setNoFitList(list);
    const has = Object.keys(renames).length > 0;
    const rename = (v) => (has && v.noFitReasons?.length ? { ...v, noFitReasons: renameReasons(v.noFitReasons, renames) } : v);
    if (has) {
      setEditing((d) => (d ? rename(d) : d));
      setNoFitFor((f) => (f ? { ...f, venue: rename(f.venue) } : f));
    }
    const next = has ? venuesRef.current.map((v) => (v.noFitReasons?.length ? normalizeVenue(rename(v)) : v)) : venuesRef.current;
    persist(next, { weddingVenueNoFitReasonList: list }).catch(saveError);
  };

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
  // Any column can be deleted but the venue's name. One you added goes with
  // its values; a built-in one leaves the table and can be restored.
  const forgetColumn = (key) => {
    setColFilters((f) => { const n = { ...f }; delete n[key]; return n; });
    if (sort?.key === key) setSort(null);
  };
  const deleteAnyColumn = (col) => {
    if (col.custom) { deleteColumn(col); return; }
    if (!confirm(`Delete the “${col.label}” column from the table?\n\nWhat's in it stays on each venue — it's still in the venue's pop-up — and you can bring the column back from Columns → Deleted columns.`)) return;
    forgetColumn(col.key);
    saveColumns(deleteBuiltinColumn(colConfig, col.key));
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
  const whyHasColumn = visible.some((c) => c.key === 'noFit');

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
    let rows = sortVenueRows(venues, sort, { valueFor: (v, key) => (key === 'area' ? areaName(v, areas) : cellValue(v, key)) });
    if (term) {
      rows = rows.filter((v) => [v.name, v.contactName, v.email, v.location, areaName(v, areas), v.notes, v.summary, ...Object.values(v.custom || {})]
        .some((x) => (x || '').toLowerCase().includes(term)));
    }
    const { shown: _shown, status, area, visit, reached, ...text } = colFilters;
    // Hidden venues have their own subtab; All venues leaves them out unless
    // the first column's filter says All.
    if (showing === 'hidden') rows = rows.filter((v) => v.hidden);
    else if (showing !== 'all') rows = rows.filter((v) => !v.hidden);
    if (status) rows = rows.filter((v) => v.status === status);
    if (visit) rows = rows.filter((v) => v.toVisit);
    if (reached) rows = rows.filter((v) => v.reachedOut === (reached === 'yes'));
    if (area) {
      rows = rows.filter((v) => {
        const r = venueArea(v, areas);
        return area === 'unmapped' ? r.how === 'unmapped' : area === NO_AREA ? r.how === 'none' : r.area?.id === area;
      });
    }
    const textOf = (v, key) => (key === 'lastContactDate' ? `${v.lastContactDate} ${fmtDate(v.lastContactDate)}` : cellValue(v, key));
    return applyColumnFilters(rows, text, textOf, ['phone']);
  }, [venues, search, sort, colFilters, areas, showing]);
  // The venues on the table that match none of the locations.
  const unmapped = useMemo(() => unmappedVenues(venues.filter((v) => !v.hidden), areas), [venues, areas]);
  // The locations are edited on their own tab, Wedding → Locations.
  const openLocations = () => setSearchParams({ view: 'locations' });
  const filtersOn = Object.values(colFilters).some((x) => String(x || '').trim());
  const hiddenCount = venues.filter((v) => v.hidden).length;
  // Hidden ones aren't counted: the button's number is the rows it leads to.
  const toVisitCount = venues.filter((v) => v.toVisit && !v.hidden).length;
  const reachedCount = venues.filter((v) => v.reachedOut && !v.hidden).length;
  const notReachedCount = venues.filter((v) => !v.reachedOut && !v.hidden).length;
  // Subtabs by status. The tab is the Status column's filter, not a second
  // one beside it, so the tab and the column header can never disagree.
  // Empty statuses get no tab unless you're on it.
  // Counted over the venues the hide filter lets through, so they match the rows.
  const statusTabs = useMemo(() => {
    const pool = showing === 'all' ? venues : venues.filter((v) => (showing === 'hidden' ? v.hidden : !v.hidden));
    const counts = new Map(VENUE_STATUSES.map((st) => [st, 0]));
    for (const v of pool) if (counts.has(v.status)) counts.set(v.status, counts.get(v.status) + 1);
    return [
      { value: '', label: 'All', count: pool.length },
      ...VENUE_STATUSES.filter((st) => counts.get(st) > 0 || colFilters.status === st)
        .map((st) => ({ value: st, label: st, count: counts.get(st) })),
    ];
  }, [venues, colFilters.status, showing]);
  const activeStatusTab = colFilters.status || '';

  /* ── Pasting a spreadsheet range ── */
  const openPaste = (text = '') => {
    setPasteText(text);
    setPasteHeader(null);
    setPasteMap(null);
  };
  const closePaste = () => setPasteText(null);

  /* ── From Google Maps ── */
  const [mapsText, setMapsText] = useState(null); // the links to start with, or null when closed
  const closeMaps = useCallback(() => setMapsText(null), []);
  // What the pop-up settled on: new venues added, ones already here filled in.
  const addFromMaps = async (picks) => {
    setMapsText(null);
    const list = [...venuesRef.current];
    const added = [];
    const updated = [];
    for (const { fields, existingId } of picks) {
      const at = existingId ? list.findIndex((v) => v.id === existingId) : -1;
      if (at < 0) {
        list.push(normalizeVenue({ id: newVenueId(), status: 'Researching', source: 'manual', ...fields }));
        added.push(fields.name);
        continue;
      }
      // Already on the list: the link is saved, and only blanks are filled.
      const cur = list[at];
      const next = normalizeVenue({
        ...cur,
        location: cur.location || fields.location, phone: cur.phone || fields.phone, website: cur.website || fields.website,
        mapsUrl: fields.mapsUrl || cur.mapsUrl,
      });
      if (JSON.stringify(next) !== JSON.stringify(cur)) { list[at] = next; updated.push(cur.name); }
    }
    if (!added.length && !updated.length) { setMessage({ type: 'ok', text: 'Those venues were already up to date.' }); return; }
    try {
      await persist(list);
      const parts = [];
      if (added.length) parts.push(`Added ${added.join(', ')}`);
      if (updated.length) parts.push(`updated ${updated.join(', ')}`);
      setMessage({ type: 'ok', text: `${parts.join(' · ')} from Google Maps.` });
    } catch (err) { saveError(err); }
  };
  // Pasting anywhere on the tab (not into a box) opens the dialog with it.
  useEffect(() => {
    const onPaste = (e) => {
      if (pasteText !== null || mapsText !== null || editing || isTyping(document.activeElement)) return;
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text.trim()) return;
      e.preventDefault();
      // A Google Maps link is a place to add, not rows of a sheet.
      if (extractMapsLinks(text).length && !isGrid(text.replace(/\n/g, ' '))) setMapsText(text);
      else openPaste(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pasteText, mapsText, editing]);

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
    return planVenuePaste(venues, pasteBody, keys, { areas });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteText, pasteBody, mapping, venues, colConfig, areas]);

  const applyPaste = async () => {
    const { config, keys } = resolveMapping(colConfig);
    const { list, added, updated, skipped } = planVenuePaste(venuesRef.current, pasteBody, keys, { makeId: newVenueId, areas });
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

  // Where a pasted column can go: the typed columns, plus the two a sheet
  // can also set — the place-to-visit flag and (by name) the location.
  const fieldOptions = [
    ...columns.filter((c) => !c.readOnly),
    ...(columns.some((c) => c.key === 'noFit') ? [{ key: 'noFit', label: 'Why not a fit' }] : []),
    TO_VISIT,
    REACHED_OUT,
    ...(areas.length ? [{ key: 'area', label: 'Area' }] : []),
  ];

  /* ── A file instead of a paste ── */
  const importFile = async (file) => {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      // A CSV is read as written, so "3/4" or a phone number isn't reinterpreted.
      const isText = /\.(csv|tsv|txt)$/i.test(file.name);
      const wb = isText ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: false });
      if (!rows.length) throw new Error('the file has no rows');
      openPaste(rowsToTsv(rows));
    } catch (err) {
      setMessage({ type: 'error', text: `Could not read ${file.name}: ${err.message}` });
    }
  };

  /* ── Bulk: tick rows, then change, export or delete them together ── */
  // Only venues still on the list count (one may have been deleted since).
  const picked = venues.filter((v) => selected.has(v.id));
  const shownIds = shown.map((v) => v.id);
  const allShownPicked = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const somePicked = shownIds.some((id) => selected.has(id));
  const togglePick = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAllShown = () => setSelected((s) => {
    const n = new Set(s);
    for (const id of shownIds) { if (allShownPicked) n.delete(id); else n.add(id); }
    return n;
  });
  const clearPicked = () => setSelected(new Set());

  const bulkFields = [
    { key: 'status', label: 'Status' },
    NO_FIT_REASONS,
    TO_VISIT,
    REACHED_OUT,
    HIDDEN,
    ...(areas.length ? [{ key: 'area', label: 'Area' }] : []),
    ...columns.filter((c) => !c.readOnly && c.key !== 'name' && c.key !== 'status').map((c) => ({ key: c.key, label: c.label, type: c.type })),
  ];
  const bulkField = bulkFields.find((f) => f.key === bulkKey) || bulkFields[0];
  const BULK_CHOICES = {
    status: VENUE_STATUSES.map((st) => [st, st]),
    toVisit: [['Yes', 'Yes — flag them'], ['No', 'No — remove the flag']],
    reachedOut: [['Emailed', 'Yes — emailed'], ['Website', 'Yes — via their website'], ['Yes', 'Yes — however it was'], ['No', 'No — not yet']],
    hidden: [['Yes', 'Yes — hide them'], ['No', 'No — show them']],
    allInclusive: [['Yes', 'Yes'], ['No', 'No'], ['', 'Not known (clear)']],
    area: [...areas.map((a) => [a.id, a.name]), [NO_AREA, 'None of these'], ['', 'Match from the address']],
  };
  const bulkChoices = BULK_CHOICES[bulkField.key] || null;
  const bulkVal = bulkChoices ? (bulkChoices.some(([val]) => val === bulkValue) ? bulkValue : bulkChoices[0][0]) : bulkValue;
  const n = picked.length;
  const these = `${n} venue${n === 1 ? '' : 's'}`;

  const NEW_REASON = '__new';
  const pickedReason = bulkNoFitMode === 'clear' ? ''
    : (bulkReason === NEW_REASON || !noFitList.length ? bulkReasonNew : (bulkReason || noFitList[0] || ''));
  const applyBulkNoFit = async () => {
    const before = venuesRef.current;
    const reason = standardReason(pickedReason, noFitList);
    if (bulkNoFitMode !== 'clear' && !reason) { setMessage({ type: 'error', text: 'Pick or type a reason first.' }); return; }
    const next = bulkNoFitReasons(before, new Set(picked.map((v) => v.id)), bulkNoFitMode, reason, noFitList).map((v, i) => (v === before[i] ? v : normalizeVenue(v)));
    const changed = next.filter((v, i) => v !== before[i]).length;
    if (!changed) { setMessage({ type: 'ok', text: `Nothing to change — ${these} already had that.` }); return; }
    const was = new Map(before.filter((v, i) => v !== next[i]).map((v) => [v.id, v]));
    // A reason typed in here joins the list, like one typed in the pop-up.
    const extra = {};
    if (bulkNoFitMode === 'add' && !noFitList.some((r) => r === reason)) {
      const nextList = normalizeReasonList([...noFitList, reason]);
      setNoFitList(nextList);
      extra.weddingVenueNoFitReasonList = nextList;
    }
    try {
      await persist(next, extra);
      const on = `${changed} venue${changed === 1 ? '' : 's'}`;
      setMessage({
        type: 'ok',
        text: bulkNoFitMode === 'add' ? `Added “${reason}” on ${on} (and marked them Not a fit).`
          : bulkNoFitMode === 'remove' ? `Removed “${reason}” from ${on}.` : `Cleared the reasons on ${on}.`,
        undo: () => { persist(venuesRef.current.map((v) => was.get(v.id) || v)).catch(saveError); setMessage(null); },
      });
      setBulkReasonNew('');
    } catch (err) { saveError(err); }
  };

  const applyBulk = async () => {
    if (bulkField.key === NO_FIT_REASONS.key) return applyBulkNoFit();
    const before = venuesRef.current;
    const next = bulkSetField(before, new Set(picked.map((v) => v.id)), bulkField.key, bulkVal);
    const changed = next.filter((v, i) => v !== before[i]).length;
    if (!changed) { setMessage({ type: 'ok', text: `Nothing to change — ${these} already had that.` }); return; }
    const was = new Map(before.filter((v, i) => v !== next[i]).map((v) => [v.id, v]));
    try {
      await persist(next);
      const shownValue = bulkChoices ? bulkChoices.find(([val]) => val === bulkVal)[1].split(' — ')[0] : bulkVal.trim();
      setMessage({
        type: 'ok',
        text: shownValue ? `Set ${bulkField.label} to “${shownValue}” on ${changed} venue${changed === 1 ? '' : 's'}.` : `Cleared ${bulkField.label} on ${changed} venue${changed === 1 ? '' : 's'}.`,
        undo: () => { persist(venuesRef.current.map((v) => was.get(v.id) || v)).catch(saveError); setMessage(null); },
      });
    } catch (err) { saveError(err); }
  };
  const deletePicked = async () => {
    if (!n || !confirm(`Delete ${these}? Ones that came from the inbox won’t be added back by a later scan.`)) return;
    const ids = new Set(picked.map((v) => v.id));
    const keys = picked.filter((v) => v.source === 'gmail').map((v) => venueNameKey(v.name)).filter((k) => k && !dismissed.includes(k));
    try {
      await persist(venuesRef.current.filter((v) => !ids.has(v.id)), keys.length ? { weddingVenueDismissed: [...dismissed, ...new Set(keys)] } : {});
      clearPicked();
      setMessage({ type: 'ok', text: `Deleted ${these}.` });
    } catch (err) { saveError(err); }
  };

  // The ticked rows, else the rows on screen, as an Excel file with every
  // column — which an import reads straight back.
  const exportRows = n ? picked : shown;
  const exportVenues = async () => {
    try {
      const XLSX = await import('xlsx');
      const rows = venueExportRows(exportRows, colConfig, areas);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = rows[0].map((h, i) => ({ wch: Math.min(40, Math.max(h.length + 2, ...rows.slice(1).map((r) => String(r[i] || '').length + 1))) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Venues');
      const d = new Date();
      XLSX.writeFile(wb, `wedding-venues-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`);
      setMessage({ type: 'ok', text: `Exported ${exportRows.length} venue${exportRows.length === 1 ? '' : 's'}. Edit the file, then Import it to update them.` });
    } catch (err) {
      setMessage({ type: 'error', text: `Could not export: ${err.message}` });
    }
  };

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        <span className={styles.count}>
          {venues.length} venue{venues.length === 1 ? '' : 's'}{toVisitCount ? ` · ${toVisitCount} to visit` : ''}{reachedCount ? ` · ${reachedCount} reached out` : ''}{hiddenCount ? ` · ${hiddenCount} hidden` : ''}
        </span>
      </div>
      {subnav}

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
              <label className={vs.autoScan} title="Rally scans this inbox for you every morning at 9 AM (Eastern) and adds what it finds">
                <input
                  type="checkbox"
                  checked={gmail.autoScan !== false}
                  onChange={(e) => setDoc(doc(db, 'users', user.uid), { weddingGmail: { autoScan: e.target.checked } }, { merge: true }).catch(saveError)}
                />
                Daily scan, 9 AM ET
              </label>
              {gmail.canDraft !== true && (
                <span className={styles.muted} title="To save reply drafts to this inbox, reconnect Gmail and allow drafts.">
                  <button type="button" className={styles.tierLegendEdit} onClick={connect} disabled={!!busy}>Reconnect Gmail</button> to save drafts
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
      {busy === 'scan' && <p className={`${vs.scanMsg} ${styles.muted}`} role="status">Reading venue emails — this can take a minute.</p>}
      {message && (
        <p className={`${vs.scanMsg} ${message.type === 'error' ? styles.digestErrMsg : styles.digestOkMsg}`} role="status">
          {message.text}{' '}
          {message.undo && <button type="button" className={styles.tierLegendEdit} onClick={message.undo}>Undo</button>}{' '}
          <button type="button" className={styles.tierLegendEdit} onClick={() => setMessage(null)}>Dismiss</button>
        </p>
      )}
      {unmapped.length > 0 && (
        <p className={vs.areaBanner} role="status" title={unmapped.map((v) => v.name).join(', ')}>
          ⚠ {unmapped.length} venue{unmapped.length === 1 ? '' : 's'} can&apos;t be mapped to any of your locations.{' '}
          <button type="button" className={styles.tierLegendEdit} onClick={() => setColFilters((f) => ({ ...f, area: 'unmapped', shown: '' }))}>Show them</button>{' · '}
          <button type="button" className={styles.tierLegendEdit} onClick={openLocations}>Edit locations</button>
        </p>
      )}

      {venues.length > 0 && (
        <div className={styles.categoryTabs} role="tablist" aria-label="Venues by status">
          {statusTabs.map((t) => (
            <button
              key={t.value || '__all__'}
              type="button"
              role="tab"
              aria-selected={activeStatusTab === t.value}
              className={activeStatusTab === t.value ? styles.categoryTabActive : styles.categoryTab}
              onClick={() => setColFilters((f) => ({ ...f, status: t.value }))}
            >
              {t.label}
              <span className={styles.categoryTabCount}>{t.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.toolbar}>
        <input className={styles.search} placeholder="Search venues…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search venues" />
        {venues.length > 0 && (
          <button
            type="button"
            className={`${styles.toolButton} ${colFilters.visit ? styles.toolButtonOn : ''}`}
            onClick={() => setColFilters((f) => ({ ...f, visit: f.visit ? '' : 'yes' }))}
            aria-pressed={!!colFilters.visit}
            title={colFilters.visit ? 'Showing only the places to visit — click to show every venue' : 'Show only the venues flagged as places to visit'}
          >
            <span className={vs.visitChip}><Flag on={!!colFilters.visit} /> To visit{toVisitCount ? ` (${toVisitCount})` : ''}</span>
          </button>
        )}
        {venues.length > 0 && (
          <button
            type="button"
            className={`${styles.toolButton} ${colFilters.reached ? styles.toolButtonOn : ''}`}
            onClick={() => setColFilters((f) => ({ ...f, reached: !f.reached ? 'yes' : f.reached === 'yes' ? 'no' : '' }))}
            aria-pressed={!!colFilters.reached}
            title={!colFilters.reached ? 'Show only the venues you’ve reached out to — click again for the ones you haven’t'
              : colFilters.reached === 'yes' ? 'Showing the venues you’ve reached out to — click for the ones you haven’t' : 'Showing the venues you haven’t reached out to — click to show every venue'}
          >
            <span className={vs.visitChip}>
              <Reached on={colFilters.reached === 'yes'} />
              {colFilters.reached === 'no' ? `Not reached out (${notReachedCount})` : `Reached out${reachedCount ? ` (${reachedCount})` : ''}`}
            </span>
          </button>
        )}
        {filtersOn && <button type="button" className={styles.toolButton} onClick={() => setColFilters({})}>Clear filters</button>}
        <div className={styles.colMenu} ref={colMenuRef}>
          <button type="button" className={styles.toolButton} onClick={() => setColMenuOpen((o) => !o)} aria-expanded={colMenuOpen}>Columns ▾</button>
          {colMenuOpen && (
            <div className={`${styles.colMenuPopover} ${vs.colMenu}`} role="menu" aria-label="Columns">
              <p className={vs.colMenuHint}>Tick to show · ★ to pin to the left · drag to reorder · 🗑 to delete</p>
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
                      <button type="button" className={vs.iconBtn} onClick={() => renameColumn(col)} title="Rename" aria-label={`Rename ${col.label}`}>✎</button>
                    )}
                    {canDeleteColumn(col.key) && (
                      <button type="button" className={vs.iconBtn} onClick={() => deleteAnyColumn(col)} title={col.custom ? 'Delete column and its values' : 'Delete column from the table'} aria-label={`Delete ${col.label}`}>🗑</button>
                    )}
                    <button type="button" className={vs.iconBtn} disabled={col.hidden || same(moved(-1))} onClick={() => saveColumns(moved(-1))} title="Move left" aria-label={`Move ${col.label} left`}>↑</button>
                    <button type="button" className={vs.iconBtn} disabled={col.hidden || same(moved(1))} onClick={() => saveColumns(moved(1))} title="Move right" aria-label={`Move ${col.label} right`}>↓</button>
                  </div>
                );
              })}
              <button type="button" className={vs.colMenuAdd} onClick={addColumn}>+ Add column</button>
              {deletedColumns(colConfig).length > 0 && (
                <div className={vs.colDeleted} role="group" aria-label="Deleted columns">
                  <p className={vs.colMenuHint}>Deleted columns</p>
                  {deletedColumns(colConfig).map((col) => (
                    <div key={col.key} className={vs.colMenuRow}>
                      <span className={vs.colDeletedLabel}>{col.label}</span>
                      <button type="button" className={vs.colRestore} onClick={() => saveColumns(restoreColumn(colConfig, col.key))} aria-label={`Restore ${col.label}`}>Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button type="button" className={styles.toolButton} onClick={openLocations} title="The locations each venue is matched to — opens Wedding → Locations">📍 Locations{areas.length ? ` (${areas.length})` : ''}</button>
        {venues.length > 0 && (
          <button type="button" className={styles.toolButton} onClick={exportVenues} disabled={!exportRows.length} title={n ? `Download the ${these} you ticked as an Excel file` : 'Download the venues shown as an Excel file — tick rows to export only those'}>
            ⬇ Export{n ? ` (${n})` : ''}
          </button>
        )}
        <button type="button" className={styles.toolButton} onClick={() => openPaste('')} title="Add or update venues from an Excel or CSV file, or a range pasted from a spreadsheet">⬆ Import</button>
        <button type="button" className={styles.toolButton} onClick={() => setMapsText('')} title="Add venues by pasting links from Google Maps (Share → Copy link)">🗺 From Google Maps</button>
        <button type="button" className={styles.toolButton} onClick={() => setEditing(normalizeVenue({ id: newVenueId(), status: 'Researching' }))}>+ Add venue</button>
      </div>

      {n > 0 && (
        <div className={styles.bulkBar} role="region" aria-label="Bulk edit">
          <span className={styles.bulkCount}>{n} selected</span>
          <span className={styles.bulkLabel}>Set</span>
          <select className={styles.bulkInput} style={{ minWidth: 0 }} value={bulkField.key} onChange={(e) => { setBulkKey(e.target.value); setBulkValue(''); }} aria-label="Field to change">
            {bulkFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          {bulkField.key === NO_FIT_REASONS.key ? (
            <>
              <select className={styles.bulkInput} style={{ minWidth: 0 }} value={bulkNoFitMode} onChange={(e) => setBulkNoFitMode(e.target.value)} aria-label="Add, remove or clear">
                <option value="add">Add reason (marks them Not a fit)</option>
                <option value="remove">Remove reason</option>
                <option value="clear">Clear all reasons</option>
              </select>
              {bulkNoFitMode !== 'clear' && noFitList.length > 0 && (
                <select className={styles.bulkInput} value={bulkReason || noFitList[0]} onChange={(e) => setBulkReason(e.target.value)} aria-label="Reason">
                  {noFitList.map((r) => <option key={r} value={r}>{r}</option>)}
                  {bulkNoFitMode === 'add' && <option value={NEW_REASON}>New reason…</option>}
                </select>
              )}
              {bulkNoFitMode === 'add' && (bulkReason === NEW_REASON || !noFitList.length) && (
                <input
                  className={styles.bulkInput}
                  value={bulkReasonNew}
                  onChange={(e) => setBulkReasonNew(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyBulk(); }}
                  placeholder="Type the reason"
                  aria-label="New reason"
                  maxLength={60}
                />
              )}
            </>
          ) : <span className={styles.bulkLabel}>to</span>}
          {bulkField.key === NO_FIT_REASONS.key ? null : bulkChoices ? (
            <select className={styles.bulkInput} value={bulkVal} onChange={(e) => setBulkValue(e.target.value)} aria-label="New value">
              {bulkChoices.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          ) : (
            <input
              className={styles.bulkInput}
              type={bulkField.key === 'lastContactDate' ? 'date' : 'text'}
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyBulk(); }}
              placeholder="Leave blank to clear"
              aria-label="New value"
            />
          )}
          <button type="button" className={styles.bulkApply} onClick={applyBulk}>Apply to {n}</button>
          <button type="button" className={styles.bulkDelete} onClick={deletePicked}>Delete</button>
          <button type="button" className={styles.bulkClear} onClick={clearPicked}>Clear selection</button>
        </div>
      )}

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
                  <th className={vs.starCol} title="Tick venues to change, export or delete them together. Flag one as a place to visit, hide it to take it off the table without deleting it, or tick the circle once you’ve reached out">
                    <input
                      type="checkbox"
                      className={vs.pick}
                      checked={allShownPicked}
                      ref={(el) => { if (el) el.indeterminate = somePicked && !allShownPicked; }}
                      onChange={toggleAllShown}
                      disabled={!shownIds.length}
                      aria-label={allShownPicked ? 'Untick every venue shown' : `Tick all ${shownIds.length} venues shown`}
                    />
                    Visit · Hide
                  </th>
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
                    {!hiddenOnly && (
                      <select className={styles.filterSelect} value={showing} onChange={(e) => setColFilters((f) => ({ ...f, shown: e.target.value }))} aria-label="Show hidden venues" title="Hidden venues are on the Hidden tab; All shows them here too">
                        <option value="">Shown</option>
                        <option value="all">All{hiddenCount ? ` (+${hiddenCount} hidden)` : ''}</option>
                      </select>
                    )}
                  </th>
                  {visible.map((col) => (
                    <th key={col.key}>
                      {col.key === 'status' ? (
                        <select className={styles.filterSelect} value={colFilters.status || ''} onChange={(e) => setColFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Filter by status">
                          <option value="">All</option>
                          {VENUE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                      ) : col.key === 'area' ? (
                        <select className={styles.filterSelect} value={colFilters.area || ''} onChange={(e) => setColFilters((f) => ({ ...f, area: e.target.value }))} aria-label="Filter by area">
                          <option value="">All</option>
                          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          {areas.length > 0 && <option value="unmapped">⚠ Can’t map{unmapped.length ? ` (${unmapped.length})` : ''}</option>}
                          {areas.length > 0 && <option value={NO_AREA}>None of these</option>}
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
                  <tr><td colSpan={visible.length + 1} className={vs.empty}>
                    {hiddenOnly ? (hiddenCount ? 'No hidden venues match.' : 'No hidden venues. The eye button on a row in All venues hides one here.')
                      : colFilters.visit && !toVisitCount ? 'No places to visit yet — flag a venue in the first column to add it here.' : 'No venues match.'}
                  </td></tr>
                )}
                {shown.map((v) => (
                  <tr key={v.id} className={`${v.hidden ? vs.hiddenRow : ''} ${selected.has(v.id) ? vs.pickedRow : ''}`}>
                    <td className={vs.starCol}>
                      <input type="checkbox" className={vs.pick} checked={selected.has(v.id)} onChange={() => togglePick(v.id)} aria-label={`Select ${v.name}`} />
                      <button
                        type="button"
                        className={v.toVisit ? vs.visitBtnOn : vs.visitBtn}
                        onClick={() => setToVisit(v, !v.toVisit)}
                        aria-pressed={v.toVisit}
                        aria-label={v.toVisit ? `${v.name} is a place to visit — remove the flag` : `Flag ${v.name} as a place to visit`}
                        title={v.toVisit ? 'A place to visit — click to remove the flag' : 'Flag as a place to visit'}
                      >
                        <Flag on={v.toVisit} />
                      </button>
                      <button
                        type="button"
                        className={v.hidden ? vs.unhideBtn : vs.hideBtn}
                        onClick={() => setHidden(v, !v.hidden)}
                        aria-label={v.hidden ? `Show ${v.name} again` : `Hide ${v.name}`}
                        title={v.hidden ? 'Show it on the table again' : 'Hide — takes it off the table, keeps it on the list'}
                      >
                        {v.hidden ? <Eye /> : <EyeOff />}
                      </button>
                      <button
                        type="button"
                        className={v.reachedOut ? vs.reachedBtnOn : vs.reachedBtn}
                        data-reach-btn
                        onClick={(e) => openReachMenu(e, v)}
                        aria-pressed={v.reachedOut}
                        aria-haspopup="menu"
                        aria-expanded={reachMenu?.id === v.id}
                        aria-label={v.reachedOut ? `${reachedLabel(v)}: ${v.name} — change` : `Mark ${v.name} as reached out`}
                        title={v.reachedOut ? `${reachedLabel(v)}${v.reachedOutDate ? ` on ${fmtDate(v.reachedOutDate)}` : ''} — click to change` : 'Mark that we’ve reached out — by email, or via their website'}
                      >
                        <Reached on={v.reachedOut} via={v.reachedOutVia} />
                      </button>
                      <button type="button" className={vs.openBtn} onClick={() => setEditing({ ...v })} title="Open venue details" aria-label={`Open ${v.name}`}>⤢</button>
                      <button type="button" className={vs.draftBtn} onClick={() => setReplyTo(v)} title="Draft an outreach email with your wedding details" aria-label={`Draft an outreach email to ${v.name}`}>✉</button>
                    </td>
                    {visible.map((col) => (
                      <td key={col.key} className={vs.cell}>
                        <EditCell venue={v} col={col} areas={areas} gmailEmail={gmail?.email} onCommit={(val) => setCell(v, col.key, val)} onPasteGrid={openPaste} onNoFitWhy={() => setNoFitFor({ venue: v, from: 'table' })} whyHasColumn={whyHasColumn} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className={styles.muted + ' ' + vs.tableHint}>Tick venues to change, export or delete several at once. Flag a venue in the first column to tag it as a place to visit. Click a cell to edit it, or a venue name to search Google for it (✎ renames). Copy a range from Google Sheets or Excel and paste it onto the page to add or update venues.</p>

      {pasteText !== null && (
        <div className={styles.modalOverlay} onClick={closePaste}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Import venues from a spreadsheet" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Import venues from a spreadsheet</h2>
              <button className={styles.modalClose} type="button" onClick={closePaste} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Choose an Excel or CSV file — an export from this page works as it is — or copy a range of cells from
                Google Sheets or Excel and paste it below, then say where each column goes.
                Venues already on the list (same name or email) are updated with the new values; blank cells leave
                what's there alone. Everything else is added.
              </p>
              <p className={vs.importFile}>
                <button type="button" className={styles.modalSecondary} onClick={() => fileRef.current?.click()}>Choose a file…</button>
                <span className={styles.muted}>.xlsx, .xls or .csv</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt"
                  hidden
                  aria-label="Spreadsheet file to import"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; importFile(f); }}
                />
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
              <label className={`${styles.modalCheckRow} ${vs.visitCheck}`}>
                <input type="checkbox" checked={!!editing.toVisit} onChange={(e) => setField('toVisit', e.target.checked)} />
                <Flag on={!!editing.toVisit} /> A place to visit
              </label>
              <label className={`${styles.modalCheckRow} ${vs.visitCheck} ${vs.reachedCheck}`}>
                <input type="checkbox" checked={!!editing.reachedOut} onChange={(e) => setEditing((d) => (d ? withReachedOut(d, e.target.checked) : d))} />
                <Reached on={!!editing.reachedOut} via={editing.reachedOutVia} /> We’ve reached out{editing.reachedOut && editing.reachedOutDate ? ` · ${fmtDate(editing.reachedOutDate)}` : ''}
                {editing.reachedOut && (
                  <select
                    className={vs.reachedVia}
                    value={editing.reachedOutVia || ''}
                    onChange={(e) => setField('reachedOutVia', e.target.value)}
                    aria-label="How we reached out"
                  >
                    <option value="">How?</option>
                    <option value="email">By email</option>
                    <option value="website">Via their website</option>
                  </select>
                )}
              </label>
              <div className={styles.contactGrid}>
                {VENUE_FIELDS.map((f) => {
                  // Not a <label> for the date list: a click on its label text
                  // would press the first chip's ✕.
                  const Field = f.type === 'dates' ? 'div' : 'label';
                  return (
                  <Field key={f.key} className={f.wide ? `${styles.contactField} ${styles.contactWide}` : styles.contactField}>
                    <span className={styles.contactLabel}>{f.label}</span>
                    {f.key === 'status' ? (
                      <>
                        <select
                          className={styles.contactInput}
                          value={editing.status}
                          onChange={(e) => {
                            if (e.target.value === 'Not a fit' && editing.status !== 'Not a fit') setNoFitFor({ venue: editing, from: 'editor' });
                            else setField('status', e.target.value);
                          }}
                        >
                          {VENUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {editing.status === 'Not a fit' && (
                          <span className={vs.noFitDetail}>
                            {editing.noFitReasons?.length ? formatReasons(editing.noFitReasons) : 'No reason given yet.'}
                            <button type="button" className={vs.noFitWhy} onClick={(e) => { e.preventDefault(); setNoFitFor({ venue: editing, from: 'editor' }); }}>
                              {editing.noFitReasons?.length ? 'Change' : '+ Why?'}
                            </button>
                            {editing.noFitNotes && <span className={vs.noFitDetailNote}>{editing.noFitNotes}</span>}
                          </span>
                        )}
                      </>
                    ) : f.type === 'dates' ? (
                      <DateListEditor dates={editing.availableDates || []} onChange={(list) => setField('availableDates', list)} />
                    ) : f.type === 'yesno' ? (
                      <select className={styles.contactInput} value={editing[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)}>
                        {['', 'Yes', 'No', ...(editing[f.key] && !['Yes', 'No'].includes(editing[f.key]) ? [editing[f.key]] : [])].map((o) => <option key={o} value={o}>{o || 'Not known'}</option>)}
                      </select>
                    ) : f.multiline ? (
                      <textarea className={styles.contactInput} rows={3} value={editing[f.key] || ''} onChange={(e) => setField(f.key, e.target.value)} />
                    ) : (
                      <input
                        className={styles.contactInput}
                        type={f.type === 'money' ? 'text' : f.type || 'text'}
                        inputMode={f.type === 'money' ? 'decimal' : undefined}
                        onBlur={f.type === 'money' ? (e) => setField(f.key, cleanMoney(e.target.value)) : undefined}
                        value={editing[f.key] || ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                        autoFocus={f.key === 'name' && !editing.name}
                        autoComplete="off"
                      />
                    )}
                  </Field>
                  );
                })}
                {areas.length > 0 && (
                  <label className={styles.contactField}>
                    <span className={styles.contactLabel}>Area</span>
                    <AreaSelect venue={editing} areas={areas} onCommit={(val) => setField('area', val)} className={vs.areaSelectWide} />
                  </label>
                )}
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
              {(editing.mapsUrl || mapsSearchUrl(editing)) && (
                <div className={vs.threads}>
                  <a className={styles.link} href={editing.mapsUrl ? siteHref(editing.mapsUrl) : mapsSearchUrl(editing)} target="_blank" rel="noreferrer">
                    {editing.mapsUrl ? '🗺 Open in Google Maps ↗' : '🗺 Find on Google Maps ↗'}
                  </a>
                </div>
              )}
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
      {mapsText !== null && (
        <VenueMapsImport venues={venues} callApi={callApi} initialText={mapsText} onAdd={addFromMaps} onClose={closeMaps} />
      )}
      {reachMenu && reachMenuVenue && (
        <div ref={reachMenuRef} className={vs.reachMenu} role="menu" aria-label={`How we reached out to ${reachMenuVenue.name}`} style={{ top: reachMenu.top, left: reachMenu.left }}>
          <p className={vs.reachMenuHead}>{reachMenuVenue.reachedOut ? `${reachedLabel(reachMenuVenue)}${reachMenuVenue.reachedOutDate ? ` · ${fmtDate(reachMenuVenue.reachedOutDate)}` : ''}` : 'We reached out…'}</p>
          {REACH_VIAS.map((via) => {
            const current = reachMenuVenue.reachedOut && reachMenuVenue.reachedOutVia === via.key;
            return (
              <button key={via.key} type="button" role="menuitemradio" aria-checked={current} className={current ? vs.reachMenuItemOn : vs.reachMenuItem} onClick={() => { setReachedOut(reachMenuVenue, true, via.key); setReachMenu(null); }}>
                <span className={vs.reachMenuIcon}><Reached on via={via.key} /></span>
                {via.key === 'email' ? 'By email' : 'Via their website'}
              </button>
            );
          })}
          {reachMenuVenue.reachedOut && (
            <button type="button" role="menuitem" className={vs.reachMenuClear} onClick={() => { setReachedOut(reachMenuVenue, false); setReachMenu(null); }}>Not reached out — unmark</button>
          )}
        </div>
      )}
      {noFitFor && (
        <VenueNoFitPrompt venue={noFitFor.venue} options={noFitOptions} onSave={saveNoFit} onCancel={closeNoFit} onEditList={editNoFitList} />
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

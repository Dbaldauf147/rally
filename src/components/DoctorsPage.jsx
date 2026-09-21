import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { saveImage, readImage, deleteImage } from '../lib/doctorImages';
import { useAuth } from '../contexts/AuthContext';
import {
  FIELDS, STATUS, STATUS_ORDER, NO_TYPE, statusLabel, typeHeading,
  normalizeEntry, normalizeList, entryTitle, entrySubtitle, entryPickerLabel,
  groupByType, countByStatus, issueCell, typeUsage,
  LANES, laneCounts,
  addEntry, updateEntry, removeEntry, isBlank, addEntryImage, removeEntryImage,
  addType, renameType, removeType, moveType,
  addField, updateField, removeField, fieldUsage, setCustomValue, customValueOf,
  resolveColumns, renameColumn, setColumnHidden, moveColumn,
  dateColumns, daysSinceField, setDaysSinceSource, daysSinceLabel, upcomingVisit,
  isCheckInEntry, isFormerEntry, setEntryFormer, formerDoctorsByType,
  setCheckInRowOff, offCheckInRows,
  setDoctorCalendar, pendingAppointments, sameType, issueRecord,
  addQuestion, updateQuestion, removeQuestion, toggleQuestionTag, addQuestionTag,
  removeQuestionTag, groupQuestions, questionTagCounts,
  linkAppointment, ignoreAppointment, unignoreAppointment,
  telHref, mailHref, mapHref, safeLink, linkLabel, makeId, seedDoctors,
} from '../lib/doctors';
import {
  CUSTOM_FIELD_TYPES, formatCustomValue, parseOptionList, optionListText, linkHref,
} from '../lib/customFields';
import {
  isGoogleCalendarConnected, connectGoogleCalendar, listGoogleCalendars, fetchGoogleCalendarEvents,
} from '../googleCalendar';
import {
  POPUP_COLUMNS, STORAGE_KEY as POPUP_COLUMNS_KEY, normalizePrefs, shownColumns, toggleColumn,
  setColumnWidth, cycleSort, sortEntries,
} from '../lib/doctorsPopupColumns';
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

// A blank record, dropped straight into the table for you to type into.
const emptyEntry = () => normalizeEntry({ id: makeId(), status: STATUS.NONE });

// The sentinel the type <select> uses for "let me type a new one". It starts
// with a space, which a real type name never does once trimmed.
const NEW_TYPE = ' new';

/* Which fields each column edits.

   A column shows more than one field — Doctor is the name and the place — so opening a
   cell gives you every field that column is responsible for, stacked. That way
   the table stays six columns wide while still reaching all thirteen fields. */
const CELL_FIELDS = {
  name: ['doctor', 'place'],
  issue: ['issue', 'notes'],
  meds: ['currentMeds', 'previousMeds'],
  cadence: ['cadence'],
  notes: ['notes'],
};

/* What the Issues tab shows, and all it shows.

   What was wrong, what was taken for it, and whatever was written down. Every
   other column on the table — how to reach them, when you're next due, the
   counters, the status, and any column added since — answers a check-in
   question rather than this one, and a record that is only a complaint has
   nothing to put in them anyway.

   Notes ride inside the Issue cell everywhere else; here they get the column,
   which is what the space freed up is for. A column hidden from the Columns
   manager stays hidden here too — this narrows the table, it doesn't overrule
   what you asked for. */
const ISSUE_COLUMNS = ['name', 'issue', 'meds', 'notes'];
const NOTES_COLUMN = { key: 'notes', kind: 'builtin', field: null, label: 'Notes', hidden: false };

/* Check-ins runs without the speciality headings (see the table below), so the
   speciality is a column of its own instead — the first one, because that is
   what you scan the tab by. It is not in the Columns manager: it exists only
   on this tab, and the headings it replaces were never hidable either. */
const TYPE_COLUMN = { key: 'type', kind: 'builtin', field: null, label: 'Type', hidden: false };

/* How late a visit is, as its own column — also Check-ins only, and for the
   same reason the tab is sorted by it: "am I behind on anything?" is the
   question the tab answers first, and reading it out of a date in a column of
   dates means doing the arithmetic yourself. The Next visit column still
   carries the date; this one carries what the date means today. */
const OVERDUE_COLUMN = { key: 'overdue', kind: 'builtin', field: null, label: 'Overdue', hidden: false };

/* One field inside an open cell.

   Uncontrolled, committing on blur or Enter: the stored shape trims its
   strings, so writing state per keystroke would eat the space the moment you
   typed it. Escape closes the cell without committing, because unmounting the
   input is what cancels it — React fires no blur on unmount. */
function CellInput({ value, field, autoFocus, onCommit }) {
  return (
    <input
      className={styles.cellInput}
      type={field.type || 'text'}
      defaultValue={value}
      placeholder={field.label}
      aria-label={field.label}
      autoFocus={autoFocus}
      onBlur={(e) => onCommit({ [field.key]: e.target.value })}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
    />
  );
}

// The speciality lives in the name cell, beside the doctor it belongs to.
// Choosing a type here moves the row to that heading; inventing one makes the
// heading, because normalizeList registers any type a record uses.
function TypeField({ entry, types, onCommit }) {
  const [typing, setTyping] = useState(false);
  if (typing) {
    return (
      <input
        className={styles.cellInput}
        autoFocus
        defaultValue=""
        placeholder="New type"
        aria-label="New type"
        onBlur={(e) => { onCommit({ type: e.target.value }); setTyping(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
      />
    );
  }
  return (
    <select
      className={styles.cellInput}
      aria-label="Type"
      value={entry.type}
      onChange={(e) => {
        if (e.target.value === NEW_TYPE) { setTyping(true); return; }
        onCommit({ type: e.target.value });
      }}
    >
      <option value={NO_TYPE}>{typeHeading(NO_TYPE)}</option>
      {types.map((t) => <option key={t} value={t}>{t}</option>)}
      <option value={NEW_TYPE}>+ New type…</option>
    </select>
  );
}

/* A cell you can click into.

   Closed, it is the read view and nothing else — an empty one stays literally
   empty so the CSS dash still finds it. Open, it holds the editors for its
   fields and closes when focus leaves the cell entirely, so Tab moves between
   the fields inside it without shutting the door behind you. */
function Cell({ className, open, onOpen, onClose, label, display, children }) {
  if (!open) {
    return (
      <td
        className={className}
        tabIndex={0}
        role="button"
        aria-label={`Edit ${label}`}
        title="Click to edit"
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      >
        {display}
      </td>
    );
  }
  return (
    <td
      className={`${className} ${styles.cellOpen}`}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
    >
      <div className={styles.cellFields}>{children}</div>
    </td>
  );
}

/* A value in a column the owner added.

   Fixed-choice types — a yes/no or a list — render as the control itself, the
   way Status does: there is nothing to type and nothing to cancel, so making
   you click to open one would only be a step in the way. Everything you type
   into goes through the same click-to-open cell as the built-in fields. */
function CustomCell({ entry, field, open, onOpen, onClose, onCommit }) {
  const value = customValueOf(entry, field);
  const commit = (raw) => onCommit(field.id, raw);

  if (field.type === 'checkbox') {
    return (
      <td className={styles.cellCustom}>
        <input
          type="checkbox"
          className={styles.cellCheck}
          aria-label={field.label}
          checked={value === true}
          onChange={(e) => commit(e.target.checked)}
        />
      </td>
    );
  }

  // A link column holds a whole URL, which would blow the column open. The
  // cell says "link" and carries the address behind it.
  if (field.type === 'link') {
    const href = linkHref(value);
    return (
      <Cell
        className={styles.cellCustom}
        label={field.label}
        open={open}
        onOpen={onOpen}
        onClose={onClose}
        display={href
          ? <a className={styles.link} href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>link ↗</a>
          : (value ? String(value) : null)}
      >
        <input
          className={styles.cellInput}
          type="url"
          defaultValue={value ?? ''}
          placeholder="Paste the website address"
          aria-label={field.label}
          autoFocus
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
        />
      </Cell>
    );
  }

  if (field.type === 'select') {
    return (
      <td className={styles.cellCustom}>
        <select
          className={styles.statusSelect}
          aria-label={field.label}
          value={value ?? ''}
          onChange={(e) => commit(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
          {/* A value that arrived before the list did still has to show. */}
          {value && !field.options.includes(String(value)) && (
            <option value={value}>{String(value)}</option>
          )}
        </select>
      </td>
    );
  }

  return (
    <Cell
      className={styles.cellCustom}
      label={field.label}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      display={formatCustomValue(field, value) || null}
    >
      <input
        className={styles.cellInput}
        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
        defaultValue={field.type === 'date' ? (value || '') : (value ?? '')}
        placeholder={field.label}
        aria-label={field.label}
        autoFocus
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
      />
    </Cell>
  );
}

/* The columns themselves: what they are called, what order they run in, and
   which ones show at all.

   Built-in and added columns sit in one list because they are one list to the
   table. The difference is only in what can be done to them: an added column
   has a type and can be deleted outright, while a built-in one can be hidden
   but never deleted — its values live on every record and are not this
   panel's to throw away. */
function ColumnManager({ list, columns, onChange, onClose }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  // The counter column reads a Date column of the owner's own, so the manager
  // is where it is told which one.
  const dates = dateColumns(list);
  const source = daysSinceField(list);

  function handleAdd(e) {
    e.preventDefault();
    if (!label.trim()) return;
    onChange(addField(list, { label, type }));
    setLabel('');
    setType('text');
  }

  function handleRemove(col) {
    const used = fieldUsage(list.entries, col.key);
    const warning = used
      ? `Delete the “${col.label}” column? ${used} record${used === 1 ? '' : 's'} have a value in it, and those values are deleted too.`
      : `Delete the “${col.label}” column?`;
    if (window.confirm(warning)) onChange(removeField(list, col.key));
  }

  return (
    <div className={styles.formCard}>
      <div className={styles.typeHead}>
        <div className={styles.formTitle}>Columns</div>
        <button type="button" className={styles.btn} onClick={onClose}>Done</button>
      </div>
      <p className={styles.hint}>
        Rename any column, drag the order about with the arrows, and untick Show to
        take one off the table. Hiding a built-in column keeps its values — untick and
        tick it back and they are all still there. Deleting a column you added deletes
        what is in it.
      </p>

      <ul className={styles.typeList}>
        {columns.map((col, i) => (
          <li key={col.key} className={styles.fieldRow}>
            <input
              className={styles.input}
              defaultValue={col.label}
              aria-label={`Rename ${col.label}`}
              onBlur={(e) => onChange(renameColumn(list, col.key, e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
            />
            {col.kind === 'custom' && (
              <select
                className={styles.fieldType}
                aria-label={`Type of ${col.label}`}
                value={col.field.type}
                onChange={(e) => onChange(updateField(list, col.key, { type: e.target.value }))}
              >
                {CUSTOM_FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            )}
            {col.key === 'daysSince' && (
              dates.length ? (
                <select
                  className={styles.fieldType}
                  aria-label="Days since counts from"
                  value={source?.id || ''}
                  onChange={(e) => onChange(setDaysSinceSource(list, e.target.value))}
                >
                  {dates.map((c) => <option key={c.key} value={c.key}>from {c.label}</option>)}
                </select>
              ) : <span className={styles.hint}>Add a Date column for it to count from</span>
            )}
            {col.kind === 'custom' && col.field.type === 'select' && (
              <input
                className={styles.input}
                defaultValue={optionListText(col.field.options)}
                placeholder="Choices, comma separated"
                aria-label={`Choices for ${col.label}`}
                onBlur={(e) => onChange(updateField(list, col.key, { options: parseOptionList(e.target.value) }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
              />
            )}
            {col.kind === 'custom' && (
              <span className={styles.typeCount} title={`${fieldUsage(list.entries, col.key)} record(s) with a value`}>
                {fieldUsage(list.entries, col.key)}
              </span>
            )}
            <label className={styles.showToggle}>
              <input
                type="checkbox"
                checked={!col.hidden}
                aria-label={`Show ${col.label}`}
                onChange={(e) => onChange(setColumnHidden(list, col.key, !e.target.checked))}
              />
              Show
            </label>
            <button
              type="button" className={styles.iconBtn} title={`Move ${col.label} left`}
              disabled={i === 0} onClick={() => onChange(moveColumn(list, col.key, -1))}
            >←</button>
            <button
              type="button" className={styles.iconBtn} title={`Move ${col.label} right`}
              disabled={i === columns.length - 1} onClick={() => onChange(moveColumn(list, col.key, 1))}
            >→</button>
            {col.kind === 'custom' ? (
              <button
                type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                title={`Delete ${col.label}`} onClick={() => handleRemove(col)}
              >×</button>
            ) : <span className={styles.iconSpacer} />}
          </li>
        ))}
      </ul>

      <form className={styles.typeAdd} onSubmit={handleAdd}>
        <input
          className={styles.input}
          value={label}
          placeholder="Add a column"
          aria-label="New column name"
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          className={styles.fieldType}
          aria-label="New column type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {CUSTOM_FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <button type="submit" className={styles.btnPrimary} disabled={!label.trim()}>Add</button>
      </form>
    </div>
  );
}

/* One record, one row.

   Everything a row holds gets its own column, so two doctors can be read
   against each other straight down the page. Cells with nothing in them are
   left literally empty and picked up by a dash in CSS, which keeps a sparse
   row — most of this list — from reading as a broken one. */
// Headers that need their column’s own alignment or width, keyed by column.
// An appointment's day, written the way the Date column writes one.
function fmtApptDay(iso) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return p ? `${Number(p[2])}/${Number(p[3])}/${p[1]}` : '';
}

/* The calendar strip above the check-ins.

   One nominated Google Calendar is read a year either side of today, and every
   appointment on it that hasn't been filed yet is offered here with the record
   it looks like it belongs to. Filing one writes the visit into the Date column
   the counter reads and, when it's still to come, takes over the Next visit
   column from the cadence.

   Nothing is filed automatically. A calendar is full of appointments that are
   nobody's check-up — the guess is worth showing, but it's a guess, and a wrong
   one silently rewriting a last-visit date is exactly the kind of thing this
   page can't afford. */
function AppointmentsPanel({ list, update, daysFrom }) {
  const calendar = list.calendar;
  const [connected, setConnected] = useState(() => isGoogleCalendarConnected());
  const [calendars, setCalendars] = useState([]);
  const [events, setEvents] = useState([]);
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState('');
  // Which record each pending appointment is pointed at, once the owner has
  // moved the select off the suggestion.
  const [choice, setChoice] = useState({});
  const [showWaved, setShowWaved] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    // Read-only calendars count here: a practice's shared calendar is one you
    // subscribe to, and it's appointments we want off it, not room to write.
    listGoogleCalendars({ writableOnly: false })
      .then((cals) => { if (live) setCalendars(cals); })
      .catch(() => { if (live) setCalendars([]); });
    return () => { live = false; };
  }, [connected]);

  const load = useCallback(async () => {
    if (!connected || !calendar.id) { setEvents([]); setState('idle'); return; }
    setState('loading');
    setError('');
    try {
      // A year back covers the last of an annual check-up; a year forward
      // covers whatever has already been booked at the end of the last one.
      const now = new Date();
      const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
      const to = new Date(now); to.setFullYear(to.getFullYear() + 1);
      const found = await fetchGoogleCalendarEvents({
        calendarId: calendar.id,
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
      });
      setEvents(found);
      setState('ready');
    } catch (err) {
      if (err.code === 'NOT_CONNECTED') setConnected(false);
      setError(err.message || 'Could not read that calendar');
      setState('error');
    }
  }, [connected, calendar.id]);

  // Deferred a tick rather than run in the effect body: the read sets state as
  // it goes, and React would rather that didn't happen mid-render.
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  const pending = useMemo(() => pendingAppointments(list, events), [list, events]);
  // Held-back rows included: this is the pool an appointment gets matched
  // against, and an appointment belongs to its record either way.
  const checkIns = useMemo(
    () => list.entries.filter((e) => isCheckInEntry(e, list.entries, { includeHeld: true })),
    [list.entries],
  );
  const waved = useMemo(
    () => events.filter((e) => list.ignoredEvents.includes(e.id)),
    [events, list.ignoredEvents],
  );

  async function connect() {
    try {
      await connectGoogleCalendar();
      setConnected(true);
      setError('');
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
    }
  }

  function pickCalendar(id) {
    const name = calendars.find((c) => c.id === id)?.name || '';
    update((l) => setDoctorCalendar(l, id, name));
  }

  const fileIt = (appt, entryId) => {
    if (!entryId) return;
    update((l) => linkAppointment(l, entryId, appt, { dateFieldId: daysFrom?.id || '' }));
  };

  const WHY = { name: 'the name matches', place: 'the place matches', type: 'the type matches' };

  return (
    <section className={styles.appts} aria-label="Appointments from your calendar">
      <div className={styles.apptHead}>
        <span className={styles.apptLead}>Appointments from</span>
        {connected ? (
          <select
            className={styles.apptCal}
            value={calendar.id}
            aria-label="Which calendar the appointments come from"
            onChange={(e) => pickCalendar(e.target.value)}
          >
            <option value="">— pick a calendar —</option>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {/* A calendar chosen before and since unshared still names itself */}
            {calendar.id && !calendars.some((c) => c.id === calendar.id) && (
              <option value={calendar.id}>{calendar.name || calendar.id}</option>
            )}
          </select>
        ) : (
          <button type="button" className={styles.apptConnect} onClick={connect}>
            Connect Google Calendar
          </button>
        )}
        {connected && calendar.id && (
          <button type="button" className={styles.apptRefresh} onClick={load} disabled={state === 'loading'}>
            {state === 'loading' ? 'Reading…' : 'Refresh'}
          </button>
        )}
        {pending.length > 0 && (
          <span className={styles.apptCount}>{pending.length} to file</span>
        )}
      </div>

      {error && <p className={styles.apptError}>{error}</p>}

      {connected && !calendar.id && !error && (
        <p className={styles.apptHint}>
          Pick the calendar your appointments land on and they’ll show up here, each with the
          record it looks like it belongs to.
        </p>
      )}

      {connected && calendar.id && !daysFrom && (
        <p className={styles.apptHint}>
          Add a Date column and a filed appointment will keep it up to date. Until then, filing
          one only records that it belongs to that doctor.
        </p>
      )}

      {state === 'ready' && pending.length === 0 && calendar.id && (
        <p className={styles.apptHint}>Nothing new — every appointment on {calendar.name || 'that calendar'} is filed.</p>
      )}

      {pending.length > 0 && (
        <ul className={styles.apptList}>
          {pending.map((a) => {
            const chosen = choice[a.eventId] ?? (a.suggestion?.entryId || '');
            const why = a.suggestion ? WHY[a.suggestion.reason] : '';
            return (
              <li key={a.eventId} className={styles.apptRow}>
                <div className={styles.apptWhen}>{fmtApptDay(a.date)}</div>
                <div className={styles.apptWhat}>
                  <div className={styles.apptTitle}>{a.title || '(No title)'}</div>
                  {a.location ? <div className={styles.apptWhere}>{a.location}</div> : null}
                </div>
                <div className={styles.apptPick}>
                  <select
                    className={styles.apptSelect}
                    value={chosen}
                    aria-label={`Which record ${a.title || 'this appointment'} belongs to`}
                    onChange={(e) => setChoice((c) => ({ ...c, [a.eventId]: e.target.value }))}
                  >
                    <option value="">Choose a record…</option>
                    {checkIns.map((e) => (
                      <option key={e.id} value={e.id}>{entryPickerLabel(e)}</option>
                    ))}
                  </select>
                  {why && chosen === a.suggestion.entryId && (
                    <span className={styles.apptWhy}>suggested — {why}</span>
                  )}
                </div>
                <div className={styles.apptActions}>
                  <button
                    type="button"
                    className={styles.apptFile}
                    disabled={!chosen}
                    onClick={() => fileIt(a, chosen)}
                  >File</button>
                  <button
                    type="button"
                    className={styles.apptSkip}
                    onClick={() => update((l) => ignoreAppointment(l, a.eventId))}
                  >Not a visit</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {waved.length > 0 && (
        <div className={styles.apptWaved}>
          <button type="button" className={styles.apptToggle} onClick={() => setShowWaved((v) => !v)}>
            {showWaved ? 'Hide' : 'Show'} {waved.length} waved off
          </button>
          {showWaved && (
            <ul className={styles.apptList}>
              {waved.map((e) => (
                <li key={e.id} className={styles.apptRow}>
                  <div className={styles.apptWhen}>{fmtApptDay(String(e.start).slice(0, 10))}</div>
                  <div className={styles.apptWhat}><div className={styles.apptTitle}>{e.title}</div></div>
                  <div className={styles.apptActions}>
                    <button
                      type="button"
                      className={styles.apptSkip}
                      onClick={() => update((l) => unignoreAppointment(l, e.id))}
                    >Put back</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* The Questions tab: what you mean to ask, and what they said.

   Grouped under the record each question is for, because that's how they get
   used — you're about to see the dentist and you want the dentist's four, not
   everything you've ever wondered in date order. */
function QuestionsPanel({ list, update }) {
  const [text, setText] = useState('');
  const [forEntry, setForEntry] = useState('');
  const [draftTags, setDraftTags] = useState([]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('all');
  const [answered, setAnswered] = useState('open');
  const [editing, setEditing] = useState(null); // { id, field } — one open at a time

  const tags = list.questionTags || [];
  const tagCounts = useMemo(() => questionTagCounts(list), [list]);
  const groups = useMemo(
    () => groupQuestions(list, { query, tag, answered }),
    [list, query, tag, answered],
  );
  const total = (list.questions || []).length;
  // The picker offers every record, not only the check-ins: a question about
  // the thing that was wrong is as real as one about the next cleaning.
  const records = list.entries || [];

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    update((l) => addQuestion(l, { text, entryId: forEntry, tags: draftTags }));
    setText('');
    setDraftTags([]);
    // The record stays picked: writing down three things for the same doctor is
    // the normal way this gets used.
  }

  const draftTagOn = (t) => draftTags.some((x) => x.toLowerCase() === t.toLowerCase());
  function toggleDraftTag(t) {
    setDraftTags((cur) => (draftTagOn(t) ? cur.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...cur, t]));
  }
  function newTag() {
    const name = window.prompt('New tag');
    if (!name || !name.trim()) return;
    update((l) => addQuestionTag(l, name));
    setDraftTags((cur) => [...cur, name.trim()]);
  }

  return (
    <section className={styles.questions}>
      <form className={styles.qAdd} onSubmit={submit}>
        <input
          className={styles.qAddText}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you want to ask?"
          aria-label="What do you want to ask?"
        />
        <select
          className={styles.qAddWho}
          value={forEntry}
          onChange={(e) => setForEntry(e.target.value)}
          aria-label="Which record this question is for"
        >
          <option value="">Whoever I see next</option>
          {records.map((e) => (
            <option key={e.id} value={e.id}>{entryPickerLabel(e)}</option>
          ))}
        </select>
        <button type="submit" className={styles.btnPrimary} disabled={!text.trim()}>Add</button>
        {tags.length > 0 && (
          <div className={styles.qAddTags}>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className={draftTagOn(t) ? styles.qTagOn : styles.qTag}
                aria-pressed={draftTagOn(t)}
                onClick={() => toggleDraftTag(t)}
              >{t}</button>
            ))}
            <button type="button" className={styles.qTagNew} onClick={newTag}>+ Tag</button>
          </div>
        )}
        {tags.length === 0 && (
          <button type="button" className={styles.qTagNew} onClick={newTag}>+ Tag</button>
        )}
      </form>

      {total > 0 && (
        <div className={styles.toolbar}>
          <input
            className={styles.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a question, an answer, a tag…"
          />
          <div className={styles.pills}>
            {[['open', 'To ask'], ['answered', 'Answered'], ['all', 'All']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={answered === k ? styles.pillOn : styles.pill}
                onClick={() => setAnswered(k)}
              >{label}</button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className={styles.pills}>
              <button
                type="button"
                className={tag === 'all' ? styles.pillOn : styles.pill}
                onClick={() => setTag('all')}
              >Any tag</button>
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={tag === t ? styles.pillOn : styles.pill}
                  onClick={() => setTag(t)}
                >{t} <span className={styles.pillCount}>{tagCounts[t] || 0}</span></button>
              ))}
            </div>
          )}
        </div>
      )}

      {total === 0 && (
        <div className={styles.empty}>
          Nothing to ask yet. Write down the thing you always forget in the room.
        </div>
      )}

      {total > 0 && groups.length === 0 && (
        <div className={styles.empty}>
          Nothing matches{query.trim() ? ` “${query.trim()}”` : ' that filter'}.{' '}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => { setQuery(''); setTag('all'); setAnswered('all'); }}
          >Clear the filters</button>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.entryId || '__loose__'} className={styles.qGroup}>
          <h2 className={styles.qGroupHead}>
            {group.entry ? entryPickerLabel(group.entry) : 'Not for anybody in particular'}
            <span className={styles.qGroupCount}>{group.questions.length}</span>
          </h2>
          <ul className={styles.qList}>
            {group.questions.map((q) => (
              <li key={q.id} className={q.answered ? styles.qRowDone : styles.qRow}>
                <label className={styles.qCheck}>
                  <input
                    type="checkbox"
                    checked={q.answered}
                    onChange={() => update((l) => updateQuestion(l, q.id, { answered: !q.answered }))}
                    aria-label={q.answered ? `Mark “${q.text}” still to ask` : `Mark “${q.text}” answered`}
                  />
                </label>
                <div className={styles.qBody}>
                  {editing?.id === q.id && editing.field === 'text' ? (
                    <input
                      className={styles.qEdit}
                      defaultValue={q.text}
                      autoFocus
                      onBlur={(e) => { update((l) => updateQuestion(l, q.id, { text: e.target.value })); setEditing(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.qText}
                      onClick={() => setEditing({ id: q.id, field: 'text' })}
                      title="Click to edit"
                    >{q.text}</button>
                  )}

                  {editing?.id === q.id && editing.field === 'answer' ? (
                    <input
                      className={styles.qEdit}
                      defaultValue={q.answer}
                      autoFocus
                      placeholder="What they said…"
                      onBlur={(e) => { update((l) => updateQuestion(l, q.id, { answer: e.target.value })); setEditing(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={q.answer ? styles.qAnswer : styles.qAnswerEmpty}
                      onClick={() => setEditing({ id: q.id, field: 'answer' })}
                    >{q.answer || 'What they said…'}</button>
                  )}

                  <div className={styles.qTags}>
                    {q.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={styles.qTagOn}
                        title={`Take “${t}” off this question`}
                        onClick={() => update((l) => toggleQuestionTag(l, q.id, t))}
                      >{t} ×</button>
                    ))}
                    {tags.filter((t) => !q.tags.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={styles.qTag}
                        title={`File this question under “${t}”`}
                        onClick={() => update((l) => toggleQuestionTag(l, q.id, t))}
                      >+ {t}</button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.qDelete}
                  title="Delete this question"
                  aria-label={`Delete “${q.text}”`}
                  onClick={() => { if (window.confirm(`Delete “${q.text}”?`)) update((l) => removeQuestion(l, q.id)); }}
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {tags.length > 0 && (
        <details className={styles.qTagManager}>
          <summary>Tags</summary>
          <div className={styles.qTagManagerBody}>
            {tags.map((t) => (
              <span key={t} className={styles.qTagManagerRow}>
                {t}
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    const n = tagCounts[t] || 0;
                    const warn = n > 0 ? ` It's on ${n} question${n === 1 ? '' : 's'} still to ask.` : '';
                    if (window.confirm(`Retire the “${t}” tag?${warn} The questions themselves stay.`)) {
                      update((l) => removeQuestionTag(l, t));
                      if (tag === t) setTag('all');
                    }
                  }}
                >retire</button>
              </span>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/* One editable cell in the speciality pop-up's table.

   Uncontrolled and committed on blur, like the page table's cells, for the
   same reason: the stored shape trims, so writing per keystroke would eat
   spaces. Keyed on the stored value by the caller, so an edit syncing in from
   another device replaces what's shown — it only changes on a commit, never
   mid-word. `wrap` shows a one-line value (a doctor's full name) across as
   many lines as the column needs, while Enter still commits it. */
function GridField({ label, value, onCommit, type = 'text', long = false, wrap = false, placeholder, autoFocus = false, onDone }) {
  const commit = (e) => {
    if (e.target.value.trim() !== String(value || '')) onCommit(e.target.value);
    onDone?.();
  };
  const enterCommits = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  const common = {
    className: styles.gridInput,
    defaultValue: value || '',
    placeholder: placeholder || '—',
    'aria-label': label,
    autoFocus,
    onBlur: commit,
  };
  // A text cell grows to show all of its value, so nothing hides behind a
  // scrollbar inside a row.
  const fit = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } };
  const area = { ...common, rows: 1, ref: fit, onInput: (e) => fit(e.target) };
  if (long) return <textarea {...area} />;
  if (wrap) return <textarea {...area} inputMode={type === 'text' ? undefined : type} onKeyDown={enterCommits} />;
  return <input type={type} {...common} onKeyDown={enterCommits} />;
}

/* The pop-up's Link cell: once there's a link, the cell is the link — its
   site's name, clickable, as on the page's own table — with a pencil to change
   it. Empty, or being edited, it's the usual field. Keyed on the stored value
   by the caller, so a saved edit drops back to the link. */
function LinkField({ label, value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const href = safeLink(value);
  if (!href || editing) {
    return (
      <GridField
        label={label} type="url" value={value} onCommit={onCommit} wrap
        autoFocus={editing} onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <div className={styles.gridLinkCell}>
      <a className={styles.gridLinkText} href={href} target="_blank" rel="noreferrer" title={value}>
        {linkLabel(value)}&nbsp;↗
      </a>
      <button type="button" className={styles.gridEdit} title="Edit link" aria-label={`Edit ${label}`} onClick={() => setEditing(true)}>✎</button>
    </div>
  );
}

/* ── A doctor's own pop-up ───────────────────────────────────────────
   How to reach them, opened by clicking the doctor's name — on the page's
   table or in the speciality pop-up. Phone, email, address and link live here
   and nowhere else, so the tables are about what's wrong and when you're due.

   Every field edits in place and saves on blur, like the tables' cells. The
   buttons along the top act on what's saved. Escape closes this and only
   this — a speciality pop-up it sits over stays open. */
function DoctorCard({ entry, title, onCommit, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const tel = telHref(entry.phone);
  const mail = mailHref(entry.email);
  const map = mapHref(entry.location);
  const link = safeLink(entry.link);
  const k = (key) => `${entry.id}:${key}:${entry[key] || ''}`;
  const field = (key, label, props = {}) => (
    <label className={styles.contactField}>
      <span className={styles.contactLabel}>{label}</span>
      <GridField key={k(key)} label={label} value={entry[key]} onCommit={(v) => onCommit({ [key]: v })} placeholder={label} {...props} />
    </label>
  );

  return (
    <div className={`${styles.modalOverlay} ${styles.contactOverlay}`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className={styles.contactCard} role="dialog" aria-modal="true" aria-label={`Contact for ${title}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.modalClose} aria-label="Close contact" onClick={onClose}>×</button>
        <h2 className={styles.contactTitle}>{title}</h2>
        {entry.type ? <div className={styles.sub}>{entry.type}</div> : null}

        {(tel || mail || map || link) && (
          <div className={styles.contactActions}>
            {tel ? <a className={styles.btn} href={tel}>Call</a> : null}
            {mail ? <a className={styles.btn} href={mail}>Email</a> : null}
            {map ? <a className={styles.btn} href={map} target="_blank" rel="noreferrer">Map ↗</a> : null}
            {link ? <a className={styles.btn} href={link} target="_blank" rel="noreferrer">{linkLabel(entry.link)} ↗</a> : null}
          </div>
        )}

        <div className={styles.contactGrid}>
          {field('doctor', 'Doctor', { wrap: true })}
          {field('place', 'Place', { wrap: true })}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('email', 'Email', { type: 'email', wrap: true })}
          <div className={styles.contactWide}>{field('location', 'Address', { long: true })}</div>
          <div className={styles.contactWide}>{field('link', 'Link', { type: 'url', wrap: true })}</div>
        </div>
      </div>
    </div>
  );
}

// The doctor's name as the way into their pop-up. Stops the click there, so a
// table cell it sits in doesn't also open for editing.
function DoctorNameButton({ name, onOpen, className }) {
  return (
    <button
      type="button"
      className={className ? `${styles.nameBtn} ${className}` : styles.nameBtn}
      title="Contact details"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >{name}</button>
  );
}

/* Phone width, where the pop-up becomes a full-screen sheet of cards. A wide
   table scrolled sideways through a phone-sized window was the whole problem
   there: you could never see a record's doctor and its issue at once. */
const NARROW_QUERY = '(max-width: 700px)';
function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return undefined;
    const onChange = (e) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

// The pop-up's typed columns: which grow with their text, which stay one line,
// and what an empty one says.
const GRID_LONG = new Set(['issue', 'currentMeds', 'previousMeds', 'notes']);
const GRID_PLACEHOLDER = { doctor: 'Doctor', place: 'Place', issue: "What it's for", cadence: 'Every 6 months' };

/* ── Pictures on a record ─────────────────────────────────────────────
   A photo of the rash, the prescription, the referral letter. Stored one per
   document (lib/doctorImages.js); the record lists their ids. */

function useImageData(uid, id) {
  const [state, setState] = useState({ id: null, data: null, failed: false });
  useEffect(() => {
    let live = true;
    readImage(uid, id)
      .then((data) => { if (live) setState({ id, data, failed: !data }); })
      .catch(() => { if (live) setState({ id, data: null, failed: true }); });
    return () => { live = false; };
  }, [uid, id]);
  return state.id === id ? state : { id, data: null, failed: false };
}

// Adds the chosen files to one record, one at a time so a failure names the
// file it was and the ones before it are kept.
function useImageAdder(uid, entryId, update) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = useCallback(async (files) => {
    const list = [...(files || [])].filter((f) => !f.type || f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of list) {
        const image = await saveImage(uid, entryId, file, makeId());
        update((l) => addEntryImage(l, entryId, image));
      }
    } catch (err) {
      setError(err?.message || 'That picture could not be saved.');
    } finally {
      setBusy(false);
    }
  }, [uid, entryId, update]);
  return { add, busy, error };
}

function AddImagesButton({ label, adder, className, children }) {
  const input = useRef(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={adder.busy}
        aria-label={label}
        title={label}
        onClick={(e) => { e.stopPropagation(); input.current?.click(); }}
      >{adder.busy ? '…' : children}</button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; adder.add(files); }}
      />
    </>
  );
}

function Thumb({ uid, image, onOpen }) {
  const { data, failed } = useImageData(uid, image.id);
  return (
    <button type="button" className={styles.thumb} title={image.name} aria-label={`Open ${image.name || 'picture'}`} onClick={onOpen}>
      {data ? <img src={data} alt="" /> : <span className={styles.thumbWait}>{failed ? '!' : ''}</span>}
    </button>
  );
}

// The Images cell in the speciality pop-up's table.
function ImagesCell({ uid, entry, title, update, onOpen }) {
  const adder = useImageAdder(uid, entry.id, update);
  return (
    <div className={styles.imagesCell}>
      <div className={styles.thumbs}>
        {entry.images.map((img) => <Thumb key={img.id} uid={uid} image={img} onOpen={() => onOpen(img.id)} />)}
        <AddImagesButton label={`Attach pictures to ${title}`} adder={adder} className={styles.thumbAdd}>+</AddImagesButton>
      </div>
      {adder.error ? <div className={styles.imageError}>{adder.error}</div> : null}
    </div>
  );
}

/* One record's pictures, large, with the rest in a strip underneath.

   Opened from a thumbnail in the pop-up or the 📷 count on the page's table.
   Escape closes this and only this — the pop-up it may sit over stays open. */
function ImageGallery({ uid, entry, title, startId, update, onClose }) {
  const [currentId, setCurrentId] = useState(startId);
  const adder = useImageAdder(uid, entry.id, update);
  const images = entry.images;
  const index = Math.max(0, images.findIndex((i) => i.id === currentId));
  const current = images[index] || null;
  const { data, failed } = useImageData(uid, current?.id || '');

  // Newly added pictures are what you want to see, so land on the last one.
  const [seenCount, setSeenCount] = useState(images.length);
  if (images.length !== seenCount) {
    if (images.length > seenCount) setCurrentId(images[images.length - 1].id);
    setSeenCount(images.length);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowRight' && images.length > 1) setCurrentId(images[(index + 1) % images.length].id);
      if (e.key === 'ArrowLeft' && images.length > 1) setCurrentId(images[(index - 1 + images.length) % images.length].id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [images, index, onClose]);

  async function remove() {
    if (!current || !window.confirm(`Delete ${current.name || 'this picture'}? This cannot be undone.`)) return;
    const next = images[index + 1] || images[index - 1] || null;
    update((l) => removeEntryImage(l, entry.id, current.id));
    setCurrentId(next?.id || null);
    deleteImage(uid, current.id).catch(() => { /* the record no longer names it */ });
  }

  return (
    <div className={`${styles.modalOverlay} ${styles.galleryOverlay}`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className={styles.gallery} role="dialog" aria-modal="true" aria-label={`Pictures for ${title}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.galleryHead}>
          <div className={styles.galleryTitle}>
            {title}
            <span className={styles.groupCount}>{images.length}</span>
          </div>
          <div className={styles.galleryActions}>
            <AddImagesButton label={`Attach pictures to ${title}`} adder={adder} className={styles.btn}>Add pictures</AddImagesButton>
            {current ? <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={remove}>Delete</button> : null}
            <button type="button" className={styles.galleryClose} aria-label="Close pictures" onClick={onClose}>×</button>
          </div>
        </div>
        {adder.error ? <div className={styles.imageError}>{adder.error}</div> : null}
        <div className={styles.galleryStage}>
          {!current && <div className={styles.galleryEmpty}>No pictures yet. Add a photo of a rash, a prescription or a letter.</div>}
          {current && data && <img src={data} alt={current.name} />}
          {current && !data && <div className={styles.galleryEmpty}>{failed ? "This picture couldn't be loaded." : 'Loading…'}</div>}
          {images.length > 1 && (
            <>
              <button type="button" className={`${styles.galleryNav} ${styles.galleryPrev}`} aria-label="Previous picture" onClick={() => setCurrentId(images[(index - 1 + images.length) % images.length].id)}>‹</button>
              <button type="button" className={`${styles.galleryNav} ${styles.galleryNext}`} aria-label="Next picture" onClick={() => setCurrentId(images[(index + 1) % images.length].id)}>›</button>
            </>
          )}
        </div>
        {current ? (
          <div className={styles.galleryCaption}>
            {current.name}
            {current.created ? ` · added ${new Date(current.created).toLocaleDateString()}` : ''}
          </div>
        ) : null}
        {images.length > 1 && (
          <div className={styles.galleryStrip}>
            {images.map((img) => (
              <div key={img.id} className={img.id === current?.id ? styles.stripOn : undefined}>
                <Thumb uid={uid} image={img} onOpen={() => setCurrentId(img.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* One speciality, opened from its heading on the Check-ins tab.

   Every record filed under it — the doctor you see on a schedule and the
   complaint that sent you there — as one row each of a wide table, so they
   read across and compare at a glance, and every cell edits in place. Below
   it, the questions for all of them in a second table. A doctor's name opens
   their own pop-up, which is where phone, email and address live. A phone
   scrolls the tables sideways, as it does the page's own. */
function TypeDetail({ uid, list, type, entries, daysFrom, update, focusFormer, onClose }) {
  const [gallery, setGallery] = useState(null); // { entryId, imageId }
  // Keeps the Former doctors heading up while the first one is being filled in.
  const [addingFormer, setAddingFormer] = useState(false);
  /* Opened from a row's "Was:" line, the pop-up is being asked for the history
     rather than for the doctor already on the row above it — so it scrolls
     there, once, and leaves the scroll alone afterwards. */
  const formerRef = useRef(null);
  useEffect(() => {
    if (!focusFormer) return;
    formerRef.current?.scrollIntoView?.({ block: 'center' });
  }, [focusFormer]);
  const [contactId, setContactId] = useState(null); // entry id
  const narrow = useIsNarrow();

  // The page underneath stays put while the pop-up is open. On a phone a
  // swipe that reaches the end of the sheet otherwise scrolls the list behind
  // it, and closing drops you somewhere other than where you opened it.
  useEffect(() => {
    const { style } = document.documentElement;
    const before = style.overflow;
    style.overflow = 'hidden';
    return () => { style.overflow = before; };
  }, []);

  const [draftQ, setDraftQ] = useState('');
  const [qFor, setQFor] = useState(null); // entry id, null = the first record
  const [newIssue, setNewIssue] = useState('');
  const [issueWith, setIssueWith] = useState(null); // entry id, '' = nobody, null = default
  const [addedId, setAddedId] = useState(null);

  /* Who a new issue can be with: each doctor or practice already filed under
     this speciality, once, however many records they appear on.

     The ones you still see come first, so the picker opens on one of them. A
     former doctor is a fair answer — an issue they treated is filed under them
     — but they are not who the next complaint goes to, and after a doctor is
     replaced they would otherwise be the name sitting in the box. */
  const doctors = useMemo(() => {
    const seen = new Set();
    const named = entries.filter((e) => {
      if (!String(e.doctor || e.place || '').trim()) return false;
      const key = `${e.doctor}|${e.place}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...named.filter((e) => !isFormerEntry(e)), ...named.filter(isFormerEntry)];
  }, [entries]);
  const withId = issueWith ?? (doctors[0]?.id || '');

  function addIssue(e) {
    e.preventDefault();
    const text = newIssue.trim();
    if (!text) return;
    const record = issueRecord(type, text, entries.find((x) => x.id === withId) || null);
    update((l) => addEntry(l, record));
    setNewIssue('');
    setAddedId(record.id);
  }

  // Bring the row just added into view, so it's plain where it went and its
  // meds and notes are right there to fill in.
  // Once: it waits for the row to render, then never moves you again while
  // you type into it or anything else.
  const scrolledTo = useRef(null);
  useEffect(() => {
    if (!addedId || scrolledTo.current === addedId) return;
    const el = document.getElementById(`detail-${addedId}`);
    if (!el) return;
    scrolledTo.current = addedId;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [addedId, entries]);

  const galleryEntry = gallery ? entries.find((e) => e.id === gallery.entryId) : null;
  const closeGallery = useCallback(() => setGallery(null), []);
  const contactEntry = contactId ? entries.find((e) => e.id === contactId) : null;
  const closeContact = useCallback(() => setContactId(null), []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The questions for every record here: still to ask first, then in the
  // order their records sit in the table.
  const entryIndex = new Map(entries.map((e, i) => [e.id, i]));
  const questions = (list.questions || [])
    .filter((q) => entryIndex.has(q.entryId))
    .sort((a, b) => (a.answered === b.answered
      ? entryIndex.get(a.entryId) - entryIndex.get(b.entryId)
      : a.answered ? 1 : -1));
  const openCount = questions.filter((q) => !q.answered).length;
  const openFor = (id) => questions.filter((q) => q.entryId === id && !q.answered).length;
  // Defaults to a doctor you still see, for the same reason the issue picker
  // does: a question you are writing down now is one you mean to ask them.
  const qForId = qFor && entryIndex.has(qFor) ? qFor : (doctors[0]?.id || entries[0]?.id || '');
  const commit = (id, key) => (value) => update((l) => updateEntry(l, id, { [key]: value }));

  function addQ(e) {
    e.preventDefault();
    const text = draftQ.trim();
    if (!text || !qForId) return;
    update((l) => addQuestion(l, { text, entryId: qForId }));
    setDraftQ('');
  }

  function addRecord({ former = false } = {}) {
    const record = normalizeEntry({ id: makeId(), type, status: STATUS.NONE, former });
    update((l) => addEntry(l, record));
    setAddedId(record.id);
  }

  // Moving a doctor to the former list and back. Nothing on the record
  // changes; only where it is listed.
  function toggleFormer(entry) {
    update((l) => setEntryFormer(l, entry.id, !isFormerEntry(entry)));
  }

  // The page table's rule: a record never filled in goes quietly, anything
  // else asks first. Every record here carries the speciality, so that alone
  // doesn't count as filled in. Its questions stay, under "Not for anybody in
  // particular" on the Questions tab, and the prompt says so.
  function deleteRecord(entry) {
    const qs = questions.filter((q) => q.entryId === entry.id).length;
    const pics = entry.images.length;
    const note = (qs ? ` Its ${qs} question${qs === 1 ? '' : 's'} will move to "Not for anybody in particular".` : '')
      + (pics ? ` Its ${pics} picture${pics === 1 ? '' : 's'} will be deleted.` : '');
    const blank = isBlank({ ...entry, type: '' }) && qs === 0;
    if (!blank && !window.confirm(`Delete ${entryTitle(entry, type)}? This cannot be undone.${note}`)) return;
    update((l) => removeEntry(l, entry.id));
    entry.images.forEach((img) => deleteImage(uid, img.id).catch(() => {}));
  }

  /* ── The records table's columns ─────────────────────────────────
     Which show, how wide, sorted by what — remembered on this device (see
     lib/doctorsPopupColumns.js for why not on the shared list). */
  const [prefs, setPrefs] = useState(() => {
    try { return normalizePrefs(JSON.parse(localStorage.getItem(POPUP_COLUMNS_KEY) || 'null')); }
    catch { return normalizePrefs(null); }
  });
  useEffect(() => {
    try { localStorage.setItem(POPUP_COLUMNS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  }, [prefs]);

  const [colsOpen, setColsOpen] = useState(false);
  const colsMenuRef = useRef(null);
  useEffect(() => {
    if (!colsOpen) return undefined;
    const away = (e) => { if (!colsMenuRef.current?.contains(e.target)) setColsOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [colsOpen]);

  const columns = shownColumns(prefs);
  // The row's own buttons — delete, and moving a doctor to the former list —
  // sit outside the chooser: they can't be hidden, sorted or resized, so they
  // share a fixed width on the end.
  const DELETE_COL_WIDTH = 76;
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0) + DELETE_COL_WIDTH;

  // Dragging a header's right edge. Pointer events, so a finger works too; the
  // handle captures the pointer, so the drag keeps going (and keeps its
  // resize cursor) when the pointer outruns the thin handle.
  function startResize(e, key, startWidth) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const x0 = e.clientX;
    const move = (ev) => setPrefs((p) => setColumnWidth(p, key, startWidth + ev.clientX - x0));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.setPointerCapture?.(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  const visitOf = (entry) => {
    const since = daysFrom ? customValueOf(entry, daysFrom) : '';
    return { since, next: upcomingVisit(entry, since) };
  };
  const valueOf = (entry, key) => {
    if (key === 'questions') return openFor(entry.id);
    if (key === 'images') return entry.images.length;
    if (key === 'lastVisit') return visitOf(entry).since;
    if (key === 'nextVisit') return visitOf(entry).next?.iso || '';
    return entry[key];
  };
  const sorted = sortEntries(entries, prefs.sort, valueOf);
  // Who you see now, and who you used to. Both keep whatever sort is set.
  const current = sorted.filter((e) => !isFormerEntry(e));
  const former = sorted.filter(isFormerEntry);

  /* What one column holds for one record, and whether it's a counted fact
     rather than a field. The desktop table puts it in a cell, the phone's
     cards under a label — same controls, same saving. */
  function cellParts(entry, c) {
    const title = entryTitle(entry, type);
    const label = `${c.label} for ${title}`;
    const k = `${entry.id}:${c.key}:${entry[c.key] || ''}`;
    switch (c.key) {
      case 'doctor':
        return { node: <DoctorNameButton className={styles.gridName} name={entry.doctor || title} onOpen={() => setContactId(entry.id)} /> };
      case 'link':
        return { node: <LinkField key={k} label={label} value={entry.link} onCommit={commit(entry.id, 'link')} /> };
      case 'status':
        return {
          node: (
            <select
              className={styles.statusSelect}
              aria-label={`Status of ${title}`}
              value={entry.status}
              onChange={(e) => update((l) => updateEntry(l, entry.id, { status: e.target.value }))}
            >
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          ),
        };
      case 'questions':
        return { fact: true, node: openFor(entry.id) || '—' };
      case 'images':
        return { node: <ImagesCell uid={uid} entry={entry} title={title} update={update} onOpen={(imageId) => setGallery({ entryId: entry.id, imageId })} /> };
      case 'lastVisit': {
        const { since } = visitOf(entry);
        return { fact: true, node: since && daysFrom ? formatCustomValue(daysFrom, since) : '—' };
      }
      case 'nextVisit': {
        const { next } = visitOf(entry);
        return { fact: true, overdue: !!next?.overdue, node: next ? `${next.label}${next.booked ? ' 📅' : ''}` : '—' };
      }
      default:
        return {
          node: (
            <GridField
              key={k}
              label={label}
              value={entry[c.key]}
              onCommit={commit(entry.id, c.key)}
              placeholder={GRID_PLACEHOLDER[c.key]}
              long={GRID_LONG.has(c.key)}
              wrap={!GRID_LONG.has(c.key)}
            />
          ),
        };
    }
  }

  /* The records, as a table on a desktop and cards on a phone. Called twice:
     the doctors you see now, then the ones you used to. */
  const renderRecords = (rows) => (
    <>
          {narrow ? (
            <div className={styles.cardList}>
              {rows.map((entry) => (
                <section
                  key={entry.id}
                  id={`detail-${entry.id}`}
                  className={entry.id === addedId ? `${styles.card} ${styles.cardNew}` : styles.card}
                  aria-label={entryTitle(entry, type)}
                >
                  <div className={styles.cardTitleRow}>
                    <div className={styles.cardTitle}>{entryTitle(entry, type)}</div>
                    <button
                      type="button"
                      className={styles.qDelete}
                      title={`Delete ${entryTitle(entry, type)}`}
                      aria-label={`Delete ${entryTitle(entry, type)}`}
                      onClick={() => deleteRecord(entry)}
                    >×</button>
                    {formerBtn(entry)}
                  </div>
                  {columns.map((c) => {
                    const { node, fact, overdue } = cellParts(entry, c);
                    return (
                      <div key={c.key} className={styles.cardField}>
                        <span className={styles.cardLabel}>{c.key === 'questions' ? 'Questions' : c.label}</span>
                        <div className={fact ? (overdue ? styles.cardFactOverdue : styles.cardFact) : styles.cardValue}>{node}</div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          ) : (
          <div className={styles.gridWrap}>
            <table className={`${styles.grid} ${styles.gridSized}`} style={{ width: `${tableWidth}px` }}>
              <colgroup>
                {columns.map((c) => <col key={c.key} style={{ width: `${c.width}px` }} />)}
                <col style={{ width: `${DELETE_COL_WIDTH}px` }} />
              </colgroup>
              <thead>
                <tr>
                  {columns.map((c) => {
                    const dir = prefs.sort?.key === c.key ? prefs.sort.dir : null;
                    return (
                      <th
                        key={c.key}
                        className={styles.gridTh}
                        aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                        title={c.key === 'questions' ? 'Questions still to ask' : undefined}
                      >
                        <button
                          type="button"
                          className={styles.gridSortBtn}
                          onClick={() => setPrefs((p) => ({ ...p, sort: cycleSort(p.sort, c.key) }))}
                          title={`Sort by ${c.label}`}
                        >
                          {c.label}
                          <span className={styles.gridSortMark} aria-hidden="true">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}</span>
                        </button>
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${c.label} column`}
                          title="Drag to resize · double-click to reset"
                          className={styles.gridResize}
                          onPointerDown={(e) => startResize(e, c.key, c.width)}
                          onDoubleClick={() => setPrefs((p) => setColumnWidth(p, c.key, POPUP_COLUMNS.find((x) => x.key === c.key).width))}
                        />
                      </th>
                    );
                  })}
                  <th aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr
                    key={entry.id}
                    id={`detail-${entry.id}`}
                    className={entry.id === addedId ? styles.gridRowNew : undefined}
                  >
                    {columns.map((c) => <Fragment key={c.key}>{renderCell(entry, c)}</Fragment>)}
                    <td>
                      <div className={styles.rowTools}>
                        <button
                          type="button"
                          className={styles.qDelete}
                          title={`Delete ${entryTitle(entry, type)}`}
                          aria-label={`Delete ${entryTitle(entry, type)}`}
                          onClick={() => deleteRecord(entry)}
                        >×</button>
                        {formerBtn(entry)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
    </>
  );
  const formerBtn = (entry) => (
    <button
      type="button"
      className={styles.qDelete}
      title={isFormerEntry(entry) ? `Bring ${entryTitle(entry, type)} back` : `Move ${entryTitle(entry, type)} to former doctors`}
      aria-label={isFormerEntry(entry) ? `Bring ${entryTitle(entry, type)} back` : `Move ${entryTitle(entry, type)} to former doctors`}
      onClick={() => toggleFormer(entry)}
    >{isFormerEntry(entry) ? "↺" : "⏳"}</button>
  );

  function renderCell(entry, c) {
    const { node, fact, overdue } = cellParts(entry, c);
    const cls = fact ? (overdue ? styles.gridFactOverdue : styles.gridFact) : undefined;
    return <td className={cls}>{node}</td>;
  }

  // A question's controls, shared by the desktop table and the phone's cards.
  const qCheck = (q) => (
    <input
      type="checkbox"
      className={styles.gridCheck}
      checked={q.answered}
      aria-label={q.answered ? `Mark “${q.text}” still to ask` : `Mark “${q.text}” answered`}
      onChange={() => update((l) => updateQuestion(l, q.id, { answered: !q.answered }))}
    />
  );
  const qText = (q) => (
    <input
      key={`${q.id}:t:${q.text}`}
      className={`${styles.gridInput} ${styles.gridQText}`}
      defaultValue={q.text}
      aria-label="Question"
      onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== q.text) update((l) => updateQuestion(l, q.id, { text: e.target.value })); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
  const qAnswer = (q) => (
    <input
      key={`${q.id}:a:${q.answer}`}
      className={styles.gridInput}
      defaultValue={q.answer}
      placeholder="What they said…"
      aria-label={`Answer to “${q.text}”`}
      onBlur={(e) => { if (e.target.value.trim() !== q.answer) update((l) => updateQuestion(l, q.id, { answer: e.target.value })); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
  const qDelete = (q) => (
    <button
      type="button"
      className={styles.qDelete}
      title="Delete this question"
      aria-label={`Delete “${q.text}”`}
      onClick={() => { if (window.confirm(`Delete “${q.text}”?`)) update((l) => removeQuestion(l, q.id)); }}
    >×</button>
  );

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={typeHeading(type)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned, so the name and the way out stay in reach however far down a
            long list you've scrolled — on a phone that's most of the time. */}
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>{typeHeading(type)}</h2>
          <button type="button" className={styles.modalClose} aria-label="Close" onClick={onClose}>×</button>
        </div>

        <form className={styles.modalIssueAdd} onSubmit={addIssue}>
          <div className={styles.modalSection}>Add an issue</div>
          <div className={styles.modalIssueRow}>
            <input
              className={styles.modalInput}
              value={newIssue}
              placeholder={`What's the issue? e.g. tooth pain`}
              aria-label={`New ${typeHeading(type)} issue`}
              onChange={(e) => setNewIssue(e.target.value)}
            />
            <select
              className={styles.modalInput}
              value={withId}
              aria-label="Which doctor it's with"
              onChange={(e) => setIssueWith(e.target.value)}
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>With {entryTitle(d, type)}</option>
              ))}
              <option value="">No doctor yet</option>
            </select>
            <button type="submit" className={styles.btnPrimary} disabled={!newIssue.trim()}>Add issue</button>
          </div>
        </form>

        <div className={styles.modalSection}>
          Records
          <span className={styles.groupCount}>{entries.length}</span>
          <div className={styles.gridColsWrap} ref={colsMenuRef}>
            <button
              type="button"
              className={styles.gridColsBtn}
              aria-expanded={colsOpen}
              aria-haspopup="true"
              onClick={() => setColsOpen((v) => !v)}
            >Columns ▾</button>
            {colsOpen && (
              <div className={styles.gridColsMenu} role="menu">
                {POPUP_COLUMNS.map((c) => (
                  <label key={c.key} className={styles.gridColsItem}>
                    <input
                      type="checkbox"
                      checked={prefs.shown.includes(c.key)}
                      disabled={prefs.shown.length === 1 && prefs.shown.includes(c.key)}
                      onChange={() => setPrefs((p) => toggleColumn(p, c.key))}
                    />
                    {c.key === 'questions' ? 'Questions to ask' : c.label}
                  </label>
                ))}
                <button
                  type="button"
                  className={styles.gridColsReset}
                  onClick={() => setPrefs(normalizePrefs(null))}
                >Reset columns</button>
              </div>
            )}
          </div>
        </div>
        {narrow && (
          // No headers to tap on a phone, so sorting is a picker instead.
          <div className={styles.cardSort}>
            <select
              className={styles.modalInput}
              aria-label="Sort records by"
              value={prefs.sort?.key || ''}
              onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value ? { key: e.target.value, dir: p.sort?.dir || 'asc' } : null }))}
            >
              <option value="">Sort: as listed</option>
              {columns.map((c) => <option key={c.key} value={c.key}>Sort: {c.key === 'questions' ? 'Questions to ask' : c.label}</option>)}
            </select>
            {prefs.sort && (
              <button
                type="button"
                className={styles.gridColsBtn}
                aria-label={prefs.sort.dir === 'asc' ? 'Sorted ascending — switch to descending' : 'Sorted descending — switch to ascending'}
                onClick={() => setPrefs((p) => ({ ...p, sort: { ...p.sort, dir: p.sort.dir === 'asc' ? 'desc' : 'asc' } }))}
              >{prefs.sort.dir === 'asc' ? '▲ A–Z' : '▼ Z–A'}</button>
            )}
          </div>
        )}
        {renderRecords(current)}
        <button type="button" className={styles.modalAddRecord} onClick={addRecord}>
          + Add another {typeHeading(type)} record
        </button>

        {/* Doctors you used to see. Their records are intact — issues, meds,
            pictures, questions — they are just no longer who you see now, so
            they sit down here and off the Check-ins tab. */}
        {(former.length > 0 || addingFormer) && (
          <>
            <div className={styles.modalSection} ref={formerRef}>
              Former doctors
              <span className={styles.groupCount}>{former.length}</span>
            </div>
            <p className={styles.modalHint}>Kept for the history. They don&rsquo;t show on Check-ins.</p>
            {former.length > 0 && renderRecords(former)}
          </>
        )}
        <button
          type="button"
          className={styles.modalAddRecord}
          onClick={() => { setAddingFormer(true); addRecord({ former: true }); }}
        >
          + Add a {typeHeading(type)} you used to see
        </button>

        <div className={styles.modalSection}>
          Questions
          {openCount > 0 && <span className={styles.groupCount}>{openCount}</span>}
        </div>
        {narrow ? (
          <ul className={styles.cardList}>
            {questions.length === 0 && <li className={styles.cardEmpty}>No questions yet.</li>}
            {questions.map((q) => {
              const entry = entries[entryIndex.get(q.entryId)];
              return (
                <li key={q.id} className={q.answered ? `${styles.card} ${styles.qCardDone}` : styles.card}>
                  <div className={styles.qCardRow}>
                    {qCheck(q)}
                    <div className={styles.qCardText}>{qText(q)}</div>
                    {qDelete(q)}
                  </div>
                  <div className={styles.qCardAnswer}>{qAnswer(q)}</div>
                  <div className={styles.cardLabel}>For {entryTitle(entry, type)}</div>
                </li>
              );
            })}
          </ul>
        ) : (
        <div className={styles.gridWrap}>
          <table className={`${styles.grid} ${styles.gridQuestions}`}>
            <thead>
              <tr>
                <th className={styles.gridColCheck} title="Answered">✓</th>
                <th style={{ width: '40%' }}>Question</th>
                <th style={{ width: '35%' }}>Answer</th>
                <th>For</th>
                <th className={styles.gridColCheck} />
              </tr>
            </thead>
            <tbody>
              {questions.length === 0 && (
                <tr><td colSpan={5} className={styles.gridEmpty}>No questions yet.</td></tr>
              )}
              {questions.map((q) => {
                const entry = entries[entryIndex.get(q.entryId)];
                return (
                  <tr key={q.id} className={q.answered ? styles.gridQDone : undefined}>
                    <td>{qCheck(q)}</td>
                    <td>{qText(q)}</td>
                    <td>{qAnswer(q)}</td>
                    <td className={styles.gridFact}>{entryTitle(entry, type)}</td>
                    <td>{qDelete(q)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        {entries.length > 0 && (
          <form className={styles.modalQAdd} onSubmit={addQ}>
            <input
              className={styles.modalInput}
              value={draftQ}
              placeholder="Add a question to ask…"
              aria-label="New question"
              onChange={(e) => setDraftQ(e.target.value)}
            />
            <select
              className={`${styles.modalInput} ${styles.modalQFor}`}
              value={qForId}
              aria-label="Which record it's for"
              onChange={(e) => setQFor(e.target.value)}
            >
              {entries.map((e) => <option key={e.id} value={e.id}>For {entryTitle(e, type)}</option>)}
            </select>
            <button type="submit" className={styles.btn} disabled={!draftQ.trim()}>Add</button>
          </form>
        )}
      </div>
      {galleryEntry && (
        <ImageGallery
          uid={uid}
          entry={galleryEntry}
          title={entryTitle(galleryEntry)}
          startId={gallery.imageId}
          update={update}
          onClose={closeGallery}
        />
      )}
      {contactEntry && (
        <DoctorCard
          entry={contactEntry}
          title={entryTitle(contactEntry)}
          onCommit={(patch) => update((l) => updateEntry(l, contactEntry.id, patch))}
          onClose={closeContact}
        />
      )}
    </div>
  );
}

/* ── On a phone ───────────────────────────────────────────────────────
   The table is the page on a laptop; on a phone it was four squeezed columns
   with names broken mid-word and contact details cut off the right edge, and
   editing meant hitting a cell the size of a fingertip. So below NARROW_QUERY
   the records are cards you read top to bottom, with the things you do from
   a phone — call, email, get directions — as buttons on the card, and a tap
   opens the whole record full-screen to change anything on it. */

function RecordCard({ entry, groupType, daysFrom, showStatus, onOpen, onOpenImages, onOpenType, onNewDoctor, former, onOpenFormer }) {
  const title = entryTitle(entry, groupType);
  const subtitle = entrySubtitle(entry, groupType);
  const issue = issueCell(entry, groupType);
  const since = daysFrom ? customValueOf(entry, daysFrom) : '';
  const counted = daysSinceLabel(since);
  const next = upcomingVisit(entry, since);
  const tel = telHref(entry.phone);
  const mail = mailHref(entry.email);
  const map = mapHref(entry.location);
  const link = safeLink(entry.link);
  const resolved = entry.status === STATUS.RESOLVED;
  const scheduled = !!next && !next.overdue;
  const cls = [styles.recCard, resolved && !scheduled && styles.recCardResolved, scheduled && styles.recCardScheduled]
    .filter(Boolean).join(' ');
  const hasActions = tel || mail || map || link || entry.images.length > 0 || onNewDoctor;

  return (
    <li className={cls}>
      <div
        className={styles.recMain}
        role="button"
        tabIndex={0}
        aria-label={`Open ${title}`}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      >
        <span className={styles.recHead}>
          <span className={styles.recTitleWrap}>
            <span className={styles.recTitle}>{title}</span>
            {onOpenType && <TypeChip type={entry.type} onOpen={onOpenType} className={styles.recTypeChip} />}
          </span>
          {showStatus && entry.status !== STATUS.NONE && (
            <span className={entry.status === STATUS.TREATING ? styles.badgeLive : styles.badge}>{statusLabel(entry.status)}</span>
          )}
        </span>
        {subtitle ? <span className={styles.recSub}>{subtitle}</span> : null}
        {former?.length > 0 && (
          <span
            className={styles.recWas}
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onOpenFormer(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenFormer(); } }}
          >{formerLabel(former, entry.type)} ›</span>
        )}
        {issue ? <span className={styles.recIssue}>{issue}</span> : null}
        {entry.currentMeds ? <span className={styles.recLine}><span className={styles.recKey}>Meds</span>{entry.currentMeds}</span> : null}
        {entry.notes ? <span className={styles.recNotes}>{entry.notes}</span> : null}
        {(next || counted || entry.cadence) && (
          <span className={styles.recChips}>
            {next && (
              <span className={next.booked ? styles.chipBooked : next.overdue ? styles.chipOverdue : styles.chip}>
                {next.booked ? '📅 ' : ''}Next {next.label}{next.overdue ? ` · ${-next.daysAway} days overdue` : ''}
              </span>
            )}
            {/^\d+$/.test(counted) && <span className={styles.chip}>{counted} days since</span>}
            {!next && entry.cadence ? <span className={styles.chip}>{entry.cadence}</span> : null}
          </span>
        )}
      </div>
      {hasActions && (
        <div className={styles.recActions}>
          {onNewDoctor && (
            <button type="button" className={styles.recAction} onClick={onNewDoctor}>+ New doctor</button>
          )}
          {tel && <a className={styles.recAction} href={tel}>Call</a>}
          {mail && <a className={styles.recAction} href={mail}>Email</a>}
          {map && <a className={styles.recAction} href={map} target="_blank" rel="noreferrer">Directions</a>}
          {link && <a className={styles.recAction} href={link} target="_blank" rel="noreferrer">{linkLabel(entry.link)} ↗</a>}
          {entry.images.length > 0 && (
            <button
              type="button"
              className={styles.recAction}
              aria-label={`Show ${entry.images.length} picture${entry.images.length === 1 ? '' : 's'}`}
              onClick={onOpenImages}
            >📷 {entry.images.length}</button>
          )}
        </div>
      )}
    </li>
  );
}

// A labelled field in the record sheet. Uncontrolled and committed on blur,
// like every other editor on this page, and keyed on the stored value by the
// caller so an edit syncing in from another device replaces it.
function SheetField({ label, value, onCommit, type = 'text', long = false, placeholder, inputMode }) {
  const commit = (e) => { if (e.target.value.trim() !== String(value ?? '')) onCommit(e.target.value); };
  const fit = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } };
  return (
    <label className={styles.sheetField}>
      <span className={styles.sheetLabel}>{label}</span>
      {long ? (
        <textarea
          className={styles.sheetInput}
          rows={1}
          ref={fit}
          onInput={(e) => fit(e.target)}
          defaultValue={value ?? ''}
          placeholder={placeholder}
          onBlur={commit}
        />
      ) : (
        <input
          className={styles.sheetInput}
          type={type}
          inputMode={inputMode}
          defaultValue={value ?? ''}
          placeholder={placeholder}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
        />
      )}
    </label>
  );
}

function SheetCustomField({ entry, field, onCommit }) {
  const value = customValueOf(entry, field);
  const commit = (raw) => onCommit(field.id, raw);
  if (field.type === 'checkbox') {
    return (
      <label className={styles.sheetCheck}>
        <input type="checkbox" checked={value === true} onChange={(e) => commit(e.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label className={styles.sheetField}>
        <span className={styles.sheetLabel}>{field.label}</span>
        <select className={styles.sheetInput} value={value ?? ''} onChange={(e) => commit(e.target.value)}>
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
          {value && !field.options.includes(String(value)) && <option value={value}>{String(value)}</option>}
        </select>
      </label>
    );
  }
  const type = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : field.type === 'link' ? 'url' : 'text';
  return (
    <SheetField
      key={`${field.id}:${value ?? ''}`}
      label={field.label}
      type={type}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      value={field.type === 'date' ? (value || '') : value}
      onCommit={commit}
    />
  );
}

/* One record, full-screen, every field of it editable. */
function RecordSheet({ uid, entry, list, daysFrom, update, onClose, onDelete, holdBack, onOpenImages }) {
  const commit = (key) => (value) => update((l) => updateEntry(l, entry.id, { [key]: value }));
  // A record with nothing typed into it yet is just that, not "No doctor recorded yet".
  const title = isBlank({ ...entry, type: '' }) ? 'New record' : entryTitle(entry);
  const since = daysFrom ? customValueOf(entry, daysFrom) : '';
  const next = upcomingVisit(entry, since);
  const counted = daysSinceLabel(since);
  const customFields = list.fields || [];
  const k = (key) => `${entry.id}:${key}:${entry[key] || ''}`;
  const field = (key, extra = {}) => {
    const f = FIELD_OF[key];
    return (
      <SheetField
        key={k(key)}
        label={f.label}
        value={entry[key]}
        onCommit={commit(key)}
        type={f.type === 'url' ? 'url' : f.type || 'text'}
        long={['issue', 'notes', 'currentMeds', 'previousMeds', 'location'].includes(key)}
        placeholder={f.placeholder}
        {...extra}
      />
    );
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`${styles.modalOverlay} ${styles.sheetOverlay}`} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>{title}</h2>
          <button type="button" className={styles.sheetDone} onClick={onClose}>Done</button>
        </div>

        <div className={styles.sheetStatus} role="radiogroup" aria-label="Status">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={entry.status === s}
              className={entry.status === s ? styles.sheetStatusOn : styles.sheetStatusBtn}
              onClick={() => update((l) => updateEntry(l, entry.id, { status: s }))}
            >{statusLabel(s)}</button>
          ))}
        </div>

        {(next || /^\d+$/.test(counted)) && (
          <div className={styles.recChips}>
            {next && (
              <span className={next.booked ? styles.chipBooked : next.overdue ? styles.chipOverdue : styles.chip}>
                {next.booked ? '📅 ' : ''}Next {next.label}{next.overdue ? ` · ${-next.daysAway} days overdue` : ''}
              </span>
            )}
            {/^\d+$/.test(counted) && <span className={styles.chip}>{counted} days since {daysFrom.label.toLowerCase()}</span>}
          </div>
        )}

        <div className={styles.sheetSection}>Who</div>
        <label className={styles.sheetField}>
          <span className={styles.sheetLabel}>Type</span>
          <span className={styles.sheetType}>
            <TypeField entry={entry} types={list.types} onCommit={(patch) => update((l) => updateEntry(l, entry.id, patch))} />
          </span>
        </label>
        {field('doctor')}
        {field('place')}

        <div className={styles.sheetSection}>What for</div>
        {field('issue', { placeholder: "What it's for" })}
        {field('currentMeds')}
        {field('previousMeds')}
        {field('notes')}

        <div className={styles.sheetSection}>Reaching them</div>
        {field('phone', { inputMode: 'tel' })}
        {field('email', { inputMode: 'email' })}
        {field('location')}
        {field('link', { inputMode: 'url' })}
        {field('cadence')}

        {customFields.length > 0 && (
          <>
            <div className={styles.sheetSection}>Your fields</div>
            {customFields.map((f) => (
              <SheetCustomField
                key={f.id}
                entry={entry}
                field={f}
                onCommit={(fieldId, value) => update((l) => setCustomValue(l, entry.id, fieldId, value))}
              />
            ))}
          </>
        )}

        <div className={styles.sheetSection}>Pictures</div>
        <div className={styles.sheetPictures}>
          <ImagesCell uid={uid} entry={entry} title={title} update={update} onOpen={onOpenImages} />
        </div>

        {/* Same rule as the table row's ×: on Check-ins this clears the row
            off the tab, so it says so rather than saying "delete". */}
        <button type="button" className={styles.sheetDelete} onClick={onDelete}>
          {holdBack ? `Take ${rowName(entry)} off Check-ins` : 'Delete this record'}
        </button>
      </div>
    </div>
  );
}

// The ⋯ menu on a phone: the two jobs that reshape the page rather than add to it.
function PhoneMenu({ onTypes, onColumns }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div className={styles.phoneMenuWrap} ref={ref}>
      <button type="button" className={styles.phoneIconBtn} aria-label="More" aria-expanded={open} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <div className={styles.phoneMenu} role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onTypes(); }}>Manage types</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onColumns(); }}>Fields &amp; columns</button>
        </div>
      )}
    </div>
  );
}

const HEAD_CLASS = { name: styles.cellName, daysSince: styles.cellDays, type: styles.cellType, overdue: styles.cellOverdue };

/* The speciality, on the row rather than in a heading over it.

   Check-ins is read a row at a time — "when am I next due for this?" — and a
   heading answers "which speciality?" only for as long as it is still on
   screen. So on that tab the type rides in the row it belongs to, and still
   opens the speciality's pop-up, which is what the heading used to be for. */
function TypeChip({ type, onOpen, className }) {
  const label = String(type || '').trim();
  if (!label) return null;
  return (
    <button
      type="button"
      className={className ? `${styles.typeChip} ${className}` : styles.typeChip}
      title={`Show everything for ${label}`}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      // Only the keys the cell around it acts on: swallowing everything would
      // eat the Escape that closes the pop-up this opens.
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
    >{label}</button>
  );
}

/* "Was: Dr. Uliasz" — who the speciality used to be, on the row that replaced
   them. The one filed most recently is last in the list; the rest are a count,
   because the row has no width for a queue of names and the pop-up the line
   opens lists them all anyway. */
function formerLabel(former, type) {
  const name = entryTitle(former[former.length - 1], type);
  return former.length > 1 ? `Was: ${name} +${former.length - 1}` : `Was: ${name}`;
}

function EntryRow({ entry, groupType, types, columns, daysFrom, openCell, onOpenCell, onCloseCell, onCommit, onCommitCustom, onDelete, holdBack, onOpenImages, onOpenContact, onOpenType, onNewDoctor, former, onOpenFormer }) {
  const subtitle = entrySubtitle(entry, groupType);
  const issue = issueCell(entry, groupType);
  // Once for the row: the Overdue column, the Next visit column and the row's
  // own colour are three readings of the same date.
  const lastVisit = daysFrom ? customValueOf(entry, daysFrom) : '';
  const next = upcomingVisit(entry, lastVisit);
  // Notes live under the issue unless a Notes column is carrying them, in
  // which case the Issue cell neither shows nor edits them — one field, one
  // place to type it.
  const notesColumn = columns.some((c) => c.key === 'notes');
  const fieldsIn = (col) => (col === 'issue' && notesColumn ? ['issue'] : CELL_FIELDS[col]);

  const cell = (col, className, label, display) => (
    <Cell
      key={col}
      className={className}
      label={label}
      open={openCell === col}
      onOpen={() => onOpenCell(col)}
      onClose={onCloseCell}
      display={display}
    >
      {col === 'name' && <TypeField entry={entry} types={types} onCommit={onCommit} />}
      {fieldsIn(col)?.map((key, i) => (
        <CellInput
          key={key}
          field={FIELD_OF[key]}
          value={entry[key]}
          autoFocus={i === 0 && col !== 'name'}
          onCommit={onCommit}
        />
      ))}
    </Cell>
  );

  // One built-in column, by key. Each still owns its own display — a doctor
  // name is not a phone number — so this is a switch and not a loop.
  const builtin = (col) => {
    switch (col.key) {
      // Its own column on Check-ins, where the headings are gone. Clicking it
      // opens the speciality's pop-up, which is what the heading was for.
      case 'type': return (
        <td key="type" className={styles.cellType}>
          {onOpenType ? <TypeChip type={entry.type} onOpen={onOpenType} /> : (entry.type || null)}
        </td>
      );
      case 'name': return cell('name', styles.cellName, col.label, (
        <>
          <div className={styles.nameLine}>
            <DoctorNameButton className={styles.name} name={entryTitle(entry, groupType)} onOpen={onOpenContact} />
            {onNewDoctor && (
              <button
                type="button"
                className={styles.newDoctorBtn}
                title={`Add a new ${typeHeading(entry.type)} doctor — this one moves to the former list`}
                aria-label={`Add a new ${typeHeading(entry.type)} doctor`}
                onClick={(e) => { e.stopPropagation(); onNewDoctor(); }}
                onKeyDown={(e) => e.stopPropagation()}
              >+ New doctor</button>
            )}
          </div>
          {former?.length > 0 && (
            <button
              type="button"
              className={styles.wasLine}
              title={`Show the ${typeHeading(entry.type)} doctors you used to see`}
              onClick={(e) => { e.stopPropagation(); onOpenFormer(); }}
              onKeyDown={(e) => e.stopPropagation()}
            >{formerLabel(former, entry.type)} ›</button>
          )}
          {subtitle ? <div className={styles.sub}>{subtitle}</div> : null}
          {entry.images.length > 0 && (
            <button
              type="button"
              className={styles.imageCount}
              title="Show pictures"
              aria-label={`Show ${entry.images.length} picture${entry.images.length === 1 ? '' : 's'}`}
              onClick={(e) => { e.stopPropagation(); onOpenImages(); }}
              onKeyDown={(e) => e.stopPropagation()}
            >📷 {entry.images.length}</button>
          )}
        </>
      ));
      case 'issue': return cell('issue', styles.cellIssue, col.label, (
        <>
          {issue ? <div>{issue}</div> : null}
          {!notesColumn && entry.notes ? <div className={styles.muted}>{entry.notes}</div> : null}
        </>
      ));
      case 'notes': return cell('notes', styles.cellNotes, col.label, entry.notes || null);
      case 'meds': return cell('meds', styles.cellMeds, col.label, (
        <>
          {entry.currentMeds ? <div>{entry.currentMeds}</div> : null}
          {entry.previousMeds ? <div className={styles.muted}>Was: {entry.previousMeds}</div> : null}
        </>
      ));
      case 'cadence': return cell('cadence', styles.cellCadence, col.label, entry.cadence || null);
      // Counted, not typed: there is nothing to open here, and the number
      // carries the date it counted from as its tooltip.
      case 'daysSince': {
        const counted = daysSinceLabel(lastVisit);
        return (
          <td
            key="daysSince"
            className={styles.cellDays}
            title={counted ? `${daysFrom.label}: ${formatCustomValue(daysFrom, lastVisit)}` : undefined}
          >{counted || null}</td>
        );
      }
      /* How far past due, in days — the number the tab is sorted by. Blank
         unless the date has actually gone by, so the column is empty on a
         list with nothing late on it, which is the answer you want at a
         glance. Due today reads as today rather than as 0 days. */
      case 'overdue': {
        if (!next) return <td key="overdue" className={styles.cellOverdue} />;
        if (next.due) return <td key="overdue" className={styles.cellOverdueLate}>Today</td>;
        if (!next.overdue) return <td key="overdue" className={styles.cellOverdue} />;
        const late = -next.daysAway;
        return (
          <td key="overdue" className={styles.cellOverdueLate}>{late} day{late === 1 ? '' : 's'}</td>
        );
      }
      /* Also counted: the last visit plus the cadence beside it. Empty unless
         both are there and both are readable, so a doctor with no cadence
         recorded reads as unscheduled rather than as never due. Overdue is
         marked, because a date that has quietly gone past is the one thing
         this column exists to catch. */
      case 'nextVisit': {
        if (!next) return <td key="nextVisit" className={styles.cellNext} />;
        const when = next.overdue ? ` — ${-next.daysAway} days ago`
          : next.due ? ' — today'
          : ` — in ${next.daysAway} days`;
        return (
          <td
            key="nextVisit"
            className={next.booked ? styles.cellNextBooked : next.overdue ? styles.cellNextOverdue : styles.cellNext}
            title={(next.booked
              ? `Booked: ${next.title || 'on your calendar'}`
              : `${entry.cadence} after ${daysFrom.label} ${formatCustomValue(daysFrom, lastVisit)}`) + when}
          >{next.booked ? `${next.label} 📅` : next.label}</td>
        );
      }
      // Status is a fixed set, so its cell is the select itself rather than a
      // click-to-open — there is nothing to type and nothing to cancel.
      case 'status': return (
        <td key="status" className={styles.cellStatus}>
          <select
            className={styles.statusSelect}
            aria-label={col.label}
            value={entry.status}
            onChange={(e) => onCommit({ status: e.target.value })}
          >
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </td>
      );
      default: return null;
    }
  };

  /* Two things a row says about itself before you read a word of it.

     Resolved goes grey and italic: it is history, and the list is long enough
     that the eye needs somewhere not to stop. It is not hidden — what cleared
     up the angular cheilitis is exactly what you want three years later — just
     visibly done with.

     A next visit still ahead goes green — an appointment on the calendar or a
     date counted from a cadence, either way. Green is the row saying it is
     taken care of, which is the difference between "I should sort this out"
     and "it is sorted", and it is worth being the loudest thing on the row.
     One that has gone past is not: an overdue row is the opposite of sorted,
     and its date says so in red where the column can be read.

     Both can be true at once, and there the schedule wins: an issue that
     resolved but has a follow-up ahead of it is a live thing, not history, so
     it comes back to full strength on a green row rather than staying grey and
     italic underneath it. */
  const resolved = entry.status === STATUS.RESOLVED;
  const scheduled = !!next && !next.overdue;
  const rowClass = [styles.row, resolved && styles.rowResolved, scheduled && styles.rowScheduled]
    .filter(Boolean).join(' ');

  return (
    <tr className={rowClass}>
      {columns.map((col) => (
        col.kind === 'custom' ? (
          <CustomCell
            key={col.key}
            entry={entry}
            field={col.field}
            open={openCell === `cf:${col.key}`}
            onOpen={() => onOpenCell(`cf:${col.key}`)}
            onClose={onCloseCell}
            onCommit={onCommitCustom}
          />
        ) : builtin(col)
      ))}

      <td className={styles.cellEdit}>
        {/* On Check-ins the × clears the row off the tab and nothing more, so
            it doesn't wear the colour the page uses for destroying things. */}
        <button
          type="button"
          className={`${styles.iconBtn} ${holdBack ? '' : styles.iconBtnDanger}`}
          title={holdBack
            ? `Take ${rowName(entry, groupType)} off Check-ins — the records stay`
            : `Delete ${entryTitle(entry, groupType)}`}
          onClick={onDelete}
        >×</button>
      </td>
    </tr>
  );
}

// What a Check-ins row is called when it's being talked about rather than
// read: the speciality, since that is what a row there stands for, and the
// record's own title only when it has no speciality to stand for.
const rowName = (entry, groupType) => String(entry?.type || groupType || '').trim()
  || entryTitle(entry, groupType);

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
        The headings the table is organised by, in order. Renaming one carries its
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


export function DoctorsPage() {
  const { user } = useAuth();
  const { list, loaded, update } = useDoctorList(user?.uid);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  // Which subtab is showing. Remembered, because whichever of the two you came
  // for is almost certainly the one you want again next time.
  const [lane, setLane] = useState(() => {
    try { return localStorage.getItem('rally.doctorsLane') || 'all'; } catch { return 'all'; }
  });
  const pickLane = (key) => {
    setLane(key);
    try { localStorage.setItem('rally.doctorsLane', key); } catch { /* private mode */ }
  };
  const [managingTypes, setManagingTypes] = useState(false);
  const [managingColumns, setManagingColumns] = useState(false);
  // Which single cell is open for editing: { id, col }. One at a time, so
  // clicking another cell commits the one you were in and moves on.
  const [openCell, setOpenCell] = useState(null);
  // On a phone: the record open full-screen, and whether it was just added
  // (a record added and left empty goes away again when the sheet closes).
  const narrow = useIsNarrow();
  const [sheet, setSheet] = useState(null); // { id, added }

  // A full empty list, not a hand-made partial one: the calendar strip reads
  // `calendar` and `ignoredEvents` while the real list is still loading, and
  // the partial stand-in crashed Check-ins into the error screen on a slow
  // first load — the usual case on a phone, where Check-ins is the tab it
  // remembers.
  const safeList = useMemo(() => list || normalizeList({}), [list]);
  const entries = safeList.entries;
  const counts = useMemo(() => countByStatus(entries), [entries]);
  // Status answers "how is the complaint going?", so it has nothing to say on
  // the check-ins lane, where a row is a schedule or a number worth keeping.
  // Neither the column nor the filter pills show there.
  const showStatus = lane !== 'checkins';
  // The record just added here, which holds its speciality's row on Check-ins
  // until it has something to say for itself. Kept for the session, not stored:
  // once it has a name or a cadence it earns the row on its own.
  const [justAdded, setJustAdded] = useState('');
  const groups = useMemo(
    // A status picked on Issues must not go on quietly hiding rows once the
    // pills that set it are gone, so the filter lifts with them.
    () => groupByType(safeList, { query, status: showStatus ? status : 'all', lane, pinned: justAdded }),
    [safeList, query, status, showStatus, lane, justAdded],
  );
  // The doctors each speciality used to see, for the "Was:" line under the one
  // it sees now.
  const formerByType = useMemo(() => formerDoctorsByType(safeList), [safeList]);
  const formerFor = (type) => formerByType.get(String(type || '').trim().toLowerCase()) || null;
  const lanes = useMemo(() => laneCounts(safeList), [safeList]);
  // The rows the Check-ins tab is holding back, listed under it so each has a
  // way back. Not filtered by the search box: a row you can't see is exactly
  // the one you'd go looking for.
  const heldBack = useMemo(() => offCheckInRows(safeList), [safeList]);
  // Every column, for the manager; the showing ones, for the table.
  const allColumns = useMemo(() => resolveColumns(safeList), [safeList]);
  // Dropped from the table rather than hidden for good: the Columns manager
  // still lists it, and Issues still shows it.
  const shownColumns = useMemo(() => {
    // Issues runs its own short set — see ISSUE_COLUMNS.
    if (lane === 'issues') {
      const byKey = new Map(allColumns.map((c) => [c.key, c]));
      return ISSUE_COLUMNS
        .map((key) => (key === 'notes' ? NOTES_COLUMN : byKey.get(key)))
        .filter((c) => c && !c.hidden);
    }
    const shown = allColumns.filter((c) => !c.hidden && (showStatus || c.key !== 'status'));
    if (lane !== 'checkins') return shown;
    // Overdue reads next to the date it is counted from, and falls to the end
    // if that column has been hidden.
    const at = shown.findIndex((c) => c.key === 'nextVisit');
    const withOverdue = at === -1
      ? [...shown, OVERDUE_COLUMN]
      : [...shown.slice(0, at), OVERDUE_COLUMN, ...shown.slice(at)];
    return [TYPE_COLUMN, ...withOverdue];
  }, [allColumns, showStatus, lane]);
  // Resolved once for the whole table rather than per row.
  const daysFrom = useMemo(() => daysSinceField(safeList), [safeList]);
  // The speciality whose pop-up is open, looked up in the live groups so an
  // edit syncing in from another device shows in it, and a type that has
  // emptied out closes it.
  const [detailType, setDetailType] = useState(null);
  // Opened from a "Was:" line, so the pop-up should land on the history rather
  // than on the doctor you already had in front of you.
  const [detailFocus, setDetailFocus] = useState('');
  // Every record under the speciality, not just the check-ins the heading sat
  // over: the issues filed there belong in the same pop-up. Read from the whole
  // list rather than the filtered groups, so a search doesn't hide half of it.
  const detailEntries = useMemo(
    () => (detailType === null ? [] : entries.filter((e) => sameType(e.type, detailType))),
    [entries, detailType],
  );
  const closeDetail = useCallback(() => { setDetailType(null); setDetailFocus(''); }, []);

  function handleAdd() {
    const blank = emptyEntry();
    update((l) => addEntry(l, blank));
    setManagingTypes(false);
    setManagingColumns(false);
    setJustAdded(blank.id);
    // Open the new row's first cell, so adding a record lands you in it rather
    // than leaving you to find the empty line. On a phone, open it full-screen.
    if (narrow) setSheet({ id: blank.id, added: true });
    else setOpenCell({ id: blank.id, col: 'name' });
  }

  /* A new doctor for a speciality you already see someone for.
   *
   * The one being replaced moves to the speciality's former list rather than
   * being edited over: what they treated, prescribed and were asked is the
   * history you keep a page like this for, and it stays under the speciality
   * where the new doctor will want it. The new record takes the row — pinned,
   * since a blank one would otherwise lose it back to the doctor it replaced —
   * and opens for typing, the same way + Add does. */
  function handleNewDoctor(entry) {
    const blank = normalizeEntry({ id: makeId(), type: entry.type, status: STATUS.NONE });
    update((l) => addEntry(setEntryFormer(l, entry.id, true), blank));
    setManagingTypes(false);
    setManagingColumns(false);
    setJustAdded(blank.id);
    if (narrow) setSheet({ id: blank.id, added: true });
    else setOpenCell({ id: blank.id, col: 'name' });
  }

  const openFormer = (type) => { setOpenCell(null); setDetailType(type); setDetailFocus('former'); };

  const sheetEntry = sheet ? entries.find((e) => e.id === sheet.id) : null;
  const closeSheet = useCallback(() => {
    if (sheet?.added) {
      // Read inside the update, so a field committed by the same tap that
      // closed the sheet counts.
      update((l) => {
        const e = l.entries.find((x) => x.id === sheet.id);
        return e && isBlank(e) ? removeEntry(l, sheet.id) : l;
      });
    }
    setSheet(null);
  }, [sheet, update]);

  // The record whose pictures are open from the page's own table.
  const [pageGallery, setPageGallery] = useState(null);
  // The doctor whose contact pop-up is open, from the page table.
  const [contactFor, setContactFor] = useState(null);
  const contactEntry = contactFor ? entries.find((e) => e.id === contactFor) : null;
  const closeContact = useCallback(() => setContactFor(null), []);
  const pageGalleryEntry = pageGallery ? entries.find((e) => e.id === pageGallery) : null;
  const closePageGallery = useCallback(() => setPageGallery(null), []);

  function handleDelete(entry) {
    const name = entryTitle(entry);
    // A row added and never filled in has nothing to lose, so it goes quietly.
    if (!isBlank(entry) && !window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    update((l) => removeEntry(l, entry.id));
    // Its pictures go with it; nothing else names them.
    entry.images.forEach((img) => deleteImage(user.uid, img.id).catch(() => {}));
    setOpenCell(null);
    setSheet(null);
  }

  /* What the row's × does on Check-ins.
   *
   * The tab is a schedule, and clearing something off a schedule is not the
   * same as destroying it. Deleting the record took the issues, pictures and
   * questions filed under it off every other tab as well, which is never what
   * clearing a row means — so here × holds the row back instead, reversibly,
   * and the list underneath says what is being held. Deleting for real is
   * still a click away on the other tabs and in the speciality pop-up. */
  function handleHoldBack(entry) {
    update((l) => setCheckInRowOff(l, entry, true));
    setOpenCell(null);
    setSheet(null);
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
        Who was seen for what, and how to reach them again. Click any cell to edit it.
        Only you can see this page.
      </p>

      <div className={styles.lanes} role="tablist" aria-label="Which records to show">
        {[{ key: 'all', label: 'Everything' }, ...LANES].map((l) => (
          <button
            key={l.key}
            type="button"
            role="tab"
            aria-selected={lane === l.key}
            className={lane === l.key ? styles.laneOn : styles.lane}
            onClick={() => pickLane(l.key)}
          >
            {narrow && l.key === 'all' ? 'All' : l.label} <span className={styles.laneCount}>{lanes[l.key]}</span>
          </button>
        ))}
      </div>
      <p className={styles.laneHint}>
        {lane === 'checkins'
          ? 'Whoever you see on a schedule, and anyone you just keep the number for.'
          : lane === 'issues'
            ? 'What was wrong, and who sorted it. A doctor you also see regularly shows in both tabs.'
            : lane === 'questions'
              ? 'What you mean to ask, filed under whoever you mean to ask it.'
              : 'Every record, check-ins and issues together.'}
      </p>

      {lane === 'checkins' && (
        <AppointmentsPanel list={safeList} update={update} daysFrom={daysFrom} />
      )}

      {/* Questions are the one tab that isn't a slice of the records table, so
          it replaces the table rather than filtering it. */}
      {lane === 'questions' ? <QuestionsPanel list={safeList} update={update} /> : <>

      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <input
            className={styles.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={narrow ? 'Search doctors, drugs, issues…' : 'Search a name, a drug, a street, a complaint…'}
            aria-label="Search records"
          />
          {narrow && (
            <>
              <button type="button" className={styles.phoneAddBtn} aria-label="Add a record" onClick={handleAdd}>+</button>
              <PhoneMenu
                onTypes={() => { setManagingTypes((m) => !m); setManagingColumns(false); }}
                onColumns={() => { setManagingColumns((m) => !m); setManagingTypes(false); }}
              />
            </>
          )}
        </div>
        {showStatus && (
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
        )}
        {!narrow && (
          <>
            <button
              type="button"
              className={styles.btn}
              onClick={() => { setManagingTypes((m) => !m); setOpenCell(null); }}
            >Manage types</button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => { setManagingColumns((m) => !m); setManagingTypes(false); setOpenCell(null); }}
            >Columns</button>
            <button type="button" className={styles.btnPrimary} onClick={handleAdd}>+ Add</button>
          </>
        )}
      </div>

      {managingTypes && (
        <TypeManager list={safeList} onChange={update} onClose={() => setManagingTypes(false)} />
      )}

      {managingColumns && (
        <ColumnManager list={safeList} columns={allColumns} onChange={update} onClose={() => setManagingColumns(false)} />
      )}

      {!loaded && entries.length === 0 && <div className={styles.empty}>Loading…</div>}

      {loaded && entries.length === 0 && (
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

      {groups.length > 0 && narrow && (
        <div className={styles.recList}>
          {groups.map((group) => (
            <section key={group.type || '__none__'} className={styles.recGroup}>
              {lane !== 'checkins' && (
              <h2 className={styles.recGroupHead}>
                {lane === 'checkins' ? (
                  <button
                    type="button"
                    className={styles.recGroupBtn}
                    onClick={() => setDetailType(group.type)}
                  >
                    {typeHeading(group.type)}
                    <span className={styles.groupCount}>{group.entries.length}</span>
                    <span className={styles.recGroupMore} aria-hidden="true">›</span>
                  </button>
                ) : (
                  <>
                    {typeHeading(group.type)}
                    <span className={styles.groupCount}>{group.entries.length}</span>
                  </>
                )}
              </h2>
              )}
              <ul className={styles.recCards}>
                {group.entries.map((entry) => (
                  <RecordCard
                    key={entry.id}
                    entry={entry}
                    groupType={lane === 'checkins' ? entry.type : group.type}
                    daysFrom={daysFrom}
                    showStatus={showStatus}
                    onOpen={() => setSheet({ id: entry.id, added: false })}
                    onOpenImages={() => setPageGallery(entry.id)}
                    onOpenType={lane === 'checkins' ? () => setDetailType(entry.type) : null}
                    onNewDoctor={lane === 'checkins' && entry.type ? () => handleNewDoctor(entry) : null}
                    former={lane === 'checkins' ? formerFor(entry.type) : null}
                    onOpenFormer={() => openFormer(entry.type)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {groups.length > 0 && !narrow && (
        <div className={styles.tableWrap}>
          <table className={lane === 'checkins' ? `${styles.table} ${styles.tableLeft}` : styles.table}>
            <thead>
              <tr>
                {shownColumns.map((col) => (
                  <th key={col.key} className={HEAD_CLASS[col.key]}>{col.label}</th>
                ))}
                <th className={styles.cellEdit}><span className={styles.srOnly}>Delete</span></th>
              </tr>
            </thead>

            {/* A tbody per type, so the headings stay inside the table and every
                group is measured against the same column widths. */}
            {groups.map((group) => (
              <tbody key={group.type || '__none__'}>
                {lane !== 'checkins' && (
                <tr className={styles.groupRow}>
                  <th scope="colgroup" colSpan={shownColumns.length + 1} className={styles.groupHead}>
                    {lane === 'checkins' ? (
                      <button
                        type="button"
                        className={styles.groupHeadBtn}
                        title={`Show everything for ${typeHeading(group.type)}`}
                        onClick={() => { setOpenCell(null); setDetailType(group.type); }}
                      >
                        {typeHeading(group.type)}
                        <span className={styles.groupCount}>{group.entries.length}</span>
                      </button>
                    ) : (
                      <>
                        {typeHeading(group.type)}
                        <span className={styles.groupCount}>{group.entries.length}</span>
                      </>
                    )}
                  </th>
                </tr>
                )}
                {group.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    groupType={lane === 'checkins' ? entry.type : group.type}
                    types={safeList.types}
                    columns={shownColumns}
                    daysFrom={daysFrom}
                    openCell={openCell?.id === entry.id ? openCell.col : null}
                    onOpenCell={(col) => { setOpenCell({ id: entry.id, col }); setManagingTypes(false); setManagingColumns(false); }}
                    onCloseCell={() => setOpenCell(null)}
                    onCommit={(patch) => update((l) => updateEntry(l, entry.id, patch))}
                    onCommitCustom={(fieldId, value) => update((l) => setCustomValue(l, entry.id, fieldId, value))}
                    onDelete={() => (lane === 'checkins' ? handleHoldBack(entry) : handleDelete(entry))}
                    holdBack={lane === 'checkins'}
                    onOpenImages={() => setPageGallery(entry.id)}
                    onOpenContact={() => { setOpenCell(null); setContactFor(entry.id); }}
                    onOpenType={lane === 'checkins' ? () => { setOpenCell(null); setDetailType(entry.type); } : null}
                    onNewDoctor={lane === 'checkins' && entry.type ? () => handleNewDoctor(entry) : null}
                    former={lane === 'checkins' ? formerFor(entry.type) : null}
                    onOpenFormer={() => openFormer(entry.type)}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {/* What the tab is holding back, and the way to put it back. Sits under
          the table rather than in it: these are rows you said you didn't want
          to see, so they're a footnote, not a section. */}
      {lane === 'checkins' && heldBack.length > 0 && (
        <div className={styles.heldBack}>
          <span className={styles.heldBackLabel}>Not on check-ins:</span>
          {heldBack.map((row) => (
            <button
              key={row.key}
              type="button"
              className={styles.heldBackChip}
              title={`Put ${row.label} back on Check-ins`}
              onClick={() => update((l) => setCheckInRowOff(l, row.entry, false))}
            >{row.label} ↺</button>
          ))}
        </div>
      )}

      </>}

      {contactEntry && (
        <DoctorCard
          entry={contactEntry}
          title={entryTitle(contactEntry)}
          onCommit={(patch) => update((l) => updateEntry(l, contactEntry.id, patch))}
          onClose={closeContact}
        />
      )}

      {narrow && sheetEntry && (
        <RecordSheet
          uid={user.uid}
          entry={sheetEntry}
          list={safeList}
          daysFrom={daysFrom}
          update={update}
          onClose={closeSheet}
          onDelete={() => (lane === 'checkins' ? handleHoldBack(sheetEntry) : handleDelete(sheetEntry))}
          holdBack={lane === 'checkins'}
          onOpenImages={() => setPageGallery(sheetEntry.id)}
        />
      )}

      {pageGalleryEntry && (
        <ImageGallery
          uid={user.uid}
          entry={pageGalleryEntry}
          title={entryTitle(pageGalleryEntry)}
          startId={pageGalleryEntry.images[0]?.id || null}
          update={update}
          onClose={closePageGallery}
        />
      )}

      {lane === 'checkins' && detailEntries.length > 0 && (
        <TypeDetail
          uid={user.uid}
          list={safeList}
          type={detailType}
          entries={detailEntries}
          daysFrom={daysFrom}
          update={update}
          focusFormer={detailFocus === 'former'}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  FIELDS, STATUS, STATUS_ORDER, NO_TYPE, statusLabel, typeHeading,
  normalizeEntry, normalizeList, entryTitle, entrySubtitle,
  groupByType, countByStatus, issueCell, typeUsage,
  addEntry, updateEntry, removeEntry, isBlank,
  addType, renameType, removeType, moveType,
  addField, updateField, removeField, fieldUsage, setCustomValue, customValueOf,
  resolveColumns, renameColumn, setColumnHidden, moveColumn,
  dateColumns, daysSinceField, setDaysSinceSource, daysSinceLabel,
  telHref, mailHref, mapHref, safeLink, linkLabel, makeId, seedDoctors,
} from '../lib/doctors';
import {
  CUSTOM_FIELD_TYPES, formatCustomValue, parseOptionList, optionListText, linkHref,
} from '../lib/customFields';
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

   A column shows more than one field — Contact is four of them — so opening a
   cell gives you every field that column is responsible for, stacked. That way
   the table stays six columns wide while still reaching all thirteen fields. */
const CELL_FIELDS = {
  name: ['doctor', 'place'],
  issue: ['issue', 'notes'],
  meds: ['currentMeds', 'previousMeds'],
  contact: ['phone', 'email', 'location', 'link'],
  cadence: ['cadence'],
};

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
const HEAD_CLASS = { name: styles.cellName, daysSince: styles.cellDays };

function EntryRow({ entry, groupType, types, columns, daysFrom, openCell, onOpenCell, onCloseCell, onCommit, onCommitCustom, onDelete }) {
  const tel = telHref(entry.phone);
  const mail = mailHref(entry.email);
  const map = mapHref(entry.location);
  const link = safeLink(entry.link);
  const subtitle = entrySubtitle(entry, groupType);
  const issue = issueCell(entry, groupType);

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
      {CELL_FIELDS[col]?.map((key, i) => (
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
      case 'name': return cell('name', styles.cellName, col.label, (
        <>
          <div className={styles.name}>{entryTitle(entry, groupType)}</div>
          {subtitle ? <div className={styles.sub}>{subtitle}</div> : null}
        </>
      ));
      case 'issue': return cell('issue', styles.cellIssue, col.label, (
        <>
          {issue ? <div>{issue}</div> : null}
          {entry.notes ? <div className={styles.muted}>{entry.notes}</div> : null}
        </>
      ));
      case 'meds': return cell('meds', styles.cellMeds, col.label, (
        <>
          {entry.currentMeds ? <div>{entry.currentMeds}</div> : null}
          {entry.previousMeds ? <div className={styles.muted}>Was: {entry.previousMeds}</div> : null}
        </>
      ));
      case 'contact': return cell('contact', styles.cellContact, col.label, (
        <>
          {tel ? <a className={styles.link} href={tel} onClick={(e) => e.stopPropagation()}>{entry.phone}</a> : null}
          {mail ? <a className={styles.link} href={mail} onClick={(e) => e.stopPropagation()}>{entry.email}</a> : null}
          {map ? (
            <a
              className={`${styles.link} ${styles.linkMuted}`} href={map} target="_blank" rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >{entry.location}</a>
          ) : null}
          {link ? (
            <a
              className={styles.link} href={link} target="_blank" rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >{linkLabel(entry.link)} ↗</a>
          ) : null}
        </>
      ));
      case 'cadence': return cell('cadence', styles.cellCadence, col.label, entry.cadence || null);
      // Counted, not typed: there is nothing to open here, and the number
      // carries the date it counted from as its tooltip.
      case 'daysSince': {
        const since = daysFrom ? customValueOf(entry, daysFrom) : '';
        const counted = daysSinceLabel(since);
        return (
          <td
            key="daysSince"
            className={styles.cellDays}
            title={counted ? `${daysFrom.label}: ${formatCustomValue(daysFrom, since)}` : undefined}
          >{counted || null}</td>
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

  return (
    <tr className={styles.row}>
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
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          title={`Delete ${entryTitle(entry, groupType)}`}
          onClick={onDelete}
        >×</button>
      </td>
    </tr>
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
  const [managingTypes, setManagingTypes] = useState(false);
  const [managingColumns, setManagingColumns] = useState(false);
  // Which single cell is open for editing: { id, col }. One at a time, so
  // clicking another cell commits the one you were in and moves on.
  const [openCell, setOpenCell] = useState(null);

  const safeList = useMemo(() => list || { types: [], fields: [], entries: [] }, [list]);
  const entries = safeList.entries;
  const counts = useMemo(() => countByStatus(entries), [entries]);
  const groups = useMemo(() => groupByType(safeList, { query, status }), [safeList, query, status]);
  // Every column, for the manager; the showing ones, for the table.
  const allColumns = useMemo(() => resolveColumns(safeList), [safeList]);
  const shownColumns = useMemo(() => allColumns.filter((c) => !c.hidden), [allColumns]);
  // Resolved once for the whole table rather than per row.
  const daysFrom = useMemo(() => daysSinceField(safeList), [safeList]);

  function handleAdd() {
    const blank = emptyEntry();
    update((l) => addEntry(l, blank));
    setManagingTypes(false);
    setManagingColumns(false);
    // Open the new row's first cell, so adding a record lands you in it rather
    // than leaving you to find the empty line.
    setOpenCell({ id: blank.id, col: 'name' });
  }

  function handleDelete(entry) {
    const name = entryTitle(entry);
    // A row added and never filled in has nothing to lose, so it goes quietly.
    if (!isBlank(entry) && !window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    update((l) => removeEntry(l, entry.id));
    setOpenCell(null);
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
          onClick={() => { setManagingTypes((m) => !m); setOpenCell(null); }}
        >Manage types</button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => { setManagingColumns((m) => !m); setManagingTypes(false); setOpenCell(null); }}
        >Columns</button>
        <button type="button" className={styles.btnPrimary} onClick={handleAdd}>+ Add</button>
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

      {groups.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
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
                <tr className={styles.groupRow}>
                  <th scope="colgroup" colSpan={shownColumns.length + 1} className={styles.groupHead}>
                    {typeHeading(group.type)}
                    <span className={styles.groupCount}>{group.entries.length}</span>
                  </th>
                </tr>
                {group.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    groupType={group.type}
                    types={safeList.types}
                    columns={shownColumns}
                    daysFrom={daysFrom}
                    openCell={openCell?.id === entry.id ? openCell.col : null}
                    onOpenCell={(col) => { setOpenCell({ id: entry.id, col }); setManagingTypes(false); setManagingColumns(false); }}
                    onCloseCell={() => setOpenCell(null)}
                    onCommit={(patch) => update((l) => updateEntry(l, entry.id, patch))}
                    onCommitCustom={(fieldId, value) => update((l) => setCustomValue(l, entry.id, fieldId, value))}
                    onDelete={() => handleDelete(entry)}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

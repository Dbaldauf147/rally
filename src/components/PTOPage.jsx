import { useMemo, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isGoogleCalendarConnected, connectGoogleCalendar, fetchGoogleCalendarEvents } from '../googleCalendar';
import styles from './PTOPage.module.css';

const STORAGE_KEY = 'rally.pto.v1';
const PTO_KEYWORD = 'pto';

const DEFAULT_STATE = {
  hrsPerDay: 8,
  years: [
    { year: 2026, total: 27, eoyBackup: 5, start: '2026-01-01', end: '2026-12-31' },
    { year: 2027, total: 27, eoyBackup: 5, start: '2027-01-01', end: '2027-12-31' },
  ],
  entries: [],
};

function parseLocal(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Count weekdays (Mon–Fri) inclusive between two ISO dates — a sensible default day count.
function weekdaysBetween(startIso, endIso) {
  const start = parseLocal(startIso);
  const end = parseLocal(endIso || startIso);
  if (!start || !end || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

const DAY_MS = 86400000;

// Derive all dashboard numbers for one year from the shared trip log.
function computeYear(y, entries, hrsPerDay, today) {
  const total = Number(y.total) || 0;
  const start = parseLocal(y.start);
  const end = parseLocal(y.end);

  let taken = 0;
  let planned = 0;
  entries.forEach((e) => {
    const d = parseLocal(e.start);
    if (!d || d.getFullYear() !== y.year) return;
    const days = Number(e.days) || 0;
    if (d < today) taken += days;
    else planned += days;
  });

  const unplanned = total - taken - planned;
  const hrs = total * (Number(hrsPerDay) || 0);
  const eoyBackup = Number(y.eoyBackup) || 0;
  const buffer = unplanned - eoyBackup;

  let pctYear = 0;
  let daysUntil = 0;
  let status = 'current';
  if (start && end) {
    const daysInWindow = Math.round((end - start) / DAY_MS) + 1;
    const elapsed = Math.round((today - start) / DAY_MS);
    pctYear = daysInWindow > 0 ? Math.min(1, Math.max(0, elapsed / daysInWindow)) : 0;
    daysUntil = Math.floor((today - start) / DAY_MS);
    status = today < start ? 'future' : today > end ? 'past' : 'current';
  }
  const shouldHaveTaken = Math.round(pctYear * total);

  return { total, taken, planned, unplanned, hrs, eoyBackup, buffer, pctYear, shouldHaveTaken, daysUntil, status };
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.years)) {
      return {
        hrsPerDay: Number(parsed.hrsPerDay) || 8,
        years: parsed.years,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    }
    // Migrate the old single-year shape { allotment, year, entries }.
    const yr = Number(parsed.year) || new Date().getFullYear();
    return {
      hrsPerDay: 8,
      years: [{ year: yr, total: Number(parsed.allotment) || 0, eoyBackup: 5, start: `${yr}-01-01`, end: `${yr}-12-31` }],
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function makeId() {
  return `pto-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function isoOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Derive an inclusive { startIso, endIso } from a Google Calendar event.
// All-day events use an exclusive end date, so step it back one day.
function eventRange(ev) {
  const startIso = (ev.start || '').slice(0, 10);
  if (!startIso) return null;
  let endIso = (ev.end || ev.start || '').slice(0, 10);
  if (ev.allDay && endIso) {
    const d = parseLocal(endIso);
    if (d) {
      d.setDate(d.getDate() - 1);
      endIso = isoOf(d);
    }
  }
  if (!endIso || endIso < startIso) endIso = startIso;
  return { startIso, endIso };
}

export function PTOPage() {
  const { user } = useAuth();
  const [state, setState] = useState(() => loadStored());
  const [draft, setDraft] = useState({ label: '', start: '', end: '', days: '', note: '' });
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const { hrsPerDay, years, entries } = state;
  const today = useMemo(() => startOfToday(), []);

  const sortedYears = useMemo(
    () => [...years].sort((a, b) => a.year - b.year),
    [years],
  );

  const computed = useMemo(
    () => sortedYears.map((y) => ({ y, c: computeYear(y, entries, hrsPerDay, today) })),
    [sortedYears, entries, hrsPerDay, today],
  );

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (a.start || '').localeCompare(b.start || '')),
    [entries],
  );

  const suggestedDays = useMemo(() => weekdaysBetween(draft.start, draft.end), [draft.start, draft.end]);

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  const updateYear = (year, patch) =>
    setState((s) => ({ ...s, years: s.years.map((y) => (y.year === year ? { ...y, ...patch } : y)) }));

  const addYear = () => {
    setState((s) => {
      const maxYear = s.years.reduce((m, y) => Math.max(m, y.year), new Date().getFullYear() - 1);
      const next = maxYear + 1;
      const template = s.years.find((y) => y.year === maxYear) || { total: 0, eoyBackup: 5 };
      return {
        ...s,
        years: [
          ...s.years,
          { year: next, total: template.total, eoyBackup: template.eoyBackup, start: `${next}-01-01`, end: `${next}-12-31` },
        ],
      };
    });
  };

  const removeYear = (year) => {
    if (!confirm(`Remove the ${year} column?`)) return;
    setState((s) => ({ ...s, years: s.years.filter((y) => y.year !== year) }));
  };

  const updateEntry = (id, patch) =>
    setState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const removeEntry = (id) => {
    const e = entries.find((x) => x.id === id);
    if (e && !confirm(`Remove “${e.label || 'this entry'}”?`)) return;
    setState((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== id) }));
  };

  const addDraft = () => {
    if (!draft.start) return;
    const days = draft.days !== '' ? Number(draft.days) : suggestedDays;
    setState((s) => ({
      ...s,
      entries: [
        ...s.entries,
        {
          id: makeId(),
          label: draft.label.trim() || 'Time off',
          start: draft.start,
          end: draft.end || draft.start,
          days,
          note: draft.note.trim(),
        },
      ],
    }));
    setDraft({ label: '', start: '', end: '', days: '', note: '' });
  };

  const importFromGoogle = async () => {
    setImporting(true);
    setImportMsg('');
    try {
      if (!isGoogleCalendarConnected()) await connectGoogleCalendar();

      const existingIds = new Set(entries.map((e) => e.gcalId).filter(Boolean));
      const found = [];
      for (const y of sortedYears) {
        const startD = parseLocal(y.start);
        const endD = parseLocal(y.end);
        if (!startD || !endD) continue;
        const timeMin = startD.toISOString();
        // Make the window end exclusive at end-of-day.
        const timeMax = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() + 1).toISOString();
        const events = await fetchGoogleCalendarEvents({ timeMin, timeMax, calendarId: 'primary' });
        events.forEach((ev) => {
          if (!(ev.title || '').toLowerCase().includes(PTO_KEYWORD)) return;
          if (ev.id && existingIds.has(ev.id)) return;
          const range = eventRange(ev);
          if (!range) return;
          const wd = weekdaysBetween(range.startIso, range.endIso);
          found.push({
            id: makeId(),
            gcalId: ev.id || undefined,
            label: ev.title || 'PTO',
            start: range.startIso,
            end: range.endIso,
            days: wd > 0 ? wd : 1,
            note: 'Imported from Google Calendar',
          });
          if (ev.id) existingIds.add(ev.id);
        });
      }

      if (found.length === 0) {
        setImportMsg('No new PTO events found in your year windows.');
      } else {
        setState((s) => ({ ...s, entries: [...s.entries, ...found] }));
        setImportMsg(`Added ${found.length} PTO ${found.length === 1 ? 'entry' : 'entries'} from Google Calendar.`);
      }
    } catch (err) {
      if (err.code === 'NOT_CONNECTED') setImportMsg('Connect Google Calendar to import.');
      else setImportMsg(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const fmtNum = (n) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10);
  const fmtPct = (p) => `${Math.round(p * 100)}%`;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>PTO</h1>
        <label className={styles.hrsControl}>
          <span>Hrs / day</span>
          <input
            className={styles.hrsInput}
            type="number"
            min="1"
            step="0.5"
            value={hrsPerDay}
            onChange={(e) => setState((s) => ({ ...s, hrsPerDay: e.target.value === '' ? '' : Number(e.target.value) }))}
          />
        </label>
      </div>
      <p className={styles.subtitle}>Year-by-year balance. Taken &amp; Planned roll up automatically from the trip log below.</p>

      <div className={styles.dashScroll}>
        <table className={styles.dash}>
          <thead>
            <tr>
              <th className={styles.rowHead}></th>
              {computed.map(({ y }) => (
                <th key={y.year} className={styles.yearHead}>
                  <span className={styles.yearNum}>{y.year}</span>
                  <button className={styles.yearRemove} onClick={() => removeYear(y.year)} title="Remove year">×</button>
                </th>
              ))}
              <th className={styles.addCol}>
                <button className={styles.addYearBtn} onClick={addYear} title="Add a year">+ Year</button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className={styles.hrsRow}>
              <td className={styles.rowHead}>Hrs</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={styles.numCell}>{fmtNum(c.hrs)}</td>
              ))}
              <td />
            </tr>
            <tr>
              <td className={styles.rowHead}>Total (days)</td>
              {computed.map(({ y }) => (
                <td key={y.year} className={styles.inputCell}>
                  <input
                    className={styles.cellInput}
                    type="number"
                    min="0"
                    step="0.5"
                    value={y.total}
                    onChange={(e) => updateYear(y.year, { total: e.target.value === '' ? '' : Number(e.target.value) })}
                  />
                </td>
              ))}
              <td />
            </tr>
            <tr>
              <td className={styles.rowHead}>Taken</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={styles.numCell}>{fmtNum(c.taken)}</td>
              ))}
              <td />
            </tr>
            <tr>
              <td className={styles.rowHead}>Planned</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={styles.numCell}>{fmtNum(c.planned)}</td>
              ))}
              <td />
            </tr>
            <tr className={styles.divider}>
              <td className={styles.rowHead}>Unplanned</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={`${styles.numCell} ${styles.numStrong} ${c.unplanned < 0 ? styles.numDanger : ''}`}>{fmtNum(c.unplanned)}</td>
              ))}
              <td />
            </tr>
            <tr>
              <td className={styles.rowHead}>EOY Backup</td>
              {computed.map(({ y }) => (
                <td key={y.year} className={styles.inputCell}>
                  <input
                    className={styles.cellInput}
                    type="number"
                    min="0"
                    step="0.5"
                    value={y.eoyBackup}
                    onChange={(e) => updateYear(y.year, { eoyBackup: e.target.value === '' ? '' : Number(e.target.value) })}
                  />
                </td>
              ))}
              <td />
            </tr>
            <tr className={styles.divider}>
              <td className={styles.rowHead}>Buffer</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={`${styles.numCell} ${styles.numStrong} ${c.buffer < 0 ? styles.numDanger : styles.numOk}`}>{fmtNum(c.buffer)}</td>
              ))}
              <td />
            </tr>
            <tr>
              <td className={styles.rowHead}>Should have taken</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={styles.numCell}>{c.status === 'future' ? '—' : fmtNum(c.shouldHaveTaken)}</td>
              ))}
              <td />
            </tr>
            <tr>
              <td className={styles.rowHead}>% of year</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={styles.numCell}>{c.status === 'future' ? '—' : fmtPct(c.pctYear)}</td>
              ))}
              <td />
            </tr>
            <tr>
              <td className={styles.rowHead}>Days until start</td>
              {computed.map(({ y, c }) => (
                <td key={y.year} className={styles.numCell}>{c.daysUntil}</td>
              ))}
              <td />
            </tr>
            <tr className={styles.windowRow}>
              <td className={styles.rowHead}>Window</td>
              {computed.map(({ y }) => (
                <td key={y.year} className={styles.windowCell}>
                  <input className={styles.windowInput} type="date" value={y.start} onChange={(e) => updateYear(y.year, { start: e.target.value })} />
                  <input className={styles.windowInput} type="date" value={y.end} onChange={(e) => updateYear(y.year, { end: e.target.value })} />
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.logHeader}>
        <h2 className={styles.logTitle}>Trip log</h2>
        <div className={styles.importBar}>
          <button className={styles.importBtn} onClick={importFromGoogle} disabled={importing}>
            {importing ? 'Importing…' : 'Pull PTO from Google Calendar'}
          </button>
          {importMsg && <span className={styles.importMsg}>{importMsg}</span>}
        </div>
      </div>
      <p className={styles.importHint}>Imports events titled “PTO” from your primary Google Calendar within each year window. Re-pulling is safe — already-imported events are skipped.</p>
      <div className={styles.list}>
        {sortedEntries.length === 0 && <div className={styles.empty}>No PTO logged yet. Add your first entry below.</div>}
        {sortedEntries.map((e) => (
          <div key={e.id} className={styles.entry}>
            <div className={styles.entryMain}>
              <input
                className={styles.entryLabel}
                value={e.label}
                onChange={(ev) => updateEntry(e.id, { label: ev.target.value })}
                placeholder="Label"
              />
              <div className={styles.entryDates}>
                <input className={styles.dateInput} type="date" value={e.start} onChange={(ev) => updateEntry(e.id, { start: ev.target.value })} />
                <span className={styles.dash}>→</span>
                <input className={styles.dateInput} type="date" value={e.end} onChange={(ev) => updateEntry(e.id, { end: ev.target.value })} />
              </div>
              {e.note && <div className={styles.entryNote}>{e.note}</div>}
            </div>
            <div className={styles.entryDaysWrap}>
              <input
                className={styles.daysInput}
                type="number"
                min="0"
                step="0.5"
                value={e.days}
                onChange={(ev) => updateEntry(e.id, { days: ev.target.value === '' ? '' : Number(ev.target.value) })}
              />
              <span className={styles.daysLbl}>days</span>
            </div>
            <button className={styles.removeBtn} onClick={() => removeEntry(e.id)} title="Remove">×</button>
          </div>
        ))}
      </div>

      <div className={styles.addCard}>
        <div className={styles.addTitle}>Log time off</div>
        <div className={styles.addGrid}>
          <input
            className={styles.addInput}
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="Label (e.g. Hawaii trip)"
          />
          <label className={styles.addField}>
            <span className={styles.addFieldLbl}>Start</span>
            <input className={styles.addInput} type="date" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} />
          </label>
          <label className={styles.addField}>
            <span className={styles.addFieldLbl}>End</span>
            <input className={styles.addInput} type="date" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} />
          </label>
          <label className={styles.addField}>
            <span className={styles.addFieldLbl}>Days{draft.days === '' && suggestedDays > 0 ? ` (≈${suggestedDays})` : ''}</span>
            <input
              className={styles.addInput}
              type="number"
              min="0"
              step="0.5"
              value={draft.days}
              onChange={(e) => setDraft((d) => ({ ...d, days: e.target.value }))}
              placeholder={suggestedDays ? String(suggestedDays) : '0'}
            />
          </label>
        </div>
        <input
          className={styles.addInput}
          value={draft.note}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          placeholder="Note (optional)"
          style={{ marginTop: '0.5rem', width: '100%' }}
        />
        <button className={styles.addBtn} onClick={addDraft} disabled={!draft.start}>Add entry</button>
        {draft.start && (
          <span className={styles.addHint}>
            Logs {(draft.days !== '' ? Number(draft.days) : suggestedDays) || 0} day(s) to {parseLocal(draft.start)?.getFullYear()}. Weekends are excluded from the auto count.
          </span>
        )}
      </div>
    </div>
  );
}

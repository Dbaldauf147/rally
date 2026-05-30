import { useMemo, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './HolidaysPage.module.css';

// US federal holidays for 2026. Editable in the UI — these are just seeds.
const DEFAULT_HOLIDAYS = [
  { id: 'h-2026-newyears', name: "New Year's Day", date: '2026-01-01', timeOff: true, note: '' },
  { id: 'h-2026-mlk', name: 'Martin Luther King Jr. Day', date: '2026-01-19', timeOff: true, note: '' },
  { id: 'h-2026-presidents', name: "Presidents' Day", date: '2026-02-16', timeOff: true, note: '' },
  { id: 'h-2026-memorial', name: 'Memorial Day', date: '2026-05-25', timeOff: true, note: '' },
  { id: 'h-2026-juneteenth', name: 'Juneteenth', date: '2026-06-19', timeOff: true, note: '' },
  { id: 'h-2026-july4', name: 'Independence Day', date: '2026-07-04', timeOff: true, note: '' },
  { id: 'h-2026-labor', name: 'Labor Day', date: '2026-09-07', timeOff: true, note: '' },
  { id: 'h-2026-columbus', name: 'Columbus Day', date: '2026-10-12', timeOff: true, note: '' },
  { id: 'h-2026-veterans', name: 'Veterans Day', date: '2026-11-11', timeOff: true, note: '' },
  { id: 'h-2026-thanksgiving', name: 'Thanksgiving Day', date: '2026-11-26', timeOff: true, note: '' },
  { id: 'h-2026-christmas', name: 'Christmas Day', date: '2026-12-25', timeOff: true, note: '' },
];

const STORAGE_KEY = 'rally.holidays.v1';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse an ISO yyyy-mm-dd as a *local* date to avoid timezone drift.
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

function formatLong(iso) {
  const d = parseLocal(iso);
  if (!d) return '—';
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function daysUntil(iso) {
  const d = parseLocal(iso);
  if (!d) return null;
  const today = startOfToday();
  return Math.round((d - today) / 86400000);
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HOLIDAYS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_HOLIDAYS;
    return parsed;
  } catch {
    return DEFAULT_HOLIDAYS;
  }
}

function makeId() {
  return `h-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function HolidaysPage() {
  const { user } = useAuth();
  const [holidays, setHolidays] = useState(() => loadStored());
  const [draft, setDraft] = useState({ name: '', date: '', note: '', timeOff: true });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holidays));
  }, [holidays]);

  const sorted = useMemo(
    () => [...holidays].sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    [holidays],
  );

  const nextHoliday = useMemo(() => {
    return sorted.find((h) => {
      const d = daysUntil(h.date);
      return d != null && d >= 0;
    });
  }, [sorted]);

  const offCount = useMemo(() => holidays.filter((h) => h.timeOff).length, [holidays]);

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  const update = (id, patch) =>
    setHolidays((list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const remove = (id) => {
    const h = holidays.find((x) => x.id === id);
    if (h && !confirm(`Remove “${h.name}”?`)) return;
    setHolidays((list) => list.filter((x) => x.id !== id));
  };

  const addDraft = () => {
    if (!draft.name.trim() || !draft.date) return;
    setHolidays((list) => [...list, { ...draft, name: draft.name.trim(), id: makeId() }]);
    setDraft({ name: '', date: '', note: '', timeOff: true });
  };

  const resetDefaults = () => {
    if (!confirm('Reset holidays back to the US federal defaults for 2026? This clears any edits.')) return;
    setHolidays(DEFAULT_HOLIDAYS);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Holidays</h1>
        <div className={styles.progress}>{offCount} day{offCount === 1 ? '' : 's'} off</div>
      </div>
      <p className={styles.subtitle}>Major holidays for the year — toggle which ones you’re taking off and jot plans.</p>

      {nextHoliday && (
        <div className={styles.nextCard}>
          <span className={styles.nextLabel}>Next up</span>
          <span className={styles.nextName}>{nextHoliday.name}</span>
          <span className={styles.nextMeta}>
            {formatLong(nextHoliday.date)} · {daysUntil(nextHoliday.date) === 0 ? 'today' : `in ${daysUntil(nextHoliday.date)} day${daysUntil(nextHoliday.date) === 1 ? '' : 's'}`}
          </span>
        </div>
      )}

      <div className={styles.list}>
        {sorted.map((h) => {
          const until = daysUntil(h.date);
          const isPast = until != null && until < 0;
          return (
            <div key={h.id} className={`${styles.row} ${isPast ? styles.rowPast : ''}`}>
              <label className={styles.offToggle} title="Taking this day off">
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={!!h.timeOff}
                  onChange={() => update(h.id, { timeOff: !h.timeOff })}
                />
              </label>
              <div className={styles.rowBody}>
                <input
                  className={styles.nameInput}
                  value={h.name}
                  onChange={(e) => update(h.id, { name: e.target.value })}
                  placeholder="Holiday name"
                />
                <div className={styles.rowMeta}>
                  <input
                    className={styles.dateInput}
                    type="date"
                    value={h.date}
                    onChange={(e) => update(h.id, { date: e.target.value })}
                  />
                  <span className={styles.dayBadge}>{formatLong(h.date)}</span>
                  {until != null && (
                    <span className={`${styles.countdown} ${isPast ? styles.countdownPast : ''}`}>
                      {until === 0 ? 'Today' : isPast ? `${Math.abs(until)}d ago` : `in ${until}d`}
                    </span>
                  )}
                </div>
                <input
                  className={styles.noteInput}
                  value={h.note || ''}
                  onChange={(e) => update(h.id, { note: e.target.value })}
                  placeholder="Plans / notes (optional)"
                />
              </div>
              <button className={styles.removeBtn} onClick={() => remove(h.id)} title="Remove">×</button>
            </div>
          );
        })}
      </div>

      <div className={styles.addCard}>
        <div className={styles.addTitle}>Add a holiday</div>
        <div className={styles.addRow}>
          <input
            className={styles.addName}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Name"
          />
          <input
            className={styles.addDate}
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
          />
          <label className={styles.addOff}>
            <input
              type="checkbox"
              checked={draft.timeOff}
              onChange={(e) => setDraft((d) => ({ ...d, timeOff: e.target.checked }))}
            />
            Day off
          </label>
          <button className={styles.addBtn} onClick={addDraft} disabled={!draft.name.trim() || !draft.date}>Add</button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button className={`${styles.btn} ${styles.btnDanger}`} onClick={resetDefaults}>Reset to 2026 federal holidays</button>
      </div>
    </div>
  );
}

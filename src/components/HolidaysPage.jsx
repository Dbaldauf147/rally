import { useMemo, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './HolidaysPage.module.css';

const HOLIDAY_YEAR = 2026;

// ---- Date-rule helpers (all return a local yyyy-mm-dd string) ----
const pad = (n) => String(n).padStart(2, '0');
const fixed = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m is 1-based
const isoOf = (dt) => fixed(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
// Nth occurrence of a weekday in a month. month0 is 0-based (8 = Sep); weekday 0=Sun … 6=Sat.
function nthWeekdayOfMonth(year, month0, weekday, n) {
  const first = new Date(year, month0, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return isoOf(new Date(year, month0, 1 + offset + (n - 1) * 7));
}
// Last occurrence of a weekday in a month (e.g. last Monday of May).
function lastWeekdayOfMonth(year, month0, weekday) {
  const d = new Date(year, month0 + 1, 0); // last day of the month
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
  return isoOf(d);
}
// Shift an ISO date by whole days (Memorial-Day-weekend Friday, day-after-Thanksgiving).
function shiftIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return isoOf(dt);
}

// Every holiday, defined by its recurrence rule and computed for HOLIDAY_YEAR
// (not hardcoded) — bump the year and every date recomputes. `rule` is the
// plain-English explanation shown on the page. Existing federal holidays keep
// their original ids so a saved list still matches. Month0: Jan=0 … Dec=11;
// weekday: Sun=0 … Sat=6.
const COW_HARBOR_ID = 'h-cowharbor';
const Y = HOLIDAY_YEAR;
const MEMORIAL_DAY = lastWeekdayOfMonth(Y, 4, 1); // last Mon in May
const THANKSGIVING = nthWeekdayOfMonth(Y, 10, 4, 4); // 4th Thu in Nov
const HOLIDAY_DEFS = [
  { id: 'h-2026-newyears', name: "New Year's Day", timeOff: true, rule: 'Always January 1', date: fixed(Y, 1, 1) },
  { id: 'h-2026-mlk', name: 'Martin Luther King Jr. Day', timeOff: true, rule: 'Third Monday in January', date: nthWeekdayOfMonth(Y, 0, 1, 3) },
  { id: 'h-2026-presidents', name: "Presidents' Day", timeOff: true, rule: 'Third Monday in February', date: nthWeekdayOfMonth(Y, 1, 1, 3) },
  { id: 'h-stpatricks', name: "St. Patrick's Day", timeOff: false, rule: 'Always March 17', date: fixed(Y, 3, 17) },
  { id: 'h-mothers', name: "Mother's Day", timeOff: false, rule: 'Second Sunday in May', date: nthWeekdayOfMonth(Y, 4, 0, 2) },
  { id: 'h-memorial-fri', name: 'Memorial Day Weekend', timeOff: true, rule: 'Friday before Memorial Day', date: shiftIso(MEMORIAL_DAY, -3) },
  { id: 'h-2026-memorial', name: 'Memorial Day', timeOff: true, rule: 'Last Monday in May', date: MEMORIAL_DAY },
  { id: 'h-2026-juneteenth', name: 'Juneteenth', timeOff: true, rule: 'Always June 19', date: fixed(Y, 6, 19) },
  { id: 'h-fathers', name: "Father's Day", timeOff: false, rule: 'Third Sunday in June', date: nthWeekdayOfMonth(Y, 5, 0, 3) },
  { id: 'h-2026-july4', name: 'Independence Day', timeOff: true, rule: 'Always July 4', date: fixed(Y, 7, 4) },
  { id: 'h-2026-labor', name: 'Labor Day', timeOff: true, rule: 'First Monday in September', date: nthWeekdayOfMonth(Y, 8, 1, 1) },
  { id: COW_HARBOR_ID, name: 'Cow Harbor Day', timeOff: false, rule: 'Third Saturday in September', date: nthWeekdayOfMonth(Y, 8, 6, 3) },
  { id: 'h-2026-columbus', name: 'Columbus Day', timeOff: true, rule: 'Second Monday in October', date: nthWeekdayOfMonth(Y, 9, 1, 2) },
  { id: 'h-halloween', name: 'Halloween', timeOff: false, rule: 'Always October 31', date: fixed(Y, 10, 31) },
  { id: 'h-2026-veterans', name: 'Veterans Day', timeOff: true, rule: 'Always November 11', date: fixed(Y, 11, 11) },
  { id: 'h-2026-thanksgiving', name: 'Thanksgiving Day', timeOff: true, rule: 'Fourth Thursday in November', date: THANKSGIVING },
  { id: 'h-day-after-thanksgiving', name: 'Day after Thanksgiving', timeOff: true, rule: 'Friday after Thanksgiving', date: shiftIso(THANKSGIVING, 1) },
  { id: 'h-christmas-eve', name: 'Christmas Eve', timeOff: true, rule: 'Always December 24', date: fixed(Y, 12, 24) },
  { id: 'h-2026-christmas', name: 'Christmas Day', timeOff: true, rule: 'Always December 25', date: fixed(Y, 12, 25) },
  { id: 'h-newyears-eve', name: "New Year's Eve", timeOff: true, rule: 'Always December 31', date: fixed(Y, 12, 31) },
];

// Rule text looked up by id, so a saved holiday list (no `rule` field yet) still
// shows its rule.
const HOLIDAY_RULES = Object.fromEntries(HOLIDAY_DEFS.map((h) => [h.id, h.rule]));

const DEFAULT_HOLIDAYS = HOLIDAY_DEFS.map((h) => ({ ...h, note: '' }));

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
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_HOLIDAYS;
    // One-time backfill of newly-added holidays (Cow Harbor Day, the eve/weekend
    // days, Mother's/Father's Day, etc.) for users who already had a saved list.
    // Matched by id so nothing duplicates; the flag means later deletions stick.
    if (!localStorage.getItem('rally.holidays.seed.v2')) {
      const have = new Set(parsed.map((h) => h.id));
      const missing = DEFAULT_HOLIDAYS.filter((h) => !have.has(h.id));
      if (missing.length) parsed = [...parsed, ...missing];
      localStorage.setItem('rally.holidays.seed.v2', '1');
    }
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

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thOff} title="Taking this day off">Off</th>
              <th>Holiday</th>
              <th>Date</th>
              <th>When it lands</th>
              <th>Notes</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => {
              const until = daysUntil(h.date);
              const isPast = until != null && until < 0;
              return (
                <tr key={h.id} className={isPast ? styles.rowPast : ''}>
                  <td className={styles.tdOff}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={!!h.timeOff}
                      onChange={() => update(h.id, { timeOff: !h.timeOff })}
                      title="Taking this day off"
                    />
                  </td>
                  <td>
                    <input
                      className={styles.nameInput}
                      value={h.name}
                      onChange={(e) => update(h.id, { name: e.target.value })}
                      placeholder="Holiday name"
                    />
                  </td>
                  <td>
                    <div className={styles.dateCell}>
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
                  </td>
                  <td>
                    <span className={styles.ruleCell}>{h.rule || HOLIDAY_RULES[h.id] || '—'}</span>
                  </td>
                  <td>
                    <input
                      className={styles.noteInput}
                      value={h.note || ''}
                      onChange={(e) => update(h.id, { note: e.target.value })}
                      placeholder="Plans / notes"
                    />
                  </td>
                  <td>
                    <button className={styles.removeBtn} onClick={() => remove(h.id)} title="Remove">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

import { useMemo, useState } from 'react';
import { useEvents } from '../hooks/useEvents';
import { getHolidayMap } from '../holidays';
import { busyDays, suggestDates, rangesSpan, cleanRanges, defaultSuggestSetup, toYmd, fromYmd, addDays } from '../lib/dateSuggest';
import { DateField } from './DateField';
import styles from './DatePoll.module.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayLabel = (ymd, today) => fromYmd(ymd).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric',
  ...(ymd.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
});

/* The organizer's shortcut on a recurring round's poll: say which stretch of
   days and which days of the week, and get back the ones the Rally calendar
   has them free on, ready to put on the poll (lib/dateSuggest.js).

   Nothing is added until the button is pressed, and every date can be unticked
   first. `options` are the dates already on the poll; `otherPolls` is the
   poll's own map of days other events are still voting on, shown as a caution
   beside a date rather than a reason to drop it. `onAdd(days)` writes them. */
export function DateSuggester({ eventId, window: pollWindow, options, otherPolls, onAdd }) {
  const { events } = useEvents();
  const today = toYmd(new Date());
  const [open, setOpen] = useState(false);
  const [ranges, setRanges] = useState([]);
  const [weekdays, setWeekdays] = useState([]);
  // The starting range and weekdays are worked out on first opening rather
  // than on mount: the poll's options arrive a moment after the page does, and
  // the weekdays come from them.
  const [started, setStarted] = useState(false);
  function openPanel() {
    if (!started) {
      const setup = defaultSuggestSetup({ window: pollWindow, options, today });
      setRanges(setup.ranges);
      setWeekdays(setup.weekdays);
      setStarted(true);
    }
    setOpen(true);
  }
  // Unticked dates are remembered, not ticked ones, so a date that turns up
  // after a change to the ranges starts out included.
  const [skipped, setSkipped] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);

  const taken = useMemo(() => {
    const days = [];
    (options || []).forEach((o) => {
      if (!o.startDate) return;
      for (let d = o.startDate; d <= (o.endDate || o.startDate) && days.length < 2000; d = addDays(d, 1)) days.push(d);
    });
    return days;
  }, [options]);

  const result = useMemo(() => {
    const span = rangesSpan(ranges);
    const busy = span ? busyDays(events, { ...span, excludeId: eventId }) : new Map();
    return suggestDates({ ranges, weekdays, busy, taken, today });
  }, [ranges, weekdays, events, eventId, taken, today]);

  const holidays = useMemo(
    () => getHolidayMap([...new Set(result.dates.map((d) => Number(d.slice(0, 4))))]),
    [result.dates],
  );
  const cautions = (day) => [
    ...(holidays[day] || []),
    ...(otherPolls?.get(day) || []).map((t) => `also on the poll for ${t}`),
  ];

  const chosen = result.dates.filter((d) => !skipped.has(d));
  const badRange = ranges.length !== cleanRanges(ranges).length;
  const setRange = (i, patch) => { setAdded(0); setRanges((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); };
  const toggleDay = (wd) => { setAdded(0); setWeekdays((w) => (w.includes(wd) ? w.filter((x) => x !== wd) : [...w, wd].sort())); };
  const toggleDate = (d) => setSkipped((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });

  async function add() {
    if (chosen.length === 0 || adding) return;
    setAdding(true);
    try {
      await onAdd(chosen);
      setAdded(chosen.length);
    } finally {
      setAdding(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.altRangeAddBtn} style={{ margin: '0 0 0.75rem' }} data-testid="suggest-open" onClick={openPanel}>
        ✨ Suggest dates from my availability
      </button>
    );
  }

  return (
    <div className={styles.suggestBox} data-testid="suggest-panel">
      <div className={styles.suggestHead}>
        <strong>✨ Suggest dates from my availability</strong>
        <button type="button" className={styles.suggestLink} onClick={() => setOpen(false)}>Close</button>
      </div>
      <p className={styles.suggestHint}>
        Pick the stretch of days and the days of the week you’d have it on. Days with a Rally event already on your calendar are left out.
      </p>

      <div className={styles.suggestLabel}>Between</div>
      {ranges.map((r, i) => (
        <div key={i} className={styles.suggestRange} data-testid="suggest-range">
          <DateField className={styles.suggestDate} value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} aria-label={`Range ${i + 1} from`} clearable={false} />
          <span className={styles.suggestHint}>to</span>
          <DateField className={styles.suggestDate} value={r.to} min={r.from || undefined} onChange={(e) => setRange(i, { to: e.target.value })} aria-label={`Range ${i + 1} to`} clearable={false} />
          {ranges.length > 1 && (
            <button type="button" className={styles.suggestLink} onClick={() => { setAdded(0); setRanges((rs) => rs.filter((_, j) => j !== i)); }} aria-label={`Remove range ${i + 1}`}>✕</button>
          )}
        </div>
      ))}
      <button
        type="button"
        className={styles.suggestLink}
        onClick={() => {
          const last = ranges[ranges.length - 1];
          const from = last?.to ? addDays(last.to, 1) : today;
          setRanges((rs) => [...rs, { from, to: addDays(from, 13) }]);
        }}
      >+ Add another range</button>
      {badRange && <p className={styles.suggestWarn}>A range needs a start and an end, in that order, no more than about a year apart.</p>}

      <div className={styles.suggestLabel}>On</div>
      <div className={styles.suggestDays} role="group" aria-label="Days of the week">
        {WEEKDAYS.map((name, wd) => (
          <button key={name} type="button" aria-pressed={weekdays.includes(wd)} className={weekdays.includes(wd) ? styles.suggestDayOn : styles.suggestDay} onClick={() => toggleDay(wd)}>
            {name}
          </button>
        ))}
      </div>

      <div className={styles.suggestLabel} data-testid="suggest-count">
        {result.dates.length === 0 ? 'No free dates' : `${result.dates.length} free date${result.dates.length === 1 ? '' : 's'}`}
      </div>
      {result.dates.length === 0 && (
        <p className={styles.suggestHint}>
          {weekdays.length === 0 ? 'Tick at least one day of the week.' : 'Nothing fits. Try a longer range or more days of the week.'}
        </p>
      )}
      {result.dates.length > 0 && (
        <ul className={styles.suggestList} data-testid="suggest-dates">
          {result.dates.map((d) => {
            const notes = cautions(d);
            return (
              <li key={d}>
                <label className={styles.suggestItem}>
                  <input type="checkbox" checked={!skipped.has(d)} onChange={() => toggleDate(d)} />
                  <span>{dayLabel(d, today)}</span>
                  {notes.length > 0 && <span className={styles.suggestCaution}>⚠ {notes.join(' · ')}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {result.truncated && <p className={styles.suggestWarn}>Showing the first {result.dates.length}. Narrow the range or the days to see the rest.</p>}

      {result.busy.length > 0 && (
        <p className={styles.suggestHint} data-testid="suggest-busy">
          Left out, you’re busy: {result.busy.map((b) => `${dayLabel(b.date, today)} (${b.titles.join(', ')})`).join('; ')}.
        </p>
      )}
      {result.taken.length > 0 && (
        <p className={styles.suggestHint}>Already on the poll: {result.taken.map((d) => dayLabel(d, today)).join('; ')}.</p>
      )}

      <div className={styles.suggestActions}>
        <button type="button" className={styles.submitBtn} disabled={chosen.length === 0 || adding} onClick={add} data-testid="suggest-add">
          {adding ? 'Adding…' : `Add ${chosen.length} date${chosen.length === 1 ? '' : 's'} to the poll`}
        </button>
        {added > 0 && <span className={styles.suggestDone}>✓ Added {added}</span>}
      </div>
    </div>
  );
}

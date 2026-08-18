import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, differenceInCalendarDays } from 'date-fns';
import { useEvents } from '../hooks/useEvents';
import { EventForm } from './EventForm';
import {
  isRecurring,
  normalizeRecurrence,
  describeRecurrence,
  nextOccurrence,
  occurrenceForYear,
} from '../lib/recurrence';
import styles from './RecurringPage.module.css';

// How many future occurrences to preview after the next one. Enough to make the
// rule obvious ("oh, it really is the third Saturday every year") without
// turning each row into a wall of dates.
const PREVIEW_YEARS = 3;

// Occurrences after the next one, so a row can show where the series is headed.
function upcomingAfter(event, next) {
  if (!next) return [];
  const rule = normalizeRecurrence(event.recurrence);
  const out = [];
  for (let year = next.year + 1; out.length < PREVIEW_YEARS; year++) {
    if (rule.endYear !== null && year > rule.endYear) break;
    const occ = occurrenceForYear(event, year);
    if (occ) out.push(occ);
  }
  return out;
}

function countdownLabel(start, now) {
  const days = differenceInCalendarDays(start, now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export function RecurringPage() {
  const { events, updateEvent } = useEvents();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState(null);
  const [showEnded, setShowEnded] = useState(false);

  // `now` is frozen per render pass so every countdown on the page agrees.
  const now = useMemo(() => new Date(), []);

  const { active, ended } = useMemo(() => {
    const rows = events
      .filter(e => isRecurring(e) && !e.cancelled)
      .map(e => {
        const next = e.dateTBD ? null : nextOccurrence(e, now);
        return { event: e, next, later: upcomingAfter(e, next) };
      });
    // Soonest first; a series with no upcoming occurrence (ended, or date TBD)
    // has nothing to sort by, so it drops to its own list below.
    const active = rows.filter(r => r.next).sort((a, b) => a.next.start - b.next.start);
    const ended = rows.filter(r => !r.next);
    return { active, ended };
  }, [events, now]);

  const editing = editingId ? events.find(e => e.id === editingId) : null;
  const total = active.length + ended.length;

  function renderRow({ event, next, later }) {
    return (
      <div key={event.id} className={next ? styles.row : `${styles.row} ${styles.rowEnded}`}>
        <div className={styles.rowMain}>
          <button type="button" className={styles.rowTitle} onClick={() => navigate(`/event/${event.id}`)}>
            {event.title || '(untitled)'}
          </button>
          <div className={styles.rule}>🔁 {describeRecurrence(event.recurrence)}</div>
          {event.location && <div className={styles.location}>📍 {event.location}</div>}
        </div>

        <div className={styles.rowDates}>
          {next ? (
            <>
              <div className={styles.nextDate}>
                {format(next.start, 'EEE, MMM d yyyy')}
                <span className={styles.countdown}>{countdownLabel(next.start, now)}</span>
              </div>
              {later.length > 0 && (
                <div className={styles.laterDates}>
                  then {later.map(o => format(o.start, 'MMM d yyyy')).join(' · ')}
                </div>
              )}
            </>
          ) : (
            <div className={styles.nextDate}>
              {event.dateTBD ? 'Date TBD' : 'Series has ended'}
            </div>
          )}
        </div>

        <div className={styles.rowActions}>
          <button type="button" className={styles.btn} onClick={() => setEditingId(event.id)}>Edit</button>
          <button type="button" className={styles.btn} onClick={() => navigate(`/event/${event.id}`)}>Open</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Repeating Events</h1>
          <p className={styles.subtitle}>
            {total === 0
              ? 'Events set to repeat every year will show up here.'
              : `${total} ${total === 1 ? 'series' : 'series'} repeating every year.`}
          </p>
        </div>
      </div>

      {total === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🔁</div>
          <h2 className={styles.emptyTitle}>No repeating events yet</h2>
          <p className={styles.emptyDesc}>
            Turn on “Repeats every year” when you create or edit an event — birthdays, anniversaries,
            the annual trip — and it will be listed here so you can edit the whole series in one place.
          </p>
          <button type="button" className={styles.primaryBtn} onClick={() => navigate('/')}>Go to Dashboard</button>
        </div>
      ) : (
        <>
          <div className={styles.list}>{active.map(renderRow)}</div>

          {ended.length > 0 && (
            <div className={styles.endedSection}>
              <button type="button" className={styles.toggle} onClick={() => setShowEnded(v => !v)}>
                {showEnded ? '▾' : '▸'} Ended or undated ({ended.length})
              </button>
              {showEnded && <div className={styles.list}>{ended.map(renderRow)}</div>}
            </div>
          )}
        </>
      )}

      {editing && (
        <div className={styles.modalOverlay} onClick={() => setEditingId(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setEditingId(null)}>&times;</button>
            <EventForm
              event={editing}
              onSave={async (data) => { await updateEvent(editing.id, data); setEditingId(null); }}
              onCancel={() => setEditingId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

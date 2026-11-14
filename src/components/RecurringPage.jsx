import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, differenceInCalendarDays } from 'date-fns';
import { useEvents } from '../hooks/useEvents';
import { useAuth } from '../contexts/AuthContext';
import { guestListReviewYear } from '../lib/guestListReview';
import { EventForm } from './EventForm';
import {
  isRecurring,
  normalizeRecurrence,
  describeRecurrence,
  nextOccurrence,
  occurrenceForYear,
} from '../lib/recurrence';
import { normalizePollSeries, describePollSeries, seriesStatus, sendDateLabel } from '../lib/pollSeries';
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
  const { user } = useAuth();
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
        return { event: e, next, later: upcomingAfter(e, next), sortDate: next?.start || null };
      });
    // The other kind of repeat: a series whose date is polled each round
    // (lib/pollSeries.js). One row per series — its latest round. These have
    // no date rule to compute from, so the row says where the round stands.
    const polled = events
      .filter(e => !isRecurring(e))
      .map(e => ({ event: e, series: seriesStatus(e, now) }))
      .filter(r => r.series)
      .map(r => ({ ...r, sortDate: r.series.sortDate }));
    // Soonest first. A yearly series with no upcoming occurrence (ended, or
    // date TBD) drops to its own list below; a polled series is live for as
    // long as its latest round exists, so it stays up top, undated ones last.
    const when = (r) => (r.sortDate ? r.sortDate.getTime() : Infinity);
    const active = [...rows.filter(r => r.next), ...polled].sort((a, b) => when(a) - when(b));
    const ended = rows.filter(r => !r.next);
    return { active, ended };
  }, [events, now]);

  const editing = editingId ? events.find(e => e.id === editingId) : null;
  const total = active.length + ended.length;

  // A polled series: the same row, but the date column reports the round.
  function renderSeriesRow({ event, series }) {
    const round = normalizePollSeries(event.pollSeries).round;
    const today = format(now, 'yyyy-MM-dd');
    const send = (ymd) => sendDateLabel(ymd, today);
    const nextPoll = series.nextSend
      ? `next round’s poll goes out ${send(series.nextSend)}`
      : 'next round opens once this one has passed';
    return (
      <div key={event.id} className={styles.row} data-testid="poll-series-row">
        <div className={styles.rowMain}>
          <button type="button" className={styles.rowTitle} onClick={() => navigate(`/event/${event.id}`)}>
            {event.title || '(untitled)'}
          </button>
          <div className={styles.rule}>🔁 {describePollSeries(event.pollSeries)} · round {round}</div>
          {event.location && <div className={styles.location}>📍 {event.location}</div>}
        </div>

        <div className={styles.rowDates}>
          {series.state === 'voting' ? (
            <>
              <div className={styles.nextDate}>Date being voted on</div>
              {series.sendDate && (
                <div className={styles.laterDates}>
                  {series.sent ? 'poll is out' : `poll goes out ${send(series.sendDate)}`}
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.nextDate}>
                {format(series.date, 'EEE, MMM d yyyy')}
                <span className={styles.countdown}>{countdownLabel(series.date, now)}</span>
              </div>
              <div className={styles.laterDates}>{nextPoll}</div>
            </>
          )}
        </div>

        <div className={styles.rowActions}>
          <button type="button" className={styles.btn} onClick={() => setEditingId(event.id)}>Edit</button>
          <button type="button" className={styles.btn} onClick={() => navigate(`/event/${event.id}`)}>Open</button>
        </div>
      </div>
    );
  }

  function renderRow(row) {
    if (row.series) return renderSeriesRow(row);
    const { event, next, later } = row;
    // Only the organizer confirms a guest list, so only they are nudged.
    const isOrganizer = event.members?.[user?.uid]?.role === 'owner' || (!!user?.uid && event.createdBy === user.uid);
    const reviewYear = isOrganizer ? guestListReviewYear(event) : null;
    return (
      <div key={event.id} className={next ? styles.row : `${styles.row} ${styles.rowEnded}`}>
        <div className={styles.rowMain}>
          <button type="button" className={styles.rowTitle} onClick={() => navigate(`/event/${event.id}`)}>
            {event.title || '(untitled)'}
          </button>
          <div className={styles.rule}>🔁 {describeRecurrence(event.recurrence)}</div>
          {event.location && <div className={styles.location}>📍 {event.location}</div>}
          {reviewYear && (
            <button type="button" className={styles.reviewDue} data-testid="guest-list-due" onClick={() => navigate(`/event/${event.id}`)}>
              📋 Confirm the {reviewYear} guest list
            </button>
          )}
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
          <h1 className={styles.title}>Recurring Events</h1>
          <p className={styles.subtitle}>
            {total === 0
              ? 'Events set to repeat will show up here.'
              : `${total} recurring series.`}
          </p>
        </div>
      </div>

      {total === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🔁</div>
          <h2 className={styles.emptyTitle}>No recurring events yet</h2>
          <p className={styles.emptyDesc}>
            Set an event to repeat when you create or edit it — on a fixed date every year, or on a
            schedule with a poll picking the date each time — and it will be listed here so you can
            edit the whole series in one place.
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

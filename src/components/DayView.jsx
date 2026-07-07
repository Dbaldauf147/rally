import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import styles from './DayView.module.css';

// Robustly turn a Firestore Timestamp / cached {seconds} / ISO string / Date
// into a JS Date (or null). Works against live and offline-cached event data.
function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function parseYmd(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  if (!m) return '';
  let h = Number(m[1]);
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ap}`;
}
function typeMeta(it) {
  if (it.isFlight || it.type === 'flight') return { icon: '✈️', label: 'Flight' };
  switch (it.type) {
    case 'travel': return { icon: '🚗', label: 'Travel' };
    case 'lodging': return { icon: '🏨', label: 'Lodging' };
    case 'booking': return { icon: '🎟️', label: 'Booking' };
    default: return { icon: '📍', label: 'Activity' };
  }
}

// A focused, read-only view of a single trip day: everything scheduled for that
// date, ordered by time, with prev/next-day and tap-a-day navigation. Editing
// stays in the Itinerary tab; this is the "what's happening today" lens.
export function DayView({ event }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const { allKeys, spanKeys } = useMemo(() => {
    const start = toDate(event.date);
    const end = toDate(event.endDate) || start;
    const span = [];
    if (start) {
      const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const e = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : s;
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) span.push(ymd(d));
    }
    const itemDates = (event.itinerary || []).map((it) => it.date).filter(Boolean);
    const all = Array.from(new Set([...span, ...itemDates])).sort();
    return { allKeys: all, spanKeys: span };
  }, [event.date, event.endDate, event.itinerary]);

  // Item count per day, so the chip strip can flag which days have plans.
  const countByDay = useMemo(() => {
    const m = {};
    for (const it of (event.itinerary || [])) if (it.date) m[it.date] = (m[it.date] || 0) + 1;
    return m;
  }, [event.itinerary]);

  if (allKeys.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>🗓️</div>
        <p>This trip doesn’t have dates yet. Finalize the dates to plan day by day.</p>
      </div>
    );
  }

  const todayKey = ymd(new Date());
  const paramDay = searchParams.get('day');
  const selectedKey = allKeys.includes(paramDay)
    ? paramDay
    : allKeys.includes(todayKey) ? todayKey : allKeys[0];
  const idx = allKeys.indexOf(selectedKey);
  const prevKey = idx > 0 ? allKeys[idx - 1] : null;
  const nextKey = idx < allKeys.length - 1 ? allKeys[idx + 1] : null;

  function goTo(key) {
    if (!key) return;
    const next = new URLSearchParams(searchParams);
    next.set('day', key);
    setSearchParams(next, { replace: true });
  }

  const dayNum = spanKeys.indexOf(selectedKey); // -1 if the date is outside the trip span
  const dateObj = parseYmd(selectedKey);
  const dateLabel = dateObj ? format(dateObj, 'EEEE, MMMM d') : selectedKey;

  const dayItems = (event.itinerary || [])
    .filter((it) => it.date === selectedKey)
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || (a.title || '').localeCompare(b.title || ''));

  return (
    <div className={styles.dayView}>
      {/* Prev / label / next */}
      <div className={styles.nav}>
        <button className={styles.navBtn} onClick={() => goTo(prevKey)} disabled={!prevKey} aria-label="Previous day">←</button>
        <div className={styles.navLabel}>
          {dayNum >= 0 && <span className={styles.dayNum}>Day {dayNum + 1}</span>}
          <span className={styles.dayDate}>{dateLabel}</span>
        </div>
        <button className={styles.navBtn} onClick={() => goTo(nextKey)} disabled={!nextKey} aria-label="Next day">→</button>
      </div>

      {/* Tap any day */}
      <div className={styles.chips}>
        {allKeys.map((key) => {
          const d = parseYmd(key);
          const inSpan = spanKeys.includes(key);
          return (
            <button
              key={key}
              className={`${styles.chip} ${key === selectedKey ? styles.chipActive : ''}`}
              onClick={() => goTo(key)}
              title={d ? format(d, 'EEEE, MMMM d') : key}
            >
              <span className={styles.chipTop}>{inSpan ? `Day ${spanKeys.indexOf(key) + 1}` : (d ? format(d, 'EEE') : '—')}</span>
              <span className={styles.chipBottom}>{d ? format(d, 'M/d') : key}</span>
              {countByDay[key] > 0 && <span className={styles.chipDot} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {/* The day's schedule */}
      {dayItems.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🌤️</div>
          <p>Nothing planned for this day yet.</p>
        </div>
      ) : (
        <div className={styles.timeline}>
          {dayItems.map((it) => {
            const meta = typeMeta(it);
            const timeStr = fmtTime(it.time);
            return (
              <div key={it.id} className={styles.item}>
                <div className={styles.itemTime}>{timeStr || <span className={styles.allDay}>All day</span>}</div>
                <div className={styles.itemBody}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemTitle}>{it.title || meta.label}</span>
                    <span className={styles.itemType}>{meta.icon} {meta.label}</span>
                  </div>
                  {(it.isFlight || it.type === 'flight') && (it.airline || it.flightNumber || it.arrivalTime) && (
                    <div className={styles.itemMeta}>
                      {[it.airline, it.flightNumber].filter(Boolean).join(' ')}
                      {it.arrivalTime && <> · {timeStr || 'dep'} → {fmtTime(it.arrivalTime)}</>}
                    </div>
                  )}
                  {it.type === 'lodging' && (it.hotelName || it.roomType) && (
                    <div className={styles.itemMeta}>{[it.hotelName, it.roomType].filter(Boolean).join(' · ')}</div>
                  )}
                  {it.location && <div className={styles.itemLoc}>📍 {it.location}</div>}
                  {it.notes && <div className={styles.itemNotes}>{it.notes}</div>}
                  {it.url && (
                    <a className={styles.itemLink} href={it.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

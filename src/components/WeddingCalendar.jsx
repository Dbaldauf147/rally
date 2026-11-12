import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  EVENT_KINDS, calendarEntries, dayLabel, entriesByDay, formatTime, monthGrid, monthLabel, newEventId,
  normalizeCalendar, removeEvent, saveEvent, shiftMonth, upcomingEntries,
} from '../lib/weddingCalendar';
import { daysUntil, localToday, normalizeTimeline, seedTimeline } from '../lib/weddingTimeline';
import { normalizeVenue } from '../lib/weddingVenues';
import styles from './WeddingPage.module.css';
import cs from './WeddingCalendar.module.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

// The colour of an entry: by where it comes from, then by what it is.
const chipClass = (e) => (e.wedding ? cs.kWedding
  : e.source === 'timeline' ? (e.kind === 'Milestone' ? cs.kMilestone : cs.kTimeline)
    : e.source === 'venue' ? cs.kVenue
      : e.kind === 'Payment due' || e.kind === 'Deadline' ? cs.kDue : cs.kEvent);

const awayLabel = (date, today) => {
  const n = daysUntil(date, today);
  if (n === null) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
};

/* Wedding → Calendar: a month at a time. Your own events (tours, tastings,
   payments due) are added and edited here; the Timeline's items and the
   dates venues have open are shown alongside and edited on their own tabs.
   lib/weddingCalendar.js gathers the three. */
export function WeddingCalendar({ onOpenTab }) {
  const { user } = useAuth();
  const today = localToday();
  const [calendar, setCalendar] = useState({ events: [] });
  const [timeline, setTimeline] = useState(null);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [show, setShow] = useState({ timeline: true, venues: true });
  const [draft, setDraft] = useState(null); // the event being added or edited

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() || {};
      setCalendar(normalizeCalendar(data.weddingCalendar));
      setTimeline(data.weddingTimeline ? normalizeTimeline(data.weddingTimeline) : seedTimeline());
      setVenues(Array.isArray(data.weddingVenues) ? data.weddingVenues.map((v) => normalizeVenue(v)) : []);
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  const calRef = useRef(calendar);
  useEffect(() => { calRef.current = calendar; }, [calendar]);
  const save = (change) => {
    const next = change(calRef.current);
    if (next === calRef.current) return;
    calRef.current = next;
    setCalendar(next);
    if (!user) return;
    setDoc(doc(db, 'users', user.uid), { weddingCalendar: next }, { merge: true })
      .then(() => setError(''))
      .catch((err) => setError(`Could not save: ${err.message}`));
  };

  const entries = useMemo(() => calendarEntries({ calendar, timeline, venues }, show), [calendar, timeline, venues, show]);
  const byDay = useMemo(() => entriesByDay(entries), [entries]);
  const weeks = useMemo(() => { const [y, m] = month.split('-').map(Number); return monthGrid(y, m); }, [month]);
  // Venue open dates are a backdrop, not a to-do, so "coming up" leaves them out.
  const upcoming = useMemo(() => upcomingEntries(entries.filter((e) => e.source !== 'venue'), today, 8), [entries, today]);
  const weddingDate = timeline?.date || '';
  const untilWedding = daysUntil(weddingDate, today);
  const venueDates = venues.some((v) => v.availableDates?.length);

  const goTo = (date) => { setMonth(date.slice(0, 7)); setSelected(date); };
  const openNew = (date) => setDraft({ id: newEventId(), date, time: '', title: '', kind: EVENT_KINDS[0], note: '', done: false, isNew: true });
  const closeDraft = () => setDraft(null);
  const submitDraft = () => {
    if (!draft.title.trim() || !draft.date) return;
    const { isNew: _isNew, ...event } = draft;
    save((c) => saveEvent(c, event));
    goTo(draft.date);
    setDraft(null);
  };
  const deleteDraft = () => {
    if (!confirm(`Delete “${draft.title || 'this event'}”?`)) return;
    save((c) => removeEvent(c, draft.id));
    setDraft(null);
  };
  useEffect(() => {
    if (!draft) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDraft(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft]);

  if (loading) return <p className={styles.muted}>Loading…</p>;

  const dayEntries = byDay.get(selected) || [];
  // One line of the day panel and of "coming up".
  const row = (e, withDate) => {
    const body = (
      <>
        <span className={`${cs.dot} ${chipClass(e)}`} aria-hidden="true" />
        <span className={cs.rowMain}>
          <span className={e.done ? cs.rowTitleDone : cs.rowTitle}>{e.title}</span>
          <span className={cs.rowMeta}>
            {[withDate && `${dayLabel(e.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${awayLabel(e.date, today)}`, formatTime(e.time), e.kind, e.done && 'Done'].filter(Boolean).join(' · ')}
          </span>
          {e.note && !withDate && <span className={cs.rowNote}>{e.note}</span>}
        </span>
      </>
    );
    if (e.source === 'event') {
      return (
        <li key={e.key}>
          <button type="button" className={cs.row} onClick={() => (withDate ? goTo(e.date) : setDraft({ ...e.event }))} title={withDate ? 'Show this day' : 'Edit this event'}>
            {body}{!withDate && <span className={cs.rowEdit} aria-hidden="true">✎</span>}
          </button>
        </li>
      );
    }
    if (withDate) return <li key={e.key}><button type="button" className={cs.row} onClick={() => goTo(e.date)} title="Show this day">{body}</button></li>;
    const tab = e.source === 'timeline' ? 'timeline' : 'venues';
    return (
      <li key={e.key}>
        <div className={cs.row}>
          {body}
          {onOpenTab && <button type="button" className={cs.rowLink} onClick={() => onOpenTab(tab)}>{tab === 'timeline' ? 'Timeline ›' : 'Venues ›'}</button>}
        </div>
      </li>
    );
  };

  return (
    <div className={cs.wrap}>
      {error && <p className={styles.digestErrMsg} role="status">{error}</p>}
      <div className={cs.bar}>
        <div className={cs.nav}>
          <button type="button" className={styles.toolButton} onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">‹</button>
          <h2 className={cs.month} aria-live="polite">{monthLabel(month)}</h2>
          <button type="button" className={styles.toolButton} onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">›</button>
          <button type="button" className={styles.toolButton} onClick={() => goTo(today)}>Today</button>
          {weddingDate && <button type="button" className={styles.toolButton} onClick={() => goTo(weddingDate)}>Wedding day</button>}
        </div>
        <div className={cs.layers}>
          <label className={cs.layer} title="The Timeline tab's items, on their real days">
            <input type="checkbox" checked={show.timeline} onChange={(e) => setShow((s) => ({ ...s, timeline: e.target.checked }))} disabled={!weddingDate} />
            <span className={`${cs.dot} ${cs.kTimeline}`} aria-hidden="true" /> Timeline
          </label>
          <label className={cs.layer} title="The dates each venue has open, from the Venues tab">
            <input type="checkbox" checked={show.venues} onChange={(e) => setShow((s) => ({ ...s, venues: e.target.checked }))} disabled={!venueDates} />
            <span className={`${cs.dot} ${cs.kVenue}`} aria-hidden="true" /> Venue open dates
          </label>
          <button type="button" className={styles.modalPrimary} onClick={() => openNew(selected)}>+ Add event</button>
        </div>
      </div>
      <p className={cs.status}>
        {!weddingDate ? (
          <>No wedding date yet — set one on the {onOpenTab ? <button type="button" className={cs.inlineLink} onClick={() => onOpenTab('timeline')}>Timeline</button> : 'Timeline'} tab and its plan appears here on real days.</>
        ) : untilWedding > 0 ? `${untilWedding} day${untilWedding === 1 ? '' : 's'} to the wedding on ${dayLabel(weddingDate)}.`
          : untilWedding === 0 ? 'The wedding is today.' : `The wedding was ${dayLabel(weddingDate)}.`}
      </p>

      <div className={cs.layout}>
        <div className={cs.gridWrap}>
          <div className={cs.grid} role="grid" aria-label={monthLabel(month)}>
            <div className={cs.weekdays} role="row">
              {WEEKDAYS.map((d) => <div key={d} className={cs.weekday} role="columnheader">{d}</div>)}
            </div>
            {weeks.map((week) => (
              <div key={week[0].date} className={cs.week} role="row">
                {week.map(({ date, inMonth }) => {
                  const list = byDay.get(date) || [];
                  const isWedding = date === weddingDate;
                  const cls = [cs.day, !inMonth && cs.dayOut, date === today && cs.dayToday, date === selected && cs.daySelected, isWedding && cs.dayWedding].filter(Boolean).join(' ');
                  return (
                    <div key={date} role="gridcell" aria-selected={date === selected} className={cls}>
                      <button
                        type="button"
                        className={cs.dayBtn}
                        onClick={() => goTo(date)}
                        onDoubleClick={() => openNew(date)}
                        aria-label={`${dayLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}${list.length ? `, ${list.length} ${list.length === 1 ? 'entry' : 'entries'}` : ''}`}
                        aria-current={date === today ? 'date' : undefined}
                      >
                        <span className={cs.dayNum}>{Number(date.slice(8))}</span>
                        {list.slice(0, MAX_CHIPS).map((e) => (
                          <span key={e.key} className={`${cs.chip} ${chipClass(e)} ${e.done ? cs.chipDone : ''}`}>
                            <span className={cs.chipText}>{e.time ? `${formatTime(e.time)} ` : ''}{e.title}</span>
                          </span>
                        ))}
                        {list.length > MAX_CHIPS && <span className={cs.more}>+{list.length - MAX_CHIPS} more</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className={cs.hint}>Click a day to see it; double-click to add an event on it.</p>
        </div>

        <aside className={cs.side}>
          <section className={cs.card} aria-label="Selected day">
            <div className={cs.cardHead}>
              <h3 className={cs.cardTitle}>{dayLabel(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
              <span className={cs.cardSub}>{awayLabel(selected, today)}</span>
            </div>
            {dayEntries.length === 0 ? <p className={cs.empty}>Nothing on this day.</p> : <ul className={cs.rows}>{dayEntries.map((e) => row(e, false))}</ul>}
            <button type="button" className={cs.addHere} onClick={() => openNew(selected)}>+ Add an event on this day</button>
          </section>
          <section className={cs.card} aria-label="Coming up">
            <div className={cs.cardHead}><h3 className={cs.cardTitle}>Coming up</h3></div>
            {upcoming.length === 0 ? <p className={cs.empty}>Nothing ahead yet. Add a tour, a tasting or a payment that’s due.</p> : <ul className={cs.rows}>{upcoming.map((e) => row(e, true))}</ul>}
          </section>
        </aside>
      </div>

      {draft && (
        <div className={styles.modalOverlay} onClick={closeDraft}>
          <form
            className={`${styles.modal} ${cs.modal}`}
            role="dialog"
            aria-modal="true"
            aria-label={draft.isNew ? 'Add an event' : 'Edit event'}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); submitDraft(); }}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{draft.isNew ? 'Add an event' : 'Edit event'}</h2>
              <button className={styles.modalClose} type="button" onClick={closeDraft} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.contactGrid}>
                <label className={`${styles.contactField} ${styles.contactWide}`}>
                  <span className={styles.contactLabel}>What</span>
                  <input className={styles.contactInput} value={draft.title} maxLength={120} autoFocus placeholder="Tour Oheka Castle" onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                </label>
                <label className={styles.contactField}>
                  <span className={styles.contactLabel}>Date</span>
                  <input className={styles.contactInput} type="date" required value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
                </label>
                <label className={styles.contactField}>
                  <span className={styles.contactLabel}>Time (optional)</span>
                  <input className={styles.contactInput} type="time" value={draft.time} onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))} />
                </label>
                <label className={styles.contactField}>
                  <span className={styles.contactLabel}>Type</span>
                  <select className={styles.contactInput} value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}>
                    {EVENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <label className={`${styles.contactField} ${cs.doneField}`}>
                  <input type="checkbox" checked={draft.done} onChange={(e) => setDraft((d) => ({ ...d, done: e.target.checked }))} />
                  <span>Done</span>
                </label>
                <label className={`${styles.contactField} ${styles.contactWide}`}>
                  <span className={styles.contactLabel}>Notes</span>
                  <textarea className={styles.contactInput} rows={3} maxLength={2000} value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
                </label>
              </div>
            </div>
            <div className={styles.modalFooter}>
              {!draft.isNew && <button className={styles.bulkDelete} type="button" onClick={deleteDraft}>Delete</button>}
              <span className={styles.modalCount}>{draft.title.trim() ? '' : 'Say what it is to save it'}</span>
              <button className={styles.modalSecondary} type="button" onClick={closeDraft}>Cancel</button>
              <button className={styles.modalPrimary} type="submit" disabled={!draft.title.trim() || !draft.date}>{draft.isNew ? 'Add' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

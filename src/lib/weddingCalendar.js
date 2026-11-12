/* Wedding → Calendar: the wedding's own calendar.

   Three things land on it:
     • events you add here — tours, tastings, fittings, payments due — kept on
       the user doc as `weddingCalendar: { events: [...] }`;
     • the Timeline's items, on their real days once the wedding has a date
       (read from `weddingTimeline`; edited on the Timeline tab);
     • the dates each venue has open (`availableDates` on `weddingVenues`;
       edited on the Venues tab).

   Days are "YYYY-MM-DD" strings throughout, so nothing shifts with the
   viewer's time zone. Pure, so the page and the tests share it. */

import { cleanDate, itemDate } from './weddingTimeline.js';

export const EVENT_KINDS = ['Appointment', 'Venue tour', 'Tasting', 'Fitting', 'Payment due', 'Deadline', 'Travel', 'Other'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const pad = (n) => String(n).padStart(2, '0');

export function newEventId() {
  return `wc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// "HH:MM" on a 24-hour clock, or '' for an all-day event.
export function cleanTime(v) {
  const m = str(v).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : '';
}

// "14:30" → "2:30 PM", "09:00" → "9 AM".
export function formatTime(t) {
  const c = cleanTime(t);
  if (!c) return '';
  const [h, m] = c.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function normalizeEvent(raw) {
  return {
    id: str(raw?.id) || newEventId(),
    date: cleanDate(raw?.date),
    time: cleanTime(raw?.time),
    title: str(raw?.title).slice(0, 120),
    kind: EVENT_KINDS.includes(raw?.kind) ? raw.kind : 'Other',
    note: typeof raw?.note === 'string' ? raw.note.replace(/\r\n?/g, '\n').trim().slice(0, 2000) : '',
    done: raw?.done === true,
  };
}

// The stored calendar, cleaned: events with no day or no title are dropped.
export function normalizeCalendar(raw) {
  const seen = new Set();
  const events = [];
  for (const r of Array.isArray(raw?.events) ? raw.events : []) {
    const e = normalizeEvent(r);
    if (!e.date || !e.title) continue;
    if (seen.has(e.id)) e.id = newEventId();
    seen.add(e.id);
    events.push(e);
  }
  return { events };
}

// Add an event, or replace the one with the same id.
export function saveEvent(calendar, event) {
  const e = normalizeEvent(event);
  if (!e.date || !e.title) return calendar;
  const has = calendar.events.some((x) => x.id === e.id);
  return { events: has ? calendar.events.map((x) => (x.id === e.id ? e : x)) : [...calendar.events, e] };
}
export const removeEvent = (calendar, id) => ({ events: calendar.events.filter((e) => e.id !== id) });

/* Everything on the calendar, as one list of entries:
     { key, date, time, title, kind, source: 'event' | 'timeline' | 'venue', done, note, ... }
   in day order — within a day: the wedding itself, then all-day entries,
   then timed ones by the clock. `show` turns the two borrowed layers off. */
export function calendarEntries({ calendar, timeline, venues } = {}, show = {}) {
  const out = [];
  for (const e of calendar?.events || []) {
    out.push({ key: `event:${e.id}`, source: 'event', date: e.date, time: e.time, title: e.title, kind: e.kind, note: e.note, done: e.done, event: e });
  }
  const weddingDate = cleanDate(timeline?.date);
  if (weddingDate && show.timeline !== false) {
    for (const it of timeline.items || []) {
      const isDay = it.daysBefore === 0;
      out.push({
        key: `timeline:${it.id}`, source: 'timeline', date: itemDate(weddingDate, it.daysBefore), time: '',
        title: it.title, kind: isDay ? 'Wedding day' : it.milestone ? 'Milestone' : 'Timeline', note: it.note, done: it.done, wedding: isDay,
      });
    }
  }
  if (show.venues !== false) {
    for (const v of venues || []) {
      if (v?.hidden || v?.status === 'Not a fit' || !str(v?.name)) continue;
      for (const d of Array.isArray(v.availableDates) ? v.availableDates : []) {
        const date = cleanDate(d);
        if (date) out.push({ key: `venue:${v.id}:${date}`, source: 'venue', date, time: '', title: `${v.name} is open`, kind: 'Venue open', note: '', done: false });
      }
    }
  }
  const rank = (e) => (e.wedding ? 0 : e.time ? 2 : 1);
  return out.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
}

export function entriesByDay(entries) {
  const map = new Map();
  for (const e of entries || []) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

// What's still ahead: from today on, things already done left out.
export function upcomingEntries(entries, today, limit = 10) {
  return (entries || []).filter((e) => e.date >= today && !e.done).slice(0, limit);
}

/* The weeks of a month's grid, Sunday first, padded with the days of the
   months either side: rows of { date, inMonth }. `month` is 1–12. */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86400000);
  const weeks = [];
  for (let d = start; ; ) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month - 1 });
      d = new Date(d.getTime() + 86400000);
    }
    weeks.push(week);
    if (d.getUTCMonth() !== month - 1 || d.getUTCFullYear() !== year) break;
  }
  return weeks;
}

// "2027-06" one month on or back; and its heading, "June 2027".
export function shiftMonth(ym, by) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
// "Sat, Jun 12, 2027"
export function dayLabel(date, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  const d = cleanDate(date);
  return d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' }) : '';
}

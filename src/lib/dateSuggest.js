// Suggesting dates for a poll from the organizer's own availability.
//
// A recurring round asks the same question every time: which of the usual
// days, in the coming stretch, am I actually free? This answers it from three
// things the organizer gives — one or more date ranges, the days of the week
// they'd have it on, and their Rally calendar — and hands back the days that
// fit, with the ones it passed over and why.
//
// "Busy" means a Rally event with a settled date sits on that day: a one-off,
// any day of a multi-day trip, or that year's occurrence of a yearly event.
// An event still being voted on isn't a commitment yet, and a holiday is a
// judgement call, so neither removes a day — the page flags them instead.
//
// Pure: no React, no Firestore. Days are 'YYYY-MM-DD' strings throughout.

import { isRecurring, occurrencesInRange } from './recurrence';

// A stale endDate further out than this is treated as bad data, the same guard
// the dashboard and the poll's own conflict rings apply.
const MAX_SPAN_DAYS = 60;

// More than this is a wall nobody votes through; the caller is told to narrow.
export const MAX_SUGGESTIONS = 40;

// A range longer than this is almost certainly a typo'd year.
const MAX_RANGE_DAYS = 400;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');

export const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromYmd(s) {
  const m = YMD.exec(String(s ?? ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}

export const addDays = (ymd, n) => {
  const d = fromYmd(ymd);
  return d ? toYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) : '';
};

function toDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Usable ranges only: both ends real days, in order, not absurdly long. */
export function cleanRanges(ranges) {
  const out = [];
  (Array.isArray(ranges) ? ranges : []).forEach((r) => {
    const from = fromYmd(r?.from);
    const to = fromYmd(r?.to);
    if (!from || !to || to < from) return;
    if (Math.round((to - from) / 86400000) > MAX_RANGE_DAYS) return;
    out.push({ from: r.from, to: r.to });
  });
  return out;
}

/**
 * The days the organizer is already spoken for, between `from` and `to`:
 * Map of day -> [event titles]. `excludeId` is the event being planned.
 */
export function busyDays(events, { from, to, excludeId } = {}) {
  const map = new Map();
  const first = fromYmd(from);
  const last = fromYmd(to);
  if (!first || !last) return map;
  const rangeEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59);
  const mark = (start, end, title) => {
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (e < s || Math.round((e - s) / 86400000) > MAX_SPAN_DAYS) e = s;
    for (let d = s; d <= e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      if (d < first || d > last) continue;
      const key = toYmd(d);
      const list = map.get(key) || [];
      if (!list.includes(title)) list.push(title);
      map.set(key, list);
    }
  };
  (events || []).forEach((e) => {
    if (!e || e.id === excludeId || e.cancelled || e.dateTBD) return;
    if ((e.stage || 'voting') !== 'finalized') return;
    const title = e.title || 'Event';
    if (isRecurring(e)) {
      occurrencesInRange(e, first, rangeEnd).forEach((occ) => mark(occ.start, occ.hasEnd ? occ.end : occ.start, title));
      return;
    }
    const start = toDate(e.date);
    if (!start) return;
    mark(start, toDate(e.endDate) || start, title);
  });
  return map;
}

/**
 * The days that fit.
 *
 *   ranges    [{ from, to }]  inclusive
 *   weekdays  [0-6]           0 = Sunday; none ticked means none wanted
 *   busy      Map day -> [titles]   (busyDays)
 *   taken     days already on the poll
 *   today     'YYYY-MM-DD'; earlier days are never offered
 *
 * Returns { dates, busy: [{ date, titles }], taken: [day], truncated }, each
 * list earliest first. `busy` and `taken` are the days that matched the ranges
 * and weekdays but were passed over.
 */
export function suggestDates({ ranges, weekdays, busy = new Map(), taken = [], today = '', max = MAX_SUGGESTIONS } = {}) {
  const wanted = new Set((weekdays || []).map(Number));
  const onPoll = new Set(taken || []);
  const seen = new Set();
  const dates = [];
  const skippedBusy = [];
  const skippedTaken = [];
  let truncated = false;
  const days = [];
  cleanRanges(ranges).forEach((r) => {
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) days.push(d);
  });
  days.sort();
  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);
    if (today && day < today) continue;
    if (!wanted.has(fromYmd(day).getDay())) continue;
    if (onPoll.has(day)) { skippedTaken.push(day); continue; }
    if (busy.has(day)) { skippedBusy.push({ date: day, titles: busy.get(day) }); continue; }
    if (dates.length >= max) { truncated = true; continue; }
    dates.push(day);
  }
  return { dates, busy: skippedBusy, taken: skippedTaken, truncated };
}

/** The earliest and latest day across some ranges, for one busy-day lookup. */
export function rangesSpan(ranges) {
  const clean = cleanRanges(ranges);
  if (clean.length === 0) return null;
  return {
    from: clean.reduce((m, r) => (r.from < m ? r.from : m), clean[0].from),
    to: clean.reduce((m, r) => (r.to > m ? r.to : m), clean[0].to),
  };
}

/**
 * Where the panel starts. The range is the round's poll window when it has one
 * that hasn't passed, else the six weeks starting a week out. The weekdays are
 * the ones already on the poll (a new round is seeded with last round's), else
 * Friday and Saturday.
 */
export function defaultSuggestSetup({ window, options, today }) {
  const fallback = { from: addDays(today, 7), to: addDays(today, 7 + 41) };
  const usable = window && fromYmd(window.from) && fromYmd(window.to) && window.to >= today;
  const range = usable ? { from: window.from < today ? today : window.from, to: window.to } : fallback;
  const days = new Set();
  (options || []).forEach((o) => {
    if (o?.closed || o?.noVote) return;
    const d = fromYmd(o?.startDate);
    if (d) days.add(d.getDay());
  });
  return { ranges: [range], weekdays: days.size ? [...days].sort() : [5, 6] };
}

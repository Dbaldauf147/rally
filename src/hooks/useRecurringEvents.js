import { useEffect, useRef } from 'react';
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useEvents } from './useEvents';
import { normalizeRecurrence, occurrenceDocId, missingOccurrenceDates, toEventDate, ymd } from '../recurrence';

// Materializes recurring events: every occurrence of a series is a real event
// document, so it carries its own RSVP list, chat, itinerary and travel
// planning, and every view that already renders events renders it for free.
//
// The series parent is the first occurrence — it's the one holding the
// `recurrence` rule. Children carry `seriesId` and no rule of their own, so
// they never spawn children themselves.
//
// Two things keep this from misbehaving:
//   * Occurrence ids are derived from the series id and the date, so two
//     devices filling the same gap write the same document instead of two.
//   * The parent records how far ahead it has generated. We only ever create
//     dates beyond that mark, so deleting one occurrence doesn't bring it back
//     on the next load — while the window still rolls forward over time.

// The guest list comes along, but nothing that belongs to one specific
// occasion: next year's party needs its own answers, not last year's.
const PER_OCCASION_FIELDS = ['texted', 'emailed', 'attendance', 'skipVote'];
function freshMembers(members) {
  const out = {};
  for (const [uid, m] of Object.entries(members || {})) {
    if (!m || typeof m !== 'object') continue;
    const keep = { ...m };
    for (const field of PER_OCCASION_FIELDS) delete keep[field];
    keep.rsvp = m.role === 'owner' ? 'yes' : 'pending';
    out[uid] = keep;
  }
  return out;
}

export function useRecurringEvents() {
  const { user } = useAuth();
  const { events, loading } = useEvents();
  // Series handled in this session, so a re-render doesn't redo the work while
  // the writes are still in flight.
  const handled = useRef(new Set());

  useEffect(() => {
    if (!user?.uid || loading || events.length === 0) return;
    const existingIds = new Set(events.map((e) => e.id));

    (async () => {
      for (const series of events) {
        const rule = normalizeRecurrence(series.recurrence);
        if (!rule) continue;
        // Only the owner tops a series up — everyone else just reads the
        // occurrences, and one writer means no duplicate work.
        if (series.createdBy !== user.uid) continue;
        if (series.cancelled) continue;
        // Keyed by the rule and the mark, not just the id, so editing a series'
        // rule tops it up again in the same session instead of waiting for a
        // reload. Re-running when neither changed is a no-op anyway.
        const key = `${series.id}:${series.recurrenceGeneratedThrough || ''}:${JSON.stringify(rule)}`;
        if (handled.current.has(key)) continue;
        handled.current.add(key);

        const start = toEventDate(series.date);
        if (!start) continue;
        const endRaw = toEventDate(series.endDate);
        // How long one occurrence runs, carried onto every future one.
        const durationMs = endRaw && endRaw > start ? endRaw - start : 0;
        const generatedThrough = series.recurrenceGeneratedThrough || '';

        const wanted = missingOccurrenceDates(series, { existingIds });
        if (wanted.length === 0) continue;

        const members = freshMembers(series.members);
        let lastWritten = '';
        for (const day of wanted) {
          const startAt = new Date(day);
          startAt.setHours(start.getHours(), start.getMinutes(), 0, 0);
          try {
            await setDoc(doc(db, 'events', occurrenceDocId(series.id, day)), {
              title: series.title || '',
              description: series.description || '',
              location: series.location || '',
              planning: series.planning || {},
              members,
              memberUids: series.memberUids || [],
              createdBy: series.createdBy,
              visibility: series.visibility || 'private',
              date: Timestamp.fromDate(startAt),
              endDate: durationMs ? Timestamp.fromDate(new Date(startAt.getTime() + durationMs)) : null,
              // The date is known by definition, so an occurrence is finalized
              // rather than up for a vote.
              stage: 'finalized',
              dateTBD: false,
              seriesId: series.id,
              seriesDate: ymd(day),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              shareToken: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            });
            lastWritten = ymd(day);
          } catch {
            break; // offline or denied — leave the mark where it is and retry next load
          }
        }

        // Advance the mark only over occurrences that actually landed, so a
        // write that failed halfway is picked up again rather than skipped.
        if (lastWritten && lastWritten > generatedThrough) {
          await updateDoc(doc(db, 'events', series.id), {
            recurrenceGeneratedThrough: lastWritten,
          }).catch(() => {});
        }
      }
    })();
  }, [events, loading, user?.uid]);
}

// Mounted once in App so the top-up runs wherever the user lands, not only on
// the pages that happen to list events.
export function RecurringEventsRunner() {
  useRecurringEvents();
  return null;
}

// Exported for the "stop repeating" action: the future occurrences of a series,
// which are the ones safe to clear out when a user ends it.
export function futureOccurrences(events, seriesId, from = new Date()) {
  const cutoff = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return events.filter((e) => {
    if (e.seriesId !== seriesId) return false;
    const d = toEventDate(e.date);
    return d && d >= cutoff;
  });
}

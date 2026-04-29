import { useEffect, useRef } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useEvents } from './useEvents';
import {
  syncEventToGoogleCalendar,
  isGoogleCalendarConnected,
  getSyncTargetCalendar,
  getAutoSyncEnabled,
  computeCalRange,
} from '../googleCalendar';

// Walks the user's events whenever the list updates. For each finalized event
// that hasn't been synced yet (or whose dates have changed since last sync),
// auto-syncs it to the user's chosen Google Calendar. Runs only when:
//   - user is signed in
//   - auto-sync is enabled in localStorage
//   - Google Calendar is connected (i.e. tokens are present)
//
// Failures are logged to the console but never surface to the UI — manual
// sync from the event detail page remains the fallback.
export function useGoogleCalendarAutoSync() {
  const { user } = useAuth();
  const { events } = useEvents();
  const inFlight = useRef(new Set());

  useEffect(() => {
    if (!user?.uid) return;
    if (!getAutoSyncEnabled()) return;
    if (!isGoogleCalendarConnected()) return;

    let cancelled = false;
    const target = getSyncTargetCalendar();

    async function processOne(event) {
      if (inFlight.current.has(event.id)) return;
      const range = computeCalRange(event);
      if (!range) return;
      const { calStart, calEnd } = range;

      const userSync = event.googleCalendar?.[user.uid];
      const calStartMs = calStart.getTime();
      const calEndMs = calEnd.getTime();
      // Already synced and dates unchanged — skip.
      if (userSync && userSync.calStartMs === calStartMs && userSync.calEndMs === calEndMs) return;

      const calendarId = userSync?.calendarId || target.id;
      const calendarName = userSync?.calendarName || target.name;

      inFlight.current.add(event.id);
      try {
        const googleEventId = await syncEventToGoogleCalendar({
          event,
          googleEventId: userSync?.googleEventId,
          calStart,
          calEnd,
          description: event.description || '',
          calendarId,
        });
        if (cancelled) return;
        await updateDoc(doc(db, 'events', event.id), {
          [`googleCalendar.${user.uid}`]: {
            googleEventId,
            calendarId,
            calendarName,
            calStartMs,
            calEndMs,
            syncedAt: new Date().toISOString(),
            auto: true,
          },
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        // Don't spam alerts; manual sync still available from EventDetail.
        // eslint-disable-next-line no-console
        console.warn('Auto-sync failed for event', event.id, err);
      } finally {
        inFlight.current.delete(event.id);
      }
    }

    async function run() {
      const finalized = events.filter(e => e.stage === 'finalized' && !e.dateTBD && e.date);
      for (const e of finalized) {
        if (cancelled) return;
        await processOne(e);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [user?.uid, events]);
}

// Render-only wrapper so App.jsx can mount the hook without needing to call
// useEvents itself (which would create a second Firestore subscription branch
// at the root regardless of which page the user is on — that's actually what
// we want here, so the hook always sees the latest event list).
export function GoogleCalendarAutoSyncRunner() {
  useGoogleCalendarAutoSync();
  return null;
}

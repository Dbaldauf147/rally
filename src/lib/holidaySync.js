import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { holidayListForSync } from './holidayReachOut';

/* Mirrors this device's holiday list onto users/{uid}.holidayList, so the
   daily holiday reach-out cron knows when each holiday falls — the list
   itself lives in localStorage, which the server can't see. Skips the write
   when the same list was already sent this visit. */

let lastSent = '';

export function syncHolidayList(uid, list) {
  if (!uid) return Promise.resolve();
  const compact = holidayListForSync(list);
  const json = `${uid}:${JSON.stringify(compact)}`;
  if (json === lastSent) return Promise.resolve();
  lastSent = json;
  return setDoc(doc(db, 'users', uid), { holidayList: compact }, { merge: true })
    .catch((err) => { lastSent = ''; console.warn('Holiday list sync failed:', err); });
}

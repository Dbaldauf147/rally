import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, FieldPath } from 'firebase/firestore';
import { db } from '../firebase';

// An event's Secret Santa draws, by year, from the organizer's own user doc
// (lib/secretSanta.js explains why they are kept there and not on the event).
// `history` is null until the first read lands.
export function useSecretSantaHistory(user, eventId) {
  const [history, setHistory] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!user?.uid) return undefined;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => setHistory((snap.exists() ? snap.data().secretSanta?.[eventId] : null) || {}),
      (err) => setLoadError(err.message || String(err)),
    );
  }, [user?.uid, eventId]);

  // Replaces one year's record whole (mergeFields), leaving every other event
  // and year on the user doc alone.
  function saveYear(y, value) {
    return setDoc(
      doc(db, 'users', user.uid),
      { secretSanta: { [eventId]: { [y]: value } } },
      { mergeFields: [new FieldPath('secretSanta', eventId, String(y))] },
    );
  }

  return { history, loadError, saveYear };
}

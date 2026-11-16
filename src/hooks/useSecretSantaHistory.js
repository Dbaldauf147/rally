import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, updateDoc, deleteField, FieldPath } from 'firebase/firestore';
import { db } from '../firebase';
import { drawStoreKey, cleanDraws } from '../lib/secretSanta';

// An event's Secret Santa draws, by year, from the organizer's own user doc
// (lib/secretSanta.js explains why they are kept there and not on the event).
// `history` is null until the first read lands.
//
// An event can hold more than one exchange. `drawId` picks which one's years
// to read and write: '' is the event's main one, anything else an extra one
// from `draws`, the list of the event's extra exchanges ({ id, name }).
export function useSecretSantaHistory(user, eventId, drawId = '') {
  const [history, setHistory] = useState(null);
  const [draws, setDraws] = useState([]);
  const [loadError, setLoadError] = useState('');
  const storeKey = drawStoreKey(eventId, drawId);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setHistory(data.secretSanta?.[storeKey] || {});
        setDraws(cleanDraws(data.secretSantaDraws?.[eventId]));
      },
      (err) => setLoadError(err.message || String(err)),
    );
  }, [user?.uid, eventId, storeKey]);

  // Replaces one year's record whole (mergeFields), leaving every other event
  // and year on the user doc alone.
  function saveYear(y, value) {
    return setDoc(
      doc(db, 'users', user.uid),
      { secretSanta: { [storeKey]: { [y]: value } } },
      { mergeFields: [new FieldPath('secretSanta', storeKey, String(y))] },
    );
  }

  // Replaces this event's list of extra exchanges.
  function saveDraws(list) {
    return setDoc(
      doc(db, 'users', user.uid),
      { secretSantaDraws: { [eventId]: cleanDraws(list) } },
      { mergeFields: [new FieldPath('secretSantaDraws', eventId)] },
    );
  }

  // Takes an extra exchange off the event, along with every year drawn for it.
  async function removeDraw(id) {
    await saveDraws(draws.filter((d) => d.id !== id));
    await updateDoc(doc(db, 'users', user.uid), new FieldPath('secretSanta', drawStoreKey(eventId, id)), deleteField());
  }

  return { history, loadError, saveYear, draws, saveDraws, removeDraw };
}

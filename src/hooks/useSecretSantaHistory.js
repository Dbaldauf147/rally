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
  // The exchange's standing email note (lib/secretSanta.js): a string once
  // saved, null before that.
  const [savedNote, setSavedNote] = useState(null);
  const storeKey = drawStoreKey(eventId, drawId);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setHistory(data.secretSanta?.[storeKey] || {});
        setDraws(cleanDraws(data.secretSantaDraws?.[eventId]));
        const n = data.secretSantaNotes?.[storeKey];
        setSavedNote(typeof n === 'string' ? n : null);
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

  // Sets the note this exchange's emails carry, this year and every year after.
  function saveNote(text) {
    return setDoc(
      doc(db, 'users', user.uid),
      { secretSantaNotes: { [storeKey]: String(text ?? '').slice(0, 1000) } },
      { mergeFields: [new FieldPath('secretSantaNotes', storeKey)] },
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
    const key = drawStoreKey(eventId, id);
    await updateDoc(doc(db, 'users', user.uid),
      new FieldPath('secretSanta', key), deleteField(),
      new FieldPath('secretSantaNotes', key), deleteField());
  }

  return { history, loadError, saveYear, savedNote, saveNote, draws, saveDraws, removeDraw };
}

// Photos of the people in a friend's family tree (lib/familyTree.js).
//
// Each one is its own Firestore document, users/{uid}/familyPhotos/{id},
// holding a small JPEG data URL — the same arrangement as Doctors pictures
// (lib/doctorImages.js), and for the same reason: the friend doc only names the
// id, so the Friends list, Reach Out and everything else that reads every
// friend doesn't download every face.
//
// A face in a circle doesn't need much: longest side 480px, which lands a
// phone photo around 30–60 KB. firestore.rules caps it at the same size.

import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { shrinkImage } from './doctorImages';
import { makeId } from './familyTree';

export const PHOTO_SIDE = 480;
export const MAX_PHOTO_CHARS = 200_000;

const photoRef = (uid, id) => doc(db, 'users', uid, 'familyPhotos', id);

// Saves the photo and hands back its id, so nothing names a photo that failed.
export async function saveFamilyPhoto(uid, friendId, file) {
  const { data } = await shrinkImage(file, PHOTO_SIDE, MAX_PHOTO_CHARS);
  const id = makeId();
  await setDoc(photoRef(uid, id), { friendId, data, created: new Date().toISOString() });
  cache.set(id, Promise.resolve(data));
  return id;
}

// Read once per session: a photo never changes under its id.
const cache = new Map();
export function readFamilyPhoto(uid, id) {
  if (!cache.has(id)) {
    const pending = getDoc(photoRef(uid, id))
      .then((snap) => (snap.exists() ? snap.data().data || null : null))
      .catch((err) => { cache.delete(id); throw err; });
    cache.set(id, pending);
  }
  return cache.get(id);
}

// Best-effort: a photo left behind costs a little storage, never a broken tree.
export async function deleteFamilyPhoto(uid, id) {
  if (!id) return;
  cache.delete(id);
  await deleteDoc(photoRef(uid, id)).catch(() => {});
}

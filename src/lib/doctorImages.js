// Pictures attached to a Doctors record.
//
// Each one is its own Firestore document, users/{uid}/doctorImages/{id},
// holding the picture as a JPEG data URL. The record itself only lists the ids
// (see normalizeImages in lib/doctors.js), so the doctors list stays small and
// opening the page doesn't download every photo.
//
// A Firestore document tops out at 1 MiB, so a picture is shrunk in the browser
// before it's saved: longest side 1600px, then the JPEG quality and, if need
// be, the size stepped down until it fits under MAX_DATA_URL characters. A
// phone photo lands around 200–500 KB — plenty to read a rash or a prescription,
// but not a full-resolution archive.

import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const MAX_SIDE = 1600;
// Characters, not bytes: base64 is what's stored. Leaves room under the 1 MiB
// document limit for the other fields; firestore.rules enforces the same cap.
export const MAX_DATA_URL = 900_000;

const imageRef = (uid, id) => doc(db, 'users', uid, 'doctorImages', id);

// The size to draw a picture at so its longest side is at most `max`.
export function fitWithin(width, height, max = MAX_SIDE) {
  const w = Math.max(1, Math.round(width || 0));
  const h = Math.max(1, Math.round(height || 0));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Couldn't read ${file.name || 'that file'} as a picture.`)); };
    img.src = url;
  });
}

export async function shrinkImage(file) {
  const img = await loadImage(file);
  let { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // JPEG has no transparency; a transparent screenshot would otherwise go black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    for (const quality of [0.85, 0.72, 0.6]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_DATA_URL) return { data, width, height };
    }
    ({ width, height } = fitWithin(width, height, Math.round(Math.max(width, height) * 0.75)));
  }
  throw new Error(`${file.name || 'That picture'} is too large to attach.`);
}

// Saves the picture first and hands back what the record should list, so a
// record never names an image that failed to save.
export async function saveImage(uid, entryId, file, id) {
  const { data, width, height } = await shrinkImage(file);
  const created = new Date().toISOString();
  const name = String(file.name || 'Photo').slice(0, 200);
  await setDoc(imageRef(uid, id), { entryId, name, data, width, height, created });
  return { id, name, created };
}

// Read once and kept for the session: a picture never changes under its id.
const cache = new Map();
export function readImage(uid, id) {
  if (!cache.has(id)) {
    const pending = getDoc(imageRef(uid, id))
      .then((snap) => (snap.exists() ? snap.data().data || null : null))
      .catch((err) => { cache.delete(id); throw err; });
    cache.set(id, pending);
  }
  return cache.get(id);
}

export async function deleteImage(uid, id) {
  cache.delete(id);
  await deleteDoc(imageRef(uid, id));
}

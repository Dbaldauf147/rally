import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export function useEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setEvents([]); setLoading(false); return; }
    const timeout = setTimeout(() => setLoading(false), 5000);

    // Query events created by user
    const qCreated = query(collection(db, 'events'), where('createdBy', '==', user.uid));
    // Query events where user is a member (by UID)
    const qMember = query(collection(db, 'events'), where('memberUids', 'array-contains', user.uid));
    // Also query by email-based key (for friends added before they had an account)
    // Must match sanitizeKey in FriendsPage: replaces . @ # $ / [ ] with _
    const emailKey = (user.email || '').replace(/[.@#$/\[\]]/g, '_').toLowerCase();
    const qEmailMember = emailKey ? query(collection(db, 'events'), where('memberUids', 'array-contains', emailKey)) : null;

    const eventsMap = new Map();
    let received = 0;
    const totalQueries = qEmailMember ? 3 : 2;

    function mergeAndUpdate() {
      const items = [...eventsMap.values()];
      items.sort((a, b) => {
        const aDate = a.date?.toDate?.() || new Date(a.date);
        const bDate = b.date?.toDate?.() || new Date(b.date);
        return aDate - bDate;
      });
      setEvents(items);
      if (received >= totalQueries) {
        clearTimeout(timeout);
        setLoading(false);
      }
    }

    // Auto-link: when we find an event where user's email key is a member but UID isn't, add their UID
    async function autoLink(eventDoc) {
      const data = eventDoc.data();
      const members = data.members || {};
      const memberUids = data.memberUids || [];
      if (memberUids.includes(user.uid)) return; // Already linked
      if (!members[emailKey]) return; // Email key not in members
      // Merge the email-keyed member into UID-keyed member
      const existing = members[emailKey];
      await updateDoc(doc(db, 'events', eventDoc.id), {
        [`members.${user.uid}`]: { ...existing, name: user.displayName || existing.name || '', email: user.email || existing.email || '' },
        [`members.${emailKey}`]: null,
        memberUids: arrayUnion(user.uid),
      }).catch(() => {});
    }

    const unsub1 = onSnapshot(qCreated, (snap) => {
      snap.docs.forEach(d => eventsMap.set(d.id, { id: d.id, ...d.data() }));
      received++;
      mergeAndUpdate();
    }, () => { received++; mergeAndUpdate(); });

    const unsub2 = onSnapshot(qMember, (snap) => {
      snap.docs.forEach(d => eventsMap.set(d.id, { id: d.id, ...d.data() }));
      received++;
      mergeAndUpdate();
    }, () => { received++; mergeAndUpdate(); });

    let unsub3 = null;
    if (qEmailMember) {
      unsub3 = onSnapshot(qEmailMember, (snap) => {
        snap.docs.forEach(d => {
          eventsMap.set(d.id, { id: d.id, ...d.data() });
          autoLink(d);
        });
        received++;
        mergeAndUpdate();
      }, () => { received++; mergeAndUpdate(); });
    }

    return () => { unsub1(); unsub2(); if (unsub3) unsub3(); };
  }, [user]);

  async function createEvent(data) {
    if (!user) return;
    const eventData = {
      ...data,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      memberUids: [user.uid],
      members: {
        [user.uid]: { role: 'owner', rsvp: 'yes', name: user.displayName || user.email || '' }
      },
      visibility: 'private',
      shareToken: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    };
    const ref = await addDoc(collection(db, 'events'), eventData);
    return ref.id;
  }

  async function updateEvent(eventId, data) {
    await updateDoc(doc(db, 'events', eventId), { ...data, updatedAt: serverTimestamp() });
  }

  async function deleteEvent(eventId) {
    await deleteDoc(doc(db, 'events', eventId));
  }

  async function rsvp(eventId, response) {
    if (!user) return;
    await updateDoc(doc(db, 'events', eventId), {
      [`members.${user.uid}.rsvp`]: response,
      updatedAt: serverTimestamp(),
    });
  }

  async function addMember(eventId, uid, name) {
    await updateDoc(doc(db, 'events', eventId), {
      [`members.${uid}`]: { role: 'viewer', rsvp: 'pending', name },
      memberUids: arrayUnion(uid),
      updatedAt: serverTimestamp(),
    });
  }

  return { events, loading, createEvent, updateEvent, deleteEvent, rsvp, addMember };
}

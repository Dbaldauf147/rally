import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, collection, onSnapshot, updateDoc, arrayUnion, arrayRemove, getDocs, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useEvents } from '../hooks/useEvents';
import { format } from 'date-fns';
import { RSVPWidget } from './RSVPWidget';
import { ChatPanel } from './ChatPanel';
import { EventForm } from './EventForm';
import { DatePoll } from './DatePoll';
import { Itinerary } from './Itinerary';
import { Notes } from './Notes';
import {
  syncEventToGoogleCalendar,
  removeEventFromGoogleCalendar,
  isGoogleCalendarConnected,
  connectGoogleCalendar,
  listGoogleCalendars,
  getSyncTargetCalendar,
  setSyncTargetCalendar,
  getAutoSyncEnabled,
  setAutoSyncEnabled,
} from '../googleCalendar';
import styles from './EventDetail.module.css';

export function EventDetail() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const { updateEvent, deleteEvent, rsvp } = useEvents();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return ['details', 'itinerary', 'notes', 'chat'].includes(t) ? t : null;
  });
  const initialTabPickedRef = useRef(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [result, setResult] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState('');
  const [editMember, setEditMember] = useState(null); // { uid, name, email, rsvp, role }
  const [editMemberFields, setEditMemberFields] = useState({});
  const [friendLinkSearch, setFriendLinkSearch] = useState('');
  const [showFriendLink, setShowFriendLink] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [dragMemberUid, setDragMemberUid] = useState(null);
  const [dropTargetUid, setDropTargetUid] = useState(null);
  const [reminderSending, setReminderSending] = useState(false);
  const [friends, setFriends] = useState([]);
  const [dateOptionsVoters, setDateOptionsVoters] = useState({});
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [friendGroupFilter, setFriendGroupFilter] = useState([]);
  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizeDate, setFinalizeDate] = useState('');
  const [finalizeEndDate, setFinalizeEndDate] = useState('');
  const [showTextAll, setShowTextAll] = useState(false);
  const [phantomFriendVotes, setPhantomFriendVotes] = useState(null); // null=unchecked, number=vote count
  const [cleaningPhantom, setCleaningPhantom] = useState(false);
  const [textAllMessage, setTextAllMessage] = useState('');
  const [textAllSending, setTextAllSending] = useState(false);
  const [missingFilter, setMissingFilter] = useState('none'); // 'none' | 'phone' | 'email' | 'both'
  const [calSyncing, setCalSyncing] = useState(false);
  const [calSyncMsg, setCalSyncMsg] = useState(null); // { type: 'success' | 'error', message: string }
  const [calTarget, setCalTarget] = useState(() => getSyncTargetCalendar());
  const [calAutoSync, setCalAutoSync] = useState(() => getAutoSyncEnabled());
  const [showCalPicker, setShowCalPicker] = useState(false);
  const [calPickerList, setCalPickerList] = useState(null); // null = not loaded, [] = empty
  const [calPickerLoading, setCalPickerLoading] = useState(false);
  const [calPickerError, setCalPickerError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'events', eventId), (snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      else setEvent(null);
      setLoading(false);
    });
    return unsub;
  }, [eventId]);

  // Pick the initial tab based on event stage once (if the URL didn't specify one).
  useEffect(() => {
    if (!event || initialTabPickedRef.current) return;
    initialTabPickedRef.current = true;
    if (activeTab) return; // URL ?tab= already set it
    const stage = event.stage || 'voting';
    if (stage === 'finalized' && !event.itineraryComplete) {
      setActiveTab('itinerary');
    } else {
      setActiveTab('details');
    }
  }, [event, activeTab]);

  // Load date option voters to include poll participants in members list + track vote stats
  const [voteStats, setVoteStats] = useState({}); // { visitorId: { total, yes, maybe, no } }
  const [allDateOptions, setAllDateOptions] = useState([]); // [{ id, startDate, endDate, note, votes }]
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events', eventId, 'dateOptions'), (snap) => {
      const voters = {};
      const stats = {};
      const options = [];
      // Only open (non-closed) options count toward the "has voted" tally
      const openOptionDocs = snap.docs.filter(d => !d.data().closed);
      const totalOptions = openOptionDocs.length;
      for (const d of snap.docs) {
        const data = d.data();
        options.push({ id: d.id, ...data });
        // Still surface closed-date voters in the members list, but don't count their votes
        for (const voterId of Object.keys(data.votes || {})) {
          if (!voters[voterId]) {
            const v = data.votes[voterId];
            voters[voterId] = { name: v.name || voterId, rsvp: 'pending', role: 'viewer', fromVotes: true };
          }
        }
      }
      for (const d of openOptionDocs) {
        const data = d.data();
        for (const [voterId, v] of Object.entries(data.votes || {})) {
          if (!stats[voterId]) stats[voterId] = { total: 0, yes: 0, maybe: 0, no: 0, totalOptions };
          if (v.vote && v.vote !== 'none') {
            stats[voterId].total++;
            if (v.vote === 'yes') stats[voterId].yes++;
            else if (v.vote === 'maybe') stats[voterId].maybe++;
            else if (v.vote === 'no') stats[voterId].no++;
          }
        }
      }
      options.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
      setAllDateOptions(options);
      setDateOptionsVoters(voters);
      setVoteStats(stats);
    });
    return unsub;
  }, [eventId]);

  // Load friends to merge phone/email data into event members
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'users', user.uid, 'friends'), (snap) => {
      setFriends(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  // Auto-sync: backfill missing contact info from friends and propagate across events
  const syncedRef = useRef(false);
  useEffect(() => {
    const isOwnerNow = event?.members?.[user?.uid]?.role === 'owner';
    if (syncedRef.current || !isOwnerNow || !event?.members || friends.length === 0) return;
    syncedRef.current = true;

    (async () => {
      try {
        // Build master contact lookup from friends
        const master = {};
        for (const f of friends) {
          if (!f) continue;
          const entry = { phone: f.phone || '', email: f.email || '', name: f.name || '' };
          if (f.email) master[f.email.toLowerCase()] = entry;
          if (f.name) master[f.name.toLowerCase()] = entry;
          if (f.phone) master[f.phone.replace(/[^\d]/g, '')] = entry;
        }
        // Also add contacts from this event
        for (const m of Object.values(event.members)) {
          if (!m || typeof m !== 'object') continue;
          const entry = { phone: m.phone || '', email: m.email || '', name: m.name || '' };
          if (m.email) master[m.email.toLowerCase()] = { ...master[m.email.toLowerCase()], ...entry, phone: entry.phone || master[m.email.toLowerCase()]?.phone || '' };
          if (m.name) master[m.name.toLowerCase()] = { ...master[m.name.toLowerCase()], ...entry, phone: entry.phone || master[m.name.toLowerCase()]?.phone || '' };
          if (m.phone) master[m.phone.replace(/[^\d]/g, '')] = { ...master[m.phone.replace(/[^\d]/g, '')], ...entry };
        }

        // Build friend link map: friendId -> linkedToFriendId
        const friendLinks = {};
        for (const f of friends) {
          if (f.linkedTo) friendLinks[f.id] = f.linkedTo;
        }
        // Build friend name/email/phone -> friendId lookup (+ unique first-name fallback)
        const friendIdByName = {};
        const friendIdByEmail = {};
        const friendIdByPhone = {};
        const friendIdByFirstName = {};
        const firstCount = {};
        for (const f of friends) {
          if (f.name) {
            friendIdByName[f.name.toLowerCase()] = f.id;
            const first = f.name.trim().split(/\s+/)[0]?.toLowerCase();
            if (first) {
              firstCount[first] = (firstCount[first] || 0) + 1;
              friendIdByFirstName[first] = f.id;
            }
          }
          if (f.email) friendIdByEmail[f.email.toLowerCase()] = f.id;
          if (f.phone) {
            const digits = f.phone.replace(/[^\d]/g, '');
            if (digits.length >= 7) friendIdByPhone[digits] = f.id;
          }
        }
        function lookupFid(m) {
          if (m.email && friendIdByEmail[m.email.toLowerCase()]) return friendIdByEmail[m.email.toLowerCase()];
          if (m.phone) {
            const d = m.phone.replace(/[^\d]/g, '');
            if (d.length >= 7 && friendIdByPhone[d]) return friendIdByPhone[d];
          }
          if (m.name && friendIdByName[m.name.toLowerCase()]) return friendIdByName[m.name.toLowerCase()];
          if (m.name) {
            const first = m.name.trim().split(/\s+/)[0]?.toLowerCase();
            if (first && firstCount[first] === 1) return friendIdByFirstName[first];
          }
          return null;
        }
        function lookupMaster(m) {
          if (m.email && master[m.email.toLowerCase()]) return master[m.email.toLowerCase()];
          if (m.phone) {
            const d = m.phone.replace(/[^\d]/g, '');
            if (d.length >= 7 && master[d]) return master[d];
          }
          if (m.name && master[m.name.toLowerCase()]) return master[m.name.toLowerCase()];
          return null;
        }

        // Sync all events
        const allEvents = await getDocs(collection(db, 'events'));
        for (const eventDoc of allEvents.docs) {
          const otherMembers = eventDoc.data().members || {};
          const updates = {};

          // Match each event member to a friend ID
          const memberToFriendId = {};
          for (const [uid, m] of Object.entries(otherMembers)) {
            if (!m || typeof m !== 'object') continue;
            const fid = lookupFid(m);
            if (fid) memberToFriendId[uid] = fid;

            // Sync contact info (backfill only — don't overwrite existing)
            const match = lookupMaster(m);
            if (match) {
              if (!m.phone && match.phone) updates[`members.${uid}.phone`] = match.phone;
              if (!m.email && match.email) updates[`members.${uid}.email`] = match.email;
            }
          }

          // Apply friend linkedTo -> event plusOneOf
          const friendIdToMemberUid = {};
          for (const [uid, fid] of Object.entries(memberToFriendId)) {
            friendIdToMemberUid[fid] = uid;
          }
          for (const [uid, fid] of Object.entries(memberToFriendId)) {
            const linkedFriendId = friendLinks[fid];
            if (!linkedFriendId) continue;
            const hostUid = friendIdToMemberUid[linkedFriendId];
            if (!hostUid) continue;
            const m = otherMembers[uid];
            if (!m?.plusOneOf || m.plusOneOf !== hostUid) {
              updates[`members.${uid}.plusOneOf`] = hostUid;
            }
          }

          if (Object.keys(updates).length > 0) {
            updateDoc(doc(db, 'events', eventDoc.id), updates).catch(() => {});
          }
        }
      } catch {}
    })();
  }, [friends.length, event, user]);

  // Detect legacy phantom "friend" votes — anonymous votes cast under the
  // generic ?name=Friend invite link before name confirmation was required.
  useEffect(() => {
    const hasFriendMember = !!event?.members?.friend;
    const isOwnerNow = event?.members?.[user?.uid]?.role === 'owner';
    if (!hasFriendMember || !isOwnerNow) {
      setPhantomFriendVotes(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dSnap = await getDocs(collection(db, 'events', eventId, 'dateOptions'));
        let count = 0;
        for (const d of dSnap.docs) {
          if (d.data().votes?.friend) count++;
        }
        if (!cancelled) setPhantomFriendVotes(count);
      } catch {
        if (!cancelled) setPhantomFriendVotes(0);
      }
    })();
    return () => { cancelled = true; };
  }, [event?.members?.friend, user?.uid, eventId]);

  async function cleanupPhantomFriend() {
    if (cleaningPhantom) return;
    setCleaningPhantom(true);
    try {
      const dSnap = await getDocs(collection(db, 'events', eventId, 'dateOptions'));
      for (const d of dSnap.docs) {
        if (d.data().votes?.friend) {
          await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id), {
            'votes.friend': deleteField(),
          }).catch(() => {});
        }
      }
      await updateDoc(doc(db, 'events', eventId), {
        'members.friend': deleteField(),
        memberUids: arrayRemove('friend'),
      }).catch(() => {});
      setPhantomFriendVotes(null);
    } finally {
      setCleaningPhantom(false);
    }
  }

  async function addAltRange(entry) {
    const next = [...(Array.isArray(event?.altRanges) ? event.altRanges : []), entry];
    await updateEvent(eventId, { altRanges: next });
  }

  async function removeAltRange(id) {
    const next = (Array.isArray(event?.altRanges) ? event.altRanges : []).filter(r => r.id !== id);
    await updateEvent(eventId, { altRanges: next });
  }

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!event) return <div className={styles.loading}>Event not found</div>;

  const date = event.date?.toDate ? event.date.toDate() : new Date(event.date);
  const endDate = event.endDate?.toDate ? event.endDate.toDate() : event.endDate ? new Date(event.endDate) : null;
  // Include ALL member entries + voters from date options
  const mergedMembers = { ...(event.members || {}) };
  for (const [voterId, voter] of Object.entries(dateOptionsVoters)) {
    if (!mergedMembers[voterId]) mergedMembers[voterId] = voter;
  }
  const rawMembers = Object.entries(mergedMembers);
  // Build a lookup from friends by email, phone, full name, and first name.
  // First-name only resolves when a single friend has that first name (otherwise
  // we'd match the wrong person — e.g., two "Joannes").
  const friendsByEmail = {};
  const friendsByPhone = {};
  const friendsByName = {};
  const firstNameCounts = {};
  const friendsByFirstName = {};
  for (const f of friends) {
    if (f.email) friendsByEmail[f.email.toLowerCase()] = f;
    if (f.phone) {
      const digits = f.phone.replace(/[^\d]/g, '');
      if (digits.length >= 7) friendsByPhone[digits] = f;
    }
    if (f.name) {
      friendsByName[f.name.toLowerCase()] = f;
      const first = f.name.trim().split(/\s+/)[0]?.toLowerCase();
      if (first) {
        firstNameCounts[first] = (firstNameCounts[first] || 0) + 1;
        friendsByFirstName[first] = f;
      }
    }
  }
  function matchFriend(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.email && friendsByEmail[m.email.toLowerCase()]) return friendsByEmail[m.email.toLowerCase()];
    if (m.phone) {
      const digits = m.phone.replace(/[^\d]/g, '');
      if (digits.length >= 7 && friendsByPhone[digits]) return friendsByPhone[digits];
    }
    if (m.name && friendsByName[m.name.toLowerCase()]) return friendsByName[m.name.toLowerCase()];
    if (m.name) {
      const first = m.name.trim().split(/\s+/)[0]?.toLowerCase();
      if (first && firstNameCounts[first] === 1) return friendsByFirstName[first];
    }
    return null;
  }
  // When no definitive match, surface up to 3 ranked suggestions so the
  // organizer can one-tap link a member to the right Friend record.
  function suggestFriends(m) {
    if (!m || typeof m !== 'object' || !m.name) return [];
    const name = m.name.trim().toLowerCase();
    const first = name.split(/\s+/)[0] || '';
    const scored = [];
    for (const f of friends) {
      if (!f.name) continue;
      const fn = f.name.toLowerCase();
      const fFirst = fn.split(/\s+/)[0] || '';
      let score = 0;
      if (fFirst && first && fFirst === first) score = 3;
      else if (fn.includes(name) || name.includes(fn)) score = 2;
      else if (fFirst && first && (fFirst.startsWith(first) || first.startsWith(fFirst))) score = 1;
      if (score > 0) scored.push({ f, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map(s => s.f);
  }
  const members = rawMembers.filter(([, m]) => m != null).map(([uid, m]) => {
    if (typeof m === 'string') return [uid, { name: m, rsvp: 'pending', email: '', _friendMatch: null, _friendSuggestions: [] }];
    if (typeof m !== 'object') return [uid, { name: String(m), rsvp: 'pending', email: '', _friendMatch: null, _friendSuggestions: [] }];
    const friendMatch = matchFriend(m);
    if (friendMatch) {
      return [uid, {
        ...m,
        name: m.name || friendMatch.name || '',
        phone: m.phone || friendMatch.phone || '',
        email: m.email || friendMatch.email || '',
        _friendMatch: friendMatch,
        _friendSuggestions: [],
      }];
    }
    return [uid, { ...m, _friendMatch: null, _friendSuggestions: suggestFriends(m) }];
  });

  async function linkMemberToFriend(uid, friend) {
    if (!friend) return;
    const updates = {};
    if (friend.name) updates[`members.${uid}.name`] = friend.name;
    if (friend.email) updates[`members.${uid}.email`] = friend.email;
    if (friend.phone) updates[`members.${uid}.phone`] = friend.phone;
    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, 'events', eventId), updates).catch(() => {});
    }
  }
  const isOwner = event.members?.[user?.uid]?.role === 'owner';
  const myRsvp = event.members?.[user?.uid]?.rsvp || 'pending';

  // Detect possible duplicates by phone, email, or first name
  function getDuplicateReason(uid) {
    try {
      const m = members.find(([u]) => u === uid)?.[1];
      if (!m) return null;
      const myFirst = (m.name || '').trim().split(/\s+/)[0].toLowerCase();
      for (const [otherUid, other] of members) {
        if (otherUid === uid || !other) continue;
        if (m.phone && other.phone && String(m.phone).replace(/[^\d]/g, '').length >= 7 && String(m.phone).replace(/[^\d]/g, '') === String(other.phone).replace(/[^\d]/g, '')) return 'phone';
        if (m.email && other.email && String(m.email).toLowerCase().trim() === String(other.email).toLowerCase().trim()) return 'email';
        const otherFirst = (other.name || '').trim().split(/\s+/)[0].toLowerCase();
        if (myFirst && otherFirst && myFirst.length >= 2 && myFirst === otherFirst) return 'name';
      }
    } catch {}
    return null;
  }
  function isDuplicate(uid) { return !!getDuplicateReason(uid); }
  const stage = event.stage || 'voting'; // 'voting' | 'finalized'

  async function handleDragMerge(srcUid, tgtUid) {
    const srcMember = members.find(([u]) => u === srcUid)?.[1];
    const tgtMember = members.find(([u]) => u === tgtUid)?.[1];
    if (!srcMember || !tgtMember) return;
    const srcName = (srcMember.name || '').trim();
    const tgtName = (tgtMember.name || '').trim();
    if (!window.confirm(`Merge ${srcName || 'this person'} with ${tgtName || 'the other contact'}?`)) return;
    const bestName = srcName.length > tgtName.length ? srcName : tgtName;
    const updates = {};
    updates[`members.${tgtUid}.name`] = bestName;
    if (!tgtMember.phone && srcMember.phone) updates[`members.${tgtUid}.phone`] = srcMember.phone;
    if (!tgtMember.email && srcMember.email) updates[`members.${tgtUid}.email`] = srcMember.email;
    if ((!tgtMember.rsvp || tgtMember.rsvp === 'pending') && srcMember.rsvp && srcMember.rsvp !== 'pending') updates[`members.${tgtUid}.rsvp`] = srcMember.rsvp;
    for (const [mUid, mData] of members) {
      if (mData.plusOneOf === srcUid) updates[`members.${mUid}.plusOneOf`] = tgtUid;
    }
    updates[`members.${srcUid}`] = deleteField();
    await updateDoc(doc(db, 'events', eventId), updates);
    try {
      const dSnap = await getDocs(collection(db, 'events', eventId, 'dateOptions'));
      for (const d of dSnap.docs) {
        const votes = d.data().votes || {};
        if (votes[srcUid] && !votes[tgtUid]) {
          await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id), {
            [`votes.${tgtUid}`]: { ...votes[srcUid], name: bestName },
            [`votes.${srcUid}`]: deleteField(),
          });
        } else if (votes[srcUid]) {
          await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id), { [`votes.${srcUid}`]: deleteField() });
        }
      }
    } catch {}
  }


  async function toggleStage() {
    if (stage === 'voting') {
      // Open modal with empty dates — user must manually pick
      setFinalizeDate('');
      setFinalizeEndDate('');
      setShowFinalize(true);
    } else {
      await updateEvent(eventId, { stage: 'voting' });
    }
  }

  async function confirmFinalize() {
    if (!finalizeDate) return;
    const d = new Date(finalizeDate + 'T12:00:00');
    const updates = { stage: 'finalized', date: d };
    if (finalizeEndDate && finalizeEndDate !== finalizeDate) {
      updates.endDate = new Date(finalizeEndDate + 'T12:00:00');
    }
    await updateEvent(eventId, updates);
    setShowFinalize(false);
  }

  async function handleDelete() {
    if (window.confirm('Delete this event? This cannot be undone.')) {
      await deleteEvent(eventId);
      navigate('/');
    }
  }

  const inviteLink = `${window.location.origin}/invite/${event.shareToken}`;

  const itineraryText = (() => {
    const items = (Array.isArray(event.itinerary) ? event.itinerary : [])
      .filter(it => (it.type || 'activity') !== 'travel');
    if (items.length === 0) return '';
    const sorted = [...items].sort((a, b) => {
      const ka = `${a.date || ''} ${a.time || ''}`;
      const kb = `${b.date || ''} ${b.time || ''}`;
      return ka.localeCompare(kb);
    });
    const byDate = new Map();
    const undated = [];
    for (const it of sorted) {
      if (!it.date) { undated.push(it); continue; }
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    }
    const formatDateHeader = (ymd) => {
      try {
        const d = new Date(ymd + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      } catch { return ymd; }
    };
    const formatTime = (t) => {
      if (!t) return '';
      const m = /^(\d{1,2}):(\d{2})/.exec(t);
      if (!m) return t;
      let h = parseInt(m[1], 10);
      const mm = m[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${mm} ${ampm}`;
    };
    const renderItem = (it) => {
      const time = formatTime(it.time);
      const title = it.title || '(untitled)';
      let line = time ? `  • ${time} — ${title}` : `  • ${title}`;
      if (it.location) line += ` @ ${it.location}`;
      return line;
    };
    const sections = [];
    for (const [ymd, list] of byDate) {
      sections.push(formatDateHeader(ymd));
      for (const it of list) sections.push(renderItem(it));
      sections.push('');
    }
    if (undated.length) {
      sections.push('TBD');
      for (const it of undated) sections.push(renderItem(it));
    }
    return '\n\nItinerary:\n' + sections.join('\n').trimEnd();
  })();

  const itineraryLink = `${inviteLink}?tab=itinerary`;
  const icsDescription = (event.description || '')
    + itineraryText
    + '\n\nFor more details around travel, please visit this website to view the itinerary: ' + itineraryLink;

  const { calStart, calEnd } = (() => {
    const items = (Array.isArray(event.itinerary) ? event.itinerary : [])
      .filter(it => (it.type || 'activity') !== 'travel' && it.date && it.time);
    const toDate = (it) => {
      const t = /^\d{1,2}:\d{2}$/.test(it.time) ? `${it.time}:00` : it.time;
      const d = new Date(`${it.date}T${t}`);
      return isNaN(d) ? null : d;
    };
    const dates = items.map(toDate).filter(Boolean);
    if (dates.length === 0) {
      return { calStart: date, calEnd: endDate || new Date(date.getTime() + 3600000) };
    }
    const start = new Date(Math.min(...dates.map(d => d.getTime())));
    const end = dates.length > 1
      ? new Date(Math.max(...dates.map(d => d.getTime())))
      : new Date(start.getTime() + 3600000);
    return { calStart: start, calEnd: end };
  })();

  const attendeeEmails = (() => {
    const seen = new Set();
    const out = [];
    for (const [uid, m] of members) {
      if (uid === user?.uid) continue;
      if (m?.rsvp === 'no') continue;
      const raw = (m?.email || (uid.includes('@') ? uid : '')).trim();
      if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
    }
    return out;
  })();
  const attendeesParam = attendeeEmails.length ? `&add=${encodeURIComponent(attendeeEmails.join(','))}` : '';

  const icsUrl = `/api/calendar-invite?title=${encodeURIComponent(event.title)}&start=${encodeURIComponent(calStart.toISOString())}&end=${encodeURIComponent(calEnd.toISOString())}${event.location ? `&location=${encodeURIComponent(event.location)}` : ''}&description=${encodeURIComponent(icsDescription)}&url=${encodeURIComponent(inviteLink)}`;

  const googleCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${calStart.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}/${calEnd.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}${event.location ? `&location=${encodeURIComponent(event.location)}` : ''}&details=${encodeURIComponent(icsDescription)}${attendeesParam}`;

  const userCalSync = user?.uid ? event.googleCalendar?.[user.uid] : null;
  const calIsStale = !!userCalSync && (
    userCalSync.calStartMs !== calStart.getTime() ||
    userCalSync.calEndMs !== calEnd.getTime()
  );

  async function handleCalendarSync() {
    if (!user?.uid) return;
    setCalSyncing(true);
    setCalSyncMsg(null);
    try {
      if (!isGoogleCalendarConnected()) {
        await connectGoogleCalendar();
      }
      // Re-sync writes back to the calendar where the event was originally created,
      // so changing your default later doesn't strand existing events.
      const targetId = userCalSync?.calendarId || calTarget.id;
      const targetName = userCalSync?.calendarName || calTarget.name;
      const doSync = () => syncEventToGoogleCalendar({
        event,
        googleEventId: userCalSync?.googleEventId,
        calStart,
        calEnd,
        description: icsDescription,
        calendarId: targetId,
      });
      let googleEventId;
      try {
        googleEventId = await doSync();
      } catch (err) {
        if (err?.code === 'NOT_CONNECTED') {
          await connectGoogleCalendar();
          googleEventId = await doSync();
        } else {
          throw err;
        }
      }
      await updateEvent(eventId, {
        [`googleCalendar.${user.uid}`]: {
          googleEventId,
          calendarId: targetId,
          calendarName: targetName,
          calStartMs: calStart.getTime(),
          calEndMs: calEnd.getTime(),
          syncedAt: new Date().toISOString(),
        },
      });
      setCalSyncMsg({ type: 'success', message: userCalSync ? `Updated in “${targetName}”` : `Added to “${targetName}”` });
    } catch (err) {
      setCalSyncMsg({ type: 'error', message: err?.message || 'Failed to sync to Google Calendar' });
    } finally {
      setCalSyncing(false);
      setTimeout(() => setCalSyncMsg(null), 6000);
    }
  }

  async function handleCalendarRemove() {
    if (!user?.uid || !userCalSync?.googleEventId) return;
    const targetName = userCalSync.calendarName || 'your Google Calendar';
    if (!window.confirm(`Remove this event from “${targetName}”?`)) return;
    setCalSyncing(true);
    setCalSyncMsg(null);
    try {
      await removeEventFromGoogleCalendar(userCalSync.googleEventId, userCalSync.calendarId || 'primary');
      await updateEvent(eventId, { [`googleCalendar.${user.uid}`]: deleteField() });
      setCalSyncMsg({ type: 'success', message: `Removed from “${targetName}”` });
    } catch (err) {
      setCalSyncMsg({ type: 'error', message: err?.message || 'Failed to remove from Google Calendar' });
    } finally {
      setCalSyncing(false);
      setTimeout(() => setCalSyncMsg(null), 5000);
    }
  }

  async function openCalendarPicker() {
    setShowCalPicker(true);
    setCalPickerError('');
    if (calPickerList) return; // already loaded
    setCalPickerLoading(true);
    try {
      if (!isGoogleCalendarConnected()) {
        await connectGoogleCalendar();
      }
      const cals = await listGoogleCalendars();
      setCalPickerList(cals);
    } catch (err) {
      if (err?.code === 'NOT_CONNECTED') {
        try {
          await connectGoogleCalendar();
          const cals = await listGoogleCalendars();
          setCalPickerList(cals);
        } catch (err2) {
          setCalPickerError(err2?.message || 'Failed to load calendars');
        }
      } else {
        setCalPickerError(err?.message || 'Failed to load calendars');
      }
    } finally {
      setCalPickerLoading(false);
    }
  }

  function chooseCalendar(cal) {
    const id = cal.primary ? 'primary' : cal.id;
    setSyncTargetCalendar(id, cal.name);
    setCalTarget({ id, name: cal.name });
    setShowCalPicker(false);
  }

  function handleCopyLink() {
    const fromName = user?.displayName || 'Someone';
    const pollUrl = `${window.location.origin}/poll/${eventId}?name=Friend`;
    const message = `Hey! ${fromName} invited you to ${event.title}.\n\nVote here on what dates you can make: ${pollUrl}`;
    navigator.clipboard.writeText(message);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  function handleSendInvite(e) {
    e.preventDefault();
    const dateStr = format(date, 'EEEE, MMMM d, yyyy · h:mm a');
    const fromName = user?.displayName || 'Someone';
    const messageText = `You're invited to ${event.title}!\n\nWhen: ${dateStr}${event.location ? `\nWhere: ${event.location}` : ''}${event.description ? `\n\n${event.description}` : ''}\n\nView event & RSVP: ${inviteLink}`;

    if (inviteEmail.trim()) {
      // Open Gmail compose with pre-filled recipient
      const subject = encodeURIComponent(`${fromName} invited you to: ${event.title}`);
      const body = encodeURIComponent(messageText);
      const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(inviteEmail.trim())}&su=${subject}&body=${body}`;
      window.open(gmailUrl, '_blank');
      // Mark member as emailed
      const emailLower = inviteEmail.trim().toLowerCase();
      const memberEntry = members.find(([uid, m]) => (m.email || '').toLowerCase() === emailLower || uid.toLowerCase() === emailLower);
      if (memberEntry) {
        updateEvent(eventId, { [`members.${memberEntry[0]}.emailed`]: new Date().toISOString() });
      }
      setInviteResult('Gmail opened!');
      setInviteEmail('');
    } else if (navigator.share) {
      // Use native share on mobile
      navigator.share({ title: event.title, text: messageText, url: inviteLink }).catch(() => {});
    } else {
      // Fallback: copy message
      navigator.clipboard.writeText(messageText);
      setInviteResult('Invite message copied to clipboard!');
    }
  }

  const tabs = [
    { key: 'details', label: 'People & Poll' },
    { key: 'itinerary', label: 'Itinerary' },
    { key: 'notes', label: 'Notes' },
    { key: 'chat', label: 'Chat' },
  ];

  return (
    <div className={`${styles.page} ${activeTab === 'itinerary' ? styles.pageWide : ''}`}>
      <button className={styles.backBtn} onClick={() => navigate('/')}>← Back</button>

      {/* Event progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: '1rem', borderRadius: 'var(--radius-full)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        {[
          { key: 'created', label: 'Created' },
          { key: 'voting', label: 'Voting' },
          { key: 'finalized', label: 'Date Finalized' },
          { key: 'itinerary', label: 'Itinerary Completed' },
          { key: 'booked', label: 'Travel Booked' },
        ].map((step, i, arr) => {
          const isFinalized = stage === 'finalized';
          const isItineraryComplete = isFinalized && event.itineraryComplete;
          const isBooked = isFinalized && event.travelBooked;
          const isActive =
            step.key === 'created' ||
            (step.key === 'voting' && (stage === 'voting' || isFinalized)) ||
            (step.key === 'finalized' && isFinalized) ||
            (step.key === 'itinerary' && isItineraryComplete) ||
            (step.key === 'booked' && isBooked);
          const isCurrent =
            (step.key === 'voting' && stage === 'voting') ||
            (step.key === 'finalized' && isFinalized && !isItineraryComplete && !isBooked) ||
            (step.key === 'itinerary' && isItineraryComplete && !isBooked) ||
            (step.key === 'booked' && isBooked) ||
            (step.key === 'created' && stage !== 'voting' && !isFinalized);
          return (
            <div key={step.key} style={{
              flex: 1, padding: '0.45rem 0', textAlign: 'center',
              fontSize: '0.72rem', fontWeight: isCurrent ? 700 : 500,
              background: isActive ? 'var(--color-accent)' : 'var(--color-surface)',
              color: isActive ? '#fff' : 'var(--color-text-muted)',
              borderRight: i < arr.length - 1 ? '1px solid var(--color-border)' : 'none',
            }}>
              {isActive && step.key !== 'created' ? '✓ ' : ''}{step.label}
            </div>
          );
        })}
      </div>

      <div className={styles.hero}>
        <div className={styles.dateBadge}>
          {event.dateTBD ? (
            <>
              <span className={styles.dateMonth}>TBD</span>
              <span className={styles.dateDay}>📊</span>
            </>
          ) : (
            <>
              <span className={styles.dateMonth}>{format(date, 'MMM')}</span>
              <span className={styles.dateDay}>{format(date, 'd')}</span>
            </>
          )}
        </div>
        <div className={styles.heroInfo}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h1 className={styles.title} style={{ margin: 0 }}>{event.title}</h1>
            <span style={{ padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: stage === 'finalized' ? 'var(--color-success-light)' : 'var(--color-warning-light)', color: stage === 'finalized' ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {stage === 'finalized' ? 'Dates Finalized' : 'Voting Open'}
            </span>
          </div>
          <p className={styles.datetime}>
            {event.dateTBD
              ? 'Date to be determined — based on poll voting'
              : (() => {
                  const items = (Array.isArray(event.itinerary) ? event.itinerary : [])
                    .filter(it => (it.type || 'activity') !== 'travel' && it.time);
                  const toMin = (t) => {
                    const m = /^(\d{1,2}):(\d{2})/.exec(t);
                    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
                  };
                  const toLabel = (t) => {
                    const m = /^(\d{1,2}):(\d{2})/.exec(t);
                    if (!m) return '';
                    let h = parseInt(m[1], 10);
                    const mm = m[2];
                    const ampm = h >= 12 ? 'PM' : 'AM';
                    h = h % 12 || 12;
                    return `${h}:${mm} ${ampm}`;
                  };
                  const mins = items.map(it => toMin(it.time)).filter(v => v !== null);
                  if (mins.length > 0) {
                    const minIdx = mins.indexOf(Math.min(...mins));
                    const maxIdx = mins.indexOf(Math.max(...mins));
                    const startLabel = toLabel(items[minIdx].time);
                    const endLabel = mins.length > 1 ? toLabel(items[maxIdx].time) : '';
                    return (
                      <>
                        {format(date, 'EEEE, MMMM d, yyyy')} · {startLabel}
                        {endLabel && ` – ${endLabel}`}
                      </>
                    );
                  }
                  return (
                    <>
                      {format(date, 'EEEE, MMMM d, yyyy · h:mm a')}
                      {endDate && ` – ${format(endDate, 'h:mm a')}`}
                    </>
                  );
                })()
            }
          </p>
          {event.location && <p className={styles.location}>📍 {event.location}</p>}
        </div>
      </div>

      {user?.uid && stage === 'finalized' && !event.dateTBD && (
        <div className={styles.rsvpSection} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            {!userCalSync && (
              <button className={styles.shareBtn} disabled={calSyncing} onClick={handleCalendarSync}>
                {calSyncing ? 'Syncing…' : '📅 Sync to my Google Calendar'}
              </button>
            )}
            {userCalSync && (
              <>
                <button
                  className={styles.shareBtn}
                  disabled={calSyncing}
                  onClick={handleCalendarSync}
                  style={calIsStale ? { background: 'var(--color-warning-light)', borderColor: 'var(--color-warning)', color: 'var(--color-warning)' } : undefined}
                >
                  {calSyncing
                    ? 'Syncing…'
                    : calIsStale
                      ? '↻ Update in Google Calendar (date changed)'
                      : '✓ Synced to Google Calendar — Re-sync'}
                </button>
                <button className={styles.shareBtn} disabled={calSyncing} onClick={handleCalendarRemove}>
                  Remove from Google Calendar
                </button>
              </>
            )}
            {calSyncMsg && (
              <span style={{
                fontSize: '0.85rem',
                color: calSyncMsg.type === 'success' ? 'var(--color-success)' : 'var(--color-danger, #b91c1c)',
              }}>
                {calSyncMsg.message}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            {userCalSync ? (
              <>Synced to <strong>{userCalSync.calendarName || 'Primary calendar'}</strong></>
            ) : (
              <>Syncing to <strong>{calTarget.name}</strong></>
            )}
            {calAutoSync && <> · <span style={{ color: 'var(--color-success)' }}>Auto-sync on</span></>}
            {' · '}
            <button
              type="button"
              onClick={openCalendarPicker}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}
            >
              Change
            </button>
          </div>
        </div>
      )}

      {showCalPicker && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}
          onClick={() => setShowCalPicker(false)}
        >
          <div
            style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', maxWidth: '420px', width: '100%', boxShadow: 'var(--shadow-lg)' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Choose Calendar</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 0.85rem' }}>
              Future syncs of finalized Rally events will be added to this calendar. Existing synced events stay where they were created.
            </p>
            {calPickerLoading && <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem 0' }}>Loading calendars…</p>}
            {calPickerError && <p style={{ fontSize: '0.85rem', color: 'var(--color-danger, #b91c1c)' }}>{calPickerError}</p>}
            {!calPickerLoading && calPickerList && calPickerList.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No writable calendars found.</p>
            )}
            {!calPickerLoading && calPickerList && calPickerList.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '320px', overflowY: 'auto' }}>
                {calPickerList.map(cal => {
                  const targetIdForCal = cal.primary ? 'primary' : cal.id;
                  const isSelected = calTarget.id === targetIdForCal;
                  return (
                    <button
                      key={cal.id}
                      type="button"
                      onClick={() => chooseCalendar(cal)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.75rem',
                        border: isSelected ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                        borderRadius: '8px', background: isSelected ? 'var(--color-accent-light)' : 'var(--color-surface)',
                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', boxSizing: 'border-box',
                      }}
                    >
                      <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: cal.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--color-text)', flex: 1 }}>{cal.name}</span>
                      {cal.primary && <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>Primary</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', marginTop: '1rem', padding: '0.65rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={calAutoSync}
                onChange={(e) => {
                  setCalAutoSync(e.target.checked);
                  setAutoSyncEnabled(e.target.checked);
                }}
                style={{ accentColor: 'var(--color-accent)', width: '16px', height: '16px', marginTop: '2px' }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text)' }}>Auto-sync finalized events</span>
                <br />
                <span style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                  Automatically add every finalized Rally event to <strong>{calTarget.name}</strong> while you have Rally open. You won't need to click Sync per event.
                </span>
              </span>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
              <button
                type="button"
                onClick={() => setShowCalPicker(false)}
                style={{ flex: 1, padding: '0.55rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {user?.email === 'baldaufdan@gmail.com' && (
      <div className={styles.rsvpSection}>
        <button className={styles.shareBtn} onClick={() => window.open(googleCalUrl, '_blank')}>
          📅 Add to Google Calendar
        </button>
        <a href={icsUrl} className={styles.shareBtn} style={{ textDecoration: 'none', display: 'inline-flex' }}>
          📅 Download .ics
        </a>
        <button className={styles.shareBtn} onClick={handleCopyLink}>
          {inviteCopied ? '✓ Link copied!' : '🔗 Copy link'}
        </button>
        <button className={styles.shareBtn} onClick={() => setShowInvite(true)}>
          ✉ Share invite
        </button>
        {members.length > 1 && (
          <button className={styles.shareBtn} onClick={() => {
            const emails = members
              .filter(([uid, m]) => uid !== user?.uid && (m.email || (uid.includes('@') ? uid : '')))
              .map(([uid, m]) => m.email || uid)
              .filter(Boolean);
            if (emails.length === 0) { alert('No contacts with emails to invite'); return; }
            const dateStr = format(date, 'EEEE, MMMM d, yyyy · h:mm a');
            const subject = encodeURIComponent(`You're invited: ${event.title}`);
            const addToCalLink = `${window.location.origin}${icsUrl}`;
            const pollLink = `${window.location.origin}/poll/${eventId}?name=Friend`;
            const body = encodeURIComponent(
              `You're invited to ${event.title}!\n\n` +
              `When: ${dateStr}\n` +
              (event.location ? `Where: ${event.location}\n` : '') +
              (event.description ? `\n${event.description}\n` : '') +
              `\nRSVP and vote on dates: ${pollLink}\n` +
              `\nAdd to Google Calendar: ${googleCalUrl}\n` +
              `\nAdd to Outlook/Apple Calendar: ${addToCalLink}\n`
            );
            window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(emails.join(','))}&su=${subject}&body=${body}`, '_blank');
            // Mark all emailed members
            const updates = {};
            members.filter(([uid, m]) => uid !== user?.uid && (m.email || uid.includes('@'))).forEach(([uid]) => {
              updates[`members.${uid}.emailed`] = new Date().toISOString();
            });
            if (Object.keys(updates).length > 0) updateEvent(eventId, updates);
          }}>
            ✉ Email All Invited ({members.filter(([uid]) => uid !== user?.uid).length})
          </button>
        )}
        {members.length > 1 && (() => {
          const phones = members
            .filter(([uid, m]) => uid !== user?.uid && m.phone)
            .map(([, m]) => m.phone);
          if (phones.length === 0) return null;
          const dateStr = format(date, 'EEEE, MMMM d, yyyy · h:mm a');
          const pollLink = `${window.location.origin}/poll/${eventId}?name=Friend`;
          const calendarLink = `${window.location.origin}${icsUrl}`;
          const pollMsg = event.stage === 'finalized'
            ? `Hey! Just a reminder about ${event.title} on ${dateStr}${event.location ? ` at ${event.location}` : ''}. See you there!\n\nDetails & RSVP: ${pollLink}`
            : `You're invited to ${event.title}!\n\nVote here on what dates you can make: ${pollLink}`;
          const calMsg = `You're invited to ${event.title} on ${dateStr}${event.location ? ` at ${event.location}` : ''}.\n\nAdd to your calendar: ${calendarLink}`;
          return (
            <>
              {activeTab !== 'itinerary' && (
                <button className={styles.shareBtn} onClick={() => {
                  setTextAllMessage(pollMsg);
                  setShowTextAll(true);
                }}>
                  💬 Text All Poll ({phones.length})
                </button>
              )}
              <button className={styles.shareBtn} onClick={() => {
                setTextAllMessage(calMsg);
                setShowTextAll(true);
              }}>
                📅 Text All Calendar Invite ({phones.length})
              </button>
            </>
          );
        })()}
      </div>
      )}

      {showTextAll && (() => {
        const recipients = members.filter(([uid, m]) => uid !== user?.uid && m.phone);
        const phones = recipients.map(([, m]) => m.phone);
        if (phones.length === 0) return null;
        const sendText = () => {
          const cleanedPhones = phones
            .map(p => {
              let c = String(p).replace(/[^+\d]/g, '');
              if (!c.startsWith('+')) {
                c = c.startsWith('1') ? `+${c}` : `+1${c}`;
              }
              return c;
            })
            .join(',');
          const body = encodeURIComponent(textAllMessage);
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
          const smsUrl = isIOS
            ? `sms:/open?addresses=${cleanedPhones}&body=${body}`
            : `sms:${cleanedPhones}?body=${body}`;
          const updates = {};
          recipients.forEach(([uid]) => {
            updates[`members.${uid}.texted`] = new Date().toISOString();
          });
          if (Object.keys(updates).length > 0) updateEvent(eventId, updates);
          window.location.href = smsUrl;
          setShowTextAll(false);
          setTextAllMessage('');
        };
        return (
          <div style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem',
            marginBottom: '0.75rem',
            background: 'var(--color-surface-alt)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Edit text draft — sending to {recipients.length}
              </span>
              <button
                onClick={() => { if (!textAllSending) { setShowTextAll(false); setTextAllMessage(''); } }}
                disabled={textAllSending}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '1.1rem', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                title="Close draft"
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
              {recipients.map(([uid, m]) => (
                <span key={uid} style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.45rem',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-full)',
                  color: 'var(--color-text-secondary)',
                }}>
                  {m.name || 'Unnamed'}
                </span>
              ))}
            </div>
            <textarea
              value={textAllMessage}
              onChange={e => setTextAllMessage(e.target.value)}
              rows={4}
              disabled={textAllSending}
              placeholder="Write a message to send to the group..."
              style={{
                width: '100%',
                padding: '0.55rem 0.7rem',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.88rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                {textAllMessage.length} character{textAllMessage.length !== 1 ? 's' : ''}
              </span>
              <button
                disabled={!textAllMessage.trim() || textAllSending}
                onClick={sendText}
                style={{
                  padding: '0.4rem 0.9rem',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: !textAllMessage.trim() ? 'not-allowed' : 'pointer',
                  opacity: !textAllMessage.trim() ? 0.5 : 1,
                }}
              >
                📤 Open in Messages ({phones.length})
              </button>
            </div>
          </div>
        );
      })()}

      {result && <div style={{ padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', fontWeight: 500, marginBottom: '0.5rem', background: 'var(--color-success-light)', color: 'var(--color-success)' }}>{result.message}</div>}

      <div className={styles.tabs}>
        {tabs.map(t => (
          <button key={t.key} className={activeTab === t.key ? styles.tabActive : styles.tab} onClick={() => setActiveTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'details' && (
        <div className={styles.content}>
          {event.description && (
            <div className={styles.descSection}>
              <h3 className={styles.sectionTitle}>About</h3>
              <p className={styles.description}>{event.description}</p>
            </div>
          )}

          <div className={styles.membersSection}>
            <h3 className={styles.sectionTitle}>
              Invited ({members.length})
              <span style={{ fontSize: '0.68rem', fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                {members.filter(([uid]) => voteStats[uid]?.total > 0).length} voted · {members.filter(([, m]) => m.skipVote).length} skip · {members.filter(([uid, m]) => !voteStats[uid]?.total && !m.skipVote).length} waiting
              </span>
              {(() => {
                const hasEmail = (uid, m) => !!m.email || uid.includes('@');
                const hasPhone = (uid, m) => !!m.phone;
                const counts = {
                  phone: members.filter(([uid, m]) => !hasPhone(uid, m)).length,
                  email: members.filter(([uid, m]) => !hasEmail(uid, m)).length,
                  both: members.filter(([uid, m]) => !hasPhone(uid, m) && !hasEmail(uid, m)).length,
                };
                const chips = [
                  { key: 'phone', label: 'Missing phone' },
                  { key: 'email', label: 'Missing email' },
                  { key: 'both', label: 'Missing both' },
                ];
                return (
                  <span style={{ display: 'inline-flex', gap: '0.3rem', marginLeft: '0.6rem', flexWrap: 'wrap' }}>
                    {chips.map(c => {
                      const active = missingFilter === c.key;
                      return (
                        <button
                          key={c.key}
                          onClick={() => setMissingFilter(active ? 'none' : c.key)}
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '0.2rem 0.6rem',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-border)',
                            background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                            color: active ? '#fff' : 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                          title={`Show only attendees ${c.label.toLowerCase()}`}
                        >
                          {active ? '✓ ' : ''}{c.label} ({counts[c.key]})
                        </button>
                      );
                    })}
                  </span>
                );
              })()}
            </h3>
            {(() => {
              // Build a map of which group each host belongs to
              const hostGroup = {};
              for (const [uid, m] of members) {
                if (m.skipVote) hostGroup[uid] = 'skip';
                else if (voteStats[uid]?.total > 0) hostGroup[uid] = 'voted';
                else hostGroup[uid] = 'waiting';
              }
              // Linked members go to the highest-priority group between them
              // Priority: voted > skip > waiting
              function getGroup(uid, m) {
                const own = m.skipVote ? 'skip' : voteStats[uid]?.total > 0 ? 'voted' : 'waiting';
                if (!m.plusOneOf) return own;
                const linked = hostGroup[m.plusOneOf] || 'waiting';
                // Pick whichever is higher priority
                const priority = { voted: 0, skip: 1, waiting: 2 };
                return (priority[own] ?? 2) <= (priority[linked] ?? 2) ? own : linked;
              }
              return [
                { key: 'voted', label: 'Voted', color: '#6366F1' },
                { key: 'skip', label: "Doesn't Need to Vote", color: '#6B7280' },
                { key: 'waiting', label: 'Waiting on Vote', color: '#F59E0B' },
              ].map(group => {
                const groupMembers = members.filter(([uid, m]) => {
                  if (getGroup(uid, m) !== group.key) return false;
                  const hasEmail = !!m.email || uid.includes('@');
                  const hasPhone = !!m.phone;
                  if (missingFilter === 'phone' && hasPhone) return false;
                  if (missingFilter === 'email' && hasEmail) return false;
                  if (missingFilter === 'both' && (hasEmail || hasPhone)) return false;
                  return true;
                });
              if (groupMembers.length === 0) return null;
              return (
                <div key={group.key} style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: group.color, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                    {group.label} ({groupMembers.length})
                  </div>
                  <div className={styles.memberList}>
                    {(() => {
                      // Group linked members together (handles mutual links, one-way links, and unlinked)
                      const processed = new Set();
                      const clusters = [];
                      const memberMap = new Map(groupMembers.map(e => [e[0], e]));

                      for (const entry of groupMembers) {
                        const [uid, m] = entry;
                        if (processed.has(uid)) continue;
                        processed.add(uid);

                        // Find all linked members (follow plusOneOf chain)
                        const cluster = [entry];
                        const linked = m.plusOneOf ? memberMap.get(m.plusOneOf) : null;
                        if (linked && !processed.has(linked[0])) {
                          processed.add(linked[0]);
                          cluster.push(linked);
                          // Check if linked member also links to someone else
                          const linkedLinked = linked[1].plusOneOf && linked[1].plusOneOf !== uid ? memberMap.get(linked[1].plusOneOf) : null;
                          if (linkedLinked && !processed.has(linkedLinked[0])) {
                            processed.add(linkedLinked[0]);
                            cluster.push(linkedLinked);
                          }
                        }
                        // Also find anyone pointing TO this member
                        for (const other of groupMembers) {
                          if (!processed.has(other[0]) && other[1].plusOneOf === uid) {
                            processed.add(other[0]);
                            cluster.push(other);
                          }
                        }
                        clusters.push(cluster);
                      }
                      return clusters;
                    })().map((cluster, ci) => (
                      <div key={ci} style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'stretch', marginBottom: '0.35rem', ...(cluster.length > 1 ? { border: '2px solid var(--color-accent)', borderRadius: 'calc(var(--radius-md) + 2px)', padding: '0.2rem', background: 'var(--color-accent-light)' } : {}) }}>
                        {cluster.map(([uid, m]) => {
                      const dupeReason = getDuplicateReason(uid);
                      const isDupe = !!dupeReason;
                      return (
                      <div key={uid} className={styles.member}
                        draggable={isOwner}
                        onDragStart={e => { e.stopPropagation(); setDragMemberUid(uid); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (dragMemberUid && dragMemberUid !== uid) setDropTargetUid(uid); }}
                        onDragLeave={() => { if (dropTargetUid === uid) setDropTargetUid(null); }}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragMemberUid && dragMemberUid !== uid) handleDragMerge(dragMemberUid, uid); setDragMemberUid(null); setDropTargetUid(null); }}
                        onDragEnd={() => { setDragMemberUid(null); setDropTargetUid(null); }}
                        onClick={isOwner ? () => { if (!dragMemberUid) { setEditMember({ uid, ...m }); setEditMemberFields({ name: m.name || '', email: m.email || '', phone: m.phone || '', rsvp: m.rsvp || 'pending', role: m.role || 'viewer', plusOneOf: m.plusOneOf || '' }); } } : undefined}
                        style={{ ...(isOwner ? { cursor: dragMemberUid ? 'grabbing' : 'grab' } : {}), ...(isDupe ? { background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 'var(--radius-md)' } : {}), ...(dropTargetUid === uid ? { background: '#DBEAFE', border: '2px solid #3B82F6', borderRadius: 'var(--radius-md)' } : {}), ...(dragMemberUid === uid ? { opacity: 0.4 } : {}) }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className={styles.memberName}>
                            {m.name || 'Guest'}
                            {isDupe && <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#D97706', marginLeft: '0.35rem' }}>⚠ Possible duplicate ({dupeReason})</span>}
                          </span>
                          <div style={{ display: 'flex', gap: '0.3rem', marginTop: '1px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {(m.email || uid.includes('@')) && <span title={m.email || uid} style={{ fontSize: '0.7rem' }}>✉️</span>}
                            {m.phone && <span title={m.phone} style={{ fontSize: '0.7rem' }}>💬</span>}
                            {isOwner && uid !== user?.uid && (() => {
                              if (m._friendMatch) {
                                return (
                                  <span title={`Linked to Friend: ${m._friendMatch.name}`} style={{ fontSize: '0.58rem', fontWeight: 600, padding: '1px 6px', borderRadius: '999px', background: '#DCFCE7', color: '#166534' }}>
                                    ✓ Linked
                                  </span>
                                );
                              }
                              const suggestions = m._friendSuggestions || [];
                              if (suggestions.length > 0) {
                                const top = suggestions[0];
                                return (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      if (window.confirm(`Link ${m.name || 'this member'} to Friend "${top.name}"?\n\nThis will copy ${top.name}'s name, email, and phone onto this attendee.`)) {
                                        linkMemberToFriend(uid, top);
                                      }
                                    }}
                                    title={`Click to link to ${top.name}`}
                                    style={{ fontSize: '0.58rem', fontWeight: 600, padding: '1px 6px', borderRadius: '999px', background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', cursor: 'pointer', fontFamily: 'inherit' }}
                                  >
                                    💡 {top.name}?
                                  </button>
                                );
                              }
                              return (
                                <span title="No matching Friend — add this person from the Friends page" style={{ fontSize: '0.58rem', fontWeight: 600, padding: '1px 6px', borderRadius: '999px', background: '#F3F4F6', color: '#6B7280' }}>
                                  No Friend found
                                </span>
                              );
                            })()}
                            {(() => {
                              const vs = voteStats[uid];
                              if (!vs || !vs.totalOptions || vs.total === 0) return null;
                              if (vs.total >= vs.totalOptions) return null;
                              const pct = Math.round((vs.total / vs.totalOptions) * 100);
                              return (
                                <span title={`Voted on ${vs.total} of ${vs.totalOptions} open dates`} style={{ fontSize: '0.6rem', fontWeight: 600, padding: '0 5px', borderRadius: '999px', background: '#FEF3C7', color: '#D97706' }}>
                                  {pct}% voted
                                </span>
                              );
                            })()}
                          </div>
                          {(() => {
                            if (m.skipVote) {
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '1px' }}>
                                  {isOwner && (
                                    <button
                                      onClick={e => { e.stopPropagation(); updateEvent(eventId, { [`members.${uid}.skipVote`]: false }); }}
                                      style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '0.6rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
                                    >undo skip</button>
                                  )}
                                </div>
                              );
                            }
                            const vs = voteStats[uid];
                            return (
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '1px', flexWrap: 'wrap' }}>
                                {isOwner && !vs && (
                                  <button
                                    onClick={e => { e.stopPropagation(); updateEvent(eventId, { [`members.${uid}.skipVote`]: true }); }}
                                    style={{ fontSize: '0.58rem', fontWeight: 600, padding: '0 5px', borderRadius: '999px', background: '#F3F4F6', color: '#9CA3AF', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                                    title="Mark as doesn't need to vote"
                                  >Skip vote</button>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {m.phone && uid !== user?.uid && (() => {
                          const name = m.name ? m.name.split(' ')[0] : 'Friend';
                          const pollUrl = `${window.location.origin}/poll/${eventId}?name=${encodeURIComponent(name)}`;
                          const dateStr = event.date ? format(new Date(event.date.seconds ? event.date.seconds * 1000 : event.date), 'EEEE, MMMM d · h:mm a') : '';
                          const msg = `Hey ${name}! You're invited to ${event.title}.\n\nVote here on what dates you can make: ${pollUrl}`;
                          const cleaned = m.phone.replace(/[^\d+]/g, '');
                          return (
                            <a href={`sms:${cleaned}?body=${encodeURIComponent(msg)}`}
                              onClick={(e) => { e.stopPropagation(); updateEvent(eventId, { [`members.${uid}.texted`]: new Date().toISOString() }); }}
                              title={`Text ${m.name || 'member'}`}
                              style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: 'var(--radius-full)', background: '#DCFCE7', color: '#166534', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
                              💬
                            </a>
                          );
                        })()}
                        {m.role === 'owner' && <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-full)', background: 'var(--color-accent-light)', color: 'var(--color-accent)', fontWeight: 600 }}>Organizer</span>}
                        {m.emailed && <span title={`Emailed ${new Date(m.emailed).toLocaleDateString()}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius-full)', background: '#EDE9FE', color: '#7C3AED', fontWeight: 600 }}>✉ Emailed</span>}
                        {m.texted && <span title={`Texted ${new Date(m.texted).toLocaleDateString()}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius-full)', background: '#DCFCE7', color: '#166534', fontWeight: 600 }}>✓ Texted</span>}
                        {stage === 'finalized' && m.rsvp && m.rsvp !== 'pending' && <span className={`${styles.rsvpBadge} ${styles[`rsvp_${m.rsvp}`]}`}>{m.rsvp}</span>}
                        {isOwner && m.role !== 'owner' && uid !== user?.uid && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm(`Remove ${m.name || 'this person'} from the event?`)) return;
                              // Remove from event members
                              await updateDoc(doc(db, 'events', eventId), { [`members.${uid}`]: deleteField() });
                              // Also remove their votes from all date options so they don't reappear
                              try {
                                const dSnap = await getDocs(collection(db, 'events', eventId, 'dateOptions'));
                                for (const d of dSnap.docs) {
                                  if (d.data().votes?.[uid]) {
                                    await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id), { [`votes.${uid}`]: deleteField() });
                                  }
                                }
                              } catch {}
                            }}
                            title={`Remove ${m.name || 'member'}`}
                            style={{ background: 'none', border: 'none', color: '#D1D5DB', fontSize: '1rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}
                            onMouseEnter={e => e.target.style.color = '#EF4444'}
                            onMouseLeave={e => e.target.style.color = '#D1D5DB'}
                          >&times;</button>
                        )}
                      </div>
                      );
                    })}
                      </div>
                    ))}
                  </div>
                </div>
              );
              });
            })()}

            {isOwner && (
              showAddFriend ? (() => {
                function friendGroupTokens(value) {
                  return (value || '').split(',').map(g => g.trim()).filter(Boolean);
                }
                const allGroups = [...new Set(friends.flatMap(f => friendGroupTokens(f.group)))].sort();
                const memberEmails = new Set(members.map(([, m]) => (m.email || '').toLowerCase()).filter(Boolean));
                const memberNames = new Set(members.map(([, m]) => (m.name || '').toLowerCase()).filter(Boolean));
                function notAlreadyMember(f) {
                  if (f.email && memberEmails.has(f.email.toLowerCase())) return false;
                  if (f.name && memberNames.has(f.name.toLowerCase())) return false;
                  return true;
                }
                const available = friends.filter(f => {
                  if (!notAlreadyMember(f)) return false;
                  if (friendGroupFilter.length > 0) {
                    const tokens = friendGroupTokens(f.group);
                    if (!friendGroupFilter.some(g => tokens.includes(g))) return false;
                  }
                  if (!friendSearch.trim()) return true;
                  const term = friendSearch.toLowerCase();
                  return (f.name || '').toLowerCase().includes(term) || (f.email || '').toLowerCase().includes(term);
                });
                async function addFriendToEvent(f) {
                  const key = (f.email || f.id).replace(/[.@#$/\[\]]/g, '_').toLowerCase();
                  const updates = {
                    [`members.${key}`]: { role: 'viewer', rsvp: 'pending', name: f.name || '', email: f.email || '', phone: f.phone || '' },
                    memberUids: arrayUnion(key),
                  };
                  const addedNames = [f.name];
                  if (f.linkedTo) {
                    const linked = friends.find(x => x.id === f.linkedTo);
                    if (linked && notAlreadyMember(linked)) {
                      const linkedKey = (linked.email || linked.id).replace(/[.@#$/\[\]]/g, '_').toLowerCase();
                      updates[`members.${linkedKey}`] = { role: 'viewer', rsvp: 'pending', name: linked.name || '', email: linked.email || '', phone: linked.phone || '', plusOneOf: key };
                      updates.memberUids = arrayUnion(key, linkedKey);
                      addedNames.push(linked.name);
                    }
                  }
                  const reverseLinked = friends.filter(x => x.linkedTo === f.id && notAlreadyMember(x));
                  for (const rl of reverseLinked) {
                    const rlKey = (rl.email || rl.id).replace(/[.@#$/\[\]]/g, '_').toLowerCase();
                    updates[`members.${rlKey}`] = { role: 'viewer', rsvp: 'pending', name: rl.name || '', email: rl.email || '', phone: rl.phone || '', plusOneOf: key };
                    updates.memberUids = arrayUnion(key, rlKey);
                    addedNames.push(rl.name);
                  }
                  await updateDoc(doc(db, 'events', eventId), updates);
                  return addedNames.filter(Boolean);
                }
                return (
                <div style={{ marginTop: '0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem', background: 'var(--color-surface)' }}>
                  <input
                    type="text"
                    value={friendSearch}
                    onChange={e => setFriendSearch(e.target.value)}
                    placeholder="Search friends by name or email..."
                    autoFocus
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit', marginBottom: '0.5rem', boxSizing: 'border-box' }}
                  />
                  {allGroups.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginRight: '0.2rem' }}>Groups:</span>
                      {allGroups.map(g => {
                        const active = friendGroupFilter.includes(g);
                        return (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setFriendGroupFilter(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])}
                            style={{ padding: '0.2rem 0.55rem', borderRadius: 'var(--radius-full)', border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`, background: active ? 'var(--color-accent-light)' : 'var(--color-surface)', color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            {g}
                          </button>
                        );
                      })}
                      {friendGroupFilter.length > 0 && (
                        <button type="button" onClick={() => setFriendGroupFilter([])} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
                      )}
                    </div>
                  )}
                  {available.length > 0 && (friendGroupFilter.length > 0 || friendSearch.trim()) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const all = [];
                        for (const f of available) {
                          const names = await addFriendToEvent(f);
                          all.push(...names);
                        }
                        setResult({ type: 'success', message: `${all.length} added: ${all.slice(0, 4).join(', ')}${all.length > 4 ? '...' : ''}` });
                        setTimeout(() => setResult(null), 3000);
                        setFriendGroupFilter([]);
                        setFriendSearch('');
                      }}
                      style={{ width: '100%', padding: '0.45rem', marginBottom: '0.5rem', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      + Add all {available.length}
                    </button>
                  )}
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {available.length === 0 ? (
                      <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'center', margin: '0.5rem 0' }}>{friendSearch.trim() || friendGroupFilter.length > 0 ? 'No matching friends' : 'All friends already added'}</p>
                    ) : available.map(f => (
                        <button key={f.id} onClick={async () => {
                          const added = await addFriendToEvent(f);
                          setResult({ type: 'success', message: `${added.join(' & ')} added!` });
                          setTimeout(() => setResult(null), 3000);
                        }} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', padding: '0.5rem 0.6rem', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)', textAlign: 'left' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <div style={{ width: '2rem', height: '2rem', borderRadius: '50%', background: 'var(--color-accent-light)', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.82rem' }}>
                            {(f.name || '?')[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text)' }}>{f.name || 'Unknown'}</div>
                            {f.email && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{f.email}</div>}
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 600 }}>+ Add</span>
                        </button>
                      ))}
                  </div>
                  <button onClick={() => { setShowAddFriend(false); setFriendSearch(''); setFriendGroupFilter([]); }} style={{ marginTop: '0.5rem', width: '100%', padding: '0.4rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Done
                  </button>
                </div>
                );
              })() : (
                <button onClick={() => setShowAddFriend(true)} style={{ marginTop: '0.5rem', width: '100%', padding: '0.5rem', border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  + Add Friends
                </button>
              )
            )}
          </div>

          {isOwner && phantomFriendVotes !== null && (
            <div style={{
              padding: '0.75rem 0.9rem',
              marginBottom: '0.75rem',
              background: 'var(--color-warning-light)',
              border: '1px solid #fcd34d',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.82rem',
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}>
              <span>
                ⚠ Anonymous "Friend" voter detected
                {phantomFriendVotes > 0 && ` (${phantomFriendVotes} vote${phantomFriendVotes !== 1 ? 's' : ''})`}.
                These came from an old link before name confirmation was required.
              </span>
              <button
                onClick={cleanupPhantomFriend}
                disabled={cleaningPhantom}
                style={{
                  padding: '0.4rem 0.85rem',
                  border: '1px solid #92400e',
                  borderRadius: 'var(--radius-md)',
                  background: '#fff',
                  color: '#92400e',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: cleaningPhantom ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                  opacity: cleaningPhantom ? 0.6 : 1,
                }}
              >
                {cleaningPhantom ? 'Removing…' : 'Remove'}
              </button>
            </div>
          )}
          <DatePoll
            entityType="events"
            entityId={eventId}
            stage={stage}
            canManage={isOwner}
            members={members}
            altRanges={Array.isArray(event.altRanges) ? event.altRanges : []}
            onAddAltRange={addAltRange}
            onRemoveAltRange={removeAltRange}
          />

          {isOwner && (
            <div className={styles.ownerActions}>
              <button className={styles.editBtn} onClick={toggleStage} style={{ background: stage === 'voting' ? 'var(--color-success-light)' : 'var(--color-warning-light)', borderColor: stage === 'voting' ? 'var(--color-success)' : 'var(--color-warning)', color: stage === 'voting' ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {stage === 'voting' ? '✓ Finalize Dates' : '↩ Reopen Voting'}
              </button>
              {stage === 'finalized' && (
                <button className={styles.editBtn} onClick={() => {
                  const d = event.date?.toDate?.() || new Date(event.date);
                  const ed = event.endDate?.toDate?.() || (event.endDate ? new Date(event.endDate) : null);
                  setFinalizeDate(d instanceof Date && !isNaN(d) ? d.toISOString().split('T')[0] : '');
                  setFinalizeEndDate(ed instanceof Date && !isNaN(ed) ? ed.toISOString().split('T')[0] : '');
                  setShowFinalize(true);
                }}>
                  Edit Date
                </button>
              )}
              {stage === 'finalized' && (
                <button
                  className={styles.editBtn}
                  onClick={() => updateEvent(eventId, { itineraryComplete: !event.itineraryComplete })}
                  style={{
                    background: event.itineraryComplete ? 'var(--color-success-light)' : 'var(--color-surface-alt)',
                    borderColor: event.itineraryComplete ? 'var(--color-success)' : 'var(--color-border)',
                    color: event.itineraryComplete ? 'var(--color-success)' : 'var(--color-text-secondary)',
                  }}
                >
                  {event.itineraryComplete ? '✓ Itinerary Completed' : '📝 Mark Itinerary Complete'}
                </button>
              )}
              {stage === 'finalized' && (
                <button
                  className={styles.editBtn}
                  onClick={() => updateEvent(eventId, { travelBooked: !event.travelBooked })}
                  style={{
                    background: event.travelBooked ? 'var(--color-success-light)' : 'var(--color-surface-alt)',
                    borderColor: event.travelBooked ? 'var(--color-success)' : 'var(--color-border)',
                    color: event.travelBooked ? 'var(--color-success)' : 'var(--color-text-secondary)',
                  }}
                >
                  {event.travelBooked ? '✓ Travel & Lodging Booked' : '✈ Mark Travel Booked'}
                </button>
              )}
              {stage === 'voting' && (() => {
                const nonResponders = members.filter(([uid, m]) => uid !== user?.uid && !['yes', 'maybe', 'no'].includes(m.rsvp) && m.email);
                if (nonResponders.length === 0) return null;
                return (
                  <button className={styles.editBtn} disabled={reminderSending} onClick={async () => {
                    const dateStr = event.date ? format(new Date(event.date.seconds ? event.date.seconds * 1000 : event.date), 'EEEE, MMMM d, yyyy · h:mm a') : '';
                    const pollLink = `${window.location.origin}/poll/${eventId}?name=Friend`;
                    setReminderSending(true);
                    try {
                      const res = await fetch('/api/send-reminder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          recipients: nonResponders.map(([, m]) => ({ name: m.name, email: m.email })),
                          fromName: user?.displayName || 'Someone',
                          eventTitle: event.title,
                          eventDate: dateStr,
                          eventLocation: event.location || '',
                          pollLink,
                          reminderNumber: 1,
                        }),
                      });
                      const data = await res.json();
                      if (data.sent > 0) {
                        // Mark reminded members as emailed
                        const updates = {};
                        nonResponders.forEach(([uid]) => {
                          updates[`members.${uid}.emailed`] = new Date().toISOString();
                        });
                        if (Object.keys(updates).length > 0) updateEvent(eventId, updates);
                      }
                      setResult({ type: data.sent > 0 ? 'success' : 'error', message: data.sent > 0 ? `Reminder sent to ${data.sent} of ${data.total} non-responder${data.total !== 1 ? 's' : ''}!` : (data.message || 'Failed to send reminders') });
                    } catch (err) {
                      setResult({ type: 'error', message: err.message });
                    }
                    setReminderSending(false);
                    setTimeout(() => setResult(null), 5000);
                  }} style={{ background: '#FEF3C7', borderColor: '#F59E0B', color: '#92400E' }}>
                    {reminderSending ? 'Sending...' : `📧 Remind Non-Responders (${nonResponders.length})`}
                  </button>
                );
              })()}
              <button className={styles.editBtn} onClick={() => setEditing(true)}>Edit Event</button>
              <button className={styles.deleteBtn} onClick={handleDelete}>Delete Event</button>
            </div>
          )}

          {/* Auto-reminder schedule — owner only, voting stage */}
          {isOwner && stage === 'voting' && (() => {
            const ar = event.autoReminders || {};
            const enabled = !!ar.enabled;
            const intervals = ar.intervals || [3, 5, 7];
            const nonVoterCount = members.filter(([uid, m]) => uid !== user?.uid && !voteStats[uid]?.total && !m.skipVote && m.email).length;

            return (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                background: enabled ? '#EEF2FF' : 'var(--color-surface)',
                border: `1px solid ${enabled ? '#6366F1' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-lg)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: enabled ? '0.75rem' : 0 }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
                      📧 Automatic Email Reminders
                    </div>
                    {!enabled && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                      Send scheduled reminders to {nonVoterCount} non-voter{nonVoterCount !== 1 ? 's' : ''} with emails
                    </div>}
                  </div>
                  <button
                    onClick={() => {
                      if (enabled) {
                        updateEvent(eventId, { autoReminders: { enabled: false, intervals, startedAt: ar.startedAt || '' } });
                      } else {
                        updateEvent(eventId, { autoReminders: { enabled: true, intervals, startedAt: new Date().toISOString() } });
                      }
                    }}
                    style={{
                      padding: '0.4rem 1rem',
                      border: 'none',
                      borderRadius: 'var(--radius-full)',
                      background: enabled ? '#DC2626' : '#6366F1',
                      color: '#fff',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {enabled ? 'Stop Reminders' : 'Enable'}
                  </button>
                </div>

                {enabled && (
                  <>
                    <div style={{ fontSize: '0.72rem', color: '#6366F1', fontWeight: 500, marginBottom: '0.65rem' }}>
                      Active since {new Date(ar.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {nonVoterCount} non-voter{nonVoterCount !== 1 ? 's' : ''} pending · checked daily
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                            {i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'}:
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={90}
                            value={intervals[i] || ''}
                            onChange={e => {
                              const next = [...intervals];
                              next[i] = parseInt(e.target.value) || 0;
                              updateEvent(eventId, { 'autoReminders.intervals': next });
                            }}
                            style={{
                              width: '50px',
                              padding: '0.3rem 0.4rem',
                              border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-md)',
                              fontSize: '0.82rem',
                              fontFamily: 'inherit',
                              textAlign: 'center',
                              outline: 'none',
                            }}
                          />
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>days</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                      Reminders sent to non-voters X days after enabling. Members who vote are automatically skipped.
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {activeTab === 'itinerary' && (
        <Itinerary
          event={event}
          canEdit={isOwner || event.members?.[user?.uid]?.role === 'editor'}
          onSave={async (data) => { await updateEvent(eventId, data); }}
        />
      )}

      {activeTab === 'notes' && (
        <Notes
          event={event}
          currentUser={user}
          canManageAll={isOwner || event.members?.[user?.uid]?.role === 'editor'}
          onSave={async (data) => { await updateEvent(eventId, data); }}
        />
      )}

      {activeTab === 'chat' && (
        <ChatPanel entityType="events" entityId={eventId} />
      )}

      {editing && (
        <div className={styles.modalOverlay} onClick={() => setEditing(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <EventForm event={event} onSave={async (data) => { await updateEvent(eventId, data); setEditing(false); }} onCancel={() => setEditing(false)} />
          </div>
        </div>
      )}

      {showInvite && (() => {
        const dateStr = format(date, 'EEEE, MMMM d, yyyy · h:mm a');
        const fromName = user?.displayName || 'Someone';
        const messageText = `You're invited to ${event.title}!\n\nWhen: ${dateStr}${event.location ? `\nWhere: ${event.location}` : ''}\n\nView event & RSVP: ${inviteLink}`;
        const subject = `${fromName} invited you to: ${event.title}`;
        return (
          <div className={styles.modalOverlay} onClick={() => { setShowInvite(false); setInviteResult(''); }}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Share This Event</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1.25rem' }}>Invite friends to join your event.</p>

              {/* Email input + Gmail button */}
              <form onSubmit={(e) => {
                e.preventDefault();
                const to = inviteEmail.trim();
                const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageText)}`;
                window.open(gmailUrl, '_blank');
                // Mark member as emailed
                const emailLower = to.toLowerCase();
                const memberEntry = members.find(([uid, m]) => (m.email || '').toLowerCase() === emailLower || uid.toLowerCase() === emailLower);
                if (memberEntry) {
                  updateEvent(eventId, { [`members.${memberEntry[0]}.emailed`]: new Date().toISOString() });
                }
                setInviteEmail('');
                setInviteResult('Gmail opened!');
              }} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="friend@email.com"
                  required
                  autoFocus
                  style={{ flex: 1, padding: '0.6rem 0.85rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', outline: 'none' }}
                />
                <button type="submit" style={{ padding: '0.6rem 1rem', border: 'none', borderRadius: 'var(--radius-md)', background: '#ea4335', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Gmail
                </button>
              </form>

              {inviteResult && <p style={{ fontSize: '0.82rem', color: 'var(--color-success)', margin: '0 0 0.75rem' }}>{inviteResult}</p>}

              {/* Share buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                <button onClick={() => {
                  const smsBody = encodeURIComponent(messageText);
                  window.open(`sms:?body=${smsBody}`, '_blank');
                }} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 500, color: 'var(--color-text)' }}>
                  💬 Send via Text Message
                </button>
                <button onClick={() => {
                  const waUrl = `https://wa.me/?text=${encodeURIComponent(messageText)}`;
                  window.open(waUrl, '_blank');
                }} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 500, color: 'var(--color-text)' }}>
                  📱 Share via WhatsApp
                </button>
                <button onClick={() => {
                  navigator.clipboard.writeText(messageText);
                  setInviteResult('Invite message copied!');
                }} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 500, color: 'var(--color-text)' }}>
                  📋 Copy Invite Message
                </button>
                <button onClick={handleCopyLink} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 500, color: 'var(--color-text)' }}>
                  🔗 {inviteCopied ? '✓ Link Copied!' : 'Copy Link Only'}
                </button>
              </div>

              <button onClick={() => { setShowInvite(false); setInviteResult(''); }} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Done
              </button>
            </div>
          </div>
        );
      })()}
      {/* Edit member modal */}
      {showFinalize && (
        <div className={styles.modalOverlay} onClick={() => setShowFinalize(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Finalize Event Date</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>Select the confirmed date for this event.</p>

            {allDateOptions.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Pick from voted dates</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {[...allDateOptions].sort((a, b) => {
                    const aYes = Object.values(a.votes || {}).filter(v => v.vote === 'yes').length;
                    const bYes = Object.values(b.votes || {}).filter(v => v.vote === 'yes').length;
                    return bYes - aYes;
                  }).map(opt => {
                    const yesCount = Object.values(opt.votes || {}).filter(v => v.vote === 'yes').length;
                    const maybeCount = Object.values(opt.votes || {}).filter(v => v.vote === 'maybe').length;
                    const isSelected = finalizeDate === opt.startDate;
                    const dateLabel = (() => {
                      try {
                        const d = new Date(opt.startDate + 'T12:00:00');
                        const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        if (opt.endDate && opt.endDate !== opt.startDate) {
                          const d2 = new Date(opt.endDate + 'T12:00:00');
                          return label + ' – ' + d2.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        }
                        return label;
                      } catch { return opt.startDate; }
                    })();
                    return (
                      <button key={opt.id} type="button" onClick={() => { setFinalizeDate(opt.startDate); setFinalizeEndDate(opt.endDate || opt.startDate); }}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', border: isSelected ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: isSelected ? 'var(--color-accent-light)' : 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: isSelected ? 700 : 500, color: 'var(--color-text)' }}>{dateLabel}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                          {yesCount > 0 && <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{yesCount} yes</span>}
                          {maybeCount > 0 && <span style={{ marginLeft: '0.35rem', color: '#D97706', fontWeight: 600 }}>{maybeCount} maybe</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Start Date
                <input type="date" value={finalizeDate} onChange={e => setFinalizeDate(e.target.value)}
                  style={{ padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', fontFamily: 'inherit' }} />
              </label>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                End Date
                <input type="date" value={finalizeEndDate} onChange={e => setFinalizeEndDate(e.target.value)}
                  style={{ padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', fontFamily: 'inherit' }} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={confirmFinalize} disabled={!finalizeDate}
                style={{ flex: 1, padding: '0.6rem', border: 'none', borderRadius: 'var(--radius-md)', background: finalizeDate ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: finalizeDate ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                Confirm Date
              </button>
              <button onClick={() => setShowFinalize(false)}
                style={{ padding: '0.6rem 1.25rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editMember && (
        <div className={styles.modalOverlay} onClick={() => setEditMember(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1rem' }}>Edit Member</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Name
                <input value={editMemberFields.name} onChange={e => setEditMemberFields(p => ({ ...p, name: e.target.value }))} style={{ padding: '0.55rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Email
                <input type="email" value={editMemberFields.email} onChange={e => setEditMemberFields(p => ({ ...p, email: e.target.value }))} style={{ padding: '0.55rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Phone
                <input type="tel" value={editMemberFields.phone || ''} onChange={e => setEditMemberFields(p => ({ ...p, phone: e.target.value }))} placeholder="(555) 123-4567" style={{ padding: '0.55rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                RSVP Status
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {[{ key: 'yes', label: 'Going' }, { key: 'maybe', label: 'Maybe' }, { key: 'pending', label: 'Pending' }, { key: 'no', label: "Can't Go" }].map(opt => (
                    <button key={opt.key} type="button" onClick={() => setEditMemberFields(p => ({ ...p, rsvp: opt.key }))}
                      style={{ padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-full)', border: editMemberFields.rsvp === opt.key ? '1px solid var(--color-accent)' : '1px solid var(--color-border)', background: editMemberFields.rsvp === opt.key ? 'var(--color-accent)' : 'var(--color-surface)', color: editMemberFields.rsvp === opt.key ? '#fff' : 'var(--color-text-secondary)', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                    >{opt.label}</button>
                  ))}
                </div>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Role
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {[{ key: 'viewer', label: 'Guest' }, { key: 'editor', label: 'Editor' }, { key: 'owner', label: 'Organizer' }].map(opt => (
                    <button key={opt.key} type="button" onClick={() => setEditMemberFields(p => ({ ...p, role: opt.key }))}
                      style={{ padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-full)', border: editMemberFields.role === opt.key ? '1px solid var(--color-accent)' : '1px solid var(--color-border)', background: editMemberFields.role === opt.key ? 'var(--color-accent)' : 'var(--color-surface)', color: editMemberFields.role === opt.key ? '#fff' : 'var(--color-text-secondary)', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                    >{opt.label}</button>
                  ))}
                </div>
              </label>
              {/* Plus One */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Assumed Yes By Way Of
                <select
                  value={editMemberFields.plusOneOf || ''}
                  onChange={e => setEditMemberFields(p => ({ ...p, plusOneOf: e.target.value || null }))}
                  style={{ padding: '0.55rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', fontFamily: 'inherit', background: 'var(--color-surface)' }}
                >
                  <option value="">— None —</option>
                  {members.filter(([uid]) => uid !== editMember?.uid).map(([uid, m]) => (
                    <option key={uid} value={uid}>{m.name || 'Guest'}</option>
                  ))}
                </select>
              </label>


              {/* Date Option Votes — editable */}
              {allDateOptions.length > 0 && (
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Date Votes ({voteStats[editMember?.uid]?.total || 0}/{allDateOptions.length} voted)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '250px', overflowY: 'auto' }}>
                    {allDateOptions.map(opt => {
                      const memberUid = editMember?.uid;
                      const vote = opt.votes?.[memberUid];
                      const voteValue = vote?.vote || 'none';
                      const dateLabel = (() => {
                        try {
                          const d = new Date(opt.startDate + 'T12:00:00');
                          const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                          if (opt.endDate && opt.endDate !== opt.startDate) {
                            const d2 = new Date(opt.endDate + 'T12:00:00');
                            return label + ' – ' + d2.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                          }
                          return label;
                        } catch { return opt.startDate; }
                      })();
                      const voteOptions = [
                        { key: 'yes', bg: 'var(--color-success-light, #dcfce7)', color: 'var(--color-success, #16a34a)', label: 'Yes' },
                        { key: 'maybe', bg: '#FEF3C7', color: '#D97706', label: 'Maybe' },
                        { key: 'no', bg: '#FEE2E2', color: '#DC2626', label: 'No' },
                        { key: 'none', bg: 'var(--color-surface-alt, #f3f4f6)', color: 'var(--color-text-muted)', label: '—' },
                      ];
                      const setVote = async (newVote) => {
                        try {
                          if (newVote === 'none') {
                            await updateDoc(doc(db, 'events', eventId, 'dateOptions', opt.id), { [`votes.${memberUid}`]: deleteField() });
                          } else {
                            await updateDoc(doc(db, 'events', eventId, 'dateOptions', opt.id), {
                              [`votes.${memberUid}`]: { vote: newVote, name: editMemberFields.name || editMember?.name || '' }
                            });
                          }
                        } catch (err) { console.error('Failed to update vote:', err); }
                      };
                      return (
                        <div key={opt.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'var(--color-surface)', border: '1px solid var(--color-border-light, #e5e7eb)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem' }}>
                          <span style={{ fontWeight: 500, color: 'var(--color-text)', flex: 1, minWidth: 0 }}>{dateLabel}</span>
                          <div style={{ display: 'flex', gap: '0.2rem' }}>
                            {voteOptions.map(v => (
                              <button
                                key={v.key}
                                type="button"
                                onClick={() => setVote(v.key)}
                                style={{
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: 'var(--radius-full, 999px)',
                                  background: voteValue === v.key ? v.bg : 'transparent',
                                  color: voteValue === v.key ? v.color : 'var(--color-text-muted)',
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  border: voteValue === v.key ? `1px solid ${v.color}` : '1px solid transparent',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  opacity: voteValue === v.key ? 1 : 0.5,
                                  transition: 'all 0.15s ease',
                                }}
                              >{v.label}</button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button onClick={async () => {
                  await updateEvent(eventId, { [`members.${editMember.uid}`]: editMemberFields });
                  if (user) {
                    // Sync to friends list
                    const friendMatch = friends.find(f =>
                      (f.email && editMemberFields.email && f.email.toLowerCase() === editMemberFields.email.toLowerCase()) ||
                      (f.name && editMemberFields.name && f.name.toLowerCase() === editMemberFields.name.toLowerCase())
                    );
                    if (friendMatch) {
                      const updates = {};
                      if (editMemberFields.phone && editMemberFields.phone !== friendMatch.phone) updates.phone = editMemberFields.phone;
                      if (editMemberFields.email && editMemberFields.email !== friendMatch.email) updates.email = editMemberFields.email;
                      if (editMemberFields.name && editMemberFields.name !== friendMatch.name) updates.name = editMemberFields.name;
                      if (Object.keys(updates).length > 0) {
                        await updateDoc(doc(db, 'users', user.uid, 'friends', friendMatch.id), updates).catch(() => {});
                      }
                    }
                    // Sync contact info across ALL other events where this person is a member
                    try {
                      const allEvents = await getDocs(collection(db, 'events'));
                      for (const eventDoc of allEvents.docs) {
                        if (eventDoc.id === eventId) continue;
                        const members = eventDoc.data().members || {};
                        for (const [memberKey, memberData] of Object.entries(members)) {
                          if (!memberData || typeof memberData !== 'object') continue;
                          const nameMatch = memberData.name && editMember.name && memberData.name.toLowerCase() === editMember.name.toLowerCase();
                          const phoneMatch = memberData.phone && editMember.phone && memberData.phone.replace(/[^\d]/g, '') === editMember.phone.replace(/[^\d]/g, '');
                          const emailMatch = memberData.email && editMember.email && memberData.email.toLowerCase() === editMember.email.toLowerCase();
                          if (nameMatch || phoneMatch || emailMatch) {
                            const syncUpdates = {};
                            if (editMemberFields.name) syncUpdates[`members.${memberKey}.name`] = editMemberFields.name;
                            if (editMemberFields.phone) syncUpdates[`members.${memberKey}.phone`] = editMemberFields.phone;
                            if (editMemberFields.email) syncUpdates[`members.${memberKey}.email`] = editMemberFields.email;
                            if (Object.keys(syncUpdates).length > 0) {
                              updateDoc(doc(db, 'events', eventDoc.id), syncUpdates).catch(() => {});
                            }
                            break;
                          }
                        }
                      }
                    } catch {}
                  }
                  setEditMember(null);
                }} style={{ flex: 1, padding: '0.6rem', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#fff', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
                <button onClick={() => setEditMember(null)} style={{ padding: '0.6rem 1.25rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                {editMember.uid !== user?.uid && (
                  <button onClick={async () => {
                    if (window.confirm(`Remove ${editMemberFields.name || 'this person'}?`)) {
                      await updateDoc(doc(db, 'events', eventId), { [`members.${editMember.uid}`]: deleteField() });
                      try {
                        const dSnap = await getDocs(collection(db, 'events', eventId, 'dateOptions'));
                        for (const d of dSnap.docs) {
                          if (d.data().votes?.[editMember.uid]) {
                            await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id), { [`votes.${editMember.uid}`]: deleteField() });
                          }
                        }
                      } catch {}
                      setEditMember(null);
                    }
                  }} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
                )}
              </div>

              {/* Merge with another member */}
              {isOwner && editMember.uid !== user?.uid && (
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                  {!showMerge ? (
                    <button
                      type="button"
                      onClick={() => { setShowMerge(true); setMergeSearch(''); }}
                      style={{ width: '100%', padding: '0.45rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      🔀 Merge with another contact
                    </button>
                  ) : (
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Merge into</div>
                      <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '0 0 0.35rem' }}>This will keep the other contact and remove {editMemberFields.name || 'this person'}, transferring any votes and data.</p>
                      <input
                        type="text"
                        value={mergeSearch}
                        onChange={e => setMergeSearch(e.target.value)}
                        placeholder="Search by name..."
                        autoFocus
                        style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.3rem' }}
                      />
                      <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {members
                          .filter(([uid, m]) => uid !== editMember.uid && (
                            !mergeSearch.trim() || (m.name || '').toLowerCase().includes(mergeSearch.toLowerCase())
                          ))
                          .map(([uid, m]) => (
                            <button
                              key={uid}
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`Merge ${editMemberFields.name || 'this person'} with ${m.name || 'the other contact'}?`)) return;
                                // Pick the more complete name (longer = more complete)
                                const srcName = (editMemberFields.name || '').trim();
                                const tgtName = (m.name || '').trim();
                                const bestName = srcName.length > tgtName.length ? srcName : tgtName;
                                // Fill gaps: use whichever has data
                                const updates = {};
                                updates[`members.${uid}.name`] = bestName;
                                if (!m.phone && editMemberFields.phone) updates[`members.${uid}.phone`] = editMemberFields.phone;
                                if (!m.email && editMemberFields.email) updates[`members.${uid}.email`] = editMemberFields.email;
                                if (!m.rsvp || m.rsvp === 'pending') {
                                  if (editMemberFields.rsvp && editMemberFields.rsvp !== 'pending') updates[`members.${uid}.rsvp`] = editMemberFields.rsvp;
                                }
                                // Transfer plusOneOf relationships pointing to the merged member
                                for (const [mUid, mData] of members) {
                                  if (mData.plusOneOf === editMember.uid) {
                                    updates[`members.${mUid}.plusOneOf`] = uid;
                                  }
                                }
                                // Remove the merged member
                                updates[`members.${editMember.uid}`] = deleteField();
                                await updateDoc(doc(db, 'events', eventId), updates);
                                // Transfer votes from dateOptions
                                try {
                                  const dSnap = await getDocs(collection(db, 'events', eventId, 'dateOptions'));
                                  for (const d of dSnap.docs) {
                                    const votes = d.data().votes || {};
                                    if (votes[editMember.uid] && !votes[uid]) {
                                      await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id), {
                                        [`votes.${uid}`]: { ...votes[editMember.uid], name: bestName },
                                        [`votes.${editMember.uid}`]: deleteField(),
                                      });
                                    } else if (votes[editMember.uid]) {
                                      await updateDoc(doc(db, 'events', eventId, 'dateOptions', d.id), {
                                        [`votes.${editMember.uid}`]: deleteField(),
                                      });
                                    }
                                  }
                                } catch {}
                                setEditMember(null);
                                setShowMerge(false);
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', boxSizing: 'border-box' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-accent-light)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'var(--color-surface)'}
                            >
                              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--color-accent-light)', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0 }}>{(m.name || '?')[0].toUpperCase()}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--color-text)' }}>{m.name || 'Guest'}</div>
                                {(m.email || m.phone) && <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{m.email || m.phone}</div>}
                              </div>
                            </button>
                          ))}
                      </div>
                      <button type="button" onClick={() => setShowMerge(false)} style={{ marginTop: '0.35rem', padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-muted)' }}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

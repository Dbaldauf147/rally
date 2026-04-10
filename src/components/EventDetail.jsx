import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, collection, onSnapshot, updateDoc, arrayUnion, getDocs, deleteField } from 'firebase/firestore';
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
import styles from './EventDetail.module.css';

export function EventDetail() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const { updateEvent, deleteEvent, rsvp } = useEvents();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
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
  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizeDate, setFinalizeDate] = useState('');
  const [finalizeEndDate, setFinalizeEndDate] = useState('');
  const [showTextAll, setShowTextAll] = useState(false);
  const [textAllMessage, setTextAllMessage] = useState('');
  const [textAllSending, setTextAllSending] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'events', eventId), (snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      else setEvent(null);
      setLoading(false);
    });
    return unsub;
  }, [eventId]);

  // Load date option voters to include poll participants in members list + track vote stats
  const [voteStats, setVoteStats] = useState({}); // { visitorId: { total, yes, maybe, no } }
  const [allDateOptions, setAllDateOptions] = useState([]); // [{ id, startDate, endDate, note, votes }]
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events', eventId, 'dateOptions'), (snap) => {
      const voters = {};
      const stats = {};
      const totalOptions = snap.docs.length;
      const options = [];
      for (const d of snap.docs) {
        const data = d.data();
        options.push({ id: d.id, ...data });
        for (const [voterId, v] of Object.entries(data.votes || {})) {
          if (!voters[voterId]) voters[voterId] = { name: v.name || voterId, rsvp: 'pending', role: 'viewer', fromVotes: true };
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
        // Build friend name/email/phone -> friendId lookup
        const friendIdByName = {};
        const friendIdByEmail = {};
        const friendIdByPhone = {};
        for (const f of friends) {
          if (f.name) friendIdByName[f.name.toLowerCase()] = f.id;
          if (f.email) friendIdByEmail[f.email.toLowerCase()] = f.id;
          if (f.phone) friendIdByPhone[f.phone.replace(/[^\d]/g, '')] = f.id;
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
            const fid = (m.email && friendIdByEmail[m.email.toLowerCase()]) ||
                        (m.name && friendIdByName[m.name.toLowerCase()]) ||
                        (m.phone && friendIdByPhone[m.phone.replace(/[^\d]/g, '')]) || null;
            if (fid) memberToFriendId[uid] = fid;

            // Sync contact info
            const match = (m.email && master[m.email.toLowerCase()]) || (m.name && master[m.name.toLowerCase()]) || (m.phone && master[m.phone.replace(/[^\d]/g, '')]) || null;
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
  // Build a lookup from friends by email and name for merging
  const friendsByEmail = {};
  const friendsByName = {};
  for (const f of friends) {
    if (f.email) friendsByEmail[f.email.toLowerCase()] = f;
    if (f.name) friendsByName[f.name.toLowerCase()] = f;
  }
  const members = rawMembers.filter(([, m]) => m != null).map(([uid, m]) => {
    if (typeof m === 'string') return [uid, { name: m, rsvp: 'pending', email: '' }];
    if (typeof m !== 'object') return [uid, { name: String(m), rsvp: 'pending', email: '' }];
    const friendMatch = (m.email && friendsByEmail[m.email.toLowerCase()]) || (m.name && friendsByName[m.name.toLowerCase()]) || null;
    if (friendMatch) {
      return [uid, {
        ...m,
        phone: m.phone || friendMatch.phone || '',
        email: m.email || friendMatch.email || '',
      }];
    }
    return [uid, m];
  });
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

  const icsUrl = `/api/calendar-invite?title=${encodeURIComponent(event.title)}&start=${encodeURIComponent(date.toISOString())}&end=${encodeURIComponent((endDate || new Date(date.getTime() + 3600000)).toISOString())}${event.location ? `&location=${encodeURIComponent(event.location)}` : ''}&description=${encodeURIComponent((event.description || '') + '\n\nRSVP: ' + inviteLink)}&url=${encodeURIComponent(inviteLink)}`;

  const googleCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}/${(endDate || new Date(date.getTime() + 3600000)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}${event.location ? `&location=${encodeURIComponent(event.location)}` : ''}&details=${encodeURIComponent((event.description || '') + '\n\nRSVP: ' + inviteLink)}`;

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
    { key: 'details', label: 'Details' },
    { key: 'itinerary', label: 'Itinerary' },
    { key: 'notes', label: 'Notes' },
    { key: 'chat', label: 'Chat' },
  ];

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate('/')}>← Back</button>

      {/* Event progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: '1rem', borderRadius: 'var(--radius-full)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        {[
          { key: 'created', label: 'Created' },
          { key: 'voting', label: 'Voting' },
          { key: 'finalized', label: 'Finalized' },
        ].map((step, i) => {
          const isActive = step.key === 'created' || (step.key === 'voting' && (stage === 'voting' || stage === 'finalized')) || (step.key === 'finalized' && stage === 'finalized');
          const isCurrent = (step.key === 'voting' && stage === 'voting') || (step.key === 'finalized' && stage === 'finalized') || (step.key === 'created' && stage !== 'voting' && stage !== 'finalized');
          return (
            <div key={step.key} style={{
              flex: 1, padding: '0.45rem 0', textAlign: 'center',
              fontSize: '0.75rem', fontWeight: isCurrent ? 700 : 500,
              background: isActive ? 'var(--color-accent)' : 'var(--color-surface)',
              color: isActive ? '#fff' : 'var(--color-text-muted)',
              borderRight: i < 2 ? '1px solid var(--color-border)' : 'none',
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
              : <>
                  {format(date, 'EEEE, MMMM d, yyyy · h:mm a')}
                  {endDate && ` – ${format(endDate, 'h:mm a')}`}
                </>
            }
          </p>
          {event.location && <p className={styles.location}>📍 {event.location}</p>}
        </div>
      </div>

      <div className={styles.rsvpSection}>
        <RSVPWidget currentRsvp={myRsvp} onRsvp={(response) => rsvp(eventId, response)} />
        <button className={styles.shareBtn} onClick={() => window.open(googleCalUrl, '_blank')}>
          📅 Add to Google Calendar
        </button>
        <a href={icsUrl} className={styles.shareBtn} style={{ textDecoration: 'none', display: 'inline-flex' }}>
          📅 Download .ics
        </a>
        <button className={styles.shareBtn} onClick={handleCopyLink}>
          {inviteCopied ? '✓ Link copied!' : '🔗 Copy link'}
        </button>
        <button className={styles.shareBtn} onClick={() => {
          const fromName = user?.displayName || 'Someone';
          const pollUrl = `${window.location.origin}/poll/${eventId}?name=Friend`;
          const message = `Hey! ${fromName} invited you to ${event.title}.\n\nVote here on what dates you can make: ${pollUrl}`;
          navigator.clipboard.writeText(message);
          setResult({ type: 'success', message: 'Poll invite copied!' });
          setTimeout(() => setResult(null), 2000);
        }}>
          📊 Copy Poll Link
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
          return phones.length > 0 ? (
            <button className={styles.shareBtn} onClick={() => {
              const dateStr = format(date, 'EEEE, MMMM d, yyyy · h:mm a');
              const pollLink = `${window.location.origin}/poll/${eventId}?name=Friend`;
              const defaultMsg = event.stage === 'finalized'
                ? `Hey! Just a reminder about ${event.title} on ${dateStr}${event.location ? ` at ${event.location}` : ''}. See you there!`
                : `You're invited to ${event.title}!\n\nVote here on what dates you can make: ${pollLink}`;
              setTextAllMessage(defaultMsg);
              setShowTextAll(true);
            }}>
              💬 Text All ({phones.length})
            </button>
          ) : null;
        })()}
      </div>

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
                const groupMembers = members.filter(([uid, m]) => getGroup(uid, m) === group.key);
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
                        <div className={styles.memberAvatar} style={isDupe ? { background: '#F59E0B', color: '#fff' } : undefined}>{(m.name || '?')[0].toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className={styles.memberName}>
                            {m.name || 'Guest'}
                            {isDupe && <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#D97706', marginLeft: '0.35rem' }}>⚠ Possible duplicate ({dupeReason})</span>}
                          </span>
                          <div style={{ display: 'flex', gap: '0.3rem', marginTop: '1px' }}>
                            {(m.email || uid.includes('@')) && <span title={m.email || uid} style={{ fontSize: '0.7rem' }}>✉️</span>}
                            {m.phone && <span title={m.phone} style={{ fontSize: '0.7rem' }}>💬</span>}
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
                        {stage === 'finalized' && <span className={`${styles.rsvpBadge} ${styles[`rsvp_${m.rsvp}`]}`}>{m.rsvp || 'invited'}</span>}
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
              showAddFriend ? (
                <div style={{ marginTop: '0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem', background: 'var(--color-surface)' }}>
                  <input
                    type="text"
                    value={friendSearch}
                    onChange={e => setFriendSearch(e.target.value)}
                    placeholder="Search friends by name or email..."
                    autoFocus
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit', marginBottom: '0.5rem', boxSizing: 'border-box' }}
                  />
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {(() => {
                      const memberEmails = new Set(members.map(([, m]) => (m.email || '').toLowerCase()).filter(Boolean));
                      const memberNames = new Set(members.map(([, m]) => (m.name || '').toLowerCase()).filter(Boolean));
                      const available = friends.filter(f => {
                        if (f.email && memberEmails.has(f.email.toLowerCase())) return false;
                        if (f.name && memberNames.has(f.name.toLowerCase())) return false;
                        if (!friendSearch.trim()) return true;
                        const term = friendSearch.toLowerCase();
                        return (f.name || '').toLowerCase().includes(term) || (f.email || '').toLowerCase().includes(term);
                      });
                      if (available.length === 0) return <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'center', margin: '0.5rem 0' }}>{friendSearch.trim() ? 'No matching friends' : 'All friends already added'}</p>;
                      return available.map(f => (
                        <button key={f.id} onClick={async () => {
                          const key = (f.email || f.id).replace(/[.@#$/\[\]]/g, '_').toLowerCase();
                          const updates = {
                            [`members.${key}`]: { role: 'viewer', rsvp: 'pending', name: f.name || '', email: f.email || '', phone: f.phone || '' },
                            memberUids: arrayUnion(key),
                          };
                          // Auto-add linked contact as "assumed yes by way of"
                          if (f.linkedTo) {
                            const linked = friends.find(x => x.id === f.linkedTo);
                            if (linked) {
                              const linkedKey = (linked.email || linked.id).replace(/[.@#$/\[\]]/g, '_').toLowerCase();
                              updates[`members.${linkedKey}`] = { role: 'viewer', rsvp: 'pending', name: linked.name || '', email: linked.email || '', phone: linked.phone || '', plusOneOf: key };
                              updates.memberUids = arrayUnion(key, linkedKey);
                            }
                          }
                          // Also check if someone else is linked TO this friend
                          const reverseLinked = friends.filter(x => x.linkedTo === f.id);
                          for (const rl of reverseLinked) {
                            const rlKey = (rl.email || rl.id).replace(/[.@#$/\[\]]/g, '_').toLowerCase();
                            updates[`members.${rlKey}`] = { role: 'viewer', rsvp: 'pending', name: rl.name || '', email: rl.email || '', phone: rl.phone || '', plusOneOf: key };
                            updates.memberUids = arrayUnion(key, rlKey);
                          }
                          await updateDoc(doc(db, 'events', eventId), updates);
                          const addedNames = [f.name];
                          if (f.linkedTo) { const l = friends.find(x => x.id === f.linkedTo); if (l) addedNames.push(l.name); }
                          reverseLinked.forEach(rl => addedNames.push(rl.name));
                          setResult({ type: 'success', message: `${addedNames.filter(Boolean).join(' & ')} added!` });
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
                      ));
                    })()}
                  </div>
                  <button onClick={() => { setShowAddFriend(false); setFriendSearch(''); }} style={{ marginTop: '0.5rem', width: '100%', padding: '0.4rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Done
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowAddFriend(true)} style={{ marginTop: '0.5rem', width: '100%', padding: '0.5rem', border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  + Add Friends
                </button>
              )
            )}
          </div>

          <DatePoll entityType="events" entityId={eventId} stage={stage} />

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

      {showTextAll && (() => {
        const recipients = members.filter(([uid, m]) => uid !== user?.uid && m.phone);
        const phones = recipients.map(([, m]) => m.phone);
        const closeModal = () => { if (!textAllSending) { setShowTextAll(false); setTextAllMessage(''); } };
        return (
          <div className={styles.modalOverlay} onClick={closeModal}>
            <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Text Everyone</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>
                Send a text to {recipients.length} member{recipients.length !== 1 ? 's' : ''} with a phone number on file.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.85rem', maxHeight: '80px', overflowY: 'auto' }}>
                {recipients.map(([uid, m]) => (
                  <span key={uid} style={{
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.55rem',
                    background: 'var(--color-surface-alt)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-full)',
                    color: 'var(--color-text-secondary)',
                  }}>
                    {m.name || 'Unnamed'}
                  </span>
                ))}
              </div>

              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                Message
              </label>
              <textarea
                value={textAllMessage}
                onChange={e => setTextAllMessage(e.target.value)}
                rows={6}
                disabled={textAllSending}
                placeholder="Write a message to send to the group..."
                autoFocus
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.92rem',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                }}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.3rem', textAlign: 'right' }}>
                {textAllMessage.length} character{textAllMessage.length !== 1 ? 's' : ''}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  onClick={closeModal}
                  disabled={textAllSending}
                  style={{
                    padding: '0.55rem 1.25rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'none',
                    color: 'var(--color-text-muted)',
                    fontSize: '0.9rem',
                    fontWeight: 500,
                    fontFamily: 'inherit',
                    cursor: textAllSending ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={!textAllMessage.trim() || phones.length === 0}
                  onClick={() => {
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
                    // Mark recipients as texted optimistically
                    const updates = {};
                    recipients.forEach(([uid]) => {
                      updates[`members.${uid}.texted`] = new Date().toISOString();
                    });
                    if (Object.keys(updates).length > 0) updateEvent(eventId, updates);
                    window.location.href = smsUrl;
                    setShowTextAll(false);
                    setTextAllMessage('');
                  }}
                  style={{
                    padding: '0.55rem 1.25rem',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-accent)',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: !textAllMessage.trim() ? 'not-allowed' : 'pointer',
                    opacity: !textAllMessage.trim() ? 0.5 : 1,
                  }}
                >
                  Open in Messages ({phones.length})
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

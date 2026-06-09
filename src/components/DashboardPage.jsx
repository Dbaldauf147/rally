import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useEvents } from '../hooks/useEvents';
import { useAuth } from '../contexts/AuthContext';
import { EventForm } from './EventForm';
import { EventCard } from './EventCard';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const { user } = useAuth();
  const { events, createEvent } = useEvents();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState('event');

  const [dateOptionMonths, setDateOptionMonths] = useState({}); // eventId -> Set of "YYYY-MM"
  const [votingProgress, setVotingProgress] = useState({}); // eventId -> { voted, total, pct }

  useEffect(() => {
    if (events.length === 0) return;
    (async () => {
      const months = {};
      const progress = {};
      for (const e of events) {
        try {
          const snap = await getDocs(collection(db, 'events', e.id, 'dateOptions'));
          // Exclude closed/cancelled date options from month buckets
          const openDocs = snap.docs.filter(d => !d.data().closed);
          const monthSet = new Set();
          // Per-user count of how many OPEN options they've actually voted on (not 'none')
          const userOpenVoteCount = {};
          for (const d of openDocs) {
            const data = d.data();
            if (data.startDate) {
              const ym = data.startDate.substring(0, 7);
              monthSet.add(ym);
            }
            if (data.votes) {
              for (const [uid, v] of Object.entries(data.votes)) {
                if (v && v.vote && v.vote !== 'none') {
                  userOpenVoteCount[uid] = (userOpenVoteCount[uid] || 0) + 1;
                }
              }
            }
          }
          months[e.id] = [...monthSet];
          // Merge event.members with any poll voters (matches EventDetail's member list)
          const merged = { ...(e.members || {}) };
          for (const d of openDocs) {
            const votes = d.data().votes || {};
            for (const voterId of Object.keys(votes)) {
              if (!merged[voterId]) merged[voterId] = { role: 'viewer', fromVotes: true };
            }
          }
          // Filter out null/invalid entries (EventDetail does the same at line 300)
          const memberEntries = Object.entries(merged).filter(([, m]) => m != null && typeof m === 'object');
          // Per-member own status, then apply plus-one inheritance (matches EventDetail getGroup)
          // Voted = voted on every open option, so a newly suggested date drops the bar
          // until everyone has weighed in on it.
          const ownStatus = {};
          for (const [uid, m] of memberEntries) {
            if (m.skipVote) ownStatus[uid] = 'skip';
            else if (openDocs.length > 0 && (userOpenVoteCount[uid] || 0) >= openDocs.length) ownStatus[uid] = 'voted';
            else ownStatus[uid] = 'waiting';
          }
          const priority = { voted: 0, skip: 1, waiting: 2 };
          const effectiveStatus = {};
          for (const [uid, m] of memberEntries) {
            const own = ownStatus[uid];
            if (!m.plusOneOf || !(m.plusOneOf in ownStatus)) {
              effectiveStatus[uid] = own;
              continue;
            }
            const linked = ownStatus[m.plusOneOf];
            effectiveStatus[uid] = (priority[own] ?? 2) <= (priority[linked] ?? 2) ? own : linked;
          }
          // Denominator excludes skip; numerator is anyone effectively voted
          let anyVoted = 0;
          let totalUnits = 0;
          for (const uid of Object.keys(effectiveStatus)) {
            const s = effectiveStatus[uid];
            if (s === 'skip') continue;
            totalUnits++;
            if (s === 'voted') anyVoted++;
          }
          const pct = totalUnits > 0 && openDocs.length > 0
            ? Math.round((anyVoted / totalUnits) * 100)
            : 0;
          progress[e.id] = { voted: anyVoted, total: totalUnits, pct };
        } catch {
          months[e.id] = [];
          progress[e.id] = { voted: 0, total: 0, pct: 0 };
        }
      }
      setDateOptionMonths(months);
      setVotingProgress(progress);
    })();
  }, [events]);

  const now = new Date();

  const allEvents = events;

  async function handleCreateEvent(data) {
    setShowCreate(false);
    try {
      const id = await createEvent(data);
      if (id) {
        navigate(`/event/${id}`);
      } else {
        // If createEvent returned no ID, event may have failed - show alert
        alert('Event may not have saved. Check your Firestore connection.');
      }
    } catch (err) {
      console.error('Create event error:', err);
      alert('Error creating event: ' + err.message);
    }
  }

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.greeting}>{greeting}, {user?.displayName?.split(' ')[0] || 'there'}</p>
          <h1 className={styles.title}>Your Dashboard</h1>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.createBtn} onClick={() => { setCreateType('event'); setShowCreate(true); }}>
            + New Event
          </button>
          <button className={`${styles.createBtn} ${styles.createBtnAlt}`} onClick={() => { setCreateType('trip'); setShowCreate(true); }}>
            + Plan Trip
          </button>
        </div>
      </div>

      {allEvents.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🗓</div>
          <h2 className={styles.emptyTitle}>No events yet</h2>
          <p className={styles.emptyDesc}>Create your first event or trip to start planning with friends and family.</p>
          <button className={styles.createBtn} onClick={() => setShowCreate(true)}>+ Create Event</button>
        </div>
      ) : (
        (() => {
          // Sort all events by date, soonest first. Finalized events use their
          // set date; voting events use their earliest date-option month;
          // events without any date sort to the end.
          const sortValue = (e) => {
            if (e.stage === 'finalized') {
              const d = e.date?.toDate?.() || (e.date ? new Date(e.date) : null);
              return d && !isNaN(d) ? d.getTime() : Infinity;
            }
            const months = (dateOptionMonths[e.id] || []).slice().sort();
            return months[0] ? new Date(months[0] + '-01').getTime() : Infinity;
          };
          const sorted = allEvents
            .map(e => ({ e, sort: sortValue(e) }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ e }) => e);

          return (
            <div className={styles.grid}>
              {sorted.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  onClick={() => navigate(`/event/${e.id}`)}
                  votePct={votingProgress[e.id]?.pct}
                />
              ))}
            </div>
          );
        })()
      )}

      {showCreate && (
        <div className={styles.modalOverlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setShowCreate(false)}>&times;</button>
            <EventForm onSave={handleCreateEvent} onCancel={() => setShowCreate(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
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

  const [dateOptionCounts, setDateOptionCounts] = useState({});
  const [dateOptionMonths, setDateOptionMonths] = useState({}); // eventId -> Set of "YYYY-MM"
  const [votingProgress, setVotingProgress] = useState({}); // eventId -> { voted, total, pct }

  useEffect(() => {
    if (events.length === 0) return;
    (async () => {
      const counts = {};
      const months = {};
      const progress = {};
      for (const e of events) {
        try {
          const snap = await getDocs(collection(db, 'events', e.id, 'dateOptions'));
          // Exclude closed/cancelled date options from counts and month buckets
          const openDocs = snap.docs.filter(d => !d.data().closed);
          counts[e.id] = openDocs.length;
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
          // Count voting groups: members with plusOneOf are grouped with their host
          const members = e.members || {};
          const memberUids = Object.keys(members);
          const independentVoters = new Set();
          for (const uid of memberUids) {
            const m = members[uid];
            if (m?.plusOneOf && memberUids.includes(m.plusOneOf)) {
              // plus-ones vote with their host
            } else if (!m?.skipVote) {
              independentVoters.add(uid);
            }
          }
          const totalUnits = independentVoters.size || 1;
          const totalOpenOptions = openDocs.length;
          // Fractional progress: sum of (open votes per user / total open options),
          // averaged over voting units. A user who voted on 3 of 5 open dates contributes 0.6.
          // Users who only voted on closed dates contribute 0.
          let fractionSum = 0;
          let anyVoted = 0;
          for (const uid of independentVoters) {
            const voted = userOpenVoteCount[uid] || 0;
            if (voted > 0) anyVoted++;
            if (totalOpenOptions > 0) fractionSum += voted / totalOpenOptions;
          }
          const pct = totalUnits > 0 && totalOpenOptions > 0
            ? Math.round((fractionSum / totalUnits) * 100)
            : 0;
          progress[e.id] = { voted: anyVoted, total: totalUnits, pct };
        } catch {
          counts[e.id] = 0;
          months[e.id] = [];
          progress[e.id] = { voted: 0, total: 0, pct: 0 };
        }
      }
      setDateOptionCounts(counts);
      setDateOptionMonths(months);
      setVotingProgress(progress);
    })();
  }, [events]);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Categorize events by stage
  function getEventStage(e) {
    const stage = e.stage || 'voting';
    if (stage === 'finalized') {
      // Check if the finalized date is in the past
      const d = e.date?.toDate?.() || new Date(e.date);
      if (d < today) return 'past';
      return 'finalized';
    }
    // If no date options exist yet, it's "created" stage
    if (stage === 'voting') return 'voting';
    return 'voting';
  }

  const allEvents = events;
  const created = allEvents.filter(e => getEventStage(e) === 'voting' && !e.stage);
  const voting = allEvents.filter(e => getEventStage(e) === 'voting' && (e.stage === 'voting' || (!e.stage && false)));
  const finalized = allEvents.filter(e => getEventStage(e) === 'finalized');
  const pastEvents = allEvents.filter(e => getEventStage(e) === 'past');

  // Simpler: just use the stage field + date check
  const createdEvents = allEvents.filter(e => {
    if (e.stage === 'finalized') return false;
    if (e.stage === 'created') return true;
    // No explicit stage — check if any date options exist
    const count = dateOptionCounts[e.id];
    if (count === undefined) return false; // still loading
    return count === 0;
  });
  const votingEvents = allEvents.filter(e => {
    if (e.stage === 'finalized' || e.stage === 'created') return false;
    // Has date options = actively voting
    const count = dateOptionCounts[e.id];
    if (count === undefined) return !e.stage || e.stage === 'voting'; // fallback while loading
    return count > 0;
  });
  const finalizedEvents = allEvents.filter(e => {
    if (e.stage !== 'finalized') return false;
    const d = e.date?.toDate?.() || new Date(e.date);
    return d >= today;
  });
  const pastFinalizedEvents = allEvents.filter(e => {
    if (e.stage !== 'finalized') return false;
    const d = e.date?.toDate?.() || new Date(e.date);
    return d < today;
  });
  const bookedEvents = finalizedEvents.filter(e => e.travelBooked);
  const unbookedFinalizedEvents = finalizedEvents.filter(e => !e.travelBooked);

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

      {/* Kanban Board */}
      {allEvents.length > 0 && (
        <div className={styles.kanban}>
          {[
            { key: 'created', label: 'Created', color: '#9CA3AF', events: createdEvents },
            { key: 'voting', label: 'Voting', color: '#F59E0B', events: votingEvents },
            { key: 'finalized', label: 'Finalized', color: '#6366F1', events: unbookedFinalizedEvents },
            { key: 'booked', label: 'Travel & Lodging', color: '#16a34a', events: bookedEvents },
          ].map(col => (
            <div key={col.key} className={styles.kanbanCol}>
              <div className={styles.kanbanColHeader} style={{ borderBottomColor: col.color, color: col.color, background: `${col.color}08` }}>
                {col.label}
                <span className={styles.kanbanColCount}>{col.events.length}</span>
              </div>
              <div className={styles.kanbanItems}>
                {col.events.length === 0 ? (
                  <div className={styles.kanbanEmpty}>No events</div>
                ) : (
                  col.events.map(e => {
                    const pct = votingProgress[e.id]?.pct;
                    return (
                      <div key={e.id} className={styles.kanbanItem} onClick={() => navigate(`/event/${e.id}`)}>
                        <div className={styles.kanbanItemDot} style={{ background: col.color }} />
                        <span className={styles.kanbanItemTitle}>{e.title}</span>
                        {col.key === 'voting' && pct != null && (
                          <span className={styles.kanbanItemMeta}>{pct}%</span>
                        )}
                        {col.key === 'finalized' && e.location && (
                          <span className={styles.kanbanItemMeta}>{e.location}</span>
                        )}
                        {col.key === 'booked' && (
                          <span className={styles.kanbanItemMeta}>✓</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {allEvents.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🗓</div>
          <h2 className={styles.emptyTitle}>No events yet</h2>
          <p className={styles.emptyDesc}>Create your first event or trip to start planning with friends and family.</p>
          <button className={styles.createBtn} onClick={() => setShowCreate(true)}>+ Create Event</button>
        </div>
      ) : (
        <>
          <div className={styles.dashColumns}>
          <div className={styles.dashLeft}>
          {votingEvents.length > 0 && (() => {
            // Group voting events by month of their date options
            const monthBuckets = {};
            const noMonth = [];
            for (const e of votingEvents) {
              const months = dateOptionMonths[e.id];
              if (!months || months.length === 0) {
                noMonth.push(e);
              } else {
                // Put event in each month it has options for
                for (const ym of months) {
                  if (!monthBuckets[ym]) monthBuckets[ym] = [];
                  if (!monthBuckets[ym].find(x => x.id === e.id)) {
                    monthBuckets[ym].push(e);
                  }
                }
              }
            }
            // Sort months chronologically
            const sortedMonths = Object.keys(monthBuckets).sort();
            const monthLabel = (ym) => {
              const [y, m] = ym.split('-');
              const d = new Date(parseInt(y), parseInt(m) - 1, 1);
              return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            };

            const dotColor = (pct) => pct >= 75 ? '#16a34a' : pct >= 40 ? '#D97706' : '#DC2626';

            return (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }} />
                    Voting ({votingEvents.length})
                  </span>
                </h2>
                <div className={styles.timeline}>
                  {sortedMonths.map(ym => (
                    <div key={ym}>
                      <div className={styles.timelineMonth}>
                        <span className={styles.timelineMonthLabel}>{monthLabel(ym)}</span>
                      </div>
                      {monthBuckets[ym].map(e => {
                        const pct = votingProgress[e.id]?.pct ?? 0;
                        return (
                          <div key={e.id} className={styles.timelineItem}>
                            <div className={styles.timelineDot} style={{ background: dotColor(pct) }} />
                            <div className={styles.timelineCard}>
                              <EventCard event={e} onClick={() => navigate(`/event/${e.id}`)} votePct={pct} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {noMonth.length > 0 && (
                    <div>
                      <div className={styles.timelineMonth}>
                        <span className={styles.timelineMonthLabel}>No Dates Yet</span>
                      </div>
                      {noMonth.map(e => {
                        const pct = votingProgress[e.id]?.pct ?? 0;
                        return (
                          <div key={e.id} className={styles.timelineItem}>
                            <div className={styles.timelineDot} style={{ background: '#9CA3AF' }} />
                            <div className={styles.timelineCard}>
                              <EventCard event={e} onClick={() => navigate(`/event/${e.id}`)} votePct={pct} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            );
          })()}
          {createdEvents.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366F1' }} />
                  Created ({createdEvents.length})
                </span>
              </h2>
              <div className={styles.grid}>
                {createdEvents.map(e => <EventCard key={e.id} event={e} onClick={() => navigate(`/event/${e.id}`)} />)}
              </div>
            </section>
          )}
          </div>{/* end dashLeft */}
          <div className={styles.dashRight}>
          {finalizedEvents.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a' }} />
                  Upcoming ({finalizedEvents.length})
                </span>
              </h2>
              <div className={styles.upcomingList}>
                {finalizedEvents
                  .sort((a, b) => {
                    const da = a.date?.toDate?.() || new Date(a.date);
                    const db2 = b.date?.toDate?.() || new Date(b.date);
                    return da - db2;
                  })
                  .map(e => <EventCard key={e.id} event={e} onClick={() => navigate(`/event/${e.id}`)} />)}
              </div>
            </section>
          )}
          </div>{/* end dashRight */}
          </div>{/* end dashColumns */}
          {pastFinalizedEvents.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#9CA3AF' }} />
                  Past Events ({pastFinalizedEvents.length})
                </span>
              </h2>
              <div className={styles.grid}>
                {pastFinalizedEvents.map(e => <EventCard key={e.id} event={e} onClick={() => navigate(`/event/${e.id}`)} />)}
              </div>
            </section>
          )}
        </>
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

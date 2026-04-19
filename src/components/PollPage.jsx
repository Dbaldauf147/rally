import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, addDoc, deleteDoc, collection, query, orderBy, getDocs, serverTimestamp, arrayUnion, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { format, eachDayOfInterval } from 'date-fns';
import styles from './PollPage.module.css';

class PollPageErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#dc2626' }}>Something went wrong</h2>
          <pre style={{ fontSize: '0.8rem', color: '#666', whiteSpace: 'pre-wrap', maxWidth: '500px', margin: '1rem auto', textAlign: 'left', background: '#f5f5f5', padding: '1rem', borderRadius: '8px' }}>
            {this.state.error.message}{'\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PollPage() {
  return (
    <PollPageErrorBoundary>
      <PollPageInner />
    </PollPageErrorBoundary>
  );
}

function PollPageInner() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const nameParam = decodeURIComponent(searchParams.get('name') || 'Guest');
  const isGenericName = nameParam === 'Friend' || nameParam === 'Guest';
  const hasVid = !!searchParams.get('vid');
  const [editedName, setEditedName] = useState(isGenericName ? '' : nameParam);
  // Always require picking from the attendee list on arrival, unless a vid
  // (returning voter) is present — prevents accidentally voting under someone
  // else's name from a forwarded/pre-filled link.
  const [nameConfirmed, setNameConfirmed] = useState(hasVid && !isGenericName);
  const [selectedMemberUid, setSelectedMemberUid] = useState(null);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const voterName = nameConfirmed ? editedName : nameParam;
  const visitorId = searchParams.get('vid')
    || selectedMemberUid
    || voterName.replace(/\s+/g, '_').toLowerCase();
  const [event, setEvent] = useState(null);
  const [dateOptions, setDateOptions] = useState([]);
  const [rsvp, setRsvp] = useState(null); // 'yes' | 'maybe' | 'no'
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSuggest, setShowSuggest] = useState(true);
  const [suggestMode, setSuggestMode] = useState(null); // null | 'single' | 'range'
  const [suggestDates, setSuggestDates] = useState([]); // for single mode — array of date strings
  const [suggestStart, setSuggestStart] = useState('');
  const [suggestEnd, setSuggestEnd] = useState('');
  const [suggestNote, setSuggestNote] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [expandedOption, setExpandedOption] = useState(null);
  const [localVotes, setLocalVotes] = useState({}); // { optionId: 'yes'|'maybe'|'no' }
  const [topPick, setTopPick] = useState(null); // optionId of user's top choice
  // Votes auto-save on each click — no submit button needed

  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    // Real-time listener on event doc so members list stays current
    const unsub = onSnapshot(doc(db, 'events', eventId), (snap) => {
      if (snap.exists()) {
        setEvent({ id: snap.id, ...snap.data() });
        const members = snap.data().members || {};
        const myEntry = members[visitorId];
        if (myEntry?.rsvp && !rsvp) setRsvp(myEntry.rsvp);
      } else {
        setLoadError('not-found');
      }
      setLoading(false);
    }, (err) => {
      console.error('Poll load error:', err);
      setLoadError(err.code === 'permission-denied' ? 'permission' : 'error');
      setLoading(false);
    });

    // Real-time listener on date options too, so voter list stays current
    const unsub2 = onSnapshot(
      collection(db, 'events', eventId, 'dateOptions'),
      (dSnap) => {
        // Hide closed/cancelled dates from the public poll
        const opts = dSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(o => !o.closed);
        setDateOptions(opts);
        // Initialize localVotes from existing votes if user already voted
        setLocalVotes(prev => {
          if (Object.keys(prev).length > 0) return prev; // don't overwrite user's in-progress selections
          const existing = {};
          for (const opt of opts) {
            const myVote = opt.votes?.[visitorId]?.vote;
            if (myVote && myVote !== 'none') existing[opt.id] = myVote;
          }
          return existing;
        });
        // Initialize top pick from existing data
        setTopPick(prev => {
          if (prev) return prev;
          for (const opt of opts) {
            if (opt.votes?.[visitorId]?.topPick) return opt.id;
          }
          return null;
        });
      },
      () => {}
    );

    return () => { unsub(); unsub2(); };
  }, [eventId]);

  const stage = event?.stage || 'voting';
  const isFinalized = stage === 'finalized';

  async function handleRsvp(response) {
    setRsvp(response);
    await updateDoc(doc(db, 'events', eventId), {
      [`members.${visitorId}`]: { role: 'viewer', rsvp: response, name: voterName },
      memberUids: arrayUnion(visitorId),
    }).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleSuggestDate() {
    setSuggesting(true);
    const noteText = suggestNote.trim() ? `${suggestNote.trim()} (suggested by ${voterName})` : `Suggested by ${voterName}`;
    try {
      if (suggestMode === 'single') {
        const sorted = [...suggestDates].sort();
        for (const ds of sorted) {
          const newOption = {
            startDate: ds, endDate: ds, note: noteText,
            suggestedBy: visitorId, suggestedByName: voterName,
            votes: { [visitorId]: { vote: 'yes', name: voterName } },
            createdAt: serverTimestamp(),
          };
          const ref = await addDoc(collection(db, 'events', eventId, 'dateOptions'), newOption);
          setDateOptions(prev => [...prev, { id: ref.id, ...newOption }]);
        }
        setSuggestDates([]);
      } else {
        if (!suggestStart) { setSuggesting(false); return; }
        const newOption = {
          startDate: suggestStart, endDate: suggestEnd || suggestStart, note: noteText,
          suggestedBy: visitorId, suggestedByName: voterName,
          votes: { [visitorId]: { vote: 'yes', name: voterName } },
          createdAt: serverTimestamp(),
        };
        const ref = await addDoc(collection(db, 'events', eventId, 'dateOptions'), newOption);
        setDateOptions(prev => [...prev, { id: ref.id, ...newOption }]);
        setSuggestStart('');
        setSuggestEnd('');
      }
      setSuggestNote('');
      setShowSuggest(false);
      setSuggestMode(null);
    } catch {}
    setSuggesting(false);
  }

  async function handleVote(optionId, vote) {
    // Toggle: if same vote, clear it
    const current = localVotes[optionId];
    const newVote = current === vote ? 'none' : vote;
    setLocalVotes(prev => {
      if (newVote === 'none') {
        const next = { ...prev };
        delete next[optionId];
        return next;
      }
      return { ...prev, [optionId]: newVote };
    });
    // Auto-save to Firestore immediately (preserve topPick flag)
    const isTopPick = topPick === optionId;
    await updateDoc(doc(db, 'events', eventId, 'dateOptions', optionId), {
      [`votes.${visitorId}`]: { vote: newVote, name: voterName, ...(isTopPick ? { topPick: true } : {}) },
    }).catch(() => {});
    // Register as event member
    updateDoc(doc(db, 'events', eventId), {
      [`members.${visitorId}`]: { role: 'viewer', rsvp: 'pending', name: voterName },
      memberUids: arrayUnion(visitorId),
    }).catch(() => {});
    // Show saved toast
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTopPick(optionId) {
    const prevTopPick = topPick;
    const isToggleOff = prevTopPick === optionId;
    const newTopPick = isToggleOff ? null : optionId;
    setTopPick(newTopPick);

    // Clear topPick from previous option
    if (prevTopPick && prevTopPick !== optionId) {
      const prevOpt = dateOptions.find(o => o.id === prevTopPick);
      const prevVote = prevOpt?.votes?.[visitorId];
      if (prevVote) {
        await updateDoc(doc(db, 'events', eventId, 'dateOptions', prevTopPick), {
          [`votes.${visitorId}`]: { vote: prevVote.vote || 'none', name: voterName },
        }).catch(() => {});
      }
    }

    // Set topPick on new option (or clear it)
    const currentOpt = dateOptions.find(o => o.id === optionId);
    const currentVote = localVotes[optionId] || currentOpt?.votes?.[visitorId]?.vote || 'none';
    await updateDoc(doc(db, 'events', eventId, 'dateOptions', optionId), {
      [`votes.${visitorId}`]: {
        vote: currentVote,
        name: voterName,
        ...(isToggleOff ? {} : { topPick: true }),
      },
    }).catch(() => {});

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleRemoveSuggestion(optionId) {
    if (!window.confirm('Remove this date suggestion?')) return;
    await deleteDoc(doc(db, 'events', eventId, 'dateOptions', optionId)).catch(() => {});
    setDateOptions(prev => prev.filter(o => o.id !== optionId));
  }

  if (loading) return <div className={styles.page}><div className={styles.card}><p>Loading...</p></div></div>;
  if (!event) return (
    <div className={styles.page}>
      <div className={styles.card}>
        {loadError === 'permission' ? (
          <>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>Access Required</h2>
            <p style={{ color: '#525252' }}>This event requires you to sign in first.</p>
            <a href="/login" style={{ display: 'inline-block', marginTop: '1rem', padding: '0.6rem 1.5rem', background: '#4f46e5', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontWeight: 600 }}>Sign In</a>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>Event not found</h2>
            <p style={{ color: '#525252' }}>This event may have been deleted or the link may be incorrect.</p>
          </>
        )}
      </div>
    </div>
  );

  const date = event.date?.toDate ? event.date.toDate() : event.date ? new Date(event.date) : new Date();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.inviteLabel}>You're invited</p>
        <h1 className={styles.title}>{event.title}</h1>

        {/* Name entry */}
        {!nameConfirmed ? (() => {
          const allMembers = Object.entries(event?.members || {})
            .filter(([, m]) => m && typeof m === 'object' && m.name);
          // Merge in anyone who has voted on a date but isn't in members
          const memberUidSet = new Set(allMembers.map(([uid]) => uid));
          for (const opt of dateOptions) {
            for (const [voterId, v] of Object.entries(opt.votes || {})) {
              if (!memberUidSet.has(voterId) && v?.name) {
                allMembers.push([voterId, { name: v.name, rsvp: 'pending', role: 'viewer' }]);
                memberUidSet.add(voterId);
              }
            }
          }
          allMembers.sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''));

          function confirmName(name, memberUid) {
            const finalName = name.trim();
            if (!finalName) return;
            setEditedName(finalName);
            if (memberUid) setSelectedMemberUid(memberUid);
            setNameConfirmed(true);
            setShowNameSuggestions(false);
            const id = memberUid || finalName.replace(/\s+/g, '_').toLowerCase();
            updateDoc(doc(db, 'events', eventId), {
              [`members.${id}`]: { role: 'viewer', rsvp: 'pending', name: finalName },
              memberUids: arrayUnion(id),
            }).catch(() => {});
          }

          return (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Who are you?</h3>
            <p className={styles.sectionDesc}>Tap your name to vote.</p>

            {allMembers.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem', marginBottom: '0.85rem' }}>
                {allMembers.map(([uid, m]) => {
                  const name = m.name;
                  return (
                    <button
                      key={uid}
                      onClick={() => confirmName(name, uid)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.55rem 0.7rem',
                        border: '2px solid #e5e5e5',
                        borderRadius: '10px',
                        background: '#fff',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        color: '#1a1a1a',
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#4f46e5'; e.currentTarget.style.background = '#eef2ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e5e5'; e.currentTarget.style.background = '#fff'; }}
                    >
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.4rem', fontWeight: 500 }}>
              {allMembers.length > 0 ? 'Not on the list?' : 'Enter your name to vote'}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={editedName}
                onChange={e => {
                  setEditedName(e.target.value);
                  setSelectedMemberUid(null);
                }}
                placeholder="Type your name…"
                autoComplete="off"
                style={{ flex: 1, padding: '0.6rem 0.75rem', border: '2px solid #e5e5e5', borderRadius: '10px', fontSize: '0.92rem', fontFamily: 'inherit' }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && editedName.trim()) {
                    confirmName(editedName, selectedMemberUid);
                  }
                }}
              />
              <button
                onClick={() => confirmName(editedName, selectedMemberUid)}
                disabled={!editedName.trim()}
                style={{ padding: '0.6rem 1.2rem', border: 'none', borderRadius: '10px', background: editedName.trim() ? '#4f46e5' : '#e5e5e5', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: editedName.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}
              >
                Continue
              </button>
            </div>
          </div>
          );
        })() : (
          <p style={{ fontSize: '0.82rem', color: '#6b7280', textAlign: 'center', margin: '0 0 1rem' }}>
            Voting as <strong style={{ color: '#1a1a1a' }}>{voterName}</strong>
            {' · '}
            <button
              onClick={() => { setNameConfirmed(false); setSelectedMemberUid(null); setEditedName(''); }}
              style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: '0.82rem', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
            >
              not you?
            </button>
          </p>
        )}

        {/* Date poll */}
        {dateOptions.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{isFinalized ? 'Finalized Dates' : 'Vote on dates'}</h3>
            {isFinalized
              ? <p className={styles.sectionDesc} style={{ color: '#16a34a' }}>Dates have been finalized. Voting is closed.</p>
              : (
                <>
                  <p className={styles.sectionDesc} style={{ marginBottom: '0.4rem' }}>Select which dates work for you.</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.65rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '0.75rem', color: '#92400e', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.9rem' }}>⭐</span>
                    <span>Tap the star to mark your <strong>favorite</strong> choice.</span>
                  </div>
                </>
              )
            }
            <div className={styles.dateList}>
              {dateOptions.map(opt => {
                const start = new Date(opt.startDate + 'T00:00:00');
                const end = new Date((opt.endDate || opt.startDate) + 'T00:00:00');
                const isRange = opt.endDate && opt.endDate !== opt.startDate;
                const dayCount = isRange ? eachDayOfInterval({ start, end }).length : 1;
                const myVote = localVotes[opt.id] || opt.votes?.[visitorId]?.vote;
                const votes = Object.values(opt.votes || {});
                const yesCount = votes.filter(v => v.vote === 'yes').length;
                const maybeCount = votes.filter(v => v.vote === 'maybe').length;
                const noCount = votes.filter(v => v.vote === 'no').length;
                const topPickCount = votes.filter(v => v.topPick).length;
                const isMyTopPick = topPick === opt.id;

                return (
                  <div key={opt.id} className={styles.dateOption} style={isMyTopPick ? { borderColor: '#f59e0b', background: '#fffbeb' } : {}}>
                    <div className={styles.dateInfo}>
                      <div className={styles.dateLabel}>
                        {isMyTopPick && <span style={{ marginRight: '0.3rem' }}>⭐</span>}
                        {isRange
                          ? `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')} (${dayCount} days)`
                          : format(start, 'EEE, MMM d, yyyy')}
                      </div>
                      {opt.note && <div className={styles.dateNote}>{opt.note}</div>}
                      <div className={styles.voteCounts} onClick={() => setExpandedOption(expandedOption === opt.id ? null : opt.id)} style={{ cursor: votes.length > 0 ? 'pointer' : 'default' }}>
                        {topPickCount > 0 && <span style={{ color: '#d97706' }}>⭐ {topPickCount}</span>}
                        {yesCount > 0 && <span style={{ color: '#16a34a' }}>{yesCount} yes</span>}
                        {maybeCount > 0 && <span style={{ color: '#f59e0b' }}>{maybeCount} maybe</span>}
                        {noCount > 0 && <span style={{ color: '#dc2626' }}>{noCount} no</span>}
                        {votes.length > 0 && <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>{expandedOption === opt.id ? '▲' : '▼'}</span>}
                      </div>
                      {expandedOption === opt.id && votes.length > 0 && (
                        <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {votes.filter(v => v.vote && v.vote !== 'none').map((v, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
                              <span style={{
                                display: 'inline-block', width: '0.55rem', height: '0.55rem', borderRadius: '50%',
                                background: v.vote === 'yes' ? '#16a34a' : v.vote === 'maybe' ? '#f59e0b' : '#dc2626',
                              }} />
                              <span style={{ color: '#374151', fontWeight: 500 }}>{v.name || 'Guest'}</span>
                              <span style={{
                                color: v.vote === 'yes' ? '#16a34a' : v.vote === 'maybe' ? '#f59e0b' : '#dc2626',
                                fontSize: '0.68rem',
                              }}>
                                {v.vote === 'yes' ? 'Going' : v.vote === 'maybe' ? 'Maybe' : "Can't go"}
                              </span>
                              {v.topPick && <span style={{ fontSize: '0.68rem' }} title="Top pick">⭐</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <div className={styles.voteButtons}>
                        {[
                          { key: 'yes', label: '✓', color: '#16a34a', bg: '#dcfce7' },
                          { key: 'maybe', label: '?', color: '#f59e0b', bg: '#fef3c7' },
                          { key: 'no', label: '✗', color: '#dc2626', bg: '#fee2e2' },
                        ].map(v => (
                          <button
                            key={v.key}
                            onClick={() => !isFinalized && handleVote(opt.id, v.key)}
                            disabled={isFinalized}
                            className={styles.voteBtn}
                            style={{
                              background: myVote === v.key ? v.bg : '#fff',
                              borderColor: myVote === v.key ? v.color : '#e5e5e5',
                              color: myVote === v.key ? v.color : '#9ca3af',
                            }}
                          >
                            {v.label}
                        </button>
                      ))}
                      </div>
                      {!isFinalized && (
                        <button
                          onClick={() => handleTopPick(opt.id)}
                          title={isMyTopPick ? 'Remove top pick' : 'Mark as your top choice'}
                          className={styles.voteBtn}
                          style={{
                            background: isMyTopPick ? '#fef3c7' : '#fff',
                            borderColor: isMyTopPick ? '#f59e0b' : '#e5e5e5',
                            color: isMyTopPick ? '#d97706' : '#d1d5db',
                            fontSize: '0.85rem',
                          }}
                        >
                          {isMyTopPick ? '⭐' : '☆'}
                        </button>
                      )}
                      {!isFinalized && opt.suggestedBy === visitorId && (
                        <button
                          onClick={() => handleRemoveSuggestion(opt.id)}
                          title="Remove your suggestion"
                          style={{ background: 'none', border: 'none', color: '#d1d5db', fontSize: '1rem', cursor: 'pointer', padding: '0.2rem', lineHeight: 1 }}
                          onMouseEnter={e => e.target.style.color = '#dc2626'}
                          onMouseLeave={e => e.target.style.color = '#d1d5db'}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Auto-save hint */}
            {!isFinalized && Object.keys(localVotes).length > 0 && (
              <div style={{ marginTop: '0.5rem', textAlign: 'center', fontSize: '0.75rem', color: '#6b7280' }}>
                Votes save automatically as you select
              </div>
            )}
          </div>
        )}

        {/* Suggest new dates */}
        {!isFinalized && (
          <div className={styles.section}>
            {!showSuggest ? (
              <button
                onClick={() => setShowSuggest(true)}
                style={{ width: '100%', padding: '0.7rem', border: '2px dashed #d1d5db', borderRadius: '10px', background: 'none', color: '#6b7280', fontSize: '0.88rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                + Suggest different dates
              </button>
            ) : !suggestMode ? (
              <div style={{ border: '1px solid #e5e5e5', borderRadius: '10px', padding: '1rem', background: '#fafafa' }}>
                <h3 className={styles.sectionTitle} style={{ marginBottom: '0.75rem' }}>Suggest Different Dates</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button onClick={() => setSuggestMode('single')} style={{ padding: '0.75rem', border: '1px solid #e5e5e5', borderRadius: '8px', background: '#fff', fontSize: '0.88rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: '#1a1a1a' }}>
                    📅 Specific date(s) <span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>— pick one or more individual days</span>
                  </button>
                  <button onClick={() => setSuggestMode('range')} style={{ padding: '0.75rem', border: '1px solid #e5e5e5', borderRadius: '8px', background: '#fff', fontSize: '0.88rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: '#1a1a1a' }}>
                    📆 Date range <span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 400 }}>— a start and end date</span>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ border: '1px solid #e5e5e5', borderRadius: '10px', padding: '1rem', background: '#fafafa' }}>
                <h3 className={styles.sectionTitle} style={{ marginBottom: '0.75rem' }}>
                  {suggestMode === 'single' ? 'Suggest Specific Dates' : 'Suggest a Date Range'}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {suggestMode === 'single' ? (
                    <>
                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '0.2rem' }}>Add dates</label>
                        <input
                          type="date"
                          onChange={e => {
                            const val = e.target.value;
                            if (val && !suggestDates.includes(val)) setSuggestDates(prev => [...prev, val].sort());
                            e.target.value = '';
                          }}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                      </div>
                      {suggestDates.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {suggestDates.map(d => (
                            <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.5rem', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '999px', fontSize: '0.78rem', color: '#4338ca' }}>
                              {format(new Date(d + 'T00:00:00'), 'MMM d, yyyy')}
                              <button onClick={() => setSuggestDates(prev => prev.filter(x => x !== d))} style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>&times;</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '0.2rem' }}>Start Date</label>
                        <input
                          type="date"
                          value={suggestStart}
                          onChange={e => setSuggestStart(e.target.value)}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '0.2rem' }}>End Date</label>
                        <input
                          type="date"
                          value={suggestEnd}
                          min={suggestStart}
                          onChange={e => setSuggestEnd(e.target.value)}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  )}
                  <input
                    type="text"
                    value={suggestNote}
                    onChange={e => setSuggestNote(e.target.value)}
                    placeholder="Add a note (optional)"
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '0.88rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={handleSuggestDate}
                      disabled={(suggestMode === 'single' ? suggestDates.length === 0 : !suggestStart) || suggesting}
                      style={{ flex: 1, padding: '0.6rem', border: 'none', borderRadius: '8px', background: '#4f46e5', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (suggestMode === 'single' ? suggestDates.length === 0 : !suggestStart) || suggesting ? 0.5 : 1 }}
                    >
                      {suggesting ? 'Adding...' : 'Add Suggestion'}
                    </button>
                    <button
                      onClick={() => { setSuggestMode(null); setSuggestStart(''); setSuggestEnd(''); setSuggestDates([]); setSuggestNote(''); }}
                      style={{ padding: '0.6rem 1rem', border: '1px solid #e5e5e5', borderRadius: '8px', background: '#fff', color: '#6b7280', fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Back
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <InviteOthers eventTitle={event.title} eventId={eventId} eventDate={date} eventLocation={event.location} voterName={voterName} members={event.members || {}} />

        <p className={styles.footer}>Powered by Rally</p>
      </div>

      {/* Saved toast */}
      {saved && (
        <div style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          background: '#16a34a',
          color: '#fff',
          padding: '0.65rem 1.25rem',
          borderRadius: '10px',
          fontSize: '0.88rem',
          fontWeight: 700,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          animation: 'fadeInUp 0.25s ease',
        }}>
          ✓ Saved!
        </div>
      )}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function InviteOthers({ eventTitle, eventId, eventDate, eventLocation, voterName, members }) {
  const [open, setOpen] = useState(true);
  const [invitees, setInvitees] = useState([{ name: '', phone: '' }]);
  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState([]);
  const [showShareLog, setShowShareLog] = useState(false);
  const [shareLogEntries, setShareLogEntries] = useState([{ name: '', phone: '' }]);
  const [importedContacts, setImportedContacts] = useState(null); // null = not imported, [] = imported list
  const [contactSearch, setContactSearch] = useState('');

  const dateStr = eventDate && !isNaN(eventDate) ? format(eventDate, 'EEEE, MMMM d · h:mm a') : '';

  // Build set of existing phone numbers (cleaned) for duplicate detection
  const membersList = useMemo(() => Object.values(members || {}).filter(Boolean), [members]);

  const existingPhones = useMemo(() => {
    const set = new Set();
    for (const m of membersList) {
      if (m.phone) set.add(m.phone.replace(/[^\d]/g, ''));
    }
    return set;
  }, [membersList]);

  function isAlreadyInvited(phone) {
    if (!phone) return null;
    const cleaned = phone.replace(/[^\d]/g, '');
    if (cleaned.length < 7) return null;
    return existingPhones.has(cleaned);
  }

  function getExistingName(phone) {
    if (!phone) return null;
    const cleaned = phone.replace(/[^\d]/g, '');
    for (const m of membersList) {
      if (m.phone && m.phone.replace(/[^\d]/g, '') === cleaned) return m.name;
    }
    return null;
  }

  function buildMessage(recipientName) {
    const name = recipientName || 'Friend';
    const pollUrl = `${window.location.origin}/poll/${eventId}?name=${encodeURIComponent(name)}`;
    return `Hey${recipientName ? ` ${recipientName}` : ''}! ${voterName} invited you to ${eventTitle}.` +
      `\n\nVote here on what dates you can make: ${pollUrl}`;
  }

  function updateInvitee(i, field, value) {
    setInvitees(prev => prev.map((inv, idx) => idx === i ? { ...inv, [field]: value } : inv));
  }

  function addInvitee() {
    setInvitees(prev => [...prev, { name: '', phone: '' }]);
  }

  function removeInvitee(i) {
    setInvitees(prev => prev.filter((_, idx) => idx !== i));
  }

  function getSmsHref() {
    const withPhones = invitees.filter(inv => inv.phone.replace(/[^\d+]/g, ''));
    if (withPhones.length === 0) return null;
    const cleaned = withPhones.map(inv => inv.phone.replace(/[^\d+]/g, ''));
    const firstName = withPhones[0]?.name || '';
    const separator = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
    return `sms:${cleaned.join(',')}${separator}body=${encodeURIComponent(buildMessage(firstName))}`;
  }

  function parseContactsFile(text, fileName) {
    const contacts = [];
    const ext = (fileName || '').toLowerCase();

    if (ext.endsWith('.vcf')) {
      // Parse vCard format
      const cards = text.split('BEGIN:VCARD');
      for (const card of cards) {
        if (!card.trim()) continue;
        let name = '';
        let phone = '';
        for (const line of card.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('FN:') || trimmed.startsWith('FN;')) {
            name = trimmed.split(':').slice(1).join(':').trim();
          }
          if ((trimmed.startsWith('TEL') || trimmed.startsWith('tel')) && trimmed.includes(':')) {
            const val = trimmed.split(':').slice(1).join(':').trim();
            if (val && !phone) phone = val;
          }
        }
        if (name || phone) contacts.push({ name, phone });
      }
    } else {
      // Parse CSV (Google Contacts format)
      const lines = text.split('\n');
      if (lines.length < 2) return contacts;
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const nameIdx = headers.findIndex(h => h === 'name' || h === 'first name' || h === 'given name');
      const lastIdx = headers.findIndex(h => h === 'last name' || h === 'family name' || h === 'additional name');
      const phoneIdx = headers.findIndex(h => h.includes('phone') || h === 'mobile' || h === 'cell');
      const fullNameIdx = headers.findIndex(h => h === 'name');

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row.trim()) continue;
        // Simple CSV parse (handles quoted fields)
        const cells = [];
        let cur = '', inQuote = false;
        for (const ch of row) {
          if (ch === '"') { inQuote = !inQuote; continue; }
          if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        cells.push(cur.trim());

        let name = '';
        if (fullNameIdx >= 0) name = cells[fullNameIdx] || '';
        if (!name && nameIdx >= 0) {
          name = cells[nameIdx] || '';
          if (lastIdx >= 0 && cells[lastIdx]) name += ' ' + cells[lastIdx];
        }
        const phone = phoneIdx >= 0 ? (cells[phoneIdx] || '') : '';
        if (name || phone) contacts.push({ name: name.trim(), phone: phone.trim() });
      }
    }
    return contacts.filter(c => c.name || c.phone);
  }

  function handleFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const contacts = parseContactsFile(reader.result, file.name);
      if (contacts.length > 0) {
        setImportedContacts(contacts);
        setContactSearch('');
      } else {
        alert('No contacts found in file. Make sure it\'s a Google Contacts CSV or vCard (.vcf) export.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleAddToEvent() {
    const toAdd = invitees.filter(inv => inv.name.trim() || inv.phone.trim());
    if (toAdd.length === 0) return;
    const duplicates = toAdd.filter(inv => inv.phone.trim() && isAlreadyInvited(inv.phone));
    const newOnes = toAdd.filter(inv => !inv.phone.trim() || !isAlreadyInvited(inv.phone));
    if (newOnes.length === 0 && duplicates.length > 0) {
      return; // all are duplicates, warnings are already visible
    }
    try {
      for (const inv of newOnes) {
        const name = inv.name.trim() || 'Guest';
        const memberId = name.replace(/\s+/g, '_').toLowerCase() + '_' + Date.now().toString(36);
        const memberData = { role: 'viewer', rsvp: 'pending', name };
        if (inv.phone.trim()) memberData.phone = inv.phone.trim();
        await updateDoc(doc(db, 'events', eventId), {
          [`members.${memberId}`]: memberData,
          memberUids: arrayUnion(memberId),
        });
      }
      const addedNames = newOnes.map(inv => inv.name.trim() || inv.phone.trim());
      if (duplicates.length > 0) {
        addedNames.push(`(${duplicates.length} already invited)`);
      }
      setAdded(addedNames);
      setInvitees([{ name: '', phone: '' }]);
      setTimeout(() => setAdded([]), 3000);
    } catch {}
  }

  function handleCopyLink() {
    const pollUrl = `${window.location.origin}/poll/${eventId}?name=Friend`;
    const message = `Hey! ${voterName} invited you to ${eventTitle}.\n\nVote here on what dates you can make: ${pollUrl}`;
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) {
    return (
      <div className={styles.section}>
        <button
          onClick={() => setOpen(true)}
          className={styles.inviteToggle}
        >
          📨 Invite others to this poll
        </button>
      </div>
    );
  }

  const smsHref = getSmsHref();
  const hasAnyInput = invitees.some(inv => inv.name.trim() || inv.phone.trim());

  return (
    <div className={styles.section}>
      <div className={styles.inviteBox}>
        <h3 className={styles.sectionTitle}>Invite Friends</h3>
        <p className={styles.sectionDesc}>Add people to this event and send them a text to vote.</p>

        <div className={styles.phoneList}>
          {invitees.map((inv, i) => (
            <div key={i}>
              <div className={styles.phoneRow} style={{ flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={inv.name}
                  onChange={e => updateInvitee(i, 'name', e.target.value)}
                  placeholder="Name"
                  className={styles.phoneInput}
                  style={{ flex: '1 1 100px', minWidth: '80px' }}
                />
                <input
                  type="tel"
                  value={inv.phone}
                  onChange={e => updateInvitee(i, 'phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  className={styles.phoneInput}
                  style={{ flex: '1 1 120px', minWidth: '100px', borderColor: isAlreadyInvited(inv.phone) ? '#f59e0b' : undefined }}
                />
                {invitees.length > 1 && (
                  <button
                    onClick={() => removeInvitee(i)}
                    className={styles.phoneRemove}
                    title="Remove"
                  >&times;</button>
                )}
              </div>
              {isAlreadyInvited(inv.phone) && (
                <p style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: 600, margin: '0.2rem 0 0.3rem', padding: '0 0.25rem' }}>
                  ⚠ {getExistingName(inv.phone) || 'This number'} is already invited to this event
                </p>
              )}
            </div>
          ))}
        </div>

        <div style={{ height: '0.25rem' }} />

        {/* Imported contacts picker */}
        {importedContacts && importedContacts.length > 0 && (
          <div style={{ marginTop: '0.5rem', padding: '0.65rem', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#166534', margin: 0 }}>
                📂 {importedContacts.length} contacts loaded
              </p>
              <button onClick={() => { setImportedContacts(null); setContactSearch(''); }} style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '0.85rem', cursor: 'pointer' }}>&times;</button>
            </div>
            <input
              type="text"
              value={contactSearch}
              onChange={e => setContactSearch(e.target.value)}
              placeholder="Search contacts..."
              className={styles.phoneInput}
              style={{ width: '100%', marginBottom: '0.4rem', boxSizing: 'border-box' }}
            />
            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {importedContacts
                .filter(c => {
                  if (!contactSearch.trim()) return true;
                  const q = contactSearch.toLowerCase();
                  return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
                })
                .slice(0, 50)
                .map((c, i) => {
                  const alreadyAdded = invitees.some(inv =>
                    (inv.phone && c.phone && inv.phone.replace(/[^\d]/g, '') === c.phone.replace(/[^\d]/g, '')) ||
                    (inv.name && c.name && inv.name.toLowerCase() === c.name.toLowerCase())
                  );
                  return (
                    <button
                      key={i}
                      disabled={alreadyAdded}
                      onClick={() => {
                        setInvitees(prev => {
                          const cleaned = prev.filter(inv => inv.name.trim() || inv.phone.trim());
                          return [...cleaned, { name: c.name, phone: c.phone }];
                        });
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '6px',
                        background: alreadyAdded ? '#F0FDF4' : '#fff', cursor: alreadyAdded ? 'default' : 'pointer',
                        fontFamily: 'inherit', fontSize: '0.78rem', textAlign: 'left', opacity: alreadyAdded ? 0.6 : 1,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#1E293B' }}>{c.name || 'Unknown'}</span>
                      <span style={{ color: '#64748B', fontSize: '0.72rem' }}>
                        {alreadyAdded ? '✓ Added' : c.phone || 'No phone'}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {added.length > 0 && (
          <p style={{ fontSize: '0.82rem', color: '#16a34a', fontWeight: 600, margin: '0.5rem 0' }}>
            ✓ Added {added.join(', ')} to the event!
          </p>
        )}

        <div className={styles.inviteActions} style={{ flexDirection: 'column' }}>
          <a
            href={smsHref || '#'}
            className={styles.sendTextBtn}
            style={{ opacity: smsHref ? 1 : 0.5, pointerEvents: smsHref ? 'auto' : 'none' }}
            onClick={() => { handleAddToEvent(); }}
          >
            💬 Send Text Invite
          </a>
          <button
            onClick={async () => {
              if ('contacts' in navigator && 'ContactsManager' in window) {
                try {
                  const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: true });
                  const newInvitees = contacts
                    .filter(c => c.tel && c.tel.length > 0)
                    .map(c => ({ name: (c.name && c.name[0]) || '', phone: c.tel[0] || '' }));
                  if (newInvitees.length > 0) {
                    setInvitees(prev => {
                      const cleaned = prev.filter(inv => inv.name.trim() || inv.phone.trim());
                      return [...cleaned, ...newInvitees];
                    });
                  }
                  return;
                } catch {}
              }
              if (navigator.share) {
                const pollUrl = `${window.location.origin}/poll/${eventId}?name=Friend`;
                try {
                  await navigator.share({ title: eventTitle, text: buildMessage(''), url: pollUrl });
                  setShowShareLog(true);
                } catch {}
              } else {
                navigator.clipboard.writeText(`${window.location.origin}/poll/${eventId}?name=Friend`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className={styles.copyLinkBtn}
            style={{ flex: 1, color: '#4f46e5', borderColor: '#C7D2FE', background: '#EEF2FF' }}
          >
            📇 Send From Your Contacts
          </button>
        </div>

        <button onClick={handleCopyLink} className={styles.copyLinkBtn} style={{ width: '100%', marginTop: '0.35rem' }}>
          {copied ? '✓ Copied!' : '🔗 Copy Poll Link'}
        </button>

        {showShareLog && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '10px' }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#4338CA', margin: '0 0 0.5rem' }}>
              Who did you share it with?
            </p>
            <p style={{ fontSize: '0.72rem', color: '#6366F1', margin: '0 0 0.5rem' }}>
              Add their info so they show up on the event. You can then send them a text invite too.
            </p>
            {shareLogEntries.map((entry, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={entry.name}
                  onChange={e => setShareLogEntries(prev => prev.map((ent, idx) => idx === i ? { ...ent, name: e.target.value } : ent))}
                  placeholder="Name"
                  className={styles.phoneInput}
                  style={{ flex: '1 1 100px', minWidth: '80px' }}
                  autoFocus={i === 0}
                />
                <input
                  type="tel"
                  value={entry.phone}
                  onChange={e => setShareLogEntries(prev => prev.map((ent, idx) => idx === i ? { ...ent, phone: e.target.value } : ent))}
                  placeholder="Phone (optional)"
                  className={styles.phoneInput}
                  style={{ flex: '1 1 120px', minWidth: '100px' }}
                />
                {shareLogEntries.length > 1 && (
                  <button onClick={() => setShareLogEntries(prev => prev.filter((_, idx) => idx !== i))} className={styles.phoneRemove}>&times;</button>
                )}
              </div>
            ))}
            <button onClick={() => setShareLogEntries(prev => [...prev, { name: '', phone: '' }])} className={styles.addPhoneBtn} style={{ margin: '0 0 0.5rem' }}>
              + Another person
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  const entries = shareLogEntries.filter(e => e.name.trim() || e.phone.trim());
                  if (entries.length > 0) {
                    setInvitees(prev => {
                      const existing = prev.filter(inv => inv.name.trim() || inv.phone.trim());
                      return [...existing, ...entries];
                    });
                  }
                  setShowShareLog(false);
                  setShareLogEntries([{ name: '', phone: '' }]);
                }}
                style={{ flex: 1, padding: '0.55rem', border: 'none', borderRadius: '8px', background: '#4F46E5', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Add to Invite List
              </button>
              <button
                onClick={() => { setShowShareLog(false); setShareLogEntries([{ name: '', phone: '' }]); }}
                style={{ padding: '0.55rem 0.75rem', border: '1px solid #C7D2FE', borderRadius: '8px', background: '#fff', color: '#6366F1', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Skip
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

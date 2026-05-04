import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, getDay, addMonths, subMonths, isSameDay } from 'date-fns';
import styles from './DatePoll.module.css';

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DatePoll({ entityType, entityId, stage = 'voting', canManage = false, members = [], altRanges = [], onAddAltRange, onRemoveAltRange, onEditDate }) {
  const isFinalized = stage === 'finalized';
  const { user } = useAuth();
  const [options, setOptions] = useState([]);
  const [calMonth, setCalMonth] = useState(new Date());
  const [selStart, setSelStart] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const [selectedDays, setSelectedDays] = useState(new Set()); // for single day(s) mode
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [referenceOnly, setReferenceOnly] = useState(false);
  const [selMode, setSelMode] = useState('single'); // 'single' | 'range'
  const [googleBusyDates, setGoogleBusyDates] = useState(new Set());
  const [googleEventMap, setGoogleEventMap] = useState({}); // { dateStr: [{ title, start, end }] }
  const [googleFullEvents, setGoogleFullEvents] = useState({}); // { dateStr: [full event objects] }
  const [viewingDay, setViewingDay] = useState(null); // dateStr of day being viewed
  const [topPick, setTopPick] = useState(null); // optionId of user's top choice
  const [googleConnected, setGoogleConnected] = useState(() => !!localStorage.getItem('google-cal-token'));
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [otherEventDates, setOtherEventDates] = useState(new Map()); // dateStr -> [event titles]
  const [showAddRange, setShowAddRange] = useState(false);
  const [newRangeLabel, setNewRangeLabel] = useState('');
  const [newRangeStart, setNewRangeStart] = useState('');
  const [newRangeEnd, setNewRangeEnd] = useState('');

  // Get a valid access token, refreshing via refresh-token if expired
  async function getValidGoogleToken() {
    let token = localStorage.getItem('google-cal-token');
    const expiry = localStorage.getItem('google-cal-expiry');
    const refreshToken = localStorage.getItem('google-cal-refresh');
    if (token && expiry && Date.now() < Number(expiry) - 60000) return token;
    if (refreshToken) {
      try {
        const res = await fetch(`/api/google-refresh?refreshToken=${encodeURIComponent(refreshToken)}`);
        const data = await res.json();
        if (data.accessToken) {
          localStorage.setItem('google-cal-token', data.accessToken);
          localStorage.setItem('google-cal-expiry', String(Date.now() + (data.expiresIn || 3600) * 1000));
          return data.accessToken;
        }
      } catch {}
    }
    return token || null;
  }

  // Fetch Google Calendar events for the visible month from all selected calendars
  const fetchGoogleBusy = useCallback(async () => {
    const selectedMulti = (() => {
      try { return JSON.parse(localStorage.getItem('google-cal-selected-multi') || '[]'); } catch { return []; }
    })();
    const legacySingle = localStorage.getItem('google-cal-selected');
    const calIds = selectedMulti.length > 0 ? selectedMulti : (legacySingle ? [legacySingle] : []);

    const token = await getValidGoogleToken();
    if (!token) {
      setGoogleConnected(false);
      return;
    }
    setGoogleConnected(true);
    if (calIds.length === 0) return; // connected but no calendars picked yet

    setLoadingGoogle(true);
    try {
      const mStart = startOfMonth(calMonth);
      const mEnd = endOfMonth(calMonth);
      const dates = new Set();
      const map = {};
      const fullMap = {};
      for (const calId of calIds) {
        try {
          const res = await fetch(`/api/google-calendar?accessToken=${encodeURIComponent(token)}&timeMin=${mStart.toISOString()}&timeMax=${mEnd.toISOString()}&calendarId=${encodeURIComponent(calId)}`);
          const data = await res.json();
          if (!data.events) continue;
          for (const evt of data.events) {
            const start = new Date(evt.start);
            const end = new Date(evt.end || evt.start);
            const days = evt.allDay
              ? eachDayOfInterval({ start, end: new Date(end.getTime() - 86400000) })
              : [start];
            for (const d of days) {
              const ds = toDateStr(d);
              dates.add(ds);
              if (!map[ds]) map[ds] = [];
              map[ds].push(evt.title);
              if (!fullMap[ds]) fullMap[ds] = [];
              fullMap[ds].push(evt);
            }
          }
        } catch {}
      }
      setGoogleBusyDates(dates);
      setGoogleEventMap(map);
      setGoogleFullEvents(fullMap);
    } catch {}
    setLoadingGoogle(false);
  }, [calMonth]);

  useEffect(() => {
    fetchGoogleBusy();
  }, [fetchGoogleBusy]);

  // Fetch other voting-stage events the user is part of, to highlight
  // dates that already have an open poll elsewhere as potential overlaps.
  useEffect(() => {
    if (!user || entityType !== 'events') return;
    let cancelled = false;
    (async () => {
      try {
        const eventsSnap = await getDocs(query(
          collection(db, 'events'),
          where('memberUids', 'array-contains', user.uid)
        ));
        const others = eventsSnap.docs.filter(d => d.id !== entityId && (d.data().stage || 'voting') === 'voting');
        const map = new Map();
        await Promise.all(others.map(async d => {
          const title = d.data().title || 'Event';
          try {
            const optsSnap = await getDocs(collection(db, 'events', d.id, 'dateOptions'));
            for (const optDoc of optsSnap.docs) {
              const opt = optDoc.data();
              if (opt.closed || opt.noVote || !opt.startDate) continue;
              const start = new Date(opt.startDate + 'T00:00:00');
              const end = new Date((opt.endDate || opt.startDate) + 'T00:00:00');
              if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
              for (const day of eachDayOfInterval({ start, end })) {
                const ds = toDateStr(day);
                const list = map.get(ds) || [];
                if (!list.includes(title)) list.push(title);
                map.set(ds, list);
              }
            }
          } catch {}
        }));
        if (!cancelled) setOtherEventDates(map);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user, entityType, entityId]);

  const didAlignCalRef = useRef(false);
  useEffect(() => {
    const q = query(collection(db, entityType, entityId, 'dateOptions'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const opts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOptions(opts);
      // Initialize top pick from existing data
      if (user) {
        setTopPick(prev => {
          if (prev) return prev;
          for (const opt of opts) {
            if (opt.votes?.[user.uid]?.topPick) return opt.id;
          }
          return null;
        });
      }
      // Jump the calendar to the earliest open suggested date the first time
      // options load, so the dates being voted on are visible by default.
      // Only runs once per mount — manual nav stays sticky after that.
      if (!didAlignCalRef.current && opts.length > 0) {
        didAlignCalRef.current = true;
        const openOpts = opts.filter(o => !o.closed && o.startDate);
        const pool = openOpts.length > 0 ? openOpts : opts.filter(o => o.startDate);
        if (pool.length > 0) {
          const earliest = pool.reduce((min, o) => (o.startDate < min ? o.startDate : min), pool[0].startDate);
          const target = new Date(earliest + 'T00:00:00');
          if (!isNaN(target.getTime())) {
            setCalMonth(prev => (
              prev.getFullYear() === target.getFullYear() && prev.getMonth() === target.getMonth()
                ? prev
                : new Date(target.getFullYear(), target.getMonth(), 1)
            ));
          }
        }
      }
    }, () => {});
    return unsub;
  }, [entityType, entityId, user]);

  // Build set of all suggested dates for highlighting
  const suggestedDates = new Set();
  for (const opt of options) {
    const start = new Date(opt.startDate + 'T00:00:00');
    const end = new Date((opt.endDate || opt.startDate) + 'T00:00:00');
    const days = eachDayOfInterval({ start, end });
    days.forEach(d => suggestedDates.add(toDateStr(d)));
  }

  function handleDayClick(day) {
    const ds = toDateStr(day);
    if (selMode === 'single') {
      // Toggle individual days
      setSelectedDays(prev => {
        const next = new Set(prev);
        if (next.has(ds)) next.delete(ds); else next.add(ds);
        return next;
      });
    } else {
      // Range mode
      if (!selStart || selEnd) {
        setSelStart(ds);
        setSelEnd(null);
      } else if (ds === selStart) {
        setSelStart(null);
        setSelEnd(null);
      } else {
        if (ds < selStart) { setSelEnd(selStart); setSelStart(ds); }
        else { setSelEnd(ds); }
      }
    }
  }

  async function handleSubmit() {
    if (!user) return;
    setAdding(true);
    const baseDoc = {
      note: note.trim(),
      suggestedBy: user.uid,
      suggestedByName: user.displayName || user.email || 'Someone',
      votes: {},
      createdAt: serverTimestamp(),
      ...(referenceOnly ? { noVote: true } : {}),
    };
    if (selMode === 'single') {
      // Create one suggestion per selected day
      const sorted = [...selectedDays].sort();
      for (const ds of sorted) {
        await addDoc(collection(db, entityType, entityId, 'dateOptions'), {
          ...baseDoc,
          startDate: ds,
          endDate: ds,
        });
      }
      setSelectedDays(new Set());
    } else {
      if (!selStart) { setAdding(false); return; }
      await addDoc(collection(db, entityType, entityId, 'dateOptions'), {
        ...baseDoc,
        startDate: selStart,
        endDate: selEnd || selStart,
      });
      setSelStart(null);
      setSelEnd(null);
    }
    setNote('');
    setReferenceOnly(false);
    setAdding(false);
  }

  async function handleVote(optionId, vote) {
    if (!user) return;
    await updateDoc(doc(db, entityType, entityId, 'dateOptions', optionId), {
      [`votes.${user.uid}`]: { vote, name: user.displayName || user.email || '' },
    });
  }

  async function handleDelete(optionId) {
    await deleteDoc(doc(db, entityType, entityId, 'dateOptions', optionId));
  }

  async function handleTopPick(optionId) {
    if (!user) return;
    const prevTopPick = topPick;
    const isToggleOff = prevTopPick === optionId;
    setTopPick(isToggleOff ? null : optionId);
    const userName = user.displayName || user.email || '';

    // Clear topPick from previous option
    if (prevTopPick && prevTopPick !== optionId) {
      const prevOpt = options.find(o => o.id === prevTopPick);
      const prevVote = prevOpt?.votes?.[user.uid];
      if (prevVote) {
        const { topPick: _, ...rest } = prevVote;
        await updateDoc(doc(db, entityType, entityId, 'dateOptions', prevTopPick), {
          [`votes.${user.uid}`]: rest,
        }).catch(() => {});
      }
    }

    // Set or clear topPick on this option
    const currentOpt = options.find(o => o.id === optionId);
    const currentVote = currentOpt?.votes?.[user.uid] || { vote: 'none', name: userName };
    if (isToggleOff) {
      const { topPick: _, ...rest } = currentVote;
      await updateDoc(doc(db, entityType, entityId, 'dateOptions', optionId), {
        [`votes.${user.uid}`]: rest,
      }).catch(() => {});
    } else {
      await updateDoc(doc(db, entityType, entityId, 'dateOptions', optionId), {
        [`votes.${user.uid}`]: { ...currentVote, topPick: true },
      }).catch(() => {});
    }
  }

  async function handleToggleClosed(optionId, closed) {
    await updateDoc(doc(db, entityType, entityId, 'dateOptions', optionId), {
      closed,
      closedBy: closed ? (user?.displayName || user?.email || user?.uid || '') : '',
      closedAt: closed ? new Date().toISOString() : '',
    });
  }

  // Calendar — include overlap days from prev/next month
  const monthStart = startOfMonth(calMonth);
  const monthEnd = endOfMonth(calMonth);
  const startPad = getDay(monthStart);
  const today = new Date();

  // Build full 6-week grid
  const calStart = new Date(monthStart);
  calStart.setDate(calStart.getDate() - startPad);
  const totalCells = 42; // 6 rows × 7
  const calDays = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(calStart);
    d.setDate(d.getDate() + i);
    calDays.push(d);
  }
  // Trim trailing row if all days are next month
  const lastRowStart = calDays.length - 7;
  const trimmed = calDays[lastRowStart].getMonth() !== calMonth.getMonth() && calDays[lastRowStart - 1]?.getMonth() !== calMonth.getMonth()
    ? calDays.slice(0, lastRowStart)
    : calDays;

  // Selection range for highlighting
  const selStartDate = selStart ? new Date(selStart + 'T00:00:00') : null;
  const selEndDate = selEnd ? new Date(selEnd + 'T00:00:00') : null;

  function isInSelection(day) {
    const ds = toDateStr(day);
    if (selMode === 'single') return selectedDays.has(ds);
    if (!selStartDate) return false;
    if (!selEndDate) return isSameDay(day, selStartDate);
    return day >= selStartDate && day <= selEndDate;
  }

  // Ranked options — closed options sink to the bottom and don't compete for "Most Popular"
  const ranked = [...options].map(opt => {
    const votes = Object.values(opt.votes || {});
    const yesCount = votes.filter(v => v.vote === 'yes').length;
    const maybeCount = votes.filter(v => v.vote === 'maybe').length;
    return { ...opt, yesCount, maybeCount, score: yesCount * 2 + maybeCount };
  }).sort((a, b) => {
    if (!!a.closed !== !!b.closed) return a.closed ? 1 : -1;
    return b.score - a.score;
  });

  const bestId = (() => {
    const openOpts = ranked.filter(o => !o.closed && !o.noVote);
    return openOpts.length > 0 && openOpts[0].score > 0 ? openOpts[0].id : null;
  })();

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>
        {isFinalized ? 'Finalized Dates' : 'Suggested Dates'}
      </h3>
      {isFinalized && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--color-success-light)', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem', fontSize: '0.82rem', color: 'var(--color-success)', fontWeight: 500 }}>
          Dates have been finalized. Voting is closed.
        </div>
      )}

      {/* Calendar + side panel — read-only when finalized */}
      <div className={styles.calendarRow}>
      <div className={styles.calendarCard}>
        {!isFinalized && (
          <div className={styles.modeToggle}>
            <button className={selMode === 'single' ? styles.modeActive : styles.modeBtn} onClick={() => { setSelMode('single'); setSelStart(null); setSelEnd(null); setSelectedDays(new Set()); }}>Single Day(s)</button>
            <button className={selMode === 'range' ? styles.modeActive : styles.modeBtn} onClick={() => { setSelMode('range'); setSelStart(null); setSelEnd(null); setSelectedDays(new Set()); }}>Date Range</button>
          </div>
        )}
        <div className={styles.calHeader}>
          <div className={styles.calHeaderNav}>
            <button className={styles.calNav} onClick={() => setCalMonth(subMonths(calMonth, 1))}>‹</button>
            <span className={styles.calMonthLabel}>{format(calMonth, 'MMMM yyyy')}</span>
            <button className={styles.calNav} onClick={() => setCalMonth(addMonths(calMonth, 1))}>›</button>
          </div>
          {googleConnected && (
            <button
              type="button"
              className={styles.calRefresh}
              onClick={fetchGoogleBusy}
              disabled={loadingGoogle}
              title="Refresh Google Calendar"
              aria-label="Refresh Google Calendar"
            >
              {loadingGoogle ? 'Syncing…' : '↻ Refresh'}
            </button>
          )}
        </div>
        <div className={styles.calGrid}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className={styles.calDayLabel}>{d}</div>
          ))}
          {trimmed.map(day => {
            const ds = toDateStr(day);
            const isCurrentMonth = day.getMonth() === calMonth.getMonth();
            const isSuggested = suggestedDates.has(ds);
            const isSelected = isInSelection(day);
            const isToday = isSameDay(day, today);
            const isPast = day < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const isBusy = googleBusyDates.has(ds);
            const busyEvents = googleEventMap[ds];
            const overlapTitles = otherEventDates.get(ds);
            const hasOverlap = !!overlapTitles && overlapTitles.length > 0;
            return (
              <button
                key={ds}
                className={`${styles.calDay} ${isSelected ? styles.calDaySelected : ''} ${isSuggested && isCurrentMonth ? styles.calDaySuggested : ''} ${isToday ? styles.calDayToday : ''} ${isPast ? styles.calDayPast : ''} ${!isCurrentMonth ? styles.calDayOtherMonth : ''} ${isBusy && !isSelected ? styles.calDayBusy : ''} ${hasOverlap && !isSelected ? styles.calDayOtherEvent : ''} ${viewingDay === ds ? styles.calDayViewing : ''}`}
                title={hasOverlap ? `Also being voted on: ${overlapTitles.join(', ')}` : undefined}
                onClick={() => {
                  if (!isPast && !isFinalized) handleDayClick(day);
                  if (isBusy || hasOverlap) setViewingDay(viewingDay === ds ? null : ds);
                  else setViewingDay(null);
                }}
                disabled={isPast}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        {/* Selection info + submit */}
        {!isFinalized && (selMode === 'single' ? selectedDays.size > 0 : !!selStart) && (
          <div className={styles.selectionBar}>
            <span className={styles.selectionText}>
              {selMode === 'single'
                ? [...selectedDays].sort().map(ds => format(new Date(ds + 'T00:00:00'), 'MMM d')).join(', ') + ` (${selectedDays.size} day${selectedDays.size !== 1 ? 's' : ''})`
                : selEnd && selEnd !== selStart
                  ? `${format(selStartDate, 'MMM d')} – ${format(selEndDate, 'MMM d, yyyy')} (${eachDayOfInterval({ start: selStartDate, end: selEndDate }).length} days)`
                  : format(selStartDate, 'EEEE, MMM d, yyyy')
              }
            </span>
            <button className={styles.selClear} onClick={() => { setSelStart(null); setSelEnd(null); setSelectedDays(new Set()); }}>Clear</button>
          </div>
        )}
        {!isFinalized && (selMode === 'single' ? selectedDays.size > 0 : !!selStart) && (
          <>
            <div className={styles.submitRow}>
              <input
                className={styles.noteInput}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={referenceOnly ? 'Name (e.g. "Backup option")' : 'Add a note (optional)'}
              />
              <button className={styles.submitBtn} onClick={handleSubmit} disabled={adding || (referenceOnly && !note.trim())}>
                {adding ? 'Adding...' : referenceOnly
                  ? `Add ${selMode === 'single' ? selectedDays.size : ''} Reference${selMode === 'single' && selectedDays.size !== 1 ? 's' : ''}`
                  : `Suggest ${selMode === 'single' ? selectedDays.size : ''} Date${selMode === 'single' && selectedDays.size !== 1 ? 's' : ''}`}
              </button>
            </div>
            <label className={styles.refToggle}>
              <input
                type="checkbox"
                checked={referenceOnly}
                onChange={e => setReferenceOnly(e.target.checked)}
              />
              <span>📌 Add as reference only (no voting)</span>
            </label>
          </>
        )}

        <div className={styles.calLegend}>
          <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: 'var(--color-accent)' }} /> Selected</span>
          <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: '#BBF7D0' }} /> Suggested</span>
          <span className={styles.legendItem}><span className={styles.legendDot} style={{ border: '2px solid var(--color-accent)', background: 'none' }} /> Today</span>
          {googleBusyDates.size > 0 && <span className={styles.legendItem}><span className={styles.legendDot} style={{ border: '2px solid #4285F4', background: 'none' }} /> Google Event</span>}
          {otherEventDates.size > 0 && <span className={styles.legendItem}><span className={styles.legendDot} style={{ border: '2px solid #f59e0b', background: 'none' }} /> Other Rally event voting</span>}
        </div>
      </div>

      {/* Side panel — Google Calendar events and other Rally events for selected day */}
      {viewingDay && (googleFullEvents[viewingDay] || otherEventDates.has(viewingDay)) && (
        <div className={styles.sidePanel}>
          <div className={styles.sidePanelHeader}>
            <h4 className={styles.sidePanelTitle}>{format(new Date(viewingDay + 'T00:00:00'), 'EEEE, MMM d')}</h4>
            <button className={styles.sidePanelClose} onClick={() => setViewingDay(null)}>&times;</button>
          </div>
          <div className={styles.sidePanelEvents}>
            {(googleFullEvents[viewingDay] || []).map((evt, i) => {
              const start = new Date(evt.start);
              const timeStr = evt.allDay ? 'All day' : format(start, 'h:mm a');
              return (
                <div key={`g-${i}`} className={styles.sidePanelEvent}>
                  <div className={styles.sidePanelTime}>{timeStr}</div>
                  <div className={styles.sidePanelEventTitle}>{evt.title}</div>
                  {evt.location && <div className={styles.sidePanelLocation}>📍 {evt.location}</div>}
                </div>
              );
            })}
            {(otherEventDates.get(viewingDay) || []).map((title, i) => (
              <div key={`r-${i}`} className={styles.sidePanelEvent} style={{ background: '#fffbeb', borderLeftColor: '#f59e0b' }}>
                <div className={styles.sidePanelTime} style={{ color: '#d97706' }}>Rally event voting</div>
                <div className={styles.sidePanelEventTitle}>{title}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      {/* Suggested date options with voting — available at the top */}
      {ranked.filter(o => !o.closed).length > 0 && (
        <div className={styles.optionsList}>
          {ranked.filter(o => !o.closed).map(opt => {
            const start = new Date(opt.startDate + 'T00:00:00');
            const end = new Date((opt.endDate || opt.startDate) + 'T00:00:00');
            const isRange = opt.endDate && opt.endDate !== opt.startDate;
            const dayCount = isRange ? eachDayOfInterval({ start, end }).length : 1;
            const votes = Object.entries(opt.votes || {});
            const myVote = user ? opt.votes?.[user.uid]?.vote : null;
            const isBest = opt.id === bestId;
            const votesDisabled = isFinalized;
            const topPickCount = Object.values(opt.votes || {}).filter(v => v.topPick).length;
            const isMyTopPick = topPick === opt.id;
            const isReference = !!opt.noVote;

            return (
              <div key={opt.id} className={`${styles.option} ${isBest ? styles.optionBest : ''} ${isReference ? styles.optionReference : ''}`} style={isMyTopPick && !isReference ? { borderColor: '#f59e0b' } : {}}>
                {isBest && <div className={styles.bestBadge}>Most Popular</div>}
                {isReference && <div className={styles.refBadge}>📌 Reference</div>}
                <div className={styles.optionHeader}>
                  <div className={styles.optionDates}>
                    {isReference && opt.note && (
                      <div className={styles.refName}>{opt.note}</div>
                    )}
                    {isRange
                      ? <span className={styles.dateRange}>{format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')} <span className={styles.dayCount}>{dayCount} days</span></span>
                      : <span className={styles.singleDate}>{format(start, 'EEEE, MMM d, yyyy')}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                    {isFinalized && canManage && !isReference && onEditDate && (
                      <button
                        className={styles.deleteBtn}
                        onClick={() => onEditDate(opt)}
                        title="Edit — change finalized date to this"
                        style={{ fontSize: '0.95rem' }}
                      >
                        ✏️
                      </button>
                    )}
                    {canManage && !isReference && (
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleToggleClosed(opt.id, true)}
                        title="Close — no longer available"
                        style={{ fontSize: '0.95rem' }}
                      >
                        🚫
                      </button>
                    )}
                    {(opt.suggestedBy === user?.uid || (isReference && canManage)) && (
                      <button className={styles.deleteBtn} onClick={() => handleDelete(opt.id)} title="Remove">×</button>
                    )}
                  </div>
                </div>
                {!isReference && opt.note && <p className={styles.note}>{opt.note}</p>}
                <p className={styles.suggestedBy}>{isReference ? 'Added' : 'Suggested'} by {opt.suggestedByName}</p>

                {!isReference && (
                  <>
                    <div className={styles.voteRow}>
                      <button className={myVote === 'yes' ? styles.voteYesActive : styles.voteBtn} onClick={() => !votesDisabled && handleVote(opt.id, myVote === 'yes' ? 'none' : 'yes')} disabled={votesDisabled}>
                        ✓ Works ({opt.yesCount})
                      </button>
                      <button className={myVote === 'maybe' ? styles.voteMaybeActive : styles.voteBtn} onClick={() => !votesDisabled && handleVote(opt.id, myVote === 'maybe' ? 'none' : 'maybe')} disabled={votesDisabled}>
                        ? Maybe ({opt.maybeCount})
                      </button>
                      <button className={myVote === 'no' ? styles.voteNoActive : styles.voteBtn} onClick={() => !votesDisabled && handleVote(opt.id, myVote === 'no' ? 'none' : 'no')} disabled={votesDisabled}>
                        ✗ No ({votes.filter(([,v]) => v.vote === 'no').length})
                      </button>
                      {!isFinalized && user && (
                        <button
                          className={styles.voteBtn}
                          onClick={() => handleTopPick(opt.id)}
                          title={isMyTopPick ? 'Remove top pick' : 'Mark as your top choice'}
                          style={{
                            background: isMyTopPick ? '#fef3c7' : undefined,
                            borderColor: isMyTopPick ? '#f59e0b' : undefined,
                            color: isMyTopPick ? '#d97706' : '#d1d5db',
                            fontSize: '0.85rem',
                            minWidth: 'auto',
                            padding: '0.35rem 0.5rem',
                          }}
                        >
                          {isMyTopPick ? '⭐' : '☆'}
                        </button>
                      )}
                      {topPickCount > 0 && (
                        <span style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: 600, marginLeft: '0.25rem' }}>
                          ⭐ {topPickCount}
                        </span>
                      )}
                    </div>

                    {(() => {
                      const castVoters = votes.filter(([,v]) => v.vote && v.vote !== 'none');
                      const votedUids = new Set(castVoters.map(([uid]) => uid));
                      const missing = members.filter(([uid, m]) => {
                        if (votedUids.has(uid)) return false;
                        if (!(m?.name || '').trim()) return false;
                        // Plus-ones inherit their host's vote, so hide them when the host has voted on this option
                        if (m.plusOneOf && votedUids.has(m.plusOneOf)) return false;
                        return true;
                      });
                      if (castVoters.length === 0 && missing.length === 0) return null;
                      return (
                        <div className={styles.voterList}>
                          {castVoters.map(([uid, v]) => (
                            <span key={uid} className={styles[`voter_${v.vote}`]}>
                              {v.name?.split(' ')[0] || 'Guest'}{v.topPick ? ' ⭐' : ''}
                            </span>
                          ))}
                          {missing.map(([uid, m]) => (
                            <span key={uid} className={styles.voter_missing} title="Hasn't voted yet">
                              {(m.name || 'Guest').split(' ')[0]}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Other group date ranges — visible only after dates are finalized */}
      {isFinalized && (() => {
        const ranges = Array.isArray(altRanges) ? altRanges : [];
        if (ranges.length === 0 && !canManage) return null;
        const submit = async () => {
          const label = newRangeLabel.trim();
          if (!newRangeStart || !label || !onAddAltRange) return;
          await onAddAltRange({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label,
            startDate: newRangeStart,
            endDate: newRangeEnd || newRangeStart,
          });
          setShowAddRange(false);
          setNewRangeLabel('');
          setNewRangeStart('');
          setNewRangeEnd('');
        };
        return (
          <div className={styles.altRangeSection}>
            <div className={styles.closedSectionHeader}>
              Other group date ranges
            </div>
            {ranges.length > 0 && (
              <div className={styles.optionsList}>
                {ranges.map(r => {
                  const start = new Date(r.startDate + 'T00:00:00');
                  const end = new Date((r.endDate || r.startDate) + 'T00:00:00');
                  const isRange = r.endDate && r.endDate !== r.startDate;
                  const dayCount = isRange ? eachDayOfInterval({ start, end }).length : 1;
                  return (
                    <div key={r.id} className={styles.option}>
                      <div className={styles.optionHeader}>
                        <div className={styles.optionDates}>
                          <div className={styles.altRangeLabel}>{r.label}</div>
                          {isRange
                            ? <span className={styles.dateRange}>{format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')} <span className={styles.dayCount}>{dayCount} days</span></span>
                            : <span className={styles.singleDate}>{format(start, 'EEEE, MMM d, yyyy')}</span>}
                        </div>
                        {canManage && onRemoveAltRange && (
                          <button className={styles.deleteBtn} onClick={() => onRemoveAltRange(r.id)} title="Remove">×</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {canManage && !showAddRange && (
              <button
                onClick={() => setShowAddRange(true)}
                className={styles.altRangeAddBtn}
              >
                + Add another date range
              </button>
            )}
            {canManage && showAddRange && (
              <div className={styles.altRangeForm}>
                <input
                  type="text"
                  value={newRangeLabel}
                  onChange={e => setNewRangeLabel(e.target.value)}
                  placeholder="Group name (e.g. Sarah's family)"
                  className={styles.altRangeInput}
                />
                <div className={styles.altRangeFormRow}>
                  <input
                    type="date"
                    value={newRangeStart}
                    onChange={e => setNewRangeStart(e.target.value)}
                    className={styles.altRangeDateInput}
                  />
                  <input
                    type="date"
                    value={newRangeEnd}
                    min={newRangeStart}
                    onChange={e => setNewRangeEnd(e.target.value)}
                    className={styles.altRangeDateInput}
                  />
                  <button
                    onClick={submit}
                    disabled={!newRangeStart || !newRangeLabel.trim()}
                    className={styles.altRangeSubmit}
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowAddRange(false); setNewRangeLabel(''); setNewRangeStart(''); setNewRangeEnd(''); }}
                    className={styles.altRangeCancel}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Closed dates summary — compact list at the bottom */}
      {ranked.filter(o => o.closed).length > 0 && (
        <div className={styles.closedSection}>
          <div className={styles.closedSectionHeader}>
            Closed dates ({ranked.filter(o => o.closed).length})
          </div>
          <div className={styles.closedList}>
            {ranked.filter(o => o.closed).map(opt => {
              const start = new Date(opt.startDate + 'T00:00:00');
              const end = new Date((opt.endDate || opt.startDate) + 'T00:00:00');
              const isRange = opt.endDate && opt.endDate !== opt.startDate;
              const label = isRange
                ? `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
                : format(start, 'EEE, MMM d, yyyy');
              return (
                <div key={opt.id} className={styles.closedItem}>
                  <span className={styles.closedItemDate}>{label}</span>
                  {opt.note && <span className={styles.closedItemNote}> — {opt.note}</span>}
                  {opt.closedBy && <span className={styles.closedItemBy}> · closed by {opt.closedBy}</span>}
                  {canManage && (
                    <button
                      className={styles.closedItemReopen}
                      onClick={() => handleToggleClosed(opt.id, false)}
                      title={isFinalized ? 'Restore — make available again' : 'Reopen for voting'}
                    >
                      ↻ Reopen
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

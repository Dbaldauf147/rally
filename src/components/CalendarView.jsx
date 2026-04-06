import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEvents } from '../hooks/useEvents';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from 'date-fns';
import styles from './CalendarView.module.css';

export function CalendarView() {
  const { events } = useEvents();
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('google-cal-selected-multi') || '[]'); } catch { return []; }
  });
  const [showCalPicker, setShowCalPicker] = useState(false);

  // Check if Google is connected — auto-refresh if token expired but refresh token exists
  useEffect(() => {
    async function checkToken() {
      const token = localStorage.getItem('google-cal-token');
      const expiry = localStorage.getItem('google-cal-expiry');
      const refreshToken = localStorage.getItem('google-cal-refresh');

      if (token && (!expiry || Date.now() < Number(expiry))) {
        setGoogleConnected(true);
        return;
      }

      // Token expired — try to refresh
      if (refreshToken) {
        try {
          const res = await fetch(`/api/google-refresh?refreshToken=${encodeURIComponent(refreshToken)}`);
          const data = await res.json();
          if (data.accessToken) {
            localStorage.setItem('google-cal-token', data.accessToken);
            localStorage.setItem('google-cal-expiry', String(Date.now() + (data.expiresIn || 3600) * 1000));
            setGoogleConnected(true);
            return;
          }
        } catch {}
      }

      setGoogleConnected(false);
    }
    checkToken();
  }, []);

  // Listen for OAuth callback
  useEffect(() => {
    function handleMessage(e) {
      if (e.data?.type === 'google-auth-success') {
        localStorage.setItem('google-cal-token', e.data.accessToken);
        if (e.data.refreshToken) localStorage.setItem('google-cal-refresh', e.data.refreshToken);
        localStorage.setItem('google-cal-expiry', String(Date.now() + (e.data.expiresIn || 3600) * 1000));
        setGoogleConnected(true);
        // Fetch calendar list so user can pick
        fetchCalendarList(e.data.accessToken);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  async function fetchCalendarList(token) {
    try {
      const res = await fetch(`/api/google-calendars?accessToken=${encodeURIComponent(token || localStorage.getItem('google-cal-token'))}`);
      const data = await res.json();
      if (data.calendars) {
        setGoogleCalendars(data.calendars);
        // If no calendars selected yet, show picker
        if (selectedCalendarIds.length === 0) setShowCalPicker(true);
      }
    } catch {}
  }

  // Fetch calendar list on mount if connected
  useEffect(() => {
    if (googleConnected && googleCalendars.length === 0) {
      fetchCalendarList();
    }
  }, [googleConnected]);

  // Get a valid access token, refreshing if needed
  async function getValidToken() {
    let token = localStorage.getItem('google-cal-token');
    const expiry = localStorage.getItem('google-cal-expiry');
    const refreshToken = localStorage.getItem('google-cal-refresh');

    // If token is still valid (with 60s buffer), use it
    if (token && expiry && Date.now() < Number(expiry) - 60000) return token;

    // Try to refresh
    if (refreshToken) {
      try {
        const res = await fetch(`/api/google-refresh?refreshToken=${encodeURIComponent(refreshToken)}`);
        const data = await res.json();
        if (data.accessToken) {
          localStorage.setItem('google-cal-token', data.accessToken);
          localStorage.setItem('google-cal-expiry', String(Date.now() + (data.expiresIn || 3600) * 1000));
          setGoogleConnected(true);
          return data.accessToken;
        }
      } catch {}
    }

    // Refresh failed — disconnect
    setGoogleConnected(false);
    localStorage.removeItem('google-cal-token');
    localStorage.removeItem('google-cal-expiry');
    return null;
  }

  // Fetch Google Calendar events from ALL selected calendars for the current month
  const fetchGoogleEvents = useCallback(async () => {
    if (selectedCalendarIds.length === 0) return;
    const token = await getValidToken();
    if (!token) return;
    setLoadingGoogle(true);
    try {
      const mStart = startOfMonth(currentDate);
      const mEnd = endOfMonth(currentDate);
      const allEvents = [];
      for (const calId of selectedCalendarIds) {
        try {
          const res = await fetch(`/api/google-calendar?accessToken=${encodeURIComponent(token)}&timeMin=${mStart.toISOString()}&timeMax=${mEnd.toISOString()}&calendarId=${encodeURIComponent(calId)}`);
          const data = await res.json();
          if (data.needsAuth) {
            const newToken = await getValidToken();
            if (newToken) {
              const retry = await fetch(`/api/google-calendar?accessToken=${encodeURIComponent(newToken)}&timeMin=${mStart.toISOString()}&timeMax=${mEnd.toISOString()}&calendarId=${encodeURIComponent(calId)}`);
              const retryData = await retry.json();
              if (retryData.events) allEvents.push(...retryData.events);
            } else {
              setGoogleConnected(false);
              localStorage.removeItem('google-cal-token');
              break;
            }
          } else if (data.events) {
            // Tag each event with its calendar info
            const cal = googleCalendars.find(c => c.id === calId);
            const tagged = data.events.map(e => ({ ...e, _calColor: cal?.color, _calName: cal?.name }));
            allEvents.push(...tagged);
          }
        } catch {}
      }
      setGoogleEvents(allEvents);
    } catch {}
    setLoadingGoogle(false);
  }, [currentDate, selectedCalendarIds, googleCalendars]);

  useEffect(() => {
    if (googleConnected && selectedCalendarIds.length > 0) fetchGoogleEvents();
  }, [googleConnected, selectedCalendarIds, fetchGoogleEvents]);

  function connectGoogle() {
    window.open('/api/google-auth', 'google-auth', 'width=500,height=700,left=200,top=100');
  }

  function disconnectGoogle() {
    localStorage.removeItem('google-cal-token');
    localStorage.removeItem('google-cal-refresh');
    localStorage.removeItem('google-cal-expiry');
    localStorage.removeItem('google-cal-selected-multi');
    setGoogleConnected(false);
    setSelectedCalendarIds([]);
    setGoogleEvents([]);
    setGoogleCalendars([]);
    setSelectedCalendarId('');
  }

  const mStart = startOfMonth(currentDate);
  const mEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: mStart, end: mEnd });
  const startPadding = getDay(mStart);

  // Fill in overlap days
  const calStart = new Date(mStart);
  calStart.setDate(calStart.getDate() - startPadding);
  const calDays = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(calStart);
    d.setDate(d.getDate() + i);
    calDays.push(d);
  }
  // Trim if last row is entirely next month
  const lastRow = calDays.slice(-7);
  const trimmed = lastRow.every(d => d.getMonth() !== currentDate.getMonth()) ? calDays.slice(0, -7) : calDays;

  function getRallyEventsForDay(day) {
    return events.filter(e => {
      const d = e.date?.toDate ? e.date.toDate() : new Date(e.date);
      return isSameDay(d, day);
    });
  }

  function getGoogleEventsForDay(day) {
    return googleEvents.filter(e => {
      const d = new Date(e.start);
      return isSameDay(d, day);
    });
  }

  function prevMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.header}>
          <button className={styles.navBtn} onClick={prevMonth}>‹</button>
          <h2 className={styles.monthTitle}>{format(currentDate, 'MMMM yyyy')}</h2>
          <button className={styles.navBtn} onClick={nextMonth}>›</button>
        </div>
        <div className={styles.googleBar}>
          {googleConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-success)', fontWeight: 500 }}>
                {selectedCalendarIds.length > 0 ? `${selectedCalendarIds.length} calendar${selectedCalendarIds.length !== 1 ? 's' : ''} synced` : 'Google Calendar connected'}
              </span>
              {loadingGoogle && <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>Syncing...</span>}
              <button onClick={() => { fetchCalendarList(); setShowCalPicker(true); }} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>Manage Calendars</button>
              <button onClick={fetchGoogleEvents} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>Refresh</button>
              <button onClick={disconnectGoogle} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>Disconnect</button>
            </div>
          ) : (
            <button onClick={connectGoogle} style={{ padding: '0.35rem 0.85rem', border: '1px solid #4285F4', borderRadius: '6px', background: '#EEF3FF', color: '#4285F4', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <svg width="14" height="14" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Connect Google Calendar
            </button>
          )}
        </div>
      </div>

      <div className={styles.grid}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className={styles.dayLabel}>{d}</div>
        ))}
        {trimmed.map(day => {
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const rallyEvts = getRallyEventsForDay(day);
          const googleEvts = getGoogleEventsForDay(day);
          const allEvents = [...rallyEvts.map(e => ({ ...e, source: 'rally' })), ...googleEvts.map(e => ({ ...e, source: 'google' }))];
          return (
            <div key={day.toISOString()} className={`${styles.cell} ${isToday(day) ? styles.cellToday : ''} ${!isCurrentMonth ? styles.cellOther : ''}`}>
              <span className={styles.dayNum}>{format(day, 'd')}</span>
              {allEvents.slice(0, 3).map((e, i) => (
                e.source === 'rally' ? (
                  <button key={e.id} className={styles.eventChip} onClick={() => navigate(`/event/${e.id}`)}>
                    {e.title}
                  </button>
                ) : (
                  <a key={e.id || i} className={styles.googleChip} href={e.htmlLink} target="_blank" rel="noopener noreferrer" title={e.title}>
                    {e.title}
                  </a>
                )
              ))}
              {allEvents.length > 3 && <span className={styles.moreCount}>+{allEvents.length - 3} more</span>}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--color-accent)' }} /> Rally Events</span>
        {googleConnected && <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#4285F4' }} /> Google Calendar</span>}
      </div>

      {/* Calendar picker modal */}
      {showCalPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', maxWidth: '400px', width: '100%', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Choose Calendars</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>Select which Google Calendars to sync. Events from all selected calendars will appear on your calendar.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '300px', overflowY: 'auto' }}>
              {googleCalendars.map(cal => {
                const isSelected = selectedCalendarIds.includes(cal.id);
                return (
                <label
                  key={cal.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.75rem',
                    border: isSelected ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                    borderRadius: '8px', background: isSelected ? 'var(--color-accent-light)' : 'var(--color-surface)',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%', boxSizing: 'border-box',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {
                      setSelectedCalendarIds(prev => {
                        const next = isSelected ? prev.filter(id => id !== cal.id) : [...prev, cal.id];
                        localStorage.setItem('google-cal-selected-multi', JSON.stringify(next));
                        return next;
                      });
                    }}
                    style={{ accentColor: 'var(--color-accent)', width: '16px', height: '16px' }}
                  />
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: cal.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--color-text)', flex: 1 }}>{cal.name}</span>
                  {cal.primary && <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>Primary</span>}
                </label>
                );
              })}
              {googleCalendars.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>Loading calendars...</p>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button onClick={() => setShowCalPicker(false)} style={{ flex: 1, padding: '0.55rem', border: 'none', borderRadius: '8px', background: 'var(--color-accent)', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Done ({selectedCalendarIds.length} selected)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

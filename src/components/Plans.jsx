import { useState, useEffect, useCallback } from 'react';
import { format, startOfWeek, addDays, addWeeks, eachDayOfInterval, isSameDay } from 'date-fns';
import styles from './Plans.module.css';

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getValidGoogleToken() {
  const token = localStorage.getItem('google-cal-token');
  const expiry = Number(localStorage.getItem('google-cal-expiry') || 0);
  if (token && Date.now() < expiry - 60_000) return token;
  const refreshToken = localStorage.getItem('google-cal-refresh');
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

export function Plans() {
  const [googleConnected, setGoogleConnected] = useState(() => !!localStorage.getItem('google-cal-token'));
  const [calendars, setCalendars] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('google-cal-selected-multi') || '[]'); } catch { return []; }
  });
  const [showCalPicker, setShowCalPicker] = useState(false);
  const [eventsByDay, setEventsByDay] = useState({}); // { 'YYYY-MM-DD': [{ title, time, calColor }] }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Compute the two weeks (Monday-anchored)
  const today = new Date();
  const week1Start = startOfWeek(today, { weekStartsOn: 1 });
  const week2Start = addWeeks(week1Start, 1);
  const week2End = addDays(week2Start, 6);
  const week1Days = eachDayOfInterval({ start: week1Start, end: addDays(week1Start, 6) });
  const week2Days = eachDayOfInterval({ start: week2Start, end: week2End });

  // Persist calendar selection
  useEffect(() => {
    localStorage.setItem('google-cal-selected-multi', JSON.stringify(selectedIds));
  }, [selectedIds]);

  // Listen for OAuth popup callback so connecting refreshes state without a reload
  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'google-auth-success') {
        localStorage.setItem('google-cal-token', e.data.accessToken);
        if (e.data.refreshToken) localStorage.setItem('google-cal-refresh', e.data.refreshToken);
        localStorage.setItem('google-cal-expiry', String(Date.now() + (e.data.expiresIn || 3600) * 1000));
        setGoogleConnected(true);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Load the user's calendar list when connected
  const fetchCalendars = useCallback(async () => {
    const token = await getValidGoogleToken();
    if (!token) { setGoogleConnected(false); return; }
    setGoogleConnected(true);
    try {
      const res = await fetch(`/api/google-calendars?accessToken=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (data.needsAuth) { setGoogleConnected(false); return; }
      if (data.calendars) {
        setCalendars(data.calendars);
        if (selectedIds.length === 0) setShowCalPicker(true);
      }
    } catch {}
  }, [selectedIds.length]);

  useEffect(() => {
    if (googleConnected) fetchCalendars();
  }, [googleConnected, fetchCalendars]);

  // Fetch events across the 14-day window for every selected calendar
  const fetchEvents = useCallback(async () => {
    if (selectedIds.length === 0) { setEventsByDay({}); return; }
    const token = await getValidGoogleToken();
    if (!token) { setGoogleConnected(false); return; }

    setLoading(true);
    setError('');
    const map = {};
    const colorById = Object.fromEntries(calendars.map(c => [c.id, c.color]));

    try {
      const timeMin = new Date(week1Start.getFullYear(), week1Start.getMonth(), week1Start.getDate(), 0, 0, 0).toISOString();
      const timeMax = new Date(week2End.getFullYear(), week2End.getMonth(), week2End.getDate(), 23, 59, 59).toISOString();
      for (const calId of selectedIds) {
        try {
          const res = await fetch(`/api/google-calendar?accessToken=${encodeURIComponent(token)}&timeMin=${timeMin}&timeMax=${timeMax}&calendarId=${encodeURIComponent(calId)}`);
          const data = await res.json();
          if (data.needsAuth) { setGoogleConnected(false); continue; }
          if (!data.events) continue;
          for (const evt of data.events) {
            const start = new Date(evt.start);
            const end = new Date(evt.end || evt.start);
            const days = evt.allDay
              ? eachDayOfInterval({ start, end: new Date(end.getTime() - 86400000) })
              : [start];
            for (const d of days) {
              const ds = toDateStr(d);
              if (!map[ds]) map[ds] = [];
              // Dedupe: same title + same start time on the same day = same event
              // appearing on multiple selected calendars (or imported twice).
              const dedupeKey = `${(evt.title || '').trim().toLowerCase()}|${evt.allDay ? 'allday' : start.getTime()}`;
              if (map[ds].some(e => e._key === dedupeKey)) continue;
              map[ds].push({
                _key: dedupeKey,
                title: evt.title,
                time: evt.allDay ? '' : format(start, 'h:mm a'),
                color: colorById[calId] || '#4285F4',
                allDay: evt.allDay,
                rawStart: start.getTime(),
              });
            }
          }
        } catch (err) {
          setError(err.message || 'Failed to load one of the calendars.');
        }
      }
      // Sort each day's events: all-day first, then by start time
      for (const ds of Object.keys(map)) {
        map[ds].sort((a, b) => {
          if (a.allDay && !b.allDay) return -1;
          if (!a.allDay && b.allDay) return 1;
          return a.rawStart - b.rawStart;
        });
      }
      setEventsByDay(map);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(','), calendars.length]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  function toggleCalendar(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function connect() {
    window.open('/api/google-auth', 'google-auth', 'width=500,height=700,left=200,top=100');
  }

  function disconnect() {
    localStorage.removeItem('google-cal-token');
    localStorage.removeItem('google-cal-refresh');
    localStorage.removeItem('google-cal-expiry');
    setGoogleConnected(false);
    setCalendars([]);
    setEventsByDay({});
  }

  function renderCell(day) {
    const ds = toDateStr(day);
    const items = eventsByDay[ds] || [];
    if (items.length === 0) return <span className={styles.empty}>—</span>;
    return items.map((evt, i) => (
      <span key={i} className={styles.eventLine} title={evt.title}>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: evt.color, marginRight: 6, verticalAlign: 'middle' }} />
        {evt.time && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem', marginRight: 4 }}>{evt.time}</span>}
        {evt.title}
      </span>
    ));
  }

  const weekdayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Plans</h1>
          <p className={styles.subtitle}>
            {format(week1Start, 'MMM d')} – {format(week2End, 'MMM d, yyyy')}
            {selectedIds.length > 0 && ` · ${selectedIds.length} calendar${selectedIds.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className={styles.controls}>
          {googleConnected && (
            <>
              <button className={styles.btn} onClick={() => setShowCalPicker(v => !v)}>
                {showCalPicker ? 'Hide calendars' : 'Choose calendars'}
              </button>
              <button className={styles.btn} onClick={fetchEvents} disabled={loading}>
                {loading ? 'Refreshing…' : '↻ Refresh'}
              </button>
              <button className={styles.btn} onClick={disconnect} title="Disconnect Google">Disconnect</button>
            </>
          )}
        </div>
      </div>

      {!googleConnected && (
        <div className={styles.connectCard}>
          <h2 className={styles.connectTitle}>Connect Google Calendar</h2>
          <p className={styles.connectDesc}>Pick the calendars you want to combine into a single two-week view.</p>
          <button className={styles.btnPrimary} onClick={connect}>Connect Google Calendar</button>
        </div>
      )}

      {googleConnected && showCalPicker && (
        <div className={styles.calPickerCard}>
          <div className={styles.calPickerHeader}>
            <h3 className={styles.calPickerTitle}>Choose calendars to combine</h3>
            <button className={styles.calPickerClose} onClick={() => setShowCalPicker(false)} aria-label="Close">×</button>
          </div>
          {calendars.length === 0
            ? <p className={styles.empty}>Loading your calendars…</p>
            : (
              <div className={styles.calList}>
                {calendars.map(c => (
                  <label key={c.id} className={styles.calRow}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(c.id)}
                      onChange={() => toggleCalendar(c.id)}
                    />
                    <span className={styles.calColor} style={{ background: c.color }} />
                    <span className={styles.calName}>{c.name}</span>
                    {c.primary && <span className={styles.calBadge}>Primary</span>}
                  </label>
                ))}
              </div>
            )}
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {googleConnected && selectedIds.length === 0 && !showCalPicker && (
        <div className={styles.connectCard}>
          <h2 className={styles.connectTitle}>No calendars selected</h2>
          <p className={styles.connectDesc}>Pick one or more calendars to populate this view.</p>
          <button className={styles.btnPrimary} onClick={() => setShowCalPicker(true)}>Choose calendars</button>
        </div>
      )}

      {googleConnected && selectedIds.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Weekday</th>
              <th>This Week</th>
              <th>Next Week</th>
            </tr>
          </thead>
          <tbody>
            {weekdayLabels.map((label, i) => {
              const w1 = week1Days[i];
              const w2 = week2Days[i];
              const w1IsToday = isSameDay(w1, today);
              const w2IsToday = isSameDay(w2, today);
              return (
                <tr key={label} className={(w1IsToday || w2IsToday) ? styles.todayRow : ''}>
                  <td className={styles.weekdayCell}>
                    {label}
                    <span className={styles.dateLabel}>
                      {format(w1, 'MMM d')} / {format(w2, 'MMM d')}
                    </span>
                  </td>
                  <td className={styles.eventCell}>{renderCell(w1)}</td>
                  <td className={styles.eventCell}>{renderCell(w2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

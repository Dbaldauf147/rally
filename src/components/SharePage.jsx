import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEvents } from '../hooks/useEvents';
import styles from './SharePage.module.css';

const INSTAGRAM_URL_RE = /https?:\/\/(?:www\.)?instagram\.com\/[^\s]+/i;

function extractInstagramUrl({ url, text }) {
  const candidates = [url, text].filter(Boolean);
  for (const c of candidates) {
    const m = c.match(INSTAGRAM_URL_RE);
    if (m) return m[0];
  }
  return '';
}

function normalizeInstagramUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return raw;
    return `https://www.instagram.com${u.pathname.replace(/\/+$/, '')}/`;
  } catch {
    return raw;
  }
}

function isInstagramUrl(raw) {
  try {
    const u = new URL(raw);
    return /(^|\.)instagram\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function toDateObj(d) {
  if (!d) return null;
  const x = d?.toDate ? d.toDate() : new Date(d);
  return isNaN(x) ? null : x;
}

// Local YYYY-MM-DD key — must match how Itinerary keys its Daily view days so a
// saved activity's `date` lands on the right day.
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Enumerate an event's trip days (start..end inclusive), skipping any the owner
// hid in the Daily view, so a shared video can be tied to a real day.
function eventDayOptions(event) {
  const start = toDateObj(event?.startDate || event?.date);
  if (!start) return [];
  const end = toDateObj(event?.endDate) || start;
  const s = new Date(start); s.setHours(0, 0, 0, 0);
  const e = new Date(end); e.setHours(0, 0, 0, 0);
  if (e < s) return [];
  const hidden = new Set(Array.isArray(event?.hiddenDailyKeys) ? event.hiddenDailyKeys : []);
  const out = [];
  const cur = new Date(s);
  let n = 1; // counts every day so visible days keep their true trip-day number
  while (cur <= e) {
    const key = dayKey(cur);
    if (!hidden.has(key)) {
      out.push({ key, label: `Day ${n} · ${cur.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` });
    }
    cur.setDate(cur.getDate() + 1);
    n += 1;
  }
  return out;
}

export function SharePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { events, loading: eventsLoading, updateEvent } = useEvents();
  const [searchParams] = useSearchParams();

  const incoming = useMemo(() => ({
    url: searchParams.get('url') || '',
    text: searchParams.get('text') || '',
    title: searchParams.get('title') || '',
  }), [searchParams]);

  const detected = extractInstagramUrl(incoming);
  const [videoUrl, setVideoUrl] = useState(detected);
  const [videoTitle, setVideoTitle] = useState(incoming.title || '');
  const [eventId, setEventId] = useState('');
  const [videoDate, setVideoDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedEvent = useMemo(() => events.find(e => e.id === eventId), [events, eventId]);
  const dayOptions = useMemo(() => eventDayOptions(selectedEvent), [selectedEvent]);

  // Re-sync if the share params arrive after first render.
  useEffect(() => {
    if (!videoUrl && detected) setVideoUrl(detected);
    if (!videoTitle && incoming.title) setVideoTitle(incoming.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, incoming.title]);

  // Default the dropdown to the most recently updated event the user can edit.
  useEffect(() => {
    if (eventId || !user || events.length === 0) return;
    const editable = events
      .filter(e => e.createdBy === user.uid || e.members?.[user.uid]?.role === 'owner' || e.members?.[user.uid]?.role === 'editor')
      .sort((a, b) => {
        const ad = a.updatedAt?.toDate?.() || 0;
        const bd = b.updatedAt?.toDate?.() || 0;
        return bd - ad;
      });
    if (editable.length > 0) setEventId(editable[0].id);
  }, [user, events, eventId]);

  // When the chosen event changes, default the day to its first trip day so the
  // video shows up on the Daily view by default; the user can switch days or
  // choose "No specific day".
  useEffect(() => {
    setVideoDate(dayOptions[0]?.key || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (authLoading) {
    return <div className={styles.page}><div className={styles.card}>Loading…</div></div>;
  }

  if (!user) {
    const here = `${window.location.pathname}${window.location.search}`;
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Sign in to save this video</h1>
          <p className={styles.body}>You need to be signed in to add videos to a Rally event.</p>
          <button
            className={styles.primaryBtn}
            onClick={() => navigate(`/login?redirect=${encodeURIComponent(here)}`)}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  async function save() {
    setError('');
    const url = videoUrl.trim();
    if (!url) { setError('Paste an Instagram link.'); return; }
    if (!isInstagramUrl(url)) { setError("That doesn't look like an Instagram link."); return; }
    if (!eventId) { setError('Pick an event to save it to.'); return; }
    const event = events.find(e => e.id === eventId);
    if (!event) { setError('That event is no longer available.'); return; }
    setSaving(true);
    try {
      // Save the reel as a real itinerary activity so it shows up with an
      // embedded player — matching the in-app "Add from Instagram" flow. With a
      // day chosen it lands on that day in the Daily view; left blank it shows
      // under "Unscheduled". Writing to a separate bucket wouldn't surface.
      const existing = Array.isArray(event.itinerary) ? event.itinerary : [];
      const newItem = {
        id: crypto.randomUUID(),
        title: videoTitle.trim() || 'Instagram reel',
        date: videoDate || '',
        time: '',
        location: '',
        notes: '',
        type: 'activity',
        url: normalizeInstagramUrl(url),
        highlightIds: [],
        isFlight: false,
        arrivalTime: '',
        airline: '',
        flightNumber: '',
        cost: '',
        source: 'instagram-share',
        addedByUid: user.uid,
        addedByName: event.members?.[user.uid]?.name || user.displayName || user.email || 'Member',
      };
      await updateEvent(eventId, { itinerary: [...existing, newItem] });
      navigate(`/event/${eventId}?tab=itinerary`);
    } catch (e) {
      setError(e.message || 'Failed to save the video.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Save video to a Rally event</h1>

        <label className={styles.label}>
          Instagram link
          <input
            type="url"
            inputMode="url"
            className={styles.input}
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            placeholder="https://www.instagram.com/reel/..."
          />
        </label>

        <label className={styles.label}>
          Name
          <input
            type="text"
            className={styles.input}
            value={videoTitle}
            onChange={e => setVideoTitle(e.target.value)}
            placeholder="e.g., Best ramen in Tokyo"
          />
        </label>

        <label className={styles.label}>
          Event
          {eventsLoading ? (
            <div className={styles.eventLoading}>Loading your events…</div>
          ) : events.length === 0 ? (
            <div className={styles.eventEmpty}>You don't have any events yet. Create one first.</div>
          ) : (
            <select
              className={styles.input}
              value={eventId}
              onChange={e => setEventId(e.target.value)}
            >
              <option value="">— Pick an event —</option>
              {events.map(e => (
                <option key={e.id} value={e.id}>{e.title || 'Untitled event'}</option>
              ))}
            </select>
          )}
        </label>

        {eventId && (
          <label className={styles.label}>
            Day
            {dayOptions.length > 0 ? (
              <select
                className={styles.input}
                value={videoDate}
                onChange={e => setVideoDate(e.target.value)}
              >
                <option value="">No specific day (Unscheduled)</option>
                {dayOptions.map(d => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type="date"
                  className={styles.input}
                  value={videoDate}
                  onChange={e => setVideoDate(e.target.value)}
                />
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  This event has no set dates yet — pick a day, or leave blank to add it as unscheduled.
                </span>
              </>
            )}
          </label>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => navigate('/')}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={save}
            disabled={saving || !videoUrl.trim() || !eventId}
          >
            {saving ? 'Saving…' : 'Save to event'}
          </button>
        </div>
      </div>
    </div>
  );
}

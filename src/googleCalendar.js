// Google Calendar write integration. Reuses the OAuth tokens stored in localStorage
// by the existing CalendarView flow (/api/google-auth + /api/google-callback +
// /api/google-refresh). The Google OAuth client must include both
// calendar.readonly (for the calendar list view) and calendar.events (for writes).

const TOKEN_KEY = 'google-cal-token';
const REFRESH_KEY = 'google-cal-refresh';
const EXPIRY_KEY = 'google-cal-expiry';
const TARGET_ID_KEY = 'google-cal-sync-target-id';
const TARGET_NAME_KEY = 'google-cal-sync-target-name';
const AUTO_SYNC_KEY = 'google-cal-auto-sync';

export function getSyncTargetCalendar() {
  const id = localStorage.getItem(TARGET_ID_KEY) || 'primary';
  const name = localStorage.getItem(TARGET_NAME_KEY) || 'Primary calendar';
  return { id, name };
}

export function setSyncTargetCalendar(id, name) {
  localStorage.setItem(TARGET_ID_KEY, id);
  localStorage.setItem(TARGET_NAME_KEY, name);
}

export function getAutoSyncEnabled() {
  return localStorage.getItem(AUTO_SYNC_KEY) === '1';
}

export function setAutoSyncEnabled(enabled) {
  if (enabled) localStorage.setItem(AUTO_SYNC_KEY, '1');
  else localStorage.removeItem(AUTO_SYNC_KEY);
}

// Mirrors EventDetail's calStart/calEnd computation so manual and auto-sync
// produce the same timing. If the event's itinerary has timed activities,
// span from the earliest to the latest. Otherwise fall back to noon + 1h
// (which buildCalendarPayload turns into an all-day entry).
export function computeCalRange(event) {
  const date = event.date?.toDate?.() || (event.date ? new Date(event.date) : null);
  const endDate = event.endDate?.toDate?.() || (event.endDate ? new Date(event.endDate) : null);
  if (!date || isNaN(date.getTime())) return null;

  const items = (Array.isArray(event.itinerary) ? event.itinerary : [])
    .filter(it => (it.type || 'activity') !== 'travel' && it.date && it.time);
  const toDate = (it) => {
    const t = /^\d{1,2}:\d{2}$/.test(it.time) ? `${it.time}:00` : it.time;
    const d = new Date(`${it.date}T${t}`);
    return isNaN(d.getTime()) ? null : d;
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
}

export function isGoogleCalendarConnected() {
  return !!localStorage.getItem(TOKEN_KEY) || !!localStorage.getItem(REFRESH_KEY);
}

// Open the Google OAuth popup and resolve once the access token comes back via postMessage.
export function connectGoogleCalendar() {
  return new Promise((resolve, reject) => {
    const popup = window.open(
      '/api/google-auth',
      'google-auth',
      'width=500,height=700,left=200,top=100',
    );
    if (!popup) {
      reject(new Error('Popup blocked. Allow popups for this site and try again.'));
      return;
    }
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
    };
    const onMessage = (e) => {
      if (e.data?.type === 'google-auth-success') {
        localStorage.setItem(TOKEN_KEY, e.data.accessToken);
        if (e.data.refreshToken) localStorage.setItem(REFRESH_KEY, e.data.refreshToken);
        localStorage.setItem(EXPIRY_KEY, String(Date.now() + (e.data.expiresIn || 3600) * 1000));
        cleanup();
        resolve();
      } else if (e.data?.type === 'google-auth-error') {
        cleanup();
        reject(new Error(e.data.error || 'Google sign-in failed'));
      }
    };
    window.addEventListener('message', onMessage);
    // If the user closes the popup without completing, reject.
    const closedTimer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('Google sign-in was cancelled'));
      }
    }, 500);
  });
}

async function getValidToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = Number(localStorage.getItem(EXPIRY_KEY) || 0);
  if (token && Date.now() < expiry - 60_000) return token;

  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    const res = await fetch(`/api/google-refresh?refreshToken=${encodeURIComponent(refreshToken)}`);
    const data = await res.json();
    if (data.accessToken) {
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(EXPIRY_KEY, String(Date.now() + (data.expiresIn || 3600) * 1000));
      return data.accessToken;
    }
  }

  return null;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildCalendarPayload({ event, calStart, calEnd, description }) {
  // The EventDetail fallback is "noon local + 1 hour" when no itinerary times exist —
  // treat that signature as an all-day event so it shows on the right day(s).
  const isNoonHourFallback =
    calStart.getHours() === 12 &&
    calStart.getMinutes() === 0 &&
    calEnd.getTime() - calStart.getTime() === 3_600_000;

  const payload = {
    summary: event.title || 'Rally event',
    location: event.location || undefined,
    description: description || undefined,
  };

  if (isNoonHourFallback) {
    const endSource =
      event.endDate?.toDate?.() ||
      (event.endDate ? new Date(event.endDate) : null);
    const endInclusive = endSource && endSource > calStart ? endSource : calStart;
    const endExclusive = new Date(endInclusive);
    endExclusive.setDate(endExclusive.getDate() + 1);
    payload.start = { date: ymd(calStart) };
    payload.end = { date: ymd(endExclusive) };
  } else {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    payload.start = { dateTime: calStart.toISOString(), timeZone: tz };
    payload.end = { dateTime: calEnd.toISOString(), timeZone: tz };
  }
  return payload;
}

async function callCalendar(method, path, body) {
  const token = await getValidToken();
  if (!token) {
    const err = new Error('Not connected to Google Calendar');
    err.code = 'NOT_CONNECTED';
    throw err;
  }
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // Token rejected — clear it so the next attempt forces a reconnect.
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    const err = new Error('Google Calendar session expired — reconnect to continue');
    err.code = 'NOT_CONNECTED';
    throw err;
  }
  if (res.status === 403) {
    const text = await res.text();
    if (text.includes('insufficient') || text.includes('Insufficient')) {
      // Old token only has read scope; force re-consent.
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      const err = new Error('Reconnect Google Calendar to grant write access');
      err.code = 'NOT_CONNECTED';
      throw err;
    }
    throw new Error(`Google Calendar ${method} failed (403): ${text}`);
  }
  if (res.status === 404 || res.status === 410) return { __missing: true };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar ${method} ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function listGoogleCalendars() {
  const token = await getValidToken();
  if (!token) {
    const err = new Error('Not connected to Google Calendar');
    err.code = 'NOT_CONNECTED';
    throw err;
  }
  const res = await fetch(`/api/google-calendars?accessToken=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (data.needsAuth) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    const err = new Error('Google Calendar session expired — reconnect to continue');
    err.code = 'NOT_CONNECTED';
    throw err;
  }
  if (!data.calendars) throw new Error(data.error || 'Failed to list calendars');
  // Only calendars the user can write to are valid sync targets.
  return data.calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
}

export async function syncEventToGoogleCalendar({ event, googleEventId, calStart, calEnd, description, calendarId = 'primary' }) {
  const payload = buildCalendarPayload({ event, calStart, calEnd, description });
  const targetId = encodeURIComponent(calendarId);

  if (googleEventId) {
    const updated = await callCalendar(
      'PATCH',
      `/calendars/${targetId}/events/${encodeURIComponent(googleEventId)}`,
      payload,
    );
    if (updated && !updated.__missing) return updated.id;
    // Fall through: the previously-synced event is gone — recreate it.
  }

  const created = await callCalendar('POST', `/calendars/${targetId}/events`, payload);
  return created.id;
}

export async function removeEventFromGoogleCalendar(googleEventId, calendarId = 'primary') {
  if (!googleEventId) return;
  await callCalendar(
    'DELETE',
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
  );
}

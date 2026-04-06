// Fetches events from Google Calendar
export default async function handler(req, res) {
  const { accessToken, timeMin, timeMax, calendarId } = req.query;
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });

  const calendar = calendarId || 'primary';
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });
  if (timeMin) params.set('timeMin', timeMin);
  if (timeMax) params.set('timeMax', timeMax);

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 401) return res.status(200).json({ needsAuth: true });
      return res.status(response.status).json({ error: err.error?.message || `HTTP ${response.status}` });
    }
    const data = await response.json();
    const events = (data.items || []).map(e => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      location: e.location || '',
      description: e.description || '',
      allDay: !!e.start?.date,
      htmlLink: e.htmlLink || '',
    }));
    return res.json({ events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

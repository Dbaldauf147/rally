// Fetches the user's list of Google Calendars
export default async function handler(req, res) {
  const { accessToken } = req.query;
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });

  try {
    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      if (response.status === 401) return res.json({ needsAuth: true });
      return res.status(response.status).json({ error: `HTTP ${response.status}` });
    }
    const data = await response.json();
    const calendars = (data.items || []).map(c => ({
      id: c.id,
      name: c.summary || c.id,
      color: c.backgroundColor || '#4285F4',
      primary: c.primary || false,
    }));
    return res.json({ calendars });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

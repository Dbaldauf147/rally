// Generates an .ics calendar file for an event
export default function handler(req, res) {
  const { title, start, end, location, description, url } = req.query;
  if (!title || !start) return res.status(400).send('Missing title or start');

  const formatICS = (dateStr) => {
    const d = new Date(dateStr);
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const startICS = formatICS(start);
  const endICS = end ? formatICS(end) : formatICS(new Date(new Date(start).getTime() + 3600000).toISOString());
  const now = formatICS(new Date().toISOString());

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rally//Event//EN',
    'BEGIN:VEVENT',
    `DTSTART:${startICS}`,
    `DTEND:${endICS}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${(title || '').replace(/[,;\\]/g, ' ')}`,
    location ? `LOCATION:${location.replace(/[,;\\]/g, ' ')}` : '',
    description ? `DESCRIPTION:${description.replace(/\n/g, '\\n').replace(/[,;\\]/g, ' ')}` : '',
    url ? `URL:${url}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${(title || 'event').replace(/[^a-zA-Z0-9 ]/g, '')}.ics"`);
  res.status(200).send(ics);
}

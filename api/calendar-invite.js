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

  // ICS text escaping per RFC 5545: backslash first, then semicolon/comma, then newlines.
  const escICS = (s) => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

  // Fold long lines to 75 octets per RFC 5545, continuation lines prefixed by a space.
  const foldLine = (line) => {
    if (line.length <= 75) return line;
    const parts = [];
    let i = 0;
    parts.push(line.slice(0, 75));
    i = 75;
    while (i < line.length) {
      parts.push(' ' + line.slice(i, i + 74));
      i += 74;
    }
    return parts.join('\r\n');
  };

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rally//Event//EN',
    'BEGIN:VEVENT',
    `DTSTART:${startICS}`,
    `DTEND:${endICS}`,
    `DTSTAMP:${now}`,
    foldLine(`SUMMARY:${escICS(title || '')}`),
    location ? foldLine(`LOCATION:${escICS(location)}`) : '',
    description ? foldLine(`DESCRIPTION:${escICS(description)}`) : '',
    url ? foldLine(`URL:${url}`) : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${(title || 'event').replace(/[^a-zA-Z0-9 ]/g, '')}.ics"`);
  res.status(200).send(ics);
}

// Sends an HTML itinerary email to a list of attendees via Resend.
// Body shape:
// {
//   recipients: [{ name, email }],
//   fromName: string,
//   event: { title, date, location, description, link },
//   itinerary: [...items],
//   savedVideos: [{ title, url }],
//   tripHighlights: [{ text, url, locked }]
// }

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(t) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
}

function formatDateHeader(ymd) {
  try {
    const d = new Date(ymd + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch { return ymd; }
}

function buildItineraryHtml(itinerary) {
  const items = (Array.isArray(itinerary) ? itinerary : [])
    .filter(it => (it.type || 'activity') !== 'travel');
  if (items.length === 0) return '';
  const sorted = [...items].sort((a, b) => {
    const ka = `${a.date || ''} ${a.time || ''}`;
    const kb = `${b.date || ''} ${b.time || ''}`;
    return ka.localeCompare(kb);
  });
  const byDate = new Map();
  const undated = [];
  for (const it of sorted) {
    if (!it.date) { undated.push(it); continue; }
    if (!byDate.has(it.date)) byDate.set(it.date, []);
    byDate.get(it.date).push(it);
  }
  const renderItem = (it) => {
    const time = formatTime(it.time);
    const title = escapeHtml(it.title || '(untitled)');
    const titleNode = it.url
      ? `<a href="${escapeHtml(it.url)}" style="color:#4f46e5;text-decoration:none;">${title}</a>`
      : `<strong>${title}</strong>`;
    const timeNode = time ? `<span style="color:#525252;">${escapeHtml(time)}</span> · ` : '';
    const locationNode = it.location
      ? `<div style="color:#6b7280;font-size:0.85rem;margin-top:0.15rem;">📍 ${escapeHtml(it.location)}</div>`
      : '';
    const notesNode = it.notes
      ? `<div style="color:#525252;font-size:0.85rem;margin-top:0.2rem;white-space:pre-wrap;">${escapeHtml(it.notes)}</div>`
      : '';
    return `
      <li style="margin:0 0 0.65rem;padding:0.6rem 0.75rem;background:#fff;border:1px solid #e7e5e4;border-radius:8px;list-style:none;">
        <div>${timeNode}${titleNode}</div>
        ${locationNode}
        ${notesNode}
      </li>`;
  };
  const sections = [];
  for (const [ymd, list] of byDate) {
    sections.push(`
      <h3 style="font-size:1rem;color:#111;margin:1.25rem 0 0.5rem;border-bottom:2px solid #e9e1fb;padding-bottom:0.3rem;">${escapeHtml(formatDateHeader(ymd))}</h3>
      <ul style="padding:0;margin:0;">${list.map(renderItem).join('')}</ul>`);
  }
  if (undated.length) {
    sections.push(`
      <h3 style="font-size:1rem;color:#6b7280;margin:1.25rem 0 0.5rem;">TBD</h3>
      <ul style="padding:0;margin:0;">${undated.map(renderItem).join('')}</ul>`);
  }
  return sections.join('');
}

function getHighlightUrls(h) {
  if (Array.isArray(h?.urls) && h.urls.length > 0) return h.urls.filter(Boolean);
  if (h?.url) return [h.url];
  return [];
}

function buildHighlightsHtml(highlights) {
  const list = Array.isArray(highlights) ? highlights : [];
  if (list.length === 0) return '';
  const rows = list.map(h => {
    const lock = h.locked ? '🔒 ' : '';
    const cost = h.cost
      ? ` <span style="display:inline-block;padding:0.05rem 0.45rem;border-radius:999px;background:#d1fae5;color:#047857;font-size:0.75rem;font-weight:600;margin-left:0.35rem;">${escapeHtml(h.cost)}</span>`
      : '';
    const urls = getHighlightUrls(h);
    const links = urls.length > 0
      ? '<div style="margin-top:0.2rem;font-size:0.8rem;">' +
        urls.map((u, i) => `<a href="${escapeHtml(u)}" style="color:#4f46e5;text-decoration:none;margin-right:0.6rem;">↗ link${urls.length > 1 ? ` ${i + 1}` : ''}</a>`).join('') +
        '</div>'
      : '';
    return `<li style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;">${lock}${escapeHtml(h.text || '')}${cost}${links}</li>`;
  }).join('');
  return `
    <h2 style="font-size:1.05rem;color:#111;margin:1.5rem 0 0.5rem;">✨ Trip Highlights</h2>
    <ul style="padding:0;margin:0;list-style:none;">${rows}</ul>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { recipients, fromName, event, itinerary, tripHighlights } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'No recipients provided' });
  }
  if (!event || !event.title) {
    return res.status(400).json({ error: 'Missing event details' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({ sent: 0, message: 'No email service configured.' });
  }

  const itineraryHtml = buildItineraryHtml(itinerary);
  const highlightsHtml = buildHighlightsHtml(tripHighlights);
  const linkBtn = event.link
    ? `<a href="${escapeHtml(event.link)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:0.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;margin-top:1rem;">View full itinerary on Rally</a>`
    : '';

  const subject = `Itinerary for ${event.title}`;

  const results = [];
  for (const r of recipients) {
    if (!r?.email) { results.push({ name: r?.name, success: false, error: 'No email' }); continue; }
    try {
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:2rem;color:#1a1a1a;">
          <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.25rem;">Rally</h1>
          <p style="color:#525252;margin:0 0 1.25rem;">Hey${r.name ? ` ${escapeHtml(r.name)}` : ''}! Here's the itinerary${fromName ? ` from ${escapeHtml(fromName)}` : ''}.</p>

          <div style="background:#faf7ff;border:1px solid #e9e1fb;border-radius:12px;padding:1.25rem;margin-bottom:1rem;">
            <h2 style="font-size:1.25rem;margin:0 0 0.4rem;color:#1a1a1a;">${escapeHtml(event.title)}</h2>
            ${event.date ? `<div style="color:#525252;margin-bottom:0.2rem;">📅 ${escapeHtml(event.date)}</div>` : ''}
            ${event.location ? `<div style="color:#525252;">📍 ${escapeHtml(event.location)}</div>` : ''}
            ${event.description ? `<p style="color:#525252;margin:0.6rem 0 0;white-space:pre-wrap;">${escapeHtml(event.description)}</p>` : ''}
          </div>

          ${highlightsHtml}
          ${itineraryHtml ? `<h2 style="font-size:1.05rem;color:#111;margin:1.5rem 0 0.5rem;">📅 Itinerary</h2>${itineraryHtml}` : ''}

          ${linkBtn}

          <p style="color:#9ca3af;font-size:0.75rem;margin-top:2rem;">Sent via Rally. If you didn't expect this email, you can safely ignore it.</p>
        </div>`;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Rally <noreply@resend.dev>',
          to: [r.email],
          subject,
          html,
        }),
      });
      if (response.ok) {
        results.push({ name: r.name, email: r.email, success: true });
      } else {
        const err = await response.json().catch(() => ({}));
        results.push({ name: r.name, email: r.email, success: false, error: err.message || `HTTP ${response.status}` });
      }
    } catch (err) {
      results.push({ name: r.name, email: r.email, success: false, error: err.message });
    }
  }

  const sent = results.filter(r => r.success).length;
  return res.status(200).json({ sent, total: recipients.length, results });
}

// Where the date vote stands on one event, and the email that says so.
//
// Pure: no Firestore, no React, no DOM, so it can be unit-tested and previewed.
// api/voting-status.js reads the event and hands it here; nothing else computes
// this, so the mail and the event page cannot drift apart.

// Same scoring the poll shows: a Works is worth two Maybes, and a zero score
// leads nothing (an option nobody has voted on is not "winning").
export function scoreOption(opt) {
  const votes = Object.values(opt.votes || {});
  const yes = votes.filter(v => v.vote === 'yes').length;
  const maybe = votes.filter(v => v.vote === 'maybe').length;
  const no = votes.filter(v => v.vote === 'no').length;
  const topPicks = votes.filter(v => v.topPick).length;
  return { ...opt, yes, maybe, no, topPicks, score: yes * 2 + maybe };
}

export function summarizeVoting(event = {}, options = []) {
  const scored = options.map(scoreOption).sort((a, b) => b.score - a.score);
  const open = scored.filter(o => !o.closed && !o.noVote);
  const references = scored.filter(o => !o.closed && o.noVote);
  const leaderId = open.length > 0 && open[0].score > 0 ? open[0].id : null;

  // How many open options each person has actually voted on.
  const voted = {};
  for (const opt of open) {
    for (const [uid, v] of Object.entries(opt.votes || {})) {
      if (v?.vote && v.vote !== 'none') voted[uid] = (voted[uid] || 0) + 1;
    }
  }

  // The member map is polymorphic — uids, sanitized emails, name slugs — so go
  // by entries rather than assuming a uid. skipVote sits the vote out, and a
  // plus-one rides on whoever they came with.
  const members = event.members || {};
  const votingMembers = Object.entries(members).filter(
    ([, m]) => m && typeof m === 'object' && !m.skipVote && (m.name || m.email),
  );
  const hasVotedAll = ([key, m]) => {
    if (open.length === 0) return false;
    if ((voted[key] || 0) >= open.length) return true;
    return !!(m.plusOneOf && (voted[m.plusOneOf] || 0) >= open.length);
  };
  const done = votingMembers.filter(hasVotedAll);
  const waiting = votingMembers.filter(m => !hasVotedAll(m)).map(([, m]) => m.name || m.email || 'Unnamed');

  const isFinalized = event.stage === 'finalized';
  const headline = isFinalized
    ? 'The date is settled'
    : open.length === 0
      ? 'No dates on the table yet'
      : `${done.length} of ${votingMembers.length} ${votingMembers.length === 1 ? 'person has' : 'people have'} voted on every date`;

  return { open, references, leaderId, doneCount: done.length, totalVoters: votingMembers.length, waiting, isFinalized, headline };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatDay(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? String(iso) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function rangeLabel(o) {
  return o.endDate && o.endDate !== o.startDate
    ? `${formatDay(o.startDate)} – ${formatDay(o.endDate)}`
    : formatDay(o.startDate);
}

export function renderVotingStatusEmail({ event = {}, eventId, summary, fromName = '', appUrl }) {
  const { open, references, leaderId, waiting, isFinalized, headline } = summary;

  const cell = 'padding: 10px 12px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 0.88rem; color: #1f2937;';
  const head = 'padding: 10px 12px; border-bottom: 2px solid #d1d5db; text-align: left; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; background: #f9fafb;';
  const pill = (n, bg, fg) => `<span style="display:inline-block; min-width:1.4rem; text-align:center; padding:2px 8px; border-radius:999px; background:${bg}; color:${fg}; font-weight:700; font-size:0.8rem;">${n}</span>`;

  const rows = open.map(o => {
    const isLeader = o.id === leaderId;
    return `
        <tr${isLeader ? ' style="background:#f0fdf4;"' : ''}>
          <td style="${cell}">
            <strong style="color:#1a1a1a;">${escapeHtml(rangeLabel(o))}</strong>
            ${isLeader ? '<span style="margin-left:6px; font-size:0.7rem; font-weight:700; color:#16a34a; text-transform:uppercase; letter-spacing:0.03em;">Leading</span>' : ''}
            ${o.note ? `<div style="color:#6b7280; font-size:0.78rem; margin-top:2px;">${escapeHtml(o.note)}</div>` : ''}
          </td>
          <td style="${cell} text-align:center;">${pill(o.yes, '#dcfce7', '#166534')}</td>
          <td style="${cell} text-align:center;">${pill(o.maybe, '#fef3c7', '#92400e')}</td>
          <td style="${cell} text-align:center;">${pill(o.no, '#fee2e2', '#991b1b')}</td>
          <td style="${cell} text-align:center; color:#d97706; font-weight:600;">${o.topPicks || ''}</td>
        </tr>`;
  }).join('');

  const waitingBlock = isFinalized || waiting.length === 0
    ? (open.length > 0 && !isFinalized
      ? '<p style="color:#16a34a; font-weight:600; margin:1.25rem 0 0;">Everyone has voted ✓</p>'
      : '')
    : `<div style="margin-top:1.5rem; padding:0.9rem 1rem; background:#fffbeb; border-left:3px solid #f59e0b; border-radius:6px;">
           <div style="font-size:0.78rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#92400e; margin-bottom:0.35rem;">Still waiting on</div>
           <div style="color:#1f2937; font-size:0.88rem;">${escapeHtml(waiting.join(', '))}</div>
         </div>`;

  const refBlock = references.length === 0 ? '' : `
      <div style="margin-top:1.25rem; color:#6b7280; font-size:0.82rem;">
        <strong style="color:#92400e;">📌 For reference (no voting):</strong>
        ${references.map(r => escapeHtml(`${r.note ? r.note + ' — ' : ''}${rangeLabel(r)}`)).join('; ')}
      </div>`;

  const subject = isFinalized
    ? `Rally: ${event.title || 'Event'} — the date is set`
    : `Rally: where the vote stands on ${event.title || 'your event'}`;

  const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 700px; margin: 0 auto; padding: 2rem;">
        <h1 style="font-size: 1.5rem; color: #4f46e5; margin: 0 0 0.25rem;">${escapeHtml(event.title || 'Event')}</h1>
        <p style="color: #525252; margin: 0 0 1.5rem;">${escapeHtml(headline)}${event.location ? ` · 📍 ${escapeHtml(event.location)}` : ''}</p>
        ${open.length === 0 ? '<p style="color:#6b7280;">No dates have been suggested yet.</p>' : `
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr>
              <th style="${head}">Date</th>
              <th style="${head} text-align:center;">Works</th>
              <th style="${head} text-align:center;">Maybe</th>
              <th style="${head} text-align:center;">No</th>
              <th style="${head} text-align:center;">⭐</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`}
        ${waitingBlock}
        ${refBlock}
        <a href="${appUrl}/poll/${eventId}" style="display: inline-block; background: #4f46e5; color: #fff; padding: 0.7rem 1.4rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 1.5rem;">${isFinalized ? 'See the details' : 'Vote on dates'}</a>
        <p style="color: #9ca3af; font-size: 0.75rem; margin-top: 2rem;">Status update${fromName ? ` sent by ${escapeHtml(fromName)}` : ''} from Rally.</p>
      </div>`;

  return { subject, html };
}

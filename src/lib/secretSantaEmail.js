// The email that tells one person who they are buying for (api/secret-santa.js).

const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function secretSantaEmail({ giverName, receiverName, eventTitle, when, location, note, fromName }) {
  const title = eventTitle || 'Secret Santa';
  const from = fromName || 'The organizer';
  const firstName = String(giverName || '').trim().split(/\s+/)[0];
  // The name is deliberately NOT in the subject: subjects show on lock screens
  // and in shared inboxes.
  const subject = `🎅 Your Secret Santa pick for ${title}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.5rem;">Rally</h1>
      <p style="color:#525252;margin:0 0 1rem;">Hey${firstName ? ` ${escapeHtml(firstName)}` : ''}! 🎅</p>
      <p style="color:#1f2937;margin:0 0 1rem;">${escapeHtml(from)} drew names for <strong>${escapeHtml(title)}</strong>. You are the Secret Santa for:</p>
      <div style="background:#f5f3ef;border-radius:12px;padding:1.25rem;margin:1rem 0;text-align:center;">
        <div style="font-size:1.6rem;font-weight:700;color:#1a1a1a;">🎁 ${escapeHtml(receiverName)}</div>
      </div>
      ${note ? `<p style="color:#1f2937;margin:0 0 1rem;white-space:pre-wrap;">${escapeHtml(note)}</p>` : ''}
      ${when ? `<p style="color:#525252;margin:0 0 0.2rem;">📅 ${escapeHtml(when)}</p>` : ''}
      ${location ? `<p style="color:#525252;margin:0 0 0.2rem;">📍 ${escapeHtml(location)}</p>` : ''}
      <p style="color:#9ca3af;font-size:0.75rem;margin-top:2rem;">Keep it a secret — only you were sent this name.</p>
    </div>`;
  return { subject, html };
}

// The email that tells one person their Secret Santa pick is ready
// (api/secret-santa.js). The name itself is NOT in the email: a button opens
// a page that keeps it covered until they tap Reveal (lib/secretSantaLink.js),
// so reading the email beside someone gives nothing away.
//
// The wishlist page (lib/wishlist.js) gets a block of its own under that: a
// button, and the address written out, so it is there to tap, copy or find
// again later. Everyone's list is on that page, so the link names nobody.

const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function secretSantaEmail({ giverName, eventTitle, when, location, note, fromName, link, wishlistLink }) {
  const title = eventTitle || 'Secret Santa';
  const from = fromName || 'The organizer';
  const firstName = String(giverName || '').trim().split(/\s+/)[0];
  // No name in the subject either: subjects show on lock screens and in
  // shared inboxes.
  const subject = `🎅 Your Secret Santa pick for ${title}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:2rem;">
      <h1 style="font-size:1.5rem;color:#4f46e5;margin:0 0 0.5rem;">Rally</h1>
      <p style="color:#525252;margin:0 0 1rem;">Hey${firstName ? ` ${escapeHtml(firstName)}` : ''}! 🎅</p>
      <p style="color:#1f2937;margin:0 0 1rem;">${escapeHtml(from)} drew names for <strong>${escapeHtml(title)}</strong>. Your pick is ready.</p>
      <div style="background:#f5f3ef;border-radius:12px;padding:1.25rem;margin:1rem 0;text-align:center;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#b91c1c;color:#fff;padding:0.8rem 1.75rem;border-radius:8px;text-decoration:none;font-weight:700;font-size:1.05rem;">🎁 See who you have</a>
        <div style="font-size:0.8rem;color:#6b7280;margin-top:0.7rem;">The name stays hidden until you tap Reveal — so it's safe to open this with someone beside you.</div>
      </div>
      ${wishlistLink ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:1.25rem;margin:1rem 0;text-align:center;">
        <div style="font-size:1rem;font-weight:700;color:#14532d;margin-bottom:0.3rem;">🎄 Wishlists</div>
        <div style="font-size:0.88rem;color:#374151;margin-bottom:0.9rem;">See what your person is hoping for, and write your own list so your Secret Santa isn't guessing.</div>
        <a href="${escapeHtml(wishlistLink)}" style="display:inline-block;background:#166534;color:#fff;padding:0.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.98rem;">Open the wishlists</a>
        <div style="font-size:0.75rem;color:#6b7280;margin-top:0.8rem;">Or copy this link:<br><a href="${escapeHtml(wishlistLink)}" style="color:#166534;word-break:break-all;">${escapeHtml(wishlistLink)}</a></div>
      </div>` : ''}
      ${note ? `<p style="color:#1f2937;margin:0 0 1rem;white-space:pre-wrap;">${escapeHtml(note)}</p>` : ''}
      ${when ? `<p style="color:#525252;margin:0 0 0.2rem;">📅 ${escapeHtml(when)}</p>` : ''}
      ${location ? `<p style="color:#525252;margin:0 0 0.2rem;">📍 ${escapeHtml(location)}</p>` : ''}
      <p style="color:#9ca3af;font-size:0.75rem;margin-top:2rem;">Keep it a secret — this link is yours alone, so don't forward this email.</p>
    </div>`;
  return { subject, html };
}

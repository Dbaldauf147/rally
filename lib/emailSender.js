// Who Rally's email says it's from.
//
// Resend's shared `resend.dev` address only delivers to the Resend account's
// own inbox, so anything meant for someone else (a wedding-digest recipient, an
// invite) is refused until mail goes out from a domain verified in Resend.
// Set RESEND_FROM_EMAIL in Vercel to an address on that domain — e.g.
// noreply@mail.example.com — and every sender switches over with no code change.
// Unset, it stays on the shared address it has always used.

export const DEFAULT_FROM_EMAIL = 'noreply@resend.dev';

export function senderAddress(name = 'Rally', env = globalThis.process?.env || {}) {
  const email = String(env.RESEND_FROM_EMAIL || '').trim() || DEFAULT_FROM_EMAIL;
  return `${name} <${email}>`;
}

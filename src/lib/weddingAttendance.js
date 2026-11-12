/* Wedding → Guests: how many people to expect, given a share of the guest
   list you think won't accept or attend.

   The rate (0–100, kept on the user doc as `weddingDeclineRate`) is applied
   only to guests who haven't answered yet. Someone marked Confirmed is
   counted in full and someone marked Not coming isn't counted at all — their
   answer beats the guess. Pure, for testing without React. */

export const CONFIRMED = 'Confirmed';
export const DECLINED = 'Not coming';

/** The stored rate as a number from 0 to 100, or null when it isn't set. */
export function normalizeDeclineRate(v) {
  const n = typeof v === 'string' ? Number(v.trim().replace(/%$/, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || (typeof v === 'string' && !v.trim())) return null;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

export function expectedAttendance(guests, rate) {
  const list = Array.isArray(guests) ? guests : [];
  let confirmed = 0;
  let declined = 0;
  for (const g of list) {
    if (g?.status === CONFIRMED) confirmed += 1;
    else if (g?.status === DECLINED) declined += 1;
  }
  const total = list.length;
  const open = total - confirmed - declined;
  const r = normalizeDeclineRate(rate);
  const expectedFromOpen = r === null ? open : Math.round(open * (1 - r / 100));
  return {
    total, confirmed, declined, open,
    rate: r,
    // Open guests the rate takes off, plus those who've already said no.
    notAttending: declined + (open - expectedFromOpen),
    expected: confirmed + expectedFromOpen,
  };
}

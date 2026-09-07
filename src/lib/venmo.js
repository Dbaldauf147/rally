// Charging someone on Venmo.
//
// There is no Venmo API worth having: the consumer API has been shut to new
// developers for years, and nothing can read your transactions, so nothing here
// can ever tick somebody off automatically when they pay. What Venmo does still
// honour is a link that opens the app — or the site, on a desktop — with the
// request already filled in. So this is one-way: it saves the typing and gets
// the amount right, and you still record the payment yourself when the money
// lands.
//
//   https://venmo.com/<handle>?txn=charge&amount=16.25&note=Labor+Day+pizza
//
// `txn=charge` asks them for money; `txn=pay` sends it. Both are used — you
// charge the people who owe you, and pay back whoever fronted something you
// were in on.
//
// Pure: no React, no Firestore, no DOM.

// Venmo usernames are 5–30 characters of letters, digits, underscores, dashes
// and dots. Accept what people will actually paste — "@dan", a profile URL off
// the share sheet, stray spaces — and keep only the handle itself.
export function normalizeHandle(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  // A pasted profile link, in any of the shapes Venmo hands out.
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?venmo\.com\/(?:u\/)?([^/?#\s]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@+/, '').trim();
  return /^[A-Za-z0-9._-]{2,30}$/.test(s) ? s : '';
}

// What to show in a field: their handle with the @ back on.
export const displayHandle = (raw) => {
  const h = normalizeHandle(raw);
  return h ? `@${h}` : '';
};

// Venmo truncates long notes and a wall of text reads as spam anyway, so the
// note says what it was for and stops.
export const NOTE_MAX = 80;

/* The link that opens Venmo with the request ready to send.

   Returns '' when there is nothing to ask for — no handle, or nothing owed —
   so the caller can decide between a button and a prompt for the handle rather
   than offering a link that would open an empty charge.

   The amount is fixed to cents because Venmo reads it as a decimal string and
   a float like 16.249999999 would arrive as a different number than the one on
   screen. */
export function venmoUrl({ handle, amount, note = '', txn = 'charge' } = {}) {
  const who = normalizeHandle(handle);
  const value = Number(amount);
  if (!who || !Number.isFinite(value) || value <= 0) return '';
  const params = new URLSearchParams({
    txn: txn === 'pay' ? 'pay' : 'charge',
    amount: value.toFixed(2),
  });
  const text = String(note || '').trim().slice(0, NOTE_MAX);
  if (text) params.set('note', text);
  return `https://venmo.com/${encodeURIComponent(who)}?${params.toString()}`;
}

// "Labor Day — Pizza" / "Labor Day" / "Pizza". Whichever parts exist, joined,
// so the person being charged knows what it is without opening anything.
export function chargeNote(eventTitle, expenseTitle) {
  return [eventTitle, expenseTitle]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .join(' — ')
    .slice(0, NOTE_MAX);
}

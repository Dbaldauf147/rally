// Texting the poll out, one person at a time.
//
// The draft panel on People & Poll writes one message and then sends it: as a
// group thread, or person by person by tapping each name. Who it goes to used
// to be a fixed audience — everyone, the non-responders, the yeses. This adds
// the other way round: tick exactly the people you mean.
//
// The link itself is a plain `sms:` URL, which opens the phone's own Messages
// app with the recipient and the message already in it. Nothing is sent, and
// no draft is written behind the scenes — iOS has no way to do that; the
// message sits there waiting for you to press send.

/* A phone number as a dialable string. The list holds them as people typed
   them — "(917) 555-0142", "917.555.0142" — and an sms: link wants digits. A
   number with no country code is assumed to be North American, which is what
   every number in this list is. */
export function cleanNumber(raw) {
  let c = String(raw ?? '').replace(/[^+\d]/g, '');
  if (!c) return '';
  if (!c.startsWith('+')) c = c.startsWith('1') ? `+${c}` : `+1${c}`;
  return c;
}

/* The sms: link. iOS wants `sms:/open?addresses=…&body=…`; everything else
   takes `sms:<numbers>?body=…`. Both open the composer — the difference is
   only that iOS refuses to prefill a body on the plain form when there is
   more than one recipient. */
export function smsLink(phones, body, { ios = false } = {}) {
  const numbers = (Array.isArray(phones) ? phones : [phones]).map(cleanNumber).filter(Boolean);
  if (!numbers.length) return '';
  const text = encodeURIComponent(String(body ?? ''));
  return ios
    ? `sms:/open?addresses=${numbers.join(',')}&body=${text}`
    : `sms:${numbers.join(',')}?body=${text}`;
}

/* Who the draft is for.

   `picked` is a Set of uids when you have chosen people by hand, and null
   when the audience decides — the panel's filters (everyone, the ones who
   haven't voted, the yeses). Somebody with no phone number is never a
   recipient: there is nothing to open Messages with. */
export function recipientsFor(members, { picked = null, inAudience = () => true } = {}) {
  return (members || []).filter(([uid, m]) => {
    if (!m?.phone) return false;
    return picked ? picked.has(uid) : inAudience(uid, m);
  });
}

// Tick one person on or off.
export function togglePicked(picked, uid) {
  const next = new Set(picked || []);
  if (next.has(uid)) next.delete(uid); else next.add(uid);
  return next;
}

/* How far through a person-by-person send you are.

   A member's `texted` is a running timestamp — somebody texted three weeks ago
   about something else is not done with the message being written now — so
   "already texted" means since this draft was opened. */
export function textProgress(recipients, openedAt = 0) {
  const done = [];
  const todo = [];
  for (const [uid, m] of recipients || []) {
    const at = m?.texted ? new Date(m.texted).getTime() : 0;
    (Number.isFinite(at) && at >= openedAt && at > 0 ? done : todo).push([uid, m]);
  }
  return { done, todo };
}

/* A draft carried from one device to another.

   Writing to twenty people is a laptop job; sending is a phone job, because an
   sms: link only does anything where there is a Messages app. So the panel can
   park the draft on your own user doc (users/{uid}.textDrafts.{eventId}) — not
   on the event, which anyone with the poll link can read — and the event page
   on the phone offers it back.

   `picked` goes over as a list of uids (Firestore has no Set) and comes back as
   a Set, or null when the audience decides. `openedAt` travels too, so that
   "already texted" on the phone means since the draft was started, wherever
   that was. */
export function draftToSave({ message, audience, picked, openedAt }, now = Date.now()) {
  return {
    message: String(message ?? ''),
    audience: audience || 'all',
    picked: picked ? [...picked] : null,
    openedAt: Number(openedAt) || now,
    savedAt: now,
  };
}

// The saved draft for one event off a user doc, or null if there isn't a usable one.
export function savedDraftOf(userDoc, eventId) {
  const d = userDoc?.textDrafts?.[eventId];
  if (!d || typeof d.message !== 'string' || !d.message.trim()) return null;
  return {
    message: d.message,
    audience: d.audience || 'all',
    picked: Array.isArray(d.picked) ? new Set(d.picked) : null,
    openedAt: Number(d.openedAt) || 0,
    savedAt: Number(d.savedAt) || 0,
  };
}

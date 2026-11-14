// The event page's "Reach Out" dialog: one place to text or email the guests,
// about the poll or the calendar invite, narrowed to the people it's for.
//
// Three choices make a send:
//   channel   'text' | 'email'
//   kind      'poll' | 'calendar'
//   audience  'all' | 'yesmaybe' | 'going' | 'missing'
//
// This file holds the wording. Who falls in each audience is decided on the
// event page, which already knows how to read votes, RSVPs and overrides.
//
// Pure: no React, no Firestore.

export const CHANNELS = [
  { key: 'text', label: 'Text', icon: '💬' },
  { key: 'email', label: 'Email', icon: '✉' },
];

export const KINDS = [
  { key: 'poll', label: 'Poll', icon: '📊' },
  { key: 'calendar', label: 'Calendar invite', icon: '📅' },
];

export const AUDIENCES = [
  { key: 'all', label: 'Everyone invited' },
  { key: 'yesmaybe', label: 'Yeses & maybes' },
  { key: 'going', label: 'Yeses only' },
  { key: 'missing', label: 'Haven’t responded to the poll' },
];

/**
 * The message for a send. `ctx`:
 *   title, location, finalized, dateStr, pollLink, calendarLink, googleCalUrl,
 *   hasAnyVotes (somebody has voted already — the poll text says "more dates").
 * Returns { subject, body }; a text uses only the body.
 */
export function outreachMessage({ channel, kind, audience }, ctx) {
  const { title, location, finalized, dateStr, pollLink, calendarLink, googleCalUrl, hasAnyVotes } = ctx;
  const where = location ? ` at ${location}` : '';

  if (kind === 'calendar') {
    const lead = `You're invited to ${title} on ${dateStr}${where}.`;
    // A text gets the one link that works on any phone; an email has room for
    // the Google link too.
    const body = channel === 'email' && googleCalUrl
      ? `${lead}\n\nAdd to Google Calendar: ${googleCalUrl}\n\nAdd to Outlook/Apple Calendar: ${calendarLink}`
      : `${lead}\n\nAdd to your calendar: ${calendarLink}`;
    return { subject: `Calendar invite: ${title}`, body };
  }

  if (audience === 'missing') {
    return {
      subject: `Still need your vote: ${title}`,
      body: `Hey! We're still waiting on your vote for ${title}. Could you take a sec to pick the dates that work for you?\n\nVote here: ${pollLink}`,
    };
  }
  if (audience === 'going' || audience === 'yesmaybe') {
    const sure = audience === 'going';
    return {
      subject: finalized ? `Reminder: ${title}` : `Update: ${title}`,
      body: finalized
        ? `Hey! Reminder about ${title} on ${dateStr}${where}. ${sure ? 'See you there!' : 'Hope you can make it!'}\n\nDetails: ${pollLink}`
        : `Hey! Since you${sure ? "'re" : ' might be'} in for ${title}, here's where things stand.\n\nDetails: ${pollLink}`,
    };
  }
  if (finalized) {
    return {
      subject: `Reminder: ${title}`,
      body: `Hey! Just a reminder about ${title} on ${dateStr}${where}. See you there!\n\nDetails & RSVP: ${pollLink}`,
    };
  }
  return {
    subject: `You're invited: ${title}`,
    body: hasAnyVotes
      ? `People have suggested additional dates for ${title}. Would any of these new dates work for you?\n\nVote here: ${pollLink}`
      : `You're invited to ${title}!\n\nVote here on what dates you can make: ${pollLink}`,
  };
}

/** A Gmail compose link, the way the event page has always opened email. */
export function gmailComposeUrl(emails, { subject, body }) {
  return `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(emails.join(','))}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

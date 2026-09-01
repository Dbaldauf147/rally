// The wedding checklist — what to do, counting backward from the date.
//
// The content is fixed rather than editable: it's a planning timeline, and the
// thing that changes is which items are done, not what the items are. So the
// stored document is only a set of ticked ids, and this file is the list.
//
// Ids are explicit slugs, not positions. A checklist keyed by index would move
// everyone's ticks the first time a task was inserted or reworded, which is
// exactly the sort of silent corruption you don't notice until the week of.
//
// `note` is the guidance that came with a task — kept beside it rather than
// folded into the text, so the task stays scannable and the reasoning is still
// there when you need it. `milestone` marks the few items everything else
// hangs off: booking the venue, mailing the invitations, the licence.

export const PHASES = [
  {
    id: 'now',
    title: 'Now, before the date exists',
    when: 'allow 1–3 months',
    tasks: [
      { id: 'numbers', text: 'Settle the three numbers: budget, guest list, season' },
      { id: 'vision', text: 'Agree on a rough vision: formal or relaxed, indoor or outdoor, city or country' },
      {
        id: 'planner',
        text: 'Decide whether you’re hiring a full planner',
        note: 'At 120–250 guests, if you both work full-time, this is worth serious consideration. If not a full planner, commit now to hiring a day-of coordinator later.',
      },
      { id: 'tour-venues', text: 'Research and tour venues', note: 'Tour at least four before deciding.' },
      {
        id: 'book-venue',
        text: 'Book the venue. Your date is now set.',
        note: 'Everything below counts backward from it.',
        milestone: true,
      },
      { id: 'insurance', text: 'Take out wedding insurance if the venue requires it or your deposits are large' },
      { id: 'admin', text: 'Set up a shared spreadsheet and a dedicated email address for wedding correspondence' },
    ],
  },
  {
    id: 'm12',
    title: '12–10 months out',
    tasks: [
      { id: 'photo', text: 'Book photographer and videographer', note: 'Good ones book 12–18 months ahead for peak dates.' },
      { id: 'caterer', text: 'Book caterer, if not in-house at the venue' },
      { id: 'music', text: 'Book band or DJ' },
      { id: 'officiant', text: 'Book officiant' },
      { id: 'party', text: 'Ask your wedding party' },
      { id: 'hotels', text: 'Reserve hotel room blocks', note: 'At your size you likely need 2–3 hotels at different price points.' },
      { id: 'website', text: 'Build the wedding website' },
      { id: 'save-the-dates', text: 'Send save-the-dates, especially if it’s a destination or holiday weekend' },
    ],
  },
  {
    id: 'm10',
    title: '10–8 months out',
    tasks: [
      { id: 'dress', text: 'Shop for and order the wedding dress', note: 'Ordering plus alterations takes 6–9 months.' },
      { id: 'florist', text: 'Book florist' },
      { id: 'cake', text: 'Book cake or dessert vendor' },
      { id: 'rentals', text: 'Book rentals if the venue doesn’t include them' },
      { id: 'beauty', text: 'Book hair and makeup team', note: 'At your size you may need a team of 2–4 to get everyone ready on time.' },
      { id: 'honeymoon', text: 'Start honeymoon planning; check passport expiration dates now' },
    ],
  },
  {
    id: 'm8',
    title: '8–6 months out',
    tasks: [
      { id: 'rehearsal-venue', text: 'Book rehearsal dinner venue' },
      { id: 'registry', text: 'Register for gifts' },
      { id: 'tasting', text: 'Attend menu tasting and lock the menu' },
      { id: 'suits', text: 'Order suits or tuxes' },
      { id: 'paper', text: 'Order invitations and all paper goods' },
      { id: 'transport', text: 'Book transportation: guest shuttles, wedding party transport, getaway car' },
      { id: 'entertainment', text: 'Book any additional entertainment (ceremony musicians, cocktail hour trio, photo booth)' },
      { id: 'fitting-1', text: 'First dress fitting' },
    ],
  },
  {
    id: 'm6',
    title: '6–4 months out',
    tasks: [
      { id: 'bands', text: 'Buy wedding bands' },
      { id: 'ceremony', text: 'Plan the ceremony: readings, vows, processional order, music' },
      { id: 'beauty-trial', text: 'Hair and makeup trial', note: 'Do it on the same day as an engagement shoot if you’re doing one.' },
      { id: 'custom', text: 'Order favors, signage, guest book, anything custom' },
      {
        id: 'license-research',
        text: 'Research your marriage license requirements',
        note: 'Waiting period, expiration window, documents needed, whether both parties must appear.',
      },
      { id: 'party-gifts', text: 'Buy wedding party gifts' },
      { id: 'rehearsal-invites', text: 'Confirm rehearsal dinner guest list and send invitations' },
    ],
  },
  {
    id: 'm3',
    title: '3 months out',
    tasks: [
      {
        id: 'mail-invitations',
        text: 'Mail invitations',
        note: 'Standard is 6–8 weeks before the wedding; 10–12 weeks for destination. Set the RSVP deadline 3–4 weeks before the wedding.',
        milestone: true,
      },
      { id: 'timeline', text: 'Draft the day-of timeline with your coordinator' },
      { id: 'fitting-2', text: 'Second dress fitting' },
      { id: 'vows', text: 'Write vows' },
      { id: 'script', text: 'Finalize the ceremony script with your officiant' },
      { id: 'honeymoon-confirm', text: 'Confirm honeymoon bookings' },
    ],
  },
  {
    id: 'm2',
    title: '2 months out',
    tasks: [
      { id: 'rsvps', text: 'Track RSVPs', note: 'Expect to chase 20–30% of your list by phone or text; this is normal and unavoidable.' },
      { id: 'seating-start', text: 'Start the seating chart' },
      { id: 'menu-counts', text: 'Final menu counts by dish type if you’re doing plated service' },
      { id: 'vendor-confirm', text: 'Confirm all vendor arrival times, load-in windows, and contact numbers' },
      { id: 'cards', text: 'Order or write place cards, escort cards, menus' },
      { id: 'shoes', text: 'Break in your shoes' },
    ],
  },
  {
    id: 'm1',
    title: '1 month out',
    tasks: [
      {
        id: 'license',
        text: 'Get the marriage license',
        note: 'Time it inside the validity window; many expire in 30–90 days.',
        milestone: true,
      },
      { id: 'headcount', text: 'Give final headcount to caterer', note: 'Usually due 7–14 days out; confirm the exact deadline.' },
      { id: 'seating-finish', text: 'Finish the seating chart' },
      { id: 'fitting-final', text: 'Final dress fitting' },
      { id: 'payments', text: 'Make final payments per each contract’s schedule' },
      { id: 'send-timeline', text: 'Send the finished day-of timeline and vendor contact sheet to every vendor and every member of the wedding party' },
      { id: 'tips', text: 'Prepare tip envelopes: label each one, put cash inside, and hand the whole set to one trusted person' },
    ],
  },
  {
    id: 'week',
    title: 'Week of',
    tasks: [
      { id: 'delegate', text: 'Delegate everything', note: 'Write down who is doing what and when.' },
      { id: 'kit', text: 'Pack the emergency kit' },
      { id: 'welcome-bags', text: 'Drop off welcome bags at hotels' },
      { id: 'deliver', text: 'Deliver decor, signage, favors, and place cards to the venue or coordinator' },
      { id: 'final-headcount', text: 'Confirm final headcount and any last dietary changes' },
      { id: 'pack', text: 'Pack for the honeymoon' },
      { id: 'rehearsal', text: 'Rehearsal and rehearsal dinner' },
      { id: 'rings', text: 'Give the rings, license, and vow books to a specific named person' },
    ],
  },
];

// A task's key in the stored document. Phase-scoped so two phases can both have
// a "fitting" without sharing a tick.
export const taskKey = (phaseId, taskId) => `${phaseId}.${taskId}`;

export const ALL_TASKS = PHASES.flatMap((p) =>
  p.tasks.map((t) => ({ ...t, phaseId: p.id, key: taskKey(p.id, t.id) })));

export const TOTAL_TASKS = ALL_TASKS.length;

const KNOWN_KEYS = new Set(ALL_TASKS.map((t) => t.key));

/* The ticked set, as stored.

   Keys that no longer match a task are dropped on the way in: a task removed
   from the list above should not leave a tick behind inflating the count. */
export function normalizeDone(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([key, value]) => {
    if (value && KNOWN_KEYS.has(key)) out[key] = true;
  });
  return out;
}

export function toggleTask(done, key) {
  const next = { ...normalizeDone(done) };
  if (next[key]) delete next[key];
  else if (KNOWN_KEYS.has(key)) next[key] = true;
  return next;
}

export const isDone = (done, key) => Boolean(done?.[key]);

export function phaseProgress(phase, done) {
  const total = phase.tasks.length;
  const complete = phase.tasks.filter((t) => isDone(done, taskKey(phase.id, t.id))).length;
  return { complete, total, finished: total > 0 && complete === total };
}

export function overallProgress(done) {
  const complete = Object.keys(normalizeDone(done)).length;
  return {
    complete,
    total: TOTAL_TASKS,
    pct: TOTAL_TASKS ? Math.round((complete / TOTAL_TASKS) * 100) : 0,
  };
}

/* The first thing still outstanding, in timeline order.

   The list is long enough that "where was I" is a real question, and the answer
   is almost always the earliest unfinished task rather than anything clever. */
export function nextUp(done) {
  return ALL_TASKS.find((t) => !isDone(done, t.key)) || null;
}

// The phase a reader should land in: the first with anything left to do, so the
// finished ones can start collapsed.
export function firstUnfinishedPhase(done) {
  const phase = PHASES.find((p) => !phaseProgress(p, done).finished);
  return phase ? phase.id : null;
}

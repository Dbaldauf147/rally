// Curated, source-verified election dates by state.
//
// IMPORTANT: these are hand-curated from official sources and WILL go stale.
// Each state carries `lastVerified` and `sources`; the Voting page surfaces a
// freshness warning and links so users always have a path to confirm. Only add
// a state's dates here after checking them against that state's official board
// of elections — never guess.
//
// `type` matches the TYPES map in VotingPage.jsx:
//   registration | early | primary | general | ballot | local | other

export const CURATED_ELECTION_DATES = {
  NY: {
    state: 'NY',
    name: 'New York',
    lastVerified: '2026-06-16',
    sources: [
      { label: 'NY State Board of Elections — deadlines', url: 'https://elections.ny.gov/registration-and-voting-deadlines' },
      { label: 'NY State BOE — 2026 deadlines poster', url: 'https://elections.ny.gov/2026-election-deadlines-poster' },
      { label: 'NYC Board of Elections — 2026 elections', url: 'https://www.vote.nyc/elections' },
      { label: 'NYC311 — 2026 Primary', url: 'https://portal.311.nyc.gov/article/?kanumber=KA-03724' },
    ],
    dates: [
      // 2026 State & Federal Primary
      { date: '2026-06-13', label: 'Primary — voter registration deadline', type: 'registration' },
      { date: '2026-06-13', label: 'Primary — early voting begins', type: 'early' },
      { date: '2026-06-21', label: 'Primary — early voting ends', type: 'early' },
      { date: '2026-06-23', label: 'State & Federal Primary Election', type: 'primary' },
      // 2026 General Election
      { date: '2026-10-24', label: 'General — voter registration deadline', type: 'registration' },
      { date: '2026-10-24', label: 'General — early voting begins', type: 'early' },
      { date: '2026-11-01', label: 'General — early voting ends', type: 'early' },
      { date: '2026-11-03', label: 'General Election (Midterms)', type: 'general' },
    ],
  },
};

export function getCuratedForState(stateCode) {
  return CURATED_ELECTION_DATES[stateCode] || null;
}

// Curated "what's on your ballot" races, by state. District-specific races
// (House/Assembly/Senate) depend on the voter's exact address — these reflect
// the NYC address provided. `contested`: true = a real choice, false =
// uncontested, null = unknown / may or may not be contested.
export const CURATED_RACES = {
  NY: {
    lastVerified: '2026-06-16',
    electionDate: '2026-06-23',
    electionLabel: 'Democratic Primary — June 23, 2026',
    addressNote: 'For an NYC address in NY-7 (U.S. House), Assembly District 50, and State Senate District 18. Your exact districts depend on your address — confirm before voting.',
    races: [
      {
        office: 'U.S. House — NY-7',
        contested: true,
        candidates: ['Vichal Kumar', 'Antonio Reynoso', 'Claire Valdez', 'Julie Won'],
        note: 'The big competitive race. Open seat — longtime incumbent Nydia Velázquez is not seeking re-election. (Candidate list cross-checked against Ballotpedia, Jun 2026.)',
        source: 'Ballotpedia',
      },
      {
        office: 'State Assembly — District 50',
        contested: true,
        candidates: ['Emily Gallagher (incumbent)', 'Andrew Bodiford'],
        source: 'Wikipedia',
      },
      {
        office: 'Governor',
        contested: null,
        candidates: ['Kathy Hochul (incumbent)'],
        note: 'May or may not be contested, depending on whether a challenger qualified.',
        source: 'BallotReady',
      },
      {
        office: 'Lieutenant Governor',
        contested: null,
        note: 'Runs on the Governor’s ticket — under a 2025 law, the gubernatorial candidate chooses a running mate.',
        source: 'Wikipedia',
      },
      {
        office: 'Attorney General',
        contested: null,
        candidates: ['Letitia James (incumbent)'],
        source: 'BallotReady',
      },
      {
        office: 'State Comptroller',
        contested: null,
        note: 'Typically appears on the statewide ballot.',
      },
      {
        office: 'State Senate — District 18',
        contested: false,
        candidates: ['Julia Salazar (incumbent, unopposed)'],
        note: 'No contest — incumbent appears unopposed.',
      },
    ],
  },
};

export function getCuratedRacesForState(stateCode) {
  return CURATED_RACES[stateCode] || null;
}

// Type → display metadata for calendar/list entries (shared by the Voting page
// and the Plans page).
export const VOTING_TYPES = {
  general:      { label: 'General election', icon: '🗳️', color: '#2563eb' },
  primary:      { label: 'Primary election', icon: '🗳️', color: '#7c3aed' },
  registration: { label: 'Registration deadline', icon: '⏰', color: '#dc2626' },
  early:        { label: 'Early voting', icon: '🕑', color: '#0891b2' },
  ballot:       { label: 'Mail ballot due', icon: '✉️', color: '#d97706' },
  local:        { label: 'Local / special election', icon: '🏛️', color: '#16a34a' },
  other:        { label: 'Other', icon: '📌', color: '#6b7280' },
};

// Dates fixed by federal law (first Tuesday after the first Monday in
// November). Reliable nationwide; primaries/deadlines/early voting vary by
// state and are curated or user-added.
export const NATIONAL_EVENTS = [
  { id: 'nat-2026', date: '2026-11-03', label: 'General Election — U.S. Midterms', type: 'general', national: true },
  { id: 'nat-2028', date: '2028-11-07', label: 'General Election — Presidential', type: 'general', national: true },
];

// Combined voting events for a state: national + curated + the user's custom
// dates, deduped (national/curated) by date+type. Used by both the Voting page
// and the Plans page so they stay in sync.
export function getVotingEventsForState(stateCode, customDates = []) {
  const curated = getCuratedForState(stateCode);
  const curatedDates = curated
    ? curated.dates.map(d => ({ ...d, id: `cur-${stateCode}-${d.date}-${d.type}`, curated: true }))
    : [];
  const base = [...NATIONAL_EVENTS, ...curatedDates];
  const seen = new Set();
  const deduped = [];
  for (const e of base) {
    const k = `${e.date}|${e.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(e);
  }
  const custom = Array.isArray(customDates) ? customDates.filter(c => c && c.date) : [];
  return [...deduped, ...custom];
}

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

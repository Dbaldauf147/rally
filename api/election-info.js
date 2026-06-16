// Returns upcoming official elections (date + name) from the Google Civic
// Information API, filtered to nationwide elections and the requested state.
// Requires a GOOGLE_CIVIC_API_KEY env var; without it the endpoint returns
// an empty list with needsKey:true so the client can fall back to manual entry.
//
// Note: Google has been winding down parts of the Civic Information API, so the
// elections feed may be sparse. We never fabricate dates — we surface only what
// the official feed returns, and the client always keeps the manual-entry path.

function inferType(name = '') {
  const n = name.toLowerCase();
  if (n.includes('primary')) return 'primary';
  if (n.includes('general')) return 'general';
  if (n.includes('runoff')) return 'general';
  if (n.includes('municipal') || n.includes('local') || n.includes('special')) return 'local';
  return 'other';
}

export default async function handler(req, res) {
  const state = String(req.query.state || '').trim().toLowerCase();
  const key = process.env.GOOGLE_CIVIC_API_KEY;

  if (!key) {
    return res.status(200).json({ elections: [], needsKey: true });
  }

  try {
    const resp = await fetch(`https://www.googleapis.com/civicinfo/v2/elections?key=${encodeURIComponent(key)}`);
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(200).json({ elections: [], error: data?.error?.message || 'Civic API error' });
    }
    const all = Array.isArray(data.elections) ? data.elections : [];
    const stateOcd = state ? `ocd-division/country:us/state:${state}` : null;

    const elections = all
      // Keep nationwide elections and (if a state was given) that state's.
      .filter(e => {
        const ocd = (e.ocdDivisionId || '').toLowerCase();
        const isNational = ocd === 'ocd-division/country:us';
        const isState = stateOcd ? ocd.startsWith(stateOcd) : false;
        // The special "VIP Test Election" id 2000 is sample data — drop it.
        return e.id !== '2000' && (isNational || isState || !stateOcd);
      })
      .map(e => ({
        id: `gov-${e.id}`,
        date: e.electionDay,        // already YYYY-MM-DD
        label: e.name || 'Election',
        type: inferType(e.name),
        official: true,
      }))
      .filter(e => e.date);

    return res.status(200).json({ elections });
  } catch (err) {
    return res.status(200).json({ elections: [], error: err.message || 'Failed to fetch elections' });
  }
}

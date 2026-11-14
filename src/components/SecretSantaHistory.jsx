import { useMemo, useState } from 'react';
import { personLabel, resolvePerson } from '../lib/secretSanta';
import { parsePastDraws, namesIn, importCandidates, matchName, importedPairs } from '../lib/secretSantaImport';

// Past draws for this event, under the Secret Santa panel: what's saved for
// each earlier year, and a way to load draws from before Rally by pasting them
// in. The most recent earlier year is what "had last time" is read from.
export function SecretSantaHistory({ history, members, friends, year, saveYear, busy }) {
  const [openYear, setOpenYear] = useState(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');
  const [draws, setDraws] = useState(null); // parsed, each with { include, year }
  const [mapping, setMapping] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const pastYears = Object.keys(history || {}).map(Number)
    .filter((y) => Number.isFinite(y) && y < year && history[y]?.pairs?.length > 0)
    .sort((a, b) => b - a);
  const candidates = useMemo(() => importCandidates(members, friends), [members, friends]);
  const chosen = (draws || []).filter((d) => d.include);
  const names = useMemo(() => namesIn((draws || []).filter((d) => d.include)), [draws]);

  // A saved person, shown under their current name when they can be found.
  const label = (ref) => {
    const key = resolvePerson(ref, members);
    return key ? personLabel(members[key]) : (ref?.name || ref?.email || 'Someone');
  };

  function read() {
    const parsed = parsePastDraws(text);
    if (parsed.length === 0) {
      setMessage({ type: 'error', text: 'No picks found. Put one per line, like “Amanda drew Grace”, under a line with the year.' });
      return;
    }
    // Two draws from the same year can't both be this event's: the first is
    // ticked, the rest are left for the organizer to choose between.
    const seen = new Set();
    const next = parsed.map((d) => {
      const include = d.year !== null && d.year < year && !seen.has(d.year);
      if (include) seen.add(d.year);
      return { ...d, include };
    });
    setDraws(next);
    setMapping(Object.fromEntries(namesIn(parsed).map((n) => [n, matchName(n, candidates)])));
    setMessage(null);
  }

  const patchDraw = (i, patch) => setDraws((list) => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const years = chosen.map((d) => Number(d.year));
  const problem = chosen.length === 0 ? 'Tick at least one draw to load.'
    : years.some((y) => !Number.isInteger(y) || y < 1900) ? 'Give every ticked draw a year.'
      : years.some((y) => y >= year) ? `Only years before ${year} can be loaded as past draws.`
        : new Set(years).size !== years.length ? 'Two ticked draws have the same year — an event has one draw a year, so untick one.'
          : '';

  async function save() {
    const replacing = years.filter((y) => history?.[y]?.pairs?.length > 0);
    if (replacing.length > 0 && !window.confirm(`Replace the draw already saved for ${replacing.join(', ')}?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      for (const d of chosen) {
        await saveYear(Number(d.year), { pairs: importedPairs(d, mapping, candidates), imported: true, title: d.title || '' });
      }
      setMessage({ type: 'ok', text: `Loaded ${chosen.length} past ${chosen.length === 1 ? 'draw' : 'draws'}: ${[...years].sort((a, b) => b - a).join(', ')}.` });
      setDraws(null);
      setText('');
      setImporting(false);
    } catch (err) {
      setMessage({ type: 'error', text: `Couldn't save: ${err.message || err}` });
    }
    setSaving(false);
  }

  async function remove(y) {
    if (!window.confirm(`Remove the saved ${y} draw?`)) return;
    try { await saveYear(y, {}); } catch (err) { setMessage({ type: 'error', text: `Couldn't remove: ${err.message || err}` }); }
  }

  const unmatched = names.filter((n) => !mapping[n]);

  return (
    <div data-testid="ss-history" style={{ marginTop: '0.9rem', paddingTop: '0.75rem', borderTop: '1px solid #FECACA' }}>
      <div style={subhead}>Past draws</div>
      {pastYears.length === 0 && <p style={hint}>None saved yet. Load earlier years so nobody gets the same person twice running.</p>}
      {pastYears.map((y) => (
        <div key={y} data-testid={`ss-past-${y}`} style={{ marginBottom: '0.3rem', fontSize: '0.84rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{y}</span>
            <span style={{ color: '#6B7280', fontSize: '0.78rem' }}>
              {history[y].pairs.length} picks{history[y].title ? ` · ${history[y].title}` : ''}{y === pastYears[0] ? ' · used as “last time”' : ''}
            </span>
            <button type="button" style={link} onClick={() => setOpenYear(openYear === y ? null : y)}>{openYear === y ? 'hide' : 'view'}</button>
            <button type="button" style={{ ...link, color: '#6B7280' }} disabled={busy || saving} onClick={() => remove(y)}>remove</button>
          </div>
          {openYear === y && (
            <div style={{ margin: '0.3rem 0 0.5rem', padding: '0.5rem 0.7rem', background: '#fff', border: '1px solid #FECACA', borderRadius: '8px' }}>
              {history[y].pairs.map((p, i) => (
                <div key={i} style={{ fontSize: '0.82rem', padding: '0.1rem 0' }}>
                  <span style={{ fontWeight: 600 }}>{label(p.giver)}</span> <span style={{ color: '#9CA3AF' }}>→</span> {label(p.receiver)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {!importing ? (
        <button type="button" style={link} data-testid="ss-import-open" onClick={() => { setImporting(true); setMessage(null); }}>
          + Load past draws
        </button>
      ) : (
        <div style={{ marginTop: '0.4rem' }}>
          <p style={hint}>
            Paste the old draws: a line with the year, then one pick per line (“Amanda drew Grace”). Several years can go in at once.
          </p>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setDraws(null); }}
            rows={6}
            data-testid="ss-import-text"
            placeholder={'Secret Santa 2025\nAmanda drew Grace\nDan drew Milan\n…'}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.5rem', border: '1px solid #E5E7EB', borderRadius: '8px', fontFamily: 'inherit', fontSize: '0.82rem', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '0.75rem', margin: '0.5rem 0' }}>
            <button type="button" style={secondary} data-testid="ss-import-read" disabled={!text.trim()} onClick={read}>Read picks</button>
            <button type="button" style={{ ...link, color: '#6B7280' }} onClick={() => { setImporting(false); setDraws(null); setMessage(null); }}>Cancel</button>
          </div>

          {draws && (
            <>
              <div style={subhead}>Draws found</div>
              {draws.map((d, i) => (
                <label key={i} data-testid={`ss-import-draw-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.84rem', padding: '0.15rem 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={d.include} onChange={(e) => patchDraw(i, { include: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: '#B91C1C' }} />
                  <span style={{ flex: '1 1 140px', minWidth: 0 }}>{d.title || 'Untitled draw'} <span style={{ color: '#6B7280', fontSize: '0.76rem' }}>({d.pairs.length} picks)</span></span>
                  <input
                    type="number"
                    value={d.year ?? ''}
                    onChange={(e) => patchDraw(i, { year: e.target.value === '' ? null : Number(e.target.value) })}
                    aria-label="Year of this draw"
                    placeholder="year"
                    style={{ width: '4.6rem', padding: '0.15rem 0.3rem', border: '1px solid #E5E7EB', borderRadius: '6px', fontFamily: 'inherit', fontSize: '0.8rem' }}
                  />
                </label>
              ))}

              {names.length > 0 && (
                <>
                  <div style={subhead}>Who is who ({names.length - unmatched.length} of {names.length} matched)</div>
                  <p style={hint}>
                    Each name is matched to a guest of this event, or to someone on your Friends page. Anyone left as “just the name” is kept as typed and can’t be linked to a guest later.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.25rem 0.9rem', marginBottom: '0.6rem' }}>
                    {names.map((n) => (
                      <label key={n} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', minWidth: 0 }}>
                        <span style={{ flex: '0 0 5.2rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                        <select
                          value={mapping[n] || ''}
                          onChange={(e) => setMapping((m) => ({ ...m, [n]: e.target.value }))}
                          aria-label={`Who ${n} is`}
                          data-testid={`ss-map-${n}`}
                          style={{ flex: 1, minWidth: 0, padding: '0.2rem 0.3rem', border: `1px solid ${mapping[n] ? '#E5E7EB' : '#FCD34D'}`, borderRadius: '6px', background: mapping[n] ? '#fff' : '#FFFBEB', fontFamily: 'inherit', fontSize: '0.8rem' }}
                        >
                          <option value="">— just the name “{n}”</option>
                          <optgroup label="Guests of this event">
                            {candidates.filter((c) => c.source === 'guest').map((c) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
                          </optgroup>
                          <optgroup label="Friends">
                            {candidates.filter((c) => c.source === 'friend').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </optgroup>
                        </select>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {problem && <p style={{ ...hint, color: '#B45309' }}>{problem}</p>}
              <button type="button" style={{ ...secondary, opacity: problem || saving ? 0.5 : 1 }} data-testid="ss-import-save" disabled={!!problem || saving} onClick={save}>
                {saving ? 'Saving…' : `Load ${chosen.length} past ${chosen.length === 1 ? 'draw' : 'draws'}`}
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p data-testid="ss-import-message" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: message.type === 'error' ? '#B91C1C' : '#166534' }}>{message.text}</p>
      )}
    </div>
  );
}

const hint = { margin: '0.2rem 0 0.5rem', fontSize: '0.78rem', color: '#6B7280', lineHeight: 1.45 };
const subhead = { fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7280', margin: '0.5rem 0 0.35rem' };
const link = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', textDecoration: 'underline' };
const secondary = { padding: '0.4rem 0.9rem', border: '1px solid #B91C1C', borderRadius: 'var(--radius-md)', background: '#fff', color: '#B91C1C', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' };

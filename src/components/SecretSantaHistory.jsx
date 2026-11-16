import { useMemo, useState } from 'react';
import { personLabel, resolvePerson } from '../lib/secretSanta';
import { format } from 'date-fns';
import { parsePastDraws, namesIn, importCandidates, matchName, importedPairs, editedPairs, drawYears } from '../lib/secretSantaImport';
import { useSecretSantaHistory } from '../hooks/useSecretSantaHistory';
import { DateField } from './DateField';

// The event's "Santa History" tab (organizer only): every past draw — who
// picked whom, and when — each one editable, plus loading draws from before
// Rally by pasting them in. The most recent earlier year is what the draw's
// "had last time" rule reads from.
export function SecretSantaHistoryTab({ event, eventId, user, friends, year }) {
  // The draws live on the organizer's own account. The organizer reads and
  // edits their own; the app's admin can open anyone's, to look only (the
  // rules let the admin read every account and write none but their own).
  const ownerUid = Object.entries(event.members || {}).find(([, m]) => m?.role === 'owner')?.[0] || event.createdBy || user?.uid;
  const readOnly = !!ownerUid && ownerUid !== user?.uid;
  const ownerName = event.members?.[ownerUid]?.name || 'the organizer';
  const source = useMemo(() => ({ uid: ownerUid }), [ownerUid]);
  const { draws } = useSecretSantaHistory(source, eventId);
  const members = useMemo(
    () => Object.fromEntries(Object.entries(event.members || {}).filter(([, m]) => m && typeof m === 'object')),
    [event.members],
  );
  return (
    <div data-testid="ss-history-tab" style={{ maxWidth: '760px' }}>
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#991B1B' }}>🎅 Secret Santa history</h3>
      <p style={hint}>
        {readOnly
          ? `Who has whom, this year and before, from ${ownerName}’s draws. You’re seeing this as the admin; only ${ownerName} can change it.`
          : `Who has whom this year, and who picked whom before. Guests can’t see this. The most recent earlier year is the one nobody can repeat in the ${year} draw.`}
      </p>
      <DrawHistory source={source} eventId={eventId} members={members} friends={friends} year={year} readOnly={readOnly} />
      {/* An event's extra exchanges each keep their own years. */}
      {draws.map((d) => (
        <DrawHistory key={d.id} draw={d} source={source} eventId={eventId} members={members} friends={friends} year={year} readOnly={readOnly} />
      ))}
    </div>
  );
}

// One exchange's draws: this year's, then the earlier ones.
function DrawHistory({ draw = null, source, eventId, members, friends, year, readOnly }) {
  const { history, loadError, saveYear } = useSecretSantaHistory(source, eventId, draw?.id || '');
  return (
    <div data-testid={draw ? `ss-history-${draw.id}` : 'ss-history-main'}>
      {draw && <h4 style={{ margin: '1.5rem 0 0.5rem', fontSize: '0.95rem', fontWeight: 700, color: '#991B1B' }}>🎅 {draw.name}</h4>}
      {loadError && <p style={{ ...hint, color: '#B91C1C' }}>Couldn’t load the history: {loadError}</p>}
      {history === null && !loadError
        ? <p style={hint}>Loading…</p>
        : (
          <>
            <ThisYear record={(history || {})[year]} year={year} members={members} readOnly={readOnly} />
            <SecretSantaHistory history={history || {}} members={members} friends={friends} year={year} saveYear={saveYear} readOnly={readOnly} />
          </>
        )}
    </div>
  );
}

// This year's draw: who has whom, and who has been emailed theirs. Kept
// folded until asked for, so the organizer can keep their own a surprise.
function ThisYear({ record, year, members, readOnly }) {
  const [open, setOpen] = useState(false);
  const pairs = record?.pairs || [];
  const label = (ref) => {
    const key = resolvePerson(ref, members);
    return key ? personLabel(members[key]) : (ref?.name || ref?.email || 'Someone');
  };
  const sentAt = (ref) => record?.sent?.[resolvePerson(ref, members)] || record?.sent?.[ref?.key] || '';
  const stamp = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : format(d, 'MMM d'); };
  const sentCount = pairs.filter((p) => sentAt(p.giver)).length;
  const rows = [...pairs].sort((a, b) => label(a.giver).localeCompare(label(b.giver)));
  return (
    <div data-testid="ss-this-year" style={{ ...card, borderColor: '#F87171' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1rem', fontWeight: 700, color: '#1F2937' }}>{year}</span>
        <span style={{ fontSize: '0.84rem', color: '#4B5563' }}>This year’s draw</span>
        {pairs.length > 0 && (
          <button type="button" style={{ ...link, marginLeft: 'auto' }} data-testid="ss-this-year-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide who has whom' : 'Show who has whom'}
          </button>
        )}
      </div>
      {pairs.length === 0 ? (
        <p style={{ ...hint, margin: '0.2rem 0 0' }}>
          No names drawn for {year} yet.{readOnly ? '' : ' Draw them in the Secret Santa panel on People & Poll.'}
        </p>
      ) : (
        <>
          <div style={{ fontSize: '0.78rem', color: '#6B7280', margin: '0.15rem 0 0.4rem' }}>
            {[`${pairs.length} people`, record.drawnAt && !isNaN(new Date(record.drawnAt)) ? `drawn ${format(new Date(record.drawnAt), 'MMM d, yyyy')}` : '',
              sentCount === 0 ? 'nobody emailed yet' : `${sentCount} of ${pairs.length} emailed their person`].filter(Boolean).join(' · ')}
          </div>
          {!open ? (
            <p style={{ ...hint, margin: 0 }}>The names stay hidden until you ask for them.</p>
          ) : (
            <div data-testid="ss-this-year-pairs" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.15rem 1rem' }}>
              {rows.map((p, i) => (
                <div key={i} style={{ fontSize: '0.86rem', padding: '0.1rem 0', minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{label(p.giver)}</span> <span style={{ color: '#9CA3AF' }}>→</span> {label(p.receiver)}
                  <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: sentAt(p.giver) ? '#166534' : '#9CA3AF', whiteSpace: 'nowrap' }}>
                    {sentAt(p.giver) ? `emailed ${stamp(sentAt(p.giver))}` : 'not emailed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const blankRow = () => ({ id: Math.random().toString(36).slice(2), giver: '', receiver: '' });

// One year's draw: the picks, and an edit mode for changing any of it.
function YearCard({ y, record, isLatest, label, candidates, year, takenYears, saveYear, startEditing = false, onDone, readOnly = false }) {
  const [editing, setEditing] = useState(startEditing);
  const isNew = y === null;
  const initialRows = () => (record?.pairs || []).map((p) => ({
    ...blankRow(), giver: label(p.giver), receiver: label(p.receiver),
    giverWas: label(p.giver), receiverWas: label(p.receiver), giverRef: p.giver, receiverRef: p.receiver,
  })).concat(isNew ? [blankRow(), blankRow(), blankRow()] : []);
  // A brand-new year opens straight into edit mode, with a few empty rows.
  const [rows, setRows] = useState(() => (startEditing ? initialRows() : []));
  const [yearText, setYearText] = useState(String(y ?? ''));
  const [dateText, setDateText] = useState(record?.date || '');
  const [title, setTitle] = useState(record?.title || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function begin() {
    setRows(initialRows());
    setYearText(String(y ?? ''));
    setDateText(record?.date || '');
    setTitle(record?.title || '');
    setError('');
    setEditing(true);
  }

  const patchRow = (id, patch) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function save() {
    const newYear = Number(yearText);
    if (!Number.isInteger(newYear) || newYear < 1900) { setError('Enter the year of this draw.'); return; }
    if (newYear >= year) { setError(`History is for years before ${year} — this year’s draw is on the People & Poll tab.`); return; }
    if (newYear !== y && takenYears.includes(newYear)) { setError(`There is already a draw saved for ${newYear}.`); return; }
    const out = editedPairs(rows, candidates);
    if (out.error) { setError(out.error); return; }
    setSaving(true);
    setError('');
    try {
      const next = { ...(record || {}), pairs: out.pairs, title: title.trim(), editedAt: new Date().toISOString() };
      if (dateText) next.date = dateText; else delete next.date;
      await saveYear(newYear, next);
      if (!isNew && newYear !== y) await saveYear(y, {});
      setEditing(false);
      onDone?.();
    } catch (err) {
      setError(`Couldn't save: ${err.message || err}`);
    }
    setSaving(false);
  }

  async function removeYear() {
    if (!window.confirm(`Delete the ${y} draw from the history?`)) return;
    try { await saveYear(y, {}); } catch (err) { setError(`Couldn't delete: ${err.message || err}`); }
  }

  const when = record?.date ? format(new Date(`${record.date}T12:00:00`), 'EEEE, MMMM d, yyyy') : '';
  const stamp = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : format(d, 'MMM d, yyyy'); };
  const source = record?.drawnAt ? `drawn in Rally ${stamp(record.drawnAt)}`
    : record?.imported ? `loaded${record.importedAt ? ` ${stamp(record.importedAt)}` : ' from a past draw'}`
      : record?.manual ? 'entered by hand' : '';

  return (
    <div data-testid={isNew ? 'ss-year-new' : `ss-past-${y}`} style={card}>
      {!editing ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#1F2937' }}>{y}</span>
            {record.title && <span style={{ fontSize: '0.84rem', color: '#4B5563' }}>{record.title}</span>}
            {isLatest && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#991B1B', background: '#FEE2E2', borderRadius: '999px', padding: '0.1rem 0.5rem' }}>used as “last time”</span>}
            {!readOnly && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem' }}>
                <button type="button" style={link} data-testid={`ss-edit-${y}`} onClick={begin}>Edit</button>
                <button type="button" style={{ ...link, color: '#6B7280' }} onClick={removeYear}>Delete</button>
              </span>
            )}
          </div>
          <div data-testid={`ss-when-${y}`} style={{ fontSize: '0.78rem', color: '#6B7280', margin: '0.15rem 0 0.5rem' }}>
            {[when || `Year ${y}`, `${record.pairs.length} picks`, source, record.editedAt ? `edited ${stamp(record.editedAt)}` : ''].filter(Boolean).join(' · ')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.15rem 1rem' }}>
            {record.pairs.map((p, i) => (
              <div key={i} style={{ fontSize: '0.86rem', padding: '0.1rem 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>{label(p.giver)}</span> <span style={{ color: '#9CA3AF' }}>→</span> {label(p.receiver)}
              </div>
            ))}
          </div>
          {error && <p style={{ ...hint, color: '#B91C1C' }}>{error}</p>}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            <label style={field}>Year
              <input type="number" value={yearText} onChange={(e) => setYearText(e.target.value)} data-testid="ss-edit-year" style={{ ...input, width: '5.5rem' }} />
            </label>
            <label style={{ ...field, flex: '0 1 11rem' }}>Date (optional)
              <DateField value={dateText} onChange={(e) => setDateText(e.target.value)} aria-label="Date of this draw" style={{ ...input, background: "#fff", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.4rem", width: "100%" }} />
            </label>
            <label style={{ ...field, flex: '1 1 10rem' }}>Name (optional)
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Secret Santa 2025" style={input} />
            </label>
          </div>
          <datalist id="ss-people">
            {candidates.map((c) => <option key={c.id} value={c.name || c.email} />)}
          </datalist>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.5rem' }}>
            {rows.map((r) => (
              <div key={r.id} data-testid="ss-edit-row" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                <input list="ss-people" value={r.giver} onChange={(e) => patchRow(r.id, { giver: e.target.value })} placeholder="Who drew" aria-label="Who drew" style={{ ...input, flex: 1, minWidth: 0 }} />
                <span style={{ color: '#9CA3AF', fontSize: '0.8rem', flexShrink: 0 }}>drew</span>
                <input list="ss-people" value={r.receiver} onChange={(e) => patchRow(r.id, { receiver: e.target.value })} placeholder="Whom" aria-label="Whom they drew" style={{ ...input, flex: 1, minWidth: 0 }} />
                <button type="button" title="Remove this pick" aria-label="Remove this pick" onClick={() => setRows((list) => list.filter((x) => x.id !== r.id))} style={{ border: 'none', background: 'none', color: '#9CA3AF', fontSize: '1.1rem', cursor: 'pointer', padding: '0 0.25rem', flexShrink: 0 }}>×</button>
              </div>
            ))}
          </div>
          <button type="button" style={link} data-testid="ss-edit-add" onClick={() => setRows((list) => [...list, blankRow()])}>+ Add a pick</button>
          <p style={hint}>Pick a name from the list (your guests and friends) or type anyone else’s.</p>
          {error && <p data-testid="ss-edit-error" style={{ ...hint, color: '#B91C1C' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="button" style={{ ...secondary, opacity: saving ? 0.5 : 1 }} disabled={saving} data-testid="ss-edit-save" onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" style={{ ...link, color: '#6B7280' }} onClick={() => { setEditing(false); onDone?.(); }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function SecretSantaHistory({ history, members, friends, year, saveYear, readOnly = false }) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');
  const [draws, setDraws] = useState(null); // parsed, each with { include, year }
  const [mapping, setMapping] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const pastYears = drawYears(history, year);
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
        await saveYear(Number(d.year), { pairs: importedPairs(d, mapping, candidates), imported: true, importedAt: new Date().toISOString(), title: d.title || '' });
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

  const unmatched = names.filter((n) => !mapping[n]);

  return (
    <div data-testid="ss-history">
      {pastYears.length === 0 && !adding && <p style={hint}>{readOnly ? 'No earlier years saved.' : 'Nothing saved yet. Load earlier years, or add one by hand, so nobody gets the same person twice running.'}</p>}
      {pastYears.map((y) => (
        <YearCard
          key={y}
          y={y}
          record={history[y]}
          isLatest={y === pastYears[0]}
          label={label}
          candidates={candidates}
          year={year}
          takenYears={pastYears}
          saveYear={saveYear}
          readOnly={readOnly}
        />
      ))}
      {adding && (
        <YearCard y={null} record={null} label={label} candidates={candidates} year={year} takenYears={pastYears} saveYear={saveYear} startEditing onDone={() => setAdding(false)} />
      )}
      {!readOnly && !adding && !importing && (
        <button type="button" style={{ ...link, marginRight: '1rem' }} data-testid="ss-add-year" onClick={() => setAdding(true)}>+ Add a year by hand</button>
      )}

      {readOnly ? null : !importing ? (
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
const card = { marginBottom: '0.75rem', padding: '0.8rem 1rem', background: '#fff', border: '1px solid #FECACA', borderRadius: 'var(--radius-md)' };
const field = { display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.72rem', fontWeight: 600, color: '#6B7280' };
const input = { padding: '0.35rem 0.5rem', border: '1px solid #E5E7EB', borderRadius: '6px', fontFamily: 'inherit', fontSize: '0.84rem', boxSizing: 'border-box' };
const link = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', textDecoration: 'underline' };
const secondary = { padding: '0.4rem 0.9rem', border: '1px solid #B91C1C', borderRadius: 'var(--radius-md)', background: '#fff', color: '#B91C1C', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' };

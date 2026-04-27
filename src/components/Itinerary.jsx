import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import styles from './Itinerary.module.css';

const TRAVEL_MODES = [
  { key: 'driving', icon: '🚗', label: 'Drive' },
  { key: 'walking', icon: '🚶', label: 'Walk' },
  { key: 'transit', icon: '🚆', label: 'Transit' },
  { key: 'bicycling', icon: '🚲', label: 'Bike' },
  { key: 'flying', icon: '✈️', label: 'Fly' },
];

function ModeSelector({ value, onChange }) {
  return (
    <div className={styles.modeSelector} onClick={e => e.stopPropagation()}>
      {TRAVEL_MODES.map(m => (
        <button
          key={m.key}
          type="button"
          className={value === m.key ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => onChange(m.key)}
          title={m.label}
          aria-label={m.label}
        >
          <span className={styles.modeIcon}>{m.icon}</span>
          <span className={styles.modeLabelText}>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

function ModeSelectorInline({ value, onChange, disabled }) {
  return (
    <div className={styles.modeSelectorInline} onClick={e => e.stopPropagation()}>
      {TRAVEL_MODES.map(m => (
        <button
          key={m.key}
          type="button"
          className={value === m.key ? styles.modeInlineBtnActive : styles.modeInlineBtn}
          onClick={() => !disabled && onChange(m.key)}
          title={m.label}
          aria-label={m.label}
          disabled={disabled}
        >
          {m.icon}
        </button>
      ))}
    </div>
  );
}

function isInstagramUrl(url) {
  try {
    const u = new URL(url);
    return /(^|\.)instagram\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

// Strip share-tracking params (e.g. ?igsh=...) so the embed permalink is clean.
function normalizeInstagramUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return url;
    return `https://www.instagram.com${u.pathname.replace(/\/+$/, '')}/`;
  } catch {
    return url;
  }
}

function buildGoogleFlightsUrl(row, event) {
  const from = (row.from || '').trim();
  const to = (row.to || '').trim();
  if (!from && !to) return null;

  const toIsoDate = (d) => {
    if (!d) return '';
    const date = d?.toDate ? d.toDate() : new Date(d);
    if (isNaN(date)) return '';
    return date.toISOString().split('T')[0];
  };
  const startIso = toIsoDate(event?.startDate || event?.date);
  const endIso = toIsoDate(event?.endDate);

  const parts = ['Flights'];
  if (from) parts.push(`from ${from}`);
  if (to) parts.push(`to ${to}`);
  if (startIso) parts.push(`on ${startIso}`);
  if (row.tripType === 'round-trip' && endIso) parts.push(`returning ${endIso}`);

  return `https://www.google.com/travel/flights?q=${encodeURIComponent(parts.join(' '))}`;
}

function FlightCosts({ event, onSave, canEdit }) {
  const rawItems = Array.isArray(event?.flightCosts) ? event.flightCosts : [];
  // Migrate legacy { city, cost } shape on read so existing data still renders.
  const items = rawItems.map(it => ({
    id: it.id,
    from: it.from || '',
    to: it.to || it.city || '',
    cost: it.cost || '',
    tripType: it.tripType === 'one-way' ? 'one-way' : 'round-trip',
    stops: typeof it.stops === 'number' ? it.stops : 0,
    starred: !!it.starred,
  }));
  // Local edits per row, committed to Firestore on blur. This avoids writing
  // on every keystroke while still showing the user their input immediately.
  const [drafts, setDrafts] = useState({});

  function getValue(id, field) {
    if (drafts[id] && drafts[id][field] !== undefined) return drafts[id][field];
    const row = items.find(x => x.id === id);
    return row?.[field] || '';
  }

  function setDraft(id, field, value) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function commit(id) {
    const draft = drafts[id];
    if (!draft) return;
    const row = items.find(x => x.id === id);
    if (!row) return;
    const merged = {
      id: row.id,
      from: (draft.from !== undefined ? draft.from : row.from || '').trim(),
      to: (draft.to !== undefined ? draft.to : row.to || '').trim(),
      cost: (draft.cost !== undefined ? draft.cost : row.cost || '').trim(),
    };
    if (merged.from === row.from && merged.to === row.to && merged.cost === row.cost) {
      setDrafts(prev => { const c = { ...prev }; delete c[id]; return c; });
      return;
    }
    await onSave({ flightCosts: rawItems.map(x => x.id === id ? merged : x) });
    setDrafts(prev => { const c = { ...prev }; delete c[id]; return c; });
  }

  async function addRow() {
    const newRow = { id: crypto.randomUUID(), from: '', to: '', cost: '$', tripType: 'round-trip', stops: 0 };
    await onSave({ flightCosts: [...rawItems, newRow] });
  }

  async function setTripType(id, tripType) {
    await onSave({
      flightCosts: rawItems.map(x => x.id === id ? { ...x, tripType } : x),
    });
  }

  async function setStops(id, stops) {
    await onSave({
      flightCosts: rawItems.map(x => x.id === id ? { ...x, stops } : x),
    });
  }

  // Single-select star: starring one row clears the star on every other row.
  async function toggleStar(id) {
    const wasStarred = !!rawItems.find(x => x.id === id)?.starred;
    await onSave({
      flightCosts: rawItems.map(x => x.id === id
        ? { ...x, starred: !wasStarred }
        : { ...x, starred: false }),
    });
  }

  async function removeRow(id) {
    await onSave({ flightCosts: rawItems.filter(x => x.id !== id) });
    setDrafts(prev => { const c = { ...prev }; delete c[id]; return c; });
  }

  return (
    <div className={styles.flightCostsSection}>
      <div className={styles.flightCostsHeader}>
        <div>
          <h4 className={styles.flightCostsTitle}>✈️ Flight Costs</h4>
          <div className={styles.flightCostsSubtitle}>
            Track flight prices between cities.
          </div>
        </div>
        {canEdit && (
          <button className={styles.flightCostsAddBtn} onClick={addRow}>+ Add flight</button>
        )}
      </div>

      {items.length === 0 ? (
        <div className={styles.flightCostsEmpty}>
          {canEdit
            ? 'No flights yet. Click "+ Add flight" to start.'
            : 'No flight costs added yet.'}
        </div>
      ) : (
        <div className={styles.flightCostsGrid}>
          {items.map(row => (
            <div
              key={row.id}
              className={row.starred ? `${styles.flightCostCard} ${styles.flightCostCardStarred}` : styles.flightCostCard}
            >
              <button
                type="button"
                onClick={() => canEdit && toggleStar(row.id)}
                disabled={!canEdit}
                className={row.starred ? styles.flightCostStarBtnActive : styles.flightCostStarBtn}
                title={row.starred ? 'This is the chosen flight' : 'Mark as the best option'}
                aria-label={row.starred ? 'Unstar' : 'Star'}
              >{row.starred ? '★' : '☆'}</button>
              {canEdit && (
                <button
                  type="button"
                  className={styles.flightCostRemoveBtn}
                  onClick={() => removeRow(row.id)}
                  title="Remove"
                  aria-label="Remove"
                >✕</button>
              )}
              <div className={styles.flightCostTypeRow}>
                <button
                  type="button"
                  className={row.tripType === 'one-way' ? styles.flightCostTypeBtnActive : styles.flightCostTypeBtn}
                  onClick={() => canEdit && setTripType(row.id, 'one-way')}
                  disabled={!canEdit}
                >One way</button>
                <button
                  type="button"
                  className={row.tripType === 'round-trip' ? styles.flightCostTypeBtnActive : styles.flightCostTypeBtn}
                  onClick={() => canEdit && setTripType(row.id, 'round-trip')}
                  disabled={!canEdit}
                >Round</button>
              </div>
              <input
                type="text"
                placeholder="From"
                value={getValue(row.id, 'from')}
                disabled={!canEdit}
                onChange={e => setDraft(row.id, 'from', e.target.value)}
                onBlur={() => commit(row.id)}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                className={styles.flightCostInput}
              />
              <input
                type="text"
                placeholder="To"
                value={getValue(row.id, 'to')}
                disabled={!canEdit}
                onChange={e => setDraft(row.id, 'to', e.target.value)}
                onBlur={() => commit(row.id)}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                className={styles.flightCostInput}
              />
              <div className={styles.flightCostStopsCostRow}>
                <select
                  value={row.stops}
                  disabled={!canEdit}
                  onChange={e => setStops(row.id, parseInt(e.target.value, 10))}
                  className={styles.flightCostSelect}
                >
                  <option value={0}>Direct</option>
                  <option value={1}>1 stop</option>
                  <option value={2}>2 stops</option>
                  <option value={3}>3+ stops</option>
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="$0"
                  value={getValue(row.id, 'cost')}
                  disabled={!canEdit}
                  onChange={e => setDraft(row.id, 'cost', e.target.value)}
                  onBlur={() => commit(row.id)}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                  className={styles.flightCostInputCost}
                />
              </div>
              {(() => {
                const url = buildGoogleFlightsUrl(row, event);
                if (!url) return null;
                return (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.flightCostSearchLink}
                    title="Search this route on Google Flights"
                  >🔍 Google Flights</a>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Read URLs from a highlight, falling back to legacy single `url` field.
function getHighlightUrls(h) {
  if (Array.isArray(h?.urls) && h.urls.length > 0) return h.urls.filter(Boolean);
  if (h?.url) return [h.url];
  return [];
}

function cleanUrlList(arr) {
  return (arr || [])
    .map(u => (u || '').trim())
    .filter(Boolean)
    .map(u => isInstagramUrl(u) ? normalizeInstagramUrl(u) : u);
}

function UrlInputList({ urls, setUrls, autoFocus = false }) {
  const list = urls.length > 0 ? urls : [''];
  function update(i, value) {
    const next = list.slice();
    next[i] = value;
    setUrls(next);
  }
  function removeAt(i) {
    const next = list.filter((_, idx) => idx !== i);
    setUrls(next.length > 0 ? next : ['']);
  }
  function addRow() {
    setUrls([...list, '']);
  }
  return (
    <div className={styles.urlList}>
      <div className={styles.urlListLabel}>Links / Videos</div>
      {list.map((u, i) => (
        <div key={i} className={styles.urlRow}>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={styles.highlightsInput}
            placeholder={i === 0
              ? 'Paste an Instagram, YouTube, or any link'
              : 'Another link'}
            value={u}
            onChange={e => update(i, e.target.value)}
            autoFocus={autoFocus && i === 0}
          />
          {(list.length > 1 || u) && (
            <button
              type="button"
              className={styles.urlRemoveBtn}
              onClick={() => removeAt(i)}
              title="Remove link"
              aria-label="Remove link"
            >✕</button>
          )}
        </div>
      ))}
      <button
        type="button"
        className={styles.urlAddBtn}
        onClick={addRow}
      >+ Add another link</button>
    </div>
  );
}

function TripHighlightsList({ event, onSave, canEdit }) {
  const { user } = useAuth();
  const highlights = Array.isArray(event?.tripHighlights) ? event.tripHighlights : [];
  const [adding, setAdding] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftCost, setDraftCost] = useState('');
  const [draftUrls, setDraftUrls] = useState(['']);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editUrls, setEditUrls] = useState(['']);

  function resetDraft() {
    setDraftText('');
    setDraftCost('');
    setDraftUrls(['']);
  }

  async function add() {
    const text = draftText.trim();
    if (!text) return;
    const newH = {
      id: crypto.randomUUID(),
      text,
      cost: draftCost.trim(),
      urls: cleanUrlList(draftUrls),
      locked: false,
      addedAt: new Date().toISOString(),
      addedByUid: user?.uid || '',
      addedByName: event?.members?.[user?.uid]?.name || user?.displayName || user?.email || 'Member',
    };
    await onSave({ tripHighlights: [...highlights, newH] });
    resetDraft();
    setAdding(false);
  }

  async function toggleLock(id) {
    await onSave({
      tripHighlights: highlights.map(h => h.id === id ? { ...h, locked: !h.locked } : h),
    });
  }

  function startEdit(h) {
    if (h.locked) return;
    setEditingId(h.id);
    setEditText(h.text || '');
    setEditCost(h.cost || '');
    const existing = getHighlightUrls(h);
    setEditUrls(existing.length > 0 ? existing : ['']);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
    setEditCost('');
    setEditUrls(['']);
  }

  async function saveEdit() {
    const text = editText.trim();
    if (!text || !editingId) { cancelEdit(); return; }
    const urls = cleanUrlList(editUrls);
    await onSave({
      tripHighlights: highlights.map(h => h.id === editingId
        ? { ...h, text, cost: editCost.trim(), urls, url: '' }
        : h),
    });
    cancelEdit();
  }

  async function remove(id) {
    const h = highlights.find(x => x.id === id);
    if (!h) return;
    if (h.locked) { alert('Unlock this highlight before removing it.'); return; }
    if (!confirm('Remove this highlight?')) return;
    await onSave({ tripHighlights: highlights.filter(x => x.id !== id) });
  }

  async function move(id, delta) {
    const idx = highlights.findIndex(x => x.id === id);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= highlights.length) return;
    const next = highlights.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    await onSave({ tripHighlights: next });
  }

  // Cast or move the current user's rank vote on a highlight.
  // Each member can have at most one highlight per rank (1, 2, 3).
  // Clicking the same rank again removes their vote.
  async function castVote(highlightId, rank) {
    if (!user) return;
    const uid = user.uid;
    const target = highlights.find(h => h.id === highlightId);
    if (!target) return;
    const wasAtThisRank = (target.votes || {})[uid] === rank;
    const next = highlights.map(h => {
      const votes = { ...(h.votes || {}) };
      if (h.id === highlightId) {
        if (wasAtThisRank) delete votes[uid];
        else votes[uid] = rank;
      } else if (votes[uid] === rank) {
        // User is moving this rank away from another highlight.
        delete votes[uid];
      }
      return { ...h, votes };
    });
    await onSave({ tripHighlights: next });
  }

  return (
    <div className={styles.highlightsSection}>
      <div className={styles.highlightsHeaderRow}>
        <div>
          <h4 className={styles.highlightsTitle}>✨ Trip Highlights</h4>
          <div className={styles.highlightsSubtitle}>
            Must-do experiences. The AI assistant plans the itinerary around these. Lock 🔒 the ones it must keep. Add Instagram links to embed videos.
          </div>
        </div>
        {canEdit && !adding && (
          <button className={styles.highlightsAddBtn} onClick={() => setAdding(true)}>+ Add highlight</button>
        )}
      </div>

      {adding && (
        <div className={styles.highlightsForm}>
          <input
            type="text"
            className={styles.highlightsInput}
            placeholder="e.g., See the Sagrada Familia"
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setAdding(false); resetDraft(); }
            }}
            autoFocus
          />
          <input
            type="text"
            className={styles.highlightsInput}
            placeholder="Cost (optional, e.g., $50/person, free, ~€20)"
            value={draftCost}
            onChange={e => setDraftCost(e.target.value)}
          />
          <UrlInputList urls={draftUrls} setUrls={setDraftUrls} />
          <div className={styles.highlightsFormActions}>
            <button
              type="button"
              className={styles.highlightsCancelBtn}
              onClick={() => { setAdding(false); resetDraft(); }}
            >Cancel</button>
            <button
              type="button"
              className={styles.highlightsSaveBtn}
              onClick={add}
              disabled={!draftText.trim()}
            >Add</button>
          </div>
        </div>
      )}

      {highlights.length === 0 && !adding ? (
        <div className={styles.highlightsEmpty}>
          No highlights yet. Add the must-do experiences for this trip — the AI assistant will plan around them.
        </div>
      ) : (
        <ul className={styles.highlightsList}>
          {highlights.map((h, idx) => {
            const urls = getHighlightUrls(h);
            return (
              <li
                key={h.id}
                className={h.locked ? `${styles.highlightRow} ${styles.highlightRowLocked}` : styles.highlightRow}
              >
                <div className={styles.highlightRowMain}>
                  <button
                    type="button"
                    onClick={() => canEdit && toggleLock(h.id)}
                    disabled={!canEdit}
                    title={h.locked
                      ? 'Locked — AI must include this. Click to unlock.'
                      : 'Unlocked — AI may skip this. Click to lock.'}
                    className={styles.highlightLockBtn}
                    aria-label={h.locked ? 'Unlock highlight' : 'Lock highlight'}
                  >
                    {h.locked ? '🔒' : '🔓'}
                  </button>
                  <span className={styles.highlightNumber} aria-label={`Stop ${idx + 1}`}>{idx + 1}</span>
                  {editingId === h.id ? (
                    <div className={styles.highlightEditFields}>
                      <input
                        type="text"
                        className={styles.highlightInlineInput}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                      />
                      <input
                        type="text"
                        className={styles.highlightInlineInput}
                        placeholder="Cost (optional, e.g., $50/person, free)"
                        value={editCost}
                        onChange={e => setEditCost(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                      <UrlInputList urls={editUrls} setUrls={setEditUrls} />
                      <div className={styles.highlightEditActions}>
                        <button
                          type="button"
                          className={styles.highlightInlineSaveBtn}
                          onClick={saveEdit}
                        >Save</button>
                        <button
                          type="button"
                          className={styles.highlightInlineCancelBtn}
                          onClick={cancelEdit}
                        >✕</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className={styles.highlightText}>{h.text}</span>
                      <div className={styles.highlightRowEnd}>
                        {h.cost && (
                          <span className={styles.highlightCost} title="Estimated cost">{h.cost}</span>
                        )}
                        {urls.map((u, i) => {
                          const ig = isInstagramUrl(u);
                          return (
                            <a
                              key={`${u}-${i}`}
                              href={u}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.highlightLinkBtn}
                              title={u}
                              aria-label={ig ? 'Open Instagram' : 'Open link'}
                            >{ig ? '📱' : '🔗'}</a>
                          );
                        })}
                        <div className={styles.highlightVotes}>
                          {[1, 2, 3].map(rank => {
                            const myRank = user ? (h.votes || {})[user.uid] : null;
                            const isMine = myRank === rank;
                            const count = Object.values(h.votes || {}).filter(v => v === rank).length;
                            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
                            return (
                              <button
                                key={rank}
                                type="button"
                                onClick={() => castVote(h.id, rank)}
                                disabled={!user}
                                className={isMine ? styles.highlightVoteBtnActive : styles.highlightVoteBtn}
                                title={!user
                                  ? 'Sign in to vote'
                                  : isMine
                                    ? `Your #${rank} pick (click to remove)`
                                    : `Vote as #${rank}`}
                                aria-label={`Vote as #${rank}`}
                              >
                                <span aria-hidden="true">{medal}</span>
                                {count > 0 && <span>{count}</span>}
                              </button>
                            );
                          })}
                        </div>
                        {(() => {
                          const counts = { 1: 0, 2: 0, 3: 0 };
                          for (const rank of Object.values(h.votes || {})) {
                            if (rank === 1 || rank === 2 || rank === 3) counts[rank]++;
                          }
                          const score = counts[1] * 3 + counts[2] * 2 + counts[3] * 1;
                          return (
                            <span
                              className={score > 0 ? styles.highlightScoreActive : styles.highlightScore}
                              title={`Ranked-choice score: 3×${counts[1]} + 2×${counts[2]} + 1×${counts[3]} = ${score}`}
                            >
                              <span aria-hidden="true">★</span> {score}
                            </span>
                          );
                        })()}
                        {canEdit && (
                          <div className={styles.highlightActions}>
                          <button
                            type="button"
                            className={styles.highlightIconBtn}
                            onClick={() => move(h.id, -1)}
                            disabled={idx === 0}
                            title="Move up"
                            aria-label="Move up"
                          >↑</button>
                          <button
                            type="button"
                            className={styles.highlightIconBtn}
                            onClick={() => move(h.id, 1)}
                            disabled={idx === highlights.length - 1}
                            title="Move down"
                            aria-label="Move down"
                          >↓</button>
                          {!h.locked && (
                            <>
                              <button
                                type="button"
                                className={styles.highlightIconBtn}
                                onClick={() => startEdit(h)}
                                title="Edit"
                                aria-label="Edit"
                              >✏️</button>
                              <button
                                type="button"
                                className={styles.highlightIconBtn}
                                onClick={() => remove(h.id)}
                                title="Remove"
                                aria-label="Remove"
                              >🗑️</button>
                            </>
                          )}
                        </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatItemDateTime(item) {
  if (!item.date) return '';
  const d = new Date(item.date + 'T' + (item.time || '00:00'));
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = item.time ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  return timeStr ? `${dateStr} · ${timeStr}` : dateStr;
}

// Travel items with "A → B" style locations have a start and end. Other items have a single location.
function extractStartEnd(item) {
  const loc = (item.location || '').trim();
  if (!loc) return { start: '', end: '' };
  if ((item.type || 'activity') === 'travel') {
    const parts = loc.split(/\s*[→➜➡>]\s*|\s+to\s+/i);
    if (parts.length >= 2) {
      return { start: parts[0].trim(), end: parts[parts.length - 1].trim() };
    }
  }
  return { start: loc, end: loc };
}

function inferTravelMode(item) {
  if (item?.travelMode) return item.travelMode;
  const t = ((item?.title || '') + ' ' + (item?.type || '')).toLowerCase();
  if (/flight|fly|plane|airport/.test(t)) return 'flying';
  if (/train|rail/.test(t)) return 'transit';
  if (/walk/.test(t)) return 'walking';
  if (/bike|bicycle/.test(t)) return 'bicycling';
  return 'driving';
}

function buildDirectionsEmbed(mapsKey, origin, destination, waypoints = [], mode = 'driving', zoom = null) {
  const modeParam = mode === 'flying' ? '' : `&mode=${mode}`;
  const wp = waypoints.length > 0
    ? `&waypoints=${waypoints.map(encodeURIComponent).join('|')}`
    : '';
  const zoomParam = typeof zoom === 'number' ? `&zoom=${zoom}` : '';
  return `https://www.google.com/maps/embed/v1/directions?key=${mapsKey}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${modeParam}${wp}${zoomParam}`;
}

function buildDirectionsLink(origin, destination, waypoints = []) {
  const path = [origin, ...waypoints, destination].map(encodeURIComponent).join('/');
  return `https://www.google.com/maps/dir/${path}`;
}

function buildPlaceEmbed(mapsKey, query) {
  return `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${encodeURIComponent(query)}`;
}

// Google Maps JavaScript API loader — loads once per page, shared promise.
let mapsApiPromise = null;
function loadMapsAPI(key) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.maps?.DirectionsService) return Promise.resolve(window.google);
  if (mapsApiPromise) return mapsApiPromise;
  mapsApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      mapsApiPromise = null;
      reject(new Error('Failed to load Google Maps JS'));
    };
    document.head.appendChild(script);
  });
  return mapsApiPromise;
}

const GOOGLE_TRAVEL_MODE = {
  driving: 'DRIVING',
  walking: 'WALKING',
  bicycling: 'BICYCLING',
  transit: 'TRANSIT',
  flying: 'DRIVING',
};

const MODE_COLOR = {
  driving: '#0891b2',
  walking: '#16a34a',
  bicycling: '#d97706',
  transit: '#6366F1',
  flying: '#9333EA',
};

// Overview map showing every leg on one canvas, each in its own mode color.
function TripOverviewMap({ mapsKey, transitions }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const renderersRef = useRef([]);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [polylines, setPolylines] = useState({}); // depKey -> [{polyline, mode}]
  const depKey = transitions.map(t => `${t.from}|${t.to}|${t.mode}`).join('\n');

  useEffect(() => {
    if (!mapsKey) return;
    let mounted = true;
    loadMapsAPI(mapsKey).then(google => {
      if (!mounted || !containerRef.current) return;
      mapRef.current = new google.maps.Map(containerRef.current, {
        zoom: 10,
        center: { lat: 40.7128, lng: -74.006 },
        mapTypeControl: false,
        streetViewControl: false,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      setReady(true);
    }).catch(e => mounted && setError(e.message));
    return () => {
      mounted = false;
      for (const r of renderersRef.current) r.setMap(null);
      renderersRef.current = [];
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
    };
  }, [mapsKey]);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.google?.maps) return;
    const google = window.google;
    // Clear previous renderers + markers
    for (const r of renderersRef.current) r.setMap(null);
    renderersRef.current = [];
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];

    const service = new google.maps.DirectionsService();
    const bounds = new google.maps.LatLngBounds();
    let remaining = transitions.length;
    if (remaining === 0) return;
    const collected = [];

    // Build the ordered list of unique stops so each gets one numbered marker.
    const stopOrder = [];
    const stopIndex = new Map();
    const addStop = (loc, title) => {
      const key = (loc || '').trim().toLowerCase();
      if (!key) return;
      if (stopIndex.has(key)) return;
      stopIndex.set(key, stopOrder.length);
      stopOrder.push({ loc, title });
    };
    for (const t of transitions) {
      addStop(t.from, t.fromTitle);
      addStop(t.to, t.toTitle);
    }
    const stopLatLngs = new Array(stopOrder.length).fill(null);

    const placeMarkersIfReady = () => {
      if (stopLatLngs.some(ll => ll === null)) return;
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
      stopLatLngs.forEach((ll, i) => {
        if (!ll) return;
        const marker = new google.maps.Marker({
          position: ll,
          map: mapRef.current,
          label: { text: String(i + 1), color: '#fff', fontWeight: '700', fontSize: '12px' },
          title: stopOrder[i].title || '',
        });
        markersRef.current.push(marker);
      });
    };

    transitions.forEach((t, tIdx) => {
      const renderer = new google.maps.DirectionsRenderer({
        map: mapRef.current,
        preserveViewport: true,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: MODE_COLOR[t.mode] || MODE_COLOR.driving,
          strokeWeight: 4,
          strokeOpacity: 0.85,
        },
      });
      renderersRef.current.push(renderer);

      service.route({
        origin: t.from,
        destination: t.to,
        travelMode: google.maps.TravelMode[GOOGLE_TRAVEL_MODE[t.mode] || 'DRIVING'],
      }, (result, status) => {
        remaining -= 1;
        if (status === 'OK') {
          renderer.setDirections(result);
          const leg = result.routes[0];
          if (leg?.bounds) bounds.union(leg.bounds);
          const raw = leg?.overview_polyline;
          const encStr = typeof raw === 'string' ? raw : (raw?.points || null);
          if (encStr) collected.push({ polyline: encStr, mode: t.mode });

          // Capture start/end latlng for stop markers (if not already captured).
          const firstLeg = leg?.legs?.[0];
          const lastLeg = leg?.legs?.[leg?.legs?.length - 1];
          const fromKey = (t.from || '').trim().toLowerCase();
          const toKey = (t.to || '').trim().toLowerCase();
          const fromIdx = stopIndex.get(fromKey);
          const toIdx = stopIndex.get(toKey);
          if (firstLeg?.start_location && fromIdx != null && !stopLatLngs[fromIdx]) {
            stopLatLngs[fromIdx] = firstLeg.start_location;
          }
          if (lastLeg?.end_location && toIdx != null && !stopLatLngs[toIdx]) {
            stopLatLngs[toIdx] = lastLeg.end_location;
          }
        } else {
          console.warn('Overview route failed:', status, 'for', t.from, '→', t.to);
        }
        if (remaining === 0) {
          if (!bounds.isEmpty()) {
            mapRef.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
          }
          setPolylines({ [depKey]: collected });
          placeMarkersIfReady();
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, depKey]);

  if (error) return <div className={styles.routeMapError}>Map unavailable: {error}</div>;
  const currentPolylines = polylines[depKey];
  const staticUrl = mapsKey && currentPolylines && currentPolylines.length > 0
    ? buildStaticMapUrl(mapsKey, currentPolylines, '900x500')
    : null;
  return (
    <>
      <div ref={containerRef} className={styles.tripOverviewMap} />
      {staticUrl && (
        <img
          src={staticUrl}
          alt="Trip route overview"
          className={styles.tripOverviewMapPrint}
          onError={() => console.warn('Static overview map failed to load:', staticUrl)}
        />
      )}
    </>
  );
}

// Colors in Static Maps need the 0xRRGGBB form, no leading '#'.
function modeColorHex(mode) {
  return (MODE_COLOR[mode] || MODE_COLOR.driving).replace('#', '0x');
}

function buildStaticMapUrl(mapsKey, paths, size = '640x360') {
  const pathParams = paths.map(p =>
    `path=color:${modeColorHex(p.mode)}|weight:5|enc:${encodeURIComponent(p.polyline)}`
  ).join('&');
  return `https://maps.googleapis.com/maps/api/staticmap?size=${size}&${pathParams}&key=${mapsKey}`;
}

// Interactive route map. Saves zoom + center on user interaction (debounced).
function RouteMap({ mapsKey, origin, destination, mode, savedZoom, savedCenter, onViewChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const rendererRef = useRef(null);
  const saveTimerRef = useRef(null);
  const hasSavedView = typeof savedZoom === 'number' && savedCenter && typeof savedCenter.lat === 'number';
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState(null);
  const [polyline, setPolyline] = useState(null);

  // Initialize map instance once.
  useEffect(() => {
    if (!mapsKey) return;
    let mounted = true;
    loadMapsAPI(mapsKey).then(google => {
      if (!mounted || !containerRef.current) return;
      const map = new google.maps.Map(containerRef.current, {
        zoom: hasSavedView ? savedZoom : 13,
        center: hasSavedView ? savedCenter : { lat: 40.7128, lng: -74.006 },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      mapRef.current = map;
      rendererRef.current = new google.maps.DirectionsRenderer({
        map,
        preserveViewport: hasSavedView,
      });

      const flushSave = () => {
        if (!mapRef.current) return;
        const z = mapRef.current.getZoom();
        const c = mapRef.current.getCenter();
        onViewChange({ zoom: z, center: { lat: c.lat(), lng: c.lng() } });
      };
      const onChange = () => {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(flushSave, 600);
      };
      map.addListener('zoom_changed', onChange);
      map.addListener('dragend', onChange);
      setMapReady(true);
    }).catch(e => {
      if (mounted) setError(e.message);
    });
    return () => {
      mounted = false;
      clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsKey]);

  // Run directions once the map is ready, and re-run whenever route or mode changes.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !rendererRef.current || !window.google?.maps) return;
    const google = window.google;
    const service = new google.maps.DirectionsService();
    const travelMode = GOOGLE_TRAVEL_MODE[mode] || 'DRIVING';
    service.route({
      origin,
      destination,
      travelMode: google.maps.TravelMode[travelMode],
    }, (result, status) => {
      if (status === 'OK') {
        rendererRef.current.setOptions({ preserveViewport: hasSavedView });
        rendererRef.current.setDirections(result);
        const raw = result.routes[0]?.overview_polyline;
        const encStr = typeof raw === 'string' ? raw : (raw?.points || null);
        if (encStr) setPolyline(encStr);
        if (hasSavedView) {
          mapRef.current.setZoom(savedZoom);
          mapRef.current.setCenter(savedCenter);
        }
      } else {
        console.warn('DirectionsService failed:', status, 'for', origin, '→', destination, 'mode:', travelMode);
        if (status !== 'ZERO_RESULTS') setError(status);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, mode, mapReady]);

  if (error) {
    return (
      <div className={styles.routeMapError}>
        <div>Map unavailable</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{error}</div>
      </div>
    );
  }
  const staticUrl = mapsKey && polyline
    ? buildStaticMapUrl(mapsKey, [{ polyline, mode }], '640x360')
    : null;
  return (
    <>
      <div ref={containerRef} className={styles.dayRouteMap} />
      {staticUrl && (
        <img
          src={staticUrl}
          alt={`Route from ${origin} to ${destination}`}
          className={styles.dayRouteMapPrint}
          onError={() => console.warn('Static map failed to load:', staticUrl)}
        />
      )}
    </>
  );
}

// Loosely compare two location strings — apartment numbers, zip codes, and extra
// neighborhood descriptors often differ slightly between activities at the same spot,
// so we strip those before comparing.
function normalizeLocation(loc) {
  if (!loc) return '';
  return loc
    .toLowerCase()
    .replace(/,?\s*(apt\.?|apartment|suite|ste\.?|unit|#)\s*[\w\d-]+/gi, '')
    .replace(/,\s*[a-z]{2}\s*\d{5}(-\d{4})?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function locationsEqual(a, b) {
  const na = normalizeLocation(a);
  const nb = normalizeLocation(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // If one is a prefix of the other (e.g., "305 w 50th st" vs "305 w 50th st, new york"),
  // treat them as the same place.
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  return false;
}

export function Itinerary({ event, onSave, canEdit }) {
  const { user } = useAuth();
  const isAdmin = user?.email === 'baldaufdan@gmail.com';
  const items = Array.isArray(event?.itinerary) ? event.itinerary : [];
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', date: '', time: '', location: '', notes: '', type: 'activity', url: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [mapModes, setMapModes] = useState({}); // mapId -> mode override
  const [hideLodging, setHideLodging] = useState(true);
  const [travelTimes, setTravelTimes] = useState({}); // key -> { duration, distance, error }
  const travelTimeFetchRef = useRef(new Set()); // keys we've already requested
  const [exportingPdf, setExportingPdf] = useState(false);
  const [emailResult, setEmailResult] = useState('');

  // Expose the latest items via a ref so async callbacks (like the map's debounced
  // zoom-save) don't write back with a stale items array and wipe newer additions.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  function getMapMode(id, defaultMode) {
    return mapModes[id] || defaultMode;
  }
  function setMapMode(id, mode) {
    setMapModes(prev => ({ ...prev, [id]: mode }));
  }

  async function handleAiPrompt() {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError('');
    setAiMessage('');
    try {
      // Convert Firestore Timestamps to YYYY-MM-DD strings for the AI
      const toDateStr = (d) => {
        if (!d) return '';
        const date = d?.toDate ? d.toDate() : new Date(d);
        if (isNaN(date)) return '';
        return date.toISOString().split('T')[0];
      };
      const eventContext = {
        title: event?.title || '',
        startDate: toDateStr(event?.startDate || event?.date),
        endDate: toDateStr(event?.endDate),
        location: event?.location || '',
        description: event?.description || '',
        tripHighlights: (Array.isArray(event?.tripHighlights) ? event.tripHighlights : [])
          .map(h => ({ text: h.text || '', locked: !!h.locked })),
      };
      const resp = await fetch('/api/itinerary-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, itinerary: items, eventContext }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to reach assistant');
      console.log('[itinerary-assistant] response:', data);
      console.log('[itinerary-assistant] items JSON:', JSON.stringify(data.items, null, 2));

      // Apply the action to the itinerary
      const newItems = (data.items || []).map(it => ({
        id: it.id && it.id.trim() ? it.id : crypto.randomUUID(),
        title: it.title || '',
        date: it.date || '',
        time: it.time || '',
        location: it.location || '',
        notes: it.notes || '',
        type: it.type || 'activity',
        url: it.url || '',
        imageQuery: it.imageQuery || '',
      }));

      let next;
      if (data.action === 'replace') {
        next = newItems;
      } else if (data.action === 'merge') {
        const byId = new Map(items.map(i => [i.id, i]));
        for (const it of newItems) byId.set(it.id, { ...byId.get(it.id), ...it });
        next = Array.from(byId.values());
      } else {
        // 'add'
        next = [...items, ...newItems];
      }
      next.sort((a, b) => {
        const ad = (a.date || '') + 'T' + (a.time || '00:00');
        const bd = (b.date || '') + 'T' + (b.time || '00:00');
        return ad.localeCompare(bd);
      });
      const delta = next.length - items.length;
      console.log('[itinerary-assistant] saving items count:', next.length, 'delta:', delta);
      console.log('[itinerary-assistant] saved items:', next.map(i => ({ id: i.id, title: i.title, type: i.type, date: i.date, time: i.time })));
      await onSave({ itinerary: next });
      console.log('[itinerary-assistant] save complete');
      const countLabel = delta > 0
        ? ` (${delta} item${delta === 1 ? '' : 's'} added)`
        : delta < 0
          ? ` (${-delta} item${delta === -1 ? '' : 's'} removed)`
          : newItems.length > 0
            ? ` (${newItems.length} item${newItems.length === 1 ? '' : 's'} updated)`
            : ' — nothing changed. Try rephrasing.';
      setAiMessage((data.message || 'Updated!') + countLabel);
      setAiPrompt('');
    } catch (err) {
      setAiError(err.message || 'Something went wrong');
    } finally {
      setAiLoading(false);
    }
  }

  function startAdd() {
    setForm({ title: '', date: '', time: '', location: '', notes: '', type: 'activity', url: '' });
    setAdding(true);
    setEditingId(null);
  }

  function startEdit(item) {
    setForm({
      title: item.title || '',
      date: item.date || '',
      time: item.time || '',
      location: item.location || '',
      notes: item.notes || '',
      type: item.type || 'activity',
      url: item.url || '',
    });
    setEditingId(item.id);
    setAdding(false);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
  }

  async function saveItem() {
    if (!form.title.trim()) return;
    let next;
    if (adding) {
      const newItem = { ...form, id: crypto.randomUUID() };
      next = [...items, newItem];
    } else {
      next = items.map(i => (i.id === editingId ? { ...i, ...form } : i));
    }
    next.sort((a, b) => {
      const ad = (a.date || '') + 'T' + (a.time || '00:00');
      const bd = (b.date || '') + 'T' + (b.time || '00:00');
      return ad.localeCompare(bd);
    });
    await onSave({ itinerary: next });
    cancel();
  }

  async function deleteItem(id) {
    if (!confirm('Delete this itinerary item?')) return;
    const next = items.filter(i => i.id !== id);
    await onSave({ itinerary: next });
  }

  async function updateItemMode(id, mode) {
    const next = items.map(i => i.id === id ? { ...i, travelMode: mode } : i);
    await onSave({ itinerary: next });
  }

  function emailItinerary() {
    const members = event?.members || {};
    const seen = new Set();
    const emails = [];
    for (const [uid, m] of Object.entries(members)) {
      if (!m) continue;
      if (m.rsvp === 'no') continue;
      const raw = (m.email || (uid.includes('@') ? uid : '')).trim();
      if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(raw);
    }
    if (emails.length === 0) {
      alert('No attendees with valid email addresses found.');
      return;
    }

    const toDateStr = (d) => {
      if (!d) return '';
      const date = d?.toDate ? d.toDate() : new Date(d);
      if (isNaN(date)) return '';
      return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    };
    const formatTime = (t) => {
      if (!t) return '';
      const m = /^(\d{1,2}):(\d{2})/.exec(t);
      if (!m) return t;
      let h = parseInt(m[1], 10);
      const mm = m[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${mm} ${ampm}`;
    };
    const formatDateHeader = (ymd) => {
      try {
        const d = new Date(ymd + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      } catch { return ymd; }
    };

    const fromName = user?.displayName || user?.email || 'A friend';
    const startStr = toDateStr(event?.startDate || event?.date);
    const endStr = toDateStr(event?.endDate);
    const dateRange = endStr && endStr !== startStr ? `${startStr} – ${endStr}` : startStr;
    const link = event?.shareToken
      ? `${window.location.origin}/invite/${event.shareToken}?tab=itinerary`
      : '';

    const lines = [];
    lines.push(`Hey! Here's the itinerary for ${event?.title || 'our trip'}.`);
    lines.push('');
    if (dateRange) lines.push(`📅 ${dateRange}`);
    if (event?.location) lines.push(`📍 ${event.location}`);
    if (event?.description) {
      lines.push('');
      lines.push(event.description);
    }

    const highlights = Array.isArray(event?.tripHighlights) ? event.tripHighlights : [];
    if (highlights.length > 0) {
      lines.push('');
      lines.push('✨ Trip Highlights');
      highlights.forEach((h, i) => {
        const lock = h.locked ? '🔒 ' : '';
        const cost = h.cost ? ` — ${h.cost}` : '';
        lines.push(`  ${i + 1}. ${lock}${h.text || ''}${cost}`);
      });
    }

    const itin = (Array.isArray(items) ? items : [])
      .filter(it => (it.type || 'activity') !== 'travel');
    if (itin.length > 0) {
      const sorted = [...itin].sort((a, b) => {
        const ka = `${a.date || ''} ${a.time || ''}`;
        const kb = `${b.date || ''} ${b.time || ''}`;
        return ka.localeCompare(kb);
      });
      const byDate = new Map();
      const undated = [];
      for (const it of sorted) {
        if (!it.date) { undated.push(it); continue; }
        if (!byDate.has(it.date)) byDate.set(it.date, []);
        byDate.get(it.date).push(it);
      }
      lines.push('');
      lines.push('📅 Itinerary');
      for (const [ymd, list] of byDate) {
        lines.push('');
        lines.push(formatDateHeader(ymd));
        for (const it of list) {
          const time = formatTime(it.time);
          const title = it.title || '(untitled)';
          let line = time ? `  • ${time} — ${title}` : `  • ${title}`;
          if (it.location) line += ` @ ${it.location}`;
          lines.push(line);
        }
      }
      if (undated.length) {
        lines.push('');
        lines.push('TBD');
        for (const it of undated) {
          const title = it.title || '(untitled)';
          let line = `  • ${title}`;
          if (it.location) line += ` @ ${it.location}`;
          lines.push(line);
        }
      }
    }

    if (link) {
      lines.push('');
      lines.push(`View the full itinerary on Rally: ${link}`);
    }
    lines.push('');
    lines.push(`— ${fromName}`);

    const body = lines.join('\n');
    const subject = `Itinerary for ${event?.title || 'our trip'}`;
    const mailto = `mailto:${encodeURIComponent(emails.join(','))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = mailto;
    setEmailResult(`Opened email draft for ${emails.length} recipient${emails.length === 1 ? '' : 's'}.`);
    setTimeout(() => setEmailResult(''), 5000);
  }

  async function exportPDF() {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      // Build transitions from the latest items
      const sortedDatesLocal = Object.keys(items.reduce((acc, i) => {
        acc[i.date || 'Unscheduled'] = true; return acc;
      }, {})).sort((a, b) => {
        if (a === 'Unscheduled') return 1;
        if (b === 'Unscheduled') return -1;
        return a.localeCompare(b);
      });
      const allT = [];
      for (const dateKey of sortedDatesLocal) {
        const dayItems = items
          .filter(i => (i.date || 'Unscheduled') === dateKey)
          .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        const activities = dayItems.filter(i => (i.type || 'activity') === 'activity');
        for (let i = 0; i < activities.length - 1; i++) {
          const from = activities[i];
          const to = activities[i + 1];
          const fromLoc = (extractStartEnd(from).end || from.location || '').trim();
          const toLoc = (extractStartEnd(to).start || to.location || '').trim();
          if (fromLoc && toLoc && !locationsEqual(fromLoc, toLoc)) {
            allT.push({
              from: fromLoc,
              to: toLoc,
              mode: inferTravelMode(to),
              fromItemId: from.id,
              toItemId: to.id,
              toTitle: to.title,
            });
          }
        }
      }

      // Fetch polyline for each transition via DirectionsService
      let google = window.google;
      if (!google?.maps && mapsKey) {
        google = await loadMapsAPI(mapsKey);
      }

      const polylineByFromId = {};
      const overviewPolylines = [];
      if (google?.maps) {
        const service = new google.maps.DirectionsService();
        await Promise.all(allT.map(t => new Promise(resolve => {
          service.route({
            origin: t.from,
            destination: t.to,
            travelMode: google.maps.TravelMode[GOOGLE_TRAVEL_MODE[t.mode] || 'DRIVING'],
          }, (result, status) => {
            if (status === 'OK') {
              const raw = result.routes[0]?.overview_polyline;
              const encStr = typeof raw === 'string' ? raw : (raw?.points || null);
              if (encStr) {
                polylineByFromId[t.fromItemId] = { polyline: encStr, mode: t.mode, toTitle: t.toTitle };
                overviewPolylines.push({ polyline: encStr, mode: t.mode });
              }
            }
            resolve();
          });
        })));
      }

      // Build static map URLs and attach travel-time text
      const routeMapsByFromId = {};
      for (const t of allT) {
        const p = polylineByFromId[t.fromItemId];
        const url = p && mapsKey ? buildStaticMapUrl(mapsKey, [p], '640x280') : null;
        const tt = travelTimes[travelTimeKey(t.from, t.to, t.mode)];
        routeMapsByFromId[t.fromItemId] = {
          url,
          mode: t.mode,
          toTitle: t.toTitle,
          duration: tt?.duration || null,
        };
      }
      const overviewMapUrl = overviewPolylines.length > 0 && mapsKey
        ? buildStaticMapUrl(mapsKey, overviewPolylines, '900x500')
        : null;

      // Dynamic import so the pdf lib isn't loaded unless the user clicks
      const [{ pdf }, { ItineraryPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./ItineraryPDF'),
      ]);

      const React = await import('react');
      const doc = React.createElement(ItineraryPDF, {
        event,
        items,
        overviewMapUrl,
        routeMapsByFromId,
      });

      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = (event?.title || 'itinerary').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
      a.href = url;
      a.download = `${safeTitle || 'itinerary'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setExportingPdf(false);
    }
  }

  async function updateItemView(id, { zoom, center }) {
    const current = itemsRef.current;
    // Guard: if the item no longer exists (e.g., deleted), skip.
    if (!current.some(i => i.id === id)) return;
    const next = current.map(i => {
      if (i.id !== id) return i;
      const copy = { ...i };
      if (typeof zoom === 'number') copy.travelZoom = Math.max(1, Math.min(20, zoom));
      if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
        copy.travelCenter = { lat: center.lat, lng: center.lng };
      }
      return copy;
    });
    await onSave({ itinerary: next });
  }

  async function resetItemView(id) {
    const current = itemsRef.current;
    if (!current.some(i => i.id === id)) return;
    const next = current.map(i => {
      if (i.id !== id) return i;
      const copy = { ...i };
      delete copy.travelZoom;
      delete copy.travelCenter;
      return copy;
    });
    await onSave({ itinerary: next });
  }

  // Group by date
  const groups = {};
  for (const item of items) {
    const key = item.date || 'Unscheduled';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => {
    if (a === 'Unscheduled') return 1;
    if (b === 'Unscheduled') return -1;
    return a.localeCompare(b);
  });

  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY;

  function travelTimeKey(from, to, mode) {
    return `${from}|${to}|${mode}`;
  }

  // Aligned activity-to-activity transitions (one per consecutive activity pair).
  // Same source the per-day Routes column uses, so the overview stays in sync.
  const allTransitions = [];
  for (const dateKey of sortedDates) {
    const dateItemsSorted = groups[dateKey].slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const activityItems = dateItemsSorted.filter(i => (i.type || 'activity') === 'activity');
    for (let i = 0; i < activityItems.length - 1; i++) {
      const fromItem = activityItems[i];
      const toItem = activityItems[i + 1];
      const fromLoc = (extractStartEnd(fromItem).end || fromItem.location || '').trim();
      const toLoc = (extractStartEnd(toItem).start || toItem.location || '').trim();
      if (fromLoc && toLoc && !locationsEqual(fromLoc, toLoc)) {
        allTransitions.push({
          from: fromLoc,
          to: toLoc,
          fromTitle: fromItem.title,
          toTitle: toItem.title,
          mode: inferTravelMode(toItem),
          fromItemId: fromItem.id,
          toItemId: toItem.id,
          dateKey,
        });
      }
    }
  }

  // Fetch travel time for every transition. Errors don't stick in the ref, so a
  // subsequent render (or mode change) will retry.
  const transitionFetchDep = allTransitions.map(t => travelTimeKey(t.from, t.to, t.mode)).join('\n');
  useEffect(() => {
    function fetchOne(t, isRetry = false) {
      const k = travelTimeKey(t.from, t.to, t.mode);
      if (travelTimeFetchRef.current.has(k)) return;
      travelTimeFetchRef.current.add(k);
      const url = `/api/travel-time?origin=${encodeURIComponent(t.from)}&destination=${encodeURIComponent(t.to)}&mode=${encodeURIComponent(t.mode)}`;
      fetch(url, { cache: 'no-store' })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          setTravelTimes(prev => ({
            ...prev,
            [k]: ok ? body : { error: body?.error || 'Request failed' },
          }));
          if (!ok) {
            // Allow future retries, and auto-retry once after a brief delay
            travelTimeFetchRef.current.delete(k);
            if (!isRetry) setTimeout(() => fetchOne(t, true), 2500);
          }
        })
        .catch(e => {
          setTravelTimes(prev => ({ ...prev, [k]: { error: e.message } }));
          travelTimeFetchRef.current.delete(k);
          if (!isRetry) setTimeout(() => fetchOne(t, true), 2500);
        });
    }
    for (const t of allTransitions) fetchOne(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionFetchDep]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Trip Itinerary</h3>
        <div className={styles.headerActions}>
          <button
            className={styles.lodgingToggleBtn}
            onClick={() => setHideLodging(v => !v)}
            title={hideLodging ? 'Show lodging column' : 'Hide lodging column'}
          >
            {hideLodging ? '🏨 Show lodging' : '🏨 Hide lodging'}
          </button>
          <button
            className={styles.lodgingToggleBtn}
            onClick={exportPDF}
            disabled={exportingPdf}
            title="Export itinerary as a PDF"
          >
            {exportingPdf ? '⏳ Generating…' : '⬇ Download PDF'}
          </button>
          {canEdit && (
            <button
              className={styles.lodgingToggleBtn}
              onClick={emailItinerary}
              title="Open an email draft to all attendees with the itinerary pre-filled"
            >
              📧 Email itinerary
            </button>
          )}
          {canEdit && !adding && !editingId && (
            <button className={styles.addBtn} onClick={startAdd}>+ Add Item</button>
          )}
        </div>
      </div>
      {emailResult && (
        <div className={styles.aiMessage} style={{ marginBottom: '0.75rem' }}>{emailResult}</div>
      )}

      {allTransitions.length > 0 && mapsKey && (
        <div className={styles.overviewMapSection}>
          <div className={styles.overviewMapHeader}>
            <span className={styles.overviewMapTitle}>🗺️ Trip Route Overview</span>
            <span className={styles.overviewMapCount}>
              {allTransitions.length} {allTransitions.length === 1 ? 'route' : 'routes'}
            </span>
          </div>
          <TripOverviewMap mapsKey={mapsKey} transitions={allTransitions} />
        </div>
      )}

      <FlightCosts event={event} onSave={onSave} canEdit={canEdit} />

      {canEdit && isAdmin && (
        aiPanelOpen ? (
          <div className={styles.aiPanelDocked}>
            <button
              type="button"
              className={styles.aiPanelCloseBtn}
              onClick={() => setAiPanelOpen(false)}
              aria-label="Close AI assistant"
              title="Close"
            >✕</button>
            <div className={styles.aiLabel}>
              <span className={styles.aiSparkle}>✨</span>
              Ask Claude to plan your trip
            </div>
            <div className={styles.aiRow}>
              <input
                className={styles.aiInput}
                type="text"
                placeholder='e.g., "Plan a day in Rome with 4 activities"'
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleAiPrompt(); }}
                disabled={aiLoading}
                autoFocus
              />
              <button
                className={styles.aiSendBtn}
                onClick={handleAiPrompt}
                disabled={aiLoading || !aiPrompt.trim()}
              >
                {aiLoading ? '…' : 'Send'}
              </button>
            </div>
            {aiMessage && <div className={styles.aiMessage}>{aiMessage}</div>}
            {aiError && <div className={styles.aiErrorMsg}>{aiError}</div>}
          </div>
        ) : (
          <button
            type="button"
            className={styles.aiPanelFab}
            onClick={() => setAiPanelOpen(true)}
            title="Ask Claude to plan your trip"
            aria-label="Open AI assistant"
          >
            <span className={styles.aiSparkle}>✨</span>
            Plan with AI
          </button>
        )
      )}

      {(adding || editingId) && (
        <div className={styles.form}>
          <div className={styles.typeRow}>
            {[
              { key: 'activity', label: 'Activity', icon: '🎯' },
              { key: 'travel', label: 'Travel', icon: '✈️' },
              { key: 'lodging', label: 'Lodging', icon: '🏨' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                className={form.type === t.key ? styles.typeBtnActive : styles.typeBtn}
                onClick={() => setForm({ ...form, type: t.key })}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder={form.type === 'travel' ? 'Title (e.g., Flight to Barcelona)' : form.type === 'lodging' ? 'Title (e.g., Hotel Montecarlo)' : 'Title (e.g., Dinner at Le Bernardin)'}
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            autoFocus
          />
          <div className={styles.row}>
            <input
              className={styles.input}
              type="date"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
            />
            <input
              className={styles.input}
              type="time"
              value={form.time}
              onChange={e => setForm({ ...form, time: e.target.value })}
            />
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder="Location (optional)"
            value={form.location}
            onChange={e => setForm({ ...form, location: e.target.value })}
          />
          <input
            className={styles.input}
            type="url"
            placeholder="Link (optional — website or booking URL)"
            value={form.url}
            onChange={e => setForm({ ...form, url: e.target.value })}
          />
          <textarea
            className={styles.textarea}
            placeholder="Notes (optional)"
            rows={3}
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
          />
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={cancel}>Cancel</button>
            <button className={styles.saveBtn} onClick={saveItem} disabled={!form.title.trim()}>
              {adding ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <TripHighlightsList event={event} onSave={onSave} canEdit={canEdit} />

      {items.length === 0 && !adding ? (
        <div className={styles.empty}>
          <p>No itinerary items yet.</p>
          {canEdit && <p className={styles.emptyHint}>Click "+ Add Item" to start planning your trip.</p>}
        </div>
      ) : (
        <div className={styles.list}>
          {sortedDates.map(dateKey => {
            const dateItems = groups[dateKey].slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
            const dateLabel = dateKey === 'Unscheduled'
              ? 'Unscheduled'
              : new Date(dateKey + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

            // Activities and lodging columns
            const activityItems = dateItems.filter(i => (i.type || 'activity') === 'activity');
            const lodgingItems = dateItems.filter(i => (i.type || 'activity') === 'lodging');
            const travelItems = dateItems.filter(i => i.type === 'travel');

            // Routes column is computed from consecutive activity pairs so each route
            // card can align from the midpoint of the "from" activity to the midpoint
            // of the "to" activity.
            const alignedTransitions = [];
            for (let i = 0; i < activityItems.length - 1; i++) {
              const fromItem = activityItems[i];
              const toItem = activityItems[i + 1];
              const fromLoc = (extractStartEnd(fromItem).end || fromItem.location || '').trim();
              const toLoc = (extractStartEnd(toItem).start || toItem.location || '').trim();
              if (fromLoc && toLoc && !locationsEqual(fromLoc, toLoc)) {
                alignedTransitions.push({
                  fromIdx: i,
                  toIdx: i + 1,
                  from: fromLoc,
                  to: toLoc,
                  fromTitle: fromItem.title,
                  toTitle: toItem.title,
                  mode: inferTravelMode(toItem),
                  zoom: typeof toItem.travelZoom === 'number' ? toItem.travelZoom : null,
                  center: toItem.travelCenter && typeof toItem.travelCenter.lat === 'number'
                    ? { lat: toItem.travelCenter.lat, lng: toItem.travelCenter.lng }
                    : null,
                  fromItemId: fromItem.id,
                  toItemId: toItem.id,
                  mapId: `aligned-route-${dateKey}-${i}`,
                });
              }
            }

            // Map each activity's id to its outbound transition (if any), so we can
            // display "travel time leaving this activity" on the card.
            const outboundByItemId = {};
            for (const t of alignedTransitions) {
              outboundByItemId[t.fromItemId] = t;
            }

            // Renders a single activity/lodging card's inner content.
            const renderItemCard = (item, color) => {
              const loc = item.location || '';
              const outbound = outboundByItemId[item.id];
              const outboundTT = outbound
                ? travelTimes[travelTimeKey(outbound.from, outbound.to, outbound.mode)]
                : null;
              const modeIconFor = (m) => (TRAVEL_MODES.find(x => x.key === m) || TRAVEL_MODES[0]).icon;
              return (
                <div className={styles.scheduleItem} style={{ borderLeftColor: color, height: '100%' }}>
                  <div className={styles.itemContent}>
                    <div className={styles.itemHeader}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.itemTitleLink}>{item.title}</a>
                      ) : (
                        <span className={styles.itemTitle}>{item.title}</span>
                      )}
                      {canEdit && (
                        <div className={styles.itemActions}>
                          <button className={styles.iconBtn} onClick={() => startEdit(item)} title="Edit">✎</button>
                          <button className={styles.iconBtn} onClick={() => deleteItem(item.id)} title="Delete">×</button>
                        </div>
                      )}
                    </div>
                    {item.time && <div className={styles.itemTime}>{new Date('2000-01-01T' + item.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>}
                    {loc && <div className={styles.itemLocation}>📍 {loc}</div>}
                    {item.notes && <div className={styles.itemNotes}>{item.notes}</div>}
                    {item.url && <div className={styles.itemUrl}><a href={item.url} target="_blank" rel="noopener noreferrer">🔗 View details</a></div>}
                    {outbound && (
                      <div className={styles.itemLeavingFooter}>
                        <span className={styles.itemLeavingIcon}>{modeIconFor(outbound.mode)}</span>
                        <span className={styles.itemLeavingText}>
                          {outboundTT?.duration
                            ? `${outboundTT.duration} to ${outbound.toTitle}`
                            : outboundTT?.error
                              ? `→ ${outbound.toTitle}`
                              : `… to ${outbound.toTitle}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            };

            // If the day has no activities or lodging, collapse to a compact
            // list of travel items instead of an empty schedule grid.
            if (activityItems.length === 0 && lodgingItems.length === 0) {
              return (
                <div key={dateKey} className={styles.dateGroup}>
                  <div className={styles.dateLabel}>{dateLabel}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {travelItems.map(item => (
                      <div key={item.id}>
                        {renderItemCard(item, '#6b7280')}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            const renderRouteCard = (t, routeIdx) => {
              const mode = t.mode;
              const hasSavedView = typeof t.zoom === 'number' && t.center;
              const ttKey = travelTimeKey(t.from, t.to, mode);
              const tt = travelTimes[ttKey];
              const ttText = tt?.duration
                ? (tt.distance ? `${tt.duration} · ${tt.distance}` : tt.duration)
                : (tt?.error ? null : '…');
              const fromNum = routeIdx * 2 + 1;
              const toNum = routeIdx * 2 + 2;
              return (
                <div className={styles.dayRoute} style={{ height: '100%' }}>
                  <div className={styles.dayRouteTravelTime}>
                    {ttText || '—'}
                  </div>
                  <div className={styles.dayRouteHeader}>
                    <span className={styles.dayRouteHeaderText} title={t.fromTitle}>{fromNum}</span>
                    <span className={styles.dayRouteArrow}>-</span>
                    <span className={styles.dayRouteHeaderText} title={t.toTitle}>{toNum}</span>
                  </div>
                  <div className={styles.modeSelectorBarCompact}>
                    <ModeSelector value={mode} onChange={m => updateItemMode(t.toItemId, m)} />
                    {hasSavedView && (
                      <button
                        type="button"
                        className={styles.zoomResetBtn}
                        onClick={() => resetItemView(t.toItemId)}
                        title="Reset map to auto-fit route"
                        aria-label="Reset map view"
                      >⟲</button>
                    )}
                  </div>
                  <div className={styles.dayRouteMapWrap} style={{ flex: '1 1 auto', height: 'auto' }}>
                    <RouteMap
                      mapsKey={mapsKey}
                      origin={t.from}
                      destination={t.to}
                      mode={mode}
                      savedZoom={t.zoom}
                      savedCenter={t.center}
                      onViewChange={view => updateItemView(t.toItemId, view)}
                    />
                  </div>
                </div>
              );
            };

            // Grid row sizing: header is auto; body rows are fixed half-row heights
            // so an activity (2 half-rows) = 2 * HALF_ROW, and a route spans 2 half-rows
            // offset by 1, giving the "start at midpoint → end at midpoint" effect.
            const HALF_ROW = 160;
            const activityCount = Math.max(activityItems.length, 1);
            const bodyRows = activityCount * 2; // activities take 2 half-rows each; routes fit between
            const gridTemplateColumns = hideLodging
              ? 'minmax(0, 1fr) minmax(0, 1.2fr)'
              : 'minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 0.9fr)';

            // Sum route durations for this day (skip routes still loading or errored).
            let totalSeconds = 0;
            let hasAnySeconds = false;
            let pending = 0;
            for (const t of alignedTransitions) {
              const tt = travelTimes[travelTimeKey(t.from, t.to, t.mode)];
              if (tt?.durationSeconds) {
                totalSeconds += tt.durationSeconds;
                hasAnySeconds = true;
              } else if (!tt?.error) {
                pending += 1;
              }
            }
            const formatTotal = (secs) => {
              const mins = Math.round(secs / 60);
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              if (h === 0) return `${m} min`;
              if (m === 0) return `${h} hr`;
              return `${h} hr ${m} min`;
            };
            const totalLabel = hasAnySeconds
              ? `${formatTotal(totalSeconds)} travel${pending > 0 ? ' (+ pending)' : ''}`
              : (alignedTransitions.length > 0 ? '… calculating travel' : null);

            return (
              <div key={dateKey} className={styles.dateGroup}>
                <div className={styles.dateLabel}>
                  {dateLabel}
                  {totalLabel && (
                    <span style={{ marginLeft: '0.6rem', fontSize: '0.72rem', fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'none', letterSpacing: 'normal' }}>
                      🚗 {totalLabel}
                    </span>
                  )}
                </div>
                <div
                  className={styles.scheduleGrid}
                  style={{
                    gridTemplateColumns,
                    gridTemplateRows: `auto repeat(${bodyRows}, ${HALF_ROW}px)`,
                  }}
                >
                  {/* Column headers */}
                  <div className={styles.scheduleColHeader} style={{ gridColumn: 1, gridRow: 1, borderBottomColor: '#6366F1', color: '#6366F1' }}>
                    <span>🎯</span> Activities
                  </div>
                  <div className={styles.scheduleColHeader} style={{ gridColumn: 2, gridRow: 1, borderBottomColor: '#0891b2', color: '#0891b2' }}>
                    <span>🚗</span> Routes
                  </div>
                  {!hideLodging && (
                    <div className={styles.scheduleColHeader} style={{ gridColumn: 3, gridRow: 1, borderBottomColor: '#d97706', color: '#d97706' }}>
                      <span>🏨</span> Lodging
                    </div>
                  )}

                  {/* Activities */}
                  {activityItems.length === 0 ? (
                    <div className={styles.scheduleEmpty} style={{ gridColumn: 1, gridRow: '2 / span 2' }}>—</div>
                  ) : (
                    activityItems.map((item, i) => (
                      <div key={item.id} style={{ gridColumn: 1, gridRow: `${2 + 2 * i} / span 2`, minHeight: 0 }}>
                        {renderItemCard(item, '#6366F1')}
                      </div>
                    ))
                  )}

                  {/* Routes (offset half-row down, aligning to midpoints of activities) */}
                  {!mapsKey ? (
                    <div className={styles.scheduleEmpty} style={{ gridColumn: 2, gridRow: '2 / span 2' }}>—</div>
                  ) : alignedTransitions.length === 0 ? (
                    <div className={styles.scheduleEmpty} style={{ gridColumn: 2, gridRow: '2 / span 2' }}>—</div>
                  ) : (
                    alignedTransitions.map((t, idx) => (
                      <div key={t.mapId} style={{ gridColumn: 2, gridRow: `${3 + 2 * t.fromIdx} / span 2`, minHeight: 0 }}>
                        {renderRouteCard(t, idx)}
                      </div>
                    ))
                  )}

                  {/* Lodging (stacked) */}
                  {!hideLodging && (
                    lodgingItems.length === 0 ? (
                      <div className={styles.scheduleEmpty} style={{ gridColumn: 3, gridRow: '2 / span 2' }}>—</div>
                    ) : (
                      lodgingItems.map((item, i) => (
                        <div key={item.id} style={{ gridColumn: 3, gridRow: `${2 + 2 * i} / span 2`, minHeight: 0 }}>
                          {renderItemCard(item, '#d97706')}
                        </div>
                      ))
                    )
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

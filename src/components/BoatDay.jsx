import React, { useMemo, useState, useRef, useEffect } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import styles from './BoatDay.module.css';

// The Kismet is the flagship; its capacity is exported for the owner card.
export const BOAT_NAME = 'The Kismet';
export const BOAT_CAPACITY = 24;

// The fleet. Each boat has its own hull and seat count.
export const BOATS = [
  { key: 'kismet', name: 'The Kismet', capacity: 24 },
  { key: 'kyle', name: "Kyle's Boat", capacity: 10 },
  { key: 'nick', name: "Nick's Boat", capacity: 10 },
];

// Columns are the buckets people sit in. The Kismet has three host columns that
// share its 24 seats; Kyle's and Nick's boats are a single column each.
const COLUMNS = [
  { key: 'dan', name: 'Dan', color: '#4f46e5', boat: 'kismet' },
  { key: 'mike', name: 'Mike', color: '#059669', boat: 'kismet' },
  { key: 'johnny', name: 'Johnny', color: '#ea580c', boat: 'kismet' },
  { key: 'kyle', name: "Kyle's Boat", color: '#0ea5e9', boat: 'kyle' },
  { key: 'nick', name: "Nick's Boat", color: '#d946ef', boat: 'nick' },
];

// Only the three Kismet host columns match Friends "guest of" values.
export const HOSTS = COLUMNS.filter(c => c.boat === 'kismet');

const colByKey = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
const boatByKey = Object.fromEntries(BOATS.map(b => [b.key, b]));
const colColor = key => colByKey[key]?.color || '#94a3b8';
const colName = key => colByKey[key]?.name || 'crew';
const colBoat = key => colByKey[key]?.boat || 'kismet';
const boatCap = key => boatByKey[key]?.capacity ?? 24;
const columnsForBoat = key => COLUMNS.filter(c => c.boat === key);

// Two centred rows of seats for a hull of the given capacity, in the SVG's
// coordinate space. Fewer seats cluster in the middle of the same hull.
function seatPositions(n) {
  const top = Math.ceil(n / 2);
  const bot = n - top;
  const CX = 298, GAP = 24;
  const row = (count, y) => Array.from({ length: count }, (_, i) => ({ x: CX + (i - (count - 1) / 2) * GAP, y }));
  return [...row(top, 216), ...row(bot, 234)];
}

function slugId(name) {
  const base = name.trim().replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return `guest_${base || 'x'}_${crypto.randomUUID().slice(0, 6)}`;
}

// A Friends contact's free-text "guest of" value ties them to a host: the first
// host whose name — or an alias — appears in it. "Mike & Sunnie" → mike.
const HOST_MATCH = [
  { key: 'dan', tokens: ['dan'] },
  { key: 'mike', tokens: ['mike', 'sunnie'] },
  { key: 'johnny', tokens: ['johnny'] },
];
export function hostForGuest(guest) {
  const g = (guest || '').toLowerCase();
  if (!g) return null;
  for (const h of HOST_MATCH) {
    if (h.tokens.some(t => g.includes(t))) return h.key;
  }
  return null;
}

// The per-host guest lists the owner publishes onto the event (the public link
// can't read Friends). Only the Kismet's host columns get these.
export function buildBoatSuggestions(friends) {
  const out = Object.fromEntries(HOSTS.map(h => [h.key, []]));
  for (const f of friends || []) {
    const key = hostForGuest(f.guest);
    if (key && out[key] && (f.name || '').trim()) {
      out[key].push({ id: f.id, name: f.name.trim() });
    }
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  return out;
}

const STANCHIONS = [90, 120, 150, 380, 410, 440];

// One boat's hull, drawn in profile with the bow to the left, its seats filled
// by `seated` and coloured by each person's column.
function BoatArt({ boat, seated }) {
  const seats = seatPositions(boat.capacity);
  return (
    <svg className={styles.boat} viewBox="0 0 520 310" role="img"
         aria-label={`${boat.name}, ${seated.length} of ${boat.capacity} seats filled`}>
      <line className={styles.stay} x1="230" y1="8" x2="50" y2="188" />
      <line className={styles.stay} x1="230" y1="8" x2="462" y2="192" />
      <path className={styles.keel} d="M236 244 L296 244 L282 290 L256 290 Z" />
      <path className={styles.rudder} d="M410 246 L422 246 L418 282 L408 282 Z" />
      <path className={styles.hull} d="M50 188 Q255 200 462 194 L448 242 Q255 260 72 232 Q54 220 50 188 Z" />
      <path className={styles.stripe} d="M58 199 Q255 211 456 205" />
      <path className={styles.lifeline} d="M64 180 Q255 192 452 186" />
      {STANCHIONS.map(x => (
        <line key={x} className={styles.stanchion} x1={x} y1="192" x2={x} y2="180" />
      ))}
      <path className={styles.cabin} d="M196 196 L214 174 L330 176 L348 196 Z" />
      <rect className={styles.port} x="224" y="181" width="22" height="6" rx="3" />
      <rect className={styles.port} x="254" y="181" width="22" height="6" rx="3" />
      <rect className={styles.port} x="284" y="182" width="22" height="6" rx="3" />
      <rect className={styles.port} x="314" y="183" width="13" height="6" rx="3" />
      <line className={styles.boom} x1="232" y1="166" x2="366" y2="170" />
      <path className={styles.jib} d="M228 10 L52 188 L270 164 Q246 84 228 10 Z" />
      <path className={styles.sail} d="M236 14 L236 164 L364 168 Q310 88 236 14 Z" />
      <rect className={styles.mast} x="228" y="8" width="4.5" height="190" rx="2" />
      <path className={styles.flag} d="M233 10 L260 18 L233 26 Z" />
      <path className={styles.water} d="M0 244 Q44 237 88 244 T176 244 T264 244 T352 244 T440 244 T520 244 V310 H0 Z" />
      <path className={styles.waterLine} d="M52 270 Q82 264 112 270 T172 270" />
      <path className={styles.waterLine} d="M344 284 Q374 278 404 284 T464 284" />
      <text className={styles.boatName} x="74" y="226">{boat.name}</text>
      {seats.map((seat, i) => {
        const person = seated[i];
        return (
          <circle
            key={i}
            cx={seat.x}
            cy={seat.y}
            r="6"
            className={person ? styles.seatFilled : styles.seatEmpty}
            style={person ? { fill: colColor(person.host) } : undefined}
          >
            {person && <title>{person.name} — {colName(person.host)}</title>}
          </circle>
        );
      })}
    </svg>
  );
}

/**
 * The fleet view + rosters. Rendered both inside EventDetail (for the owner) and
 * on the public /boat/:eventId page, so it takes the viewer's identity as props.
 */
export function BoatDay({ event, eventId, viewerId, viewerName }) {
  const boat = event.boatDay || {};
  const roster = useMemo(() => (Array.isArray(boat.roster) ? boat.roster : []), [boat.roster]);
  const responses = useMemo(() => (Array.isArray(boat.responses) ? boat.responses : []), [boat.responses]);
  const guestLists = boat.suggestions && typeof boat.suggestions === 'object' ? boat.suggestions : {};

  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [menuFor, setMenuFor] = useState(null); // `${colKey}:${name}` of the open move menu
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuFor) return;
    const h = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuFor]);

  // How many going on each boat, for per-boat capacity.
  const goingByBoat = useMemo(() => {
    const out = {};
    roster.forEach(r => { const b = colBoat(r.host); out[b] = (out[b] || 0) + 1; });
    return out;
  }, [roster]);
  const boatFull = key => (goingByBoat[key] || 0) >= boatCap(key);

  // The single write path. 'going' seats them on their column's boat (capacity
  // checked inside the transaction), 'maybe'/'no' park them without a seat, and
  // 'clear' removes them. A person is only ever in one place.
  async function setStatus(person, status, newCol) {
    const name = (person.name || '').trim();
    if (!name) return;
    const host = newCol || person.host || null;
    const id = person.id || slugId(name);
    const nlow = name.toLowerCase();
    setError('');
    setBusyId(id);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'events', eventId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Event not found.');
        const bd = snap.data().boatDay || {};
        const notThis = arr => (Array.isArray(arr) ? arr : []).filter(x => (x.name || '').toLowerCase() !== nlow);
        let nextRoster = notThis(bd.roster);
        let nextResp = notThis(bd.responses);
        const stamp = { id, name, host, addedBy: viewerId || '', addedByName: viewerName || '', at: new Date().toISOString() };
        if (status === 'going') {
          const bkey = colBoat(host);
          const onBoat = nextRoster.filter(r => colBoat(r.host) === bkey).length;
          if (onBoat >= boatCap(bkey)) throw new Error(`${boatByKey[bkey]?.name || 'That boat'} is full — ${boatCap(bkey)} people max.`);
          nextRoster = [...nextRoster, { ...stamp, addedAt: stamp.at }];
        } else if (status === 'maybe' || status === 'no') {
          nextResp = [...nextResp, { ...stamp, status }];
        }
        tx.update(ref, { 'boatDay.roster': nextRoster, 'boatDay.responses': nextResp });
      });
      if (person.host) setDrafts(d => ({ ...d, [person.host]: '' }));
    } catch (e) {
      setError(e.message || 'Could not update that person.');
    } finally {
      setBusyId(null);
    }
  }

  // Move a person to another column/boat: they board it (going), leaving wherever
  // they were. Capacity of the destination is enforced by setStatus.
  const moveTo = (person, colKey) => { setMenuFor(null); setStatus(person, 'going', colKey); };

  const STATES = [
    { k: 'going', label: 'Going', cls: styles.segGoing },
    { k: 'maybe', label: 'Maybe', cls: styles.segMaybe },
    { k: 'no', label: 'No', cls: styles.segNo },
  ];

  function renderColumn(col) {
    const crew = roster.filter(r => r.host === col.key);            // going
    const resp = responses.filter(r => r.host === col.key);         // maybe / no
    const statusByName = new Map();
    crew.forEach(r => statusByName.set((r.name || '').toLowerCase(), 'going'));
    resp.forEach(r => statusByName.set((r.name || '').toLowerCase(), r.status === 'no' ? 'no' : 'maybe'));

    const people = [];
    const seen = new Set();
    const addRow = (name, id) => {
      const k = (name || '').toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      people.push({ id, name, host: col.key, status: statusByName.get(k) || 'none' });
    };
    (guestLists[col.key] || []).forEach(g => addRow(g.name, g.id));
    crew.forEach(r => addRow(r.name, r.id));
    resp.forEach(r => addRow(r.name, r.id));
    const rank = { going: 0, none: 1, maybe: 2, no: 3 };
    people.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.name || '').localeCompare(b.name || ''));

    const draft = drafts[col.key] || '';
    const maybeN = resp.filter(r => r.status !== 'no').length;
    const noN = resp.filter(r => r.status === 'no').length;
    const boatIsFull = boatFull(col.boat);

    return (
      <div key={col.key} className={styles.column}>
        <div className={styles.columnHead}>
          <i className={styles.hostDot} style={{ background: col.color }} />
          <span className={styles.hostName}>{col.name}</span>
          <span className={styles.hostCount}>
            {crew.length}{maybeN ? ` · ${maybeN}?` : ''}{noN ? ` · ${noN}✕` : ''}
          </span>
        </div>
        {col.boat !== 'kyle' && col.boat !== 'nick' && (
          <div className={styles.colBoat}>on {boatByKey[col.boat]?.name}</div>
        )}

        <ul className={styles.people}>
          {people.map(p => {
            const menuKey = `${col.key}:${(p.name || '').toLowerCase()}`;
            return (
              <li key={p.id || p.name} className={styles.personRow}>
                <div className={styles.pNameWrap}>
                  <button
                    className={styles.pName}
                    title={`Move ${p.name} to another boat`}
                    onClick={() => setMenuFor(menuFor === menuKey ? null : menuKey)}
                  >
                    {p.name} <span className={styles.pCaret}>⋯</span>
                  </button>
                  {menuFor === menuKey && (
                    <div className={styles.moveMenu} ref={menuRef}>
                      <div className={styles.moveMenuLabel}>Move to</div>
                      {COLUMNS.filter(c => c.key !== col.key).map(c => (
                        <button
                          key={c.key}
                          className={styles.moveMenuItem}
                          onClick={() => moveTo(p, c.key)}
                          disabled={boatFull(c.boat)}
                        >
                          <i className={styles.moveDot} style={{ background: c.color }} />
                          {c.name}{c.boat === 'kismet' ? ' · Kismet' : ''}
                          {boatFull(c.boat) ? ' (full)' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.seg}>
                  {STATES.map(opt => {
                    const active = p.status === opt.k;
                    const blocked = opt.k === 'going' && boatIsFull && !active;
                    return (
                      <button
                        key={opt.k}
                        className={`${styles.segBtn} ${active ? opt.cls : ''}`}
                        onClick={() => setStatus(p, active ? 'clear' : opt.k)}
                        disabled={busyId === p.id || blocked}
                        title={active ? `Clear ${p.name}` : `${p.name}: ${opt.label}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>

        <div className={styles.addNewRow}>
          <input
            type="text"
            className={styles.input}
            value={draft}
            onChange={e => setDrafts(d => ({ ...d, [col.key]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') setStatus({ name: draft, host: col.key }, 'going'); }}
            placeholder={boatIsFull ? 'Boat is full' : 'Add someone else…'}
            disabled={boatIsFull}
          />
          <button
            className={styles.addBtn}
            onClick={() => setStatus({ name: draft, host: col.key }, 'going')}
            disabled={boatIsFull || !draft.trim()}
          >
            Add
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {/* The fleet — one hull per boat, left to right. */}
      <div className={styles.fleet}>
        {BOATS.map(b => {
          const seated = columnsForBoat(b.key).flatMap(c => roster.filter(r => r.host === c.key));
          return (
            <div key={b.key} className={styles.fleetBoat}>
              <div className={styles.countRow}>
                <span className={styles.boatTitle}>⛵ {b.name}</span>
                <span className={styles.count}>
                  {seated.length}/{b.capacity}{seated.length >= b.capacity ? ' · full' : ''}
                </span>
              </div>
              <BoatArt boat={b} seated={seated} />
            </div>
          );
        })}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {/* One column per bucket. Click a name to move that person to another boat. */}
      <div className={styles.columns}>
        {COLUMNS.map(renderColumn)}
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { doc, runTransaction, updateDoc, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import styles from './BoatDay.module.css';

export const BOAT_CAPACITY = 24;
export const BOAT_NAME = 'The Kismet';

// The three people who each bring a crew aboard. Fixed in code like BOAT_NAME —
// The Kismet is a specific boat with specific hosts. Seats are SHARED across all
// three: she is full at BOAT_CAPACITY however the split falls, so any column can
// take the last seat.
export const HOSTS = [
  { key: 'dan', name: 'Dan', color: '#4f46e5', aliases: [] },
  { key: 'mike', name: 'Mike', color: '#059669', aliases: ['sunnie'] },
  { key: 'johnny', name: 'Johnny', color: '#ea580c', aliases: [] },
];

const HOST_KEYS = HOSTS.map(h => h.key);
const hostColor = key => HOSTS.find(h => h.key === key)?.color || '#94a3b8';
const hostName = key => HOSTS.find(h => h.key === key)?.name || 'crew';

// A Friends contact's free-text "guest of" value ties them to a host: it maps to
// the first host whose name — or an alias — appears in the value. So "Mike &
// Sunnie" → mike, "Johnny" → johnny, "Dan" → dan. Returns null if nothing matches.
export function hostForGuest(guest) {
  const g = (guest || '').toLowerCase();
  if (!g) return null;
  for (const h of HOSTS) {
    const tokens = [h.name.toLowerCase(), ...(h.aliases || [])];
    if (tokens.some(t => g.includes(t))) return h.key;
  }
  return null;
}

// Build the per-host guest lists the public boat page shows as tap-to-add chips.
// The owner computes this from their (private) Friends and writes it onto the
// event doc, because whoever opens the public link can't read those Friends.
export function buildBoatSuggestions(friends) {
  const out = Object.fromEntries(HOST_KEYS.map(k => [k, []]));
  for (const f of friends || []) {
    const key = hostForGuest(f.guest);
    if (key && out[key] && (f.name || '').trim()) {
      out[key].push({ id: f.id, name: f.name.trim() });
    }
  }
  for (const k of HOST_KEYS) {
    out[k].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  return out;
}

// Seat positions in the SVG's coordinate space — two benches inside the hull,
// drawn as a cutaway. The list length is the capacity; the hull art is drawn to
// contain exactly these, and the bow is left clear for the name.
const SEATS = [
  ...Array.from({ length: 12 }, (_, i) => ({ x: 158 + i * 25.5, y: 216 })),
  ...Array.from({ length: 12 }, (_, i) => ({ x: 166 + i * 24, y: 234 })),
];

// Stanchion feet along the sheer, for the lifelines.
const STANCHIONS = [90, 120, 150, 380, 410, 440];

function slugId(name) {
  const base = name.trim().replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return `guest_${base || 'x'}_${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * The sailboat view + roster. Rendered both inside EventDetail (for the owner)
 * and on the public /boat/:eventId page (for anyone with the link), so it takes
 * the viewer's identity as props rather than reading auth.
 */
export function BoatDay({ event, eventId, viewerId, viewerName, isOwner = false }) {
  const boat = event.boatDay || {};
  const roster = useMemo(
    () => (Array.isArray(boat.roster) ? boat.roster : []),
    [boat.roster],
  );
  const [busyId, setBusyId] = useState(null);
  const [busyHost, setBusyHost] = useState(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});

  const full = roster.length >= BOAT_CAPACITY;

  // Seats fill host by host, so the boat reads as three colour-blocked crews
  // rather than a scatter. Anything with an unrecognised host still gets a seat.
  const seated = useMemo(() => [
    ...HOSTS.flatMap(h => roster.filter(r => r.host === h.key)),
    ...roster.filter(r => !HOST_KEYS.includes(r.host)),
  ], [roster]);

  // Names already aboard, for dimming a guest chip once they've boarded.
  const aboardNames = useMemo(
    () => new Set(roster.map(r => (r.name || '').toLowerCase())),
    [roster],
  );

  // Per-host guest lists the owner published from their Friends (see
  // buildBoatSuggestions). Whoever opens the link can't read those Friends, so
  // these ride along on the event doc.
  const guestLists = boat.suggestions && typeof boat.suggestions === 'object' ? boat.suggestions : {};

  async function addPerson(rawName, hostKey, explicitId) {
    const name = (rawName || '').trim();
    if (!name) return;
    setError('');
    setBusyHost(hostKey);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'events', eventId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Event not found.');
        const current = Array.isArray(snap.data().boatDay?.roster) ? snap.data().boatDay.roster : [];
        // Guard against a double-add of the same person (e.g. tapping a guest
        // chip twice before the snapshot catches up).
        if (current.some(r => (r.name || '').toLowerCase() === name.toLowerCase())) return;
        // Capacity is checked inside the transaction so two people tapping Add at
        // once can't oversubscribe the last seat.
        if (current.length >= BOAT_CAPACITY) throw new Error(`The boat is full — ${BOAT_CAPACITY} people max.`);
        tx.update(ref, {
          'boatDay.roster': [...current, {
            id: explicitId || slugId(name),
            name,
            host: hostKey,
            addedBy: viewerId || '',
            addedByName: viewerName || '',
            addedAt: new Date().toISOString(), // serverTimestamp() is not allowed inside arrays
          }],
        });
      });
      setDrafts(d => ({ ...d, [hostKey]: '' }));
    } catch (e) {
      setError(e.message || 'Could not add that person.');
    } finally {
      setBusyHost(null);
    }
  }

  async function removePerson(item) {
    setError('');
    setBusyId(item.id);
    try {
      await updateDoc(doc(db, 'events', eventId), { 'boatDay.roster': arrayRemove(item) });
    } catch {
      setError('Could not remove that person.');
    } finally {
      setBusyId(null);
    }
  }

  const canRemove = (item) => isOwner || item.addedBy === viewerId || item.id === viewerId;

  return (
    <div className={styles.wrap}>
      <div className={styles.boatCard}>
        <div className={styles.countRow}>
          <span className={styles.boatTitle}>⛵ {BOAT_NAME}</span>
          <span className={styles.countGroup}>
            <span className={styles.count}>{roster.length} / {BOAT_CAPACITY} aboard</span>
            {full && <span className={styles.fullTag}>Full</span>}
          </span>
        </div>

        {/* Catalina 42-ish masthead sloop, drawn in profile with the bow to the
            left. Layer order matters: keel and hull go down before the water so
            she floats in it rather than on it, and the mast goes on after the
            sails so it reads in front of them. */}
        <svg className={styles.boat} viewBox="0 0 520 310" role="img"
             aria-label={`${BOAT_NAME}, a sailboat with ${roster.length} of ${BOAT_CAPACITY} seats filled`}>
          {/* Standing rigging: forestay + backstay */}
          <line className={styles.stay} x1="230" y1="8" x2="50" y2="188" />
          <line className={styles.stay} x1="230" y1="8" x2="462" y2="192" />

          {/* Fin keel + spade rudder */}
          <path className={styles.keel} d="M236 244 L296 244 L282 290 L256 290 Z" />
          <path className={styles.rudder} d="M410 246 L422 246 L418 282 L408 282 Z" />

          {/* Hull: curved near-plumb stem, gentle sheer, reverse transom */}
          <path className={styles.hull} d="M50 188 Q255 200 462 194 L448 242 Q255 260 72 232 Q54 220 50 188 Z" />
          <path className={styles.stripe} d="M58 199 Q255 211 456 205" />

          {/* Lifelines */}
          <path className={styles.lifeline} d="M64 180 Q255 192 452 186" />
          {STANCHIONS.map(x => (
            <line key={x} className={styles.stanchion} x1={x} y1="192" x2={x} y2="180" />
          ))}

          {/* Coachroof + ports */}
          <path className={styles.cabin} d="M196 196 L214 174 L330 176 L348 196 Z" />
          <rect className={styles.port} x="224" y="181" width="22" height="6" rx="3" />
          <rect className={styles.port} x="254" y="181" width="22" height="6" rx="3" />
          <rect className={styles.port} x="284" y="182" width="22" height="6" rx="3" />
          <rect className={styles.port} x="314" y="183" width="13" height="6" rx="3" />

          {/* Boom, then sails: genoa first so the main layers over its foot */}
          <line className={styles.boom} x1="232" y1="166" x2="366" y2="170" />
          <path className={styles.jib} d="M228 10 L52 188 L270 164 Q246 84 228 10 Z" />
          <path className={styles.sail} d="M236 14 L236 164 L364 168 Q310 88 236 14 Z" />
          <rect className={styles.mast} x="228" y="8" width="4.5" height="190" rx="2" />
          <path className={styles.flag} d="M233 10 L260 18 L233 26 Z" />

          {/* Water over the hull's bottom */}
          <path className={styles.water} d="M0 244 Q44 237 88 244 T176 244 T264 244 T352 244 T440 244 T520 244 V310 H0 Z" />
          <path className={styles.waterLine} d="M52 270 Q82 264 112 270 T172 270" />
          <path className={styles.waterLine} d="M344 284 Q374 278 404 284 T464 284" />

          <text className={styles.boatName} x="74" y="226">{BOAT_NAME}</text>

          {/* Seats, coloured by whose crew is in them */}
          {SEATS.map((seat, i) => {
            const person = seated[i];
            return (
              <circle
                key={i}
                cx={seat.x}
                cy={seat.y}
                r="6"
                className={person ? styles.seatFilled : styles.seatEmpty}
                style={person ? { fill: hostColor(person.host) } : undefined}
              >
                {person && <title>{person.name} — with {hostName(person.host)}</title>}
              </circle>
            );
          })}
        </svg>

        <div className={styles.legend}>
          {HOSTS.map(h => (
            <span key={h.key}>
              <i className={styles.dotFilled} style={{ background: h.color }} /> {h.name}
            </span>
          ))}
          <span><i className={styles.dotEmpty} /> Open seat</span>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {/* One column per host. Seats are shared, so a column never locks on its
          own count — only when the whole boat is full. */}
      <div className={styles.columns}>
        {HOSTS.map(host => {
          const crew = roster.filter(r => r.host === host.key);
          const draft = drafts[host.key] || '';
          // This host's guests who aren't aboard yet — one tap boards them.
          const chips = (guestLists[host.key] || [])
            .filter(g => g && g.name && !aboardNames.has(g.name.toLowerCase()));
          return (
            <div key={host.key} className={styles.column}>
              <div className={styles.columnHead}>
                <i className={styles.hostDot} style={{ background: host.color }} />
                <span className={styles.hostName}>{host.name}</span>
                <span className={styles.hostCount}>{crew.length}</span>
              </div>

              {crew.length === 0 ? (
                <p className={styles.empty}>Nobody yet.</p>
              ) : (
                <ul className={styles.roster}>
                  {crew.map(item => (
                    <li key={item.id} className={styles.rosterItem}>
                      <span
                        className={styles.rosterName}
                        title={item.addedByName ? `Added by ${item.addedByName}` : undefined}
                      >
                        {item.name}
                      </span>
                      {canRemove(item) && (
                        <button
                          className={styles.removeBtn}
                          onClick={() => removePerson(item)}
                          disabled={busyId === item.id}
                          title={`Remove ${item.name}`}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {chips.length > 0 && (
                <div className={styles.chips}>
                  {chips.map(g => (
                    <button
                      key={g.id || g.name}
                      className={styles.chip}
                      onClick={() => addPerson(g.name, host.key, g.id)}
                      disabled={full || busyHost === host.key}
                      title={`Add ${g.name}`}
                    >
                      + {g.name}
                    </button>
                  ))}
                </div>
              )}

              <div className={styles.addNewRow}>
                <input
                  type="text"
                  className={styles.input}
                  value={draft}
                  onChange={e => setDrafts(d => ({ ...d, [host.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addPerson(draft, host.key); }}
                  placeholder={full ? 'Boat is full' : 'Add someone else…'}
                  disabled={full}
                />
                <button
                  className={styles.addBtn}
                  onClick={() => addPerson(draft, host.key)}
                  disabled={full || !draft.trim() || busyHost === host.key}
                >
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { doc, runTransaction, updateDoc, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import styles from './BoatDay.module.css';

export const BOAT_CAPACITY = 24;
export const BOAT_NAME = 'The Kismet';

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
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const aboardIds = useMemo(() => new Set(roster.map(r => r.id)), [roster]);
  const full = roster.length >= BOAT_CAPACITY;

  // The viewer, plus everyone on the event who comes "by way of" the viewer.
  const myPeople = useMemo(() => {
    const entries = Object.entries(event.members || {})
      .filter(([, m]) => m && typeof m === 'object' && m.name);
    const out = [];
    const self = entries.find(([uid]) => uid === viewerId);
    if (self) out.push({ id: self[0], name: self[1].name, self: true });
    else if (viewerId && viewerName) out.push({ id: viewerId, name: viewerName, self: true });
    const linked = [];
    for (const [uid, m] of entries) {
      if (uid !== viewerId && m.plusOneOf === viewerId) linked.push({ id: uid, name: m.name });
    }
    // Firestore map key order isn't stable across snapshots, so sort by name —
    // otherwise these buttons reshuffle under the user's finger after each add.
    linked.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return [...out, ...linked];
  }, [event.members, viewerId, viewerName]);

  async function addPerson(person) {
    setError('');
    setBusyId(person.id);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'events', eventId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Event not found.');
        const current = Array.isArray(snap.data().boatDay?.roster) ? snap.data().boatDay.roster : [];
        if (current.some(r => r.id === person.id)) return; // already aboard — someone beat us to it
        if (current.length >= BOAT_CAPACITY) throw new Error(`The boat is full — ${BOAT_CAPACITY} people max.`);
        tx.update(ref, {
          'boatDay.roster': [...current, {
            id: person.id,
            name: person.name,
            addedBy: viewerId || '',
            addedByName: viewerName || '',
            addedAt: new Date().toISOString(), // serverTimestamp() is not allowed inside arrays
          }],
        });
      });
    } catch (e) {
      setError(e.message || 'Could not add that person.');
    } finally {
      setBusyId(null);
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

  async function addNewPerson() {
    const name = newName.trim();
    if (!name) return;
    await addPerson({ id: slugId(name), name });
    setNewName('');
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

          {/* Seats */}
          {SEATS.map((seat, i) => {
            const person = roster[i];
            return (
              <circle
                key={i}
                cx={seat.x}
                cy={seat.y}
                r="6"
                className={person ? styles.seatFilled : styles.seatEmpty}
              >
                {person && <title>{person.name}</title>}
              </circle>
            );
          })}
        </svg>

        <div className={styles.legend}>
          <span><i className={styles.dotFilled} /> Aboard</span>
          <span><i className={styles.dotEmpty} /> Open seat</span>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {/* Who's aboard */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Aboard ({roster.length})</h3>
        {roster.length === 0 ? (
          <p className={styles.empty}>Nobody's on the boat yet. Add yourself and your people below.</p>
        ) : (
          <ul className={styles.roster}>
            {roster.map((item, i) => (
              <li key={item.id} className={styles.rosterItem}>
                <span className={styles.seatNum}>{i + 1}</span>
                <span className={styles.rosterName}>{item.name}</span>
                {item.addedByName && item.addedBy !== item.id && (
                  <span className={styles.addedBy}>added by {item.addedByName}</span>
                )}
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
      </div>

      {/* Add people */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Add your people</h3>
        {myPeople.length > 0 ? (
          <div className={styles.peopleGrid}>
            {myPeople.map(p => {
              const on = aboardIds.has(p.id);
              return (
                <button
                  key={p.id}
                  className={on ? styles.personOn : styles.person}
                  onClick={() => !on && addPerson(p)}
                  disabled={on || busyId === p.id || full}
                >
                  <span className={styles.personMark}>{on ? '✓' : '+'}</span>
                  <span className={styles.personName}>
                    {p.name}{p.self ? ' (you)' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className={styles.empty}>Nobody is linked to you on this event yet.</p>
        )}

        <p className={styles.addNewLabel}>Someone else?</p>
        <div className={styles.addNewRow}>
          <input
            type="text"
            className={styles.input}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addNewPerson(); }}
            placeholder="Type a name…"
            disabled={full}
          />
          <button
            className={styles.addBtn}
            onClick={addNewPerson}
            disabled={!newName.trim() || full}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { doc, runTransaction, updateDoc, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import styles from './BoatDay.module.css';

export const BOAT_CAPACITY = 24;

// Seat positions in the SVG's coordinate space — two benches inside the hull.
// The list length is the capacity; the hull art is drawn to contain exactly these.
const SEATS = [
  ...Array.from({ length: 12 }, (_, i) => ({ x: 62 + i * 27, y: 211 })),
  ...Array.from({ length: 12 }, (_, i) => ({ x: 92 + i * 22, y: 235 })),
];

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
          <span className={styles.count}>{roster.length} / {BOAT_CAPACITY} aboard</span>
          {full && <span className={styles.fullTag}>Boat is full</span>}
        </div>

        <svg className={styles.boat} viewBox="0 0 420 300" role="img"
             aria-label={`Sailboat with ${roster.length} of ${BOAT_CAPACITY} seats filled`}>
          {/* Water */}
          <path className={styles.water} d="M0 262 Q 35 254 70 262 T 140 262 T 210 262 T 280 262 T 350 262 T 420 262 V300 H0 Z" />
          <path className={styles.waterLine} d="M40 280 Q 70 274 100 280 T 160 280" />
          <path className={styles.waterLine} d="M260 286 Q 290 280 320 286 T 380 286" />

          {/* Mast + sails */}
          <path className={styles.sail} d="M156 42 L156 186 L268 186 Z" />
          <path className={styles.jib} d="M144 46 L144 186 L66 186 Z" />
          <rect className={styles.mast} x="146" y="30" width="5" height="158" rx="2" />
          <path className={styles.flag} d="M151 32 L182 40 L151 48 Z" />

          {/* Hull */}
          <path className={styles.hull} d="M26 190 L394 190 L364 250 Q 210 276 56 250 Z" />
          <line className={styles.deck} x1="26" y1="190" x2="394" y2="190" />

          {/* Seats */}
          {SEATS.map((seat, i) => {
            const person = roster[i];
            return (
              <circle
                key={i}
                cx={seat.x}
                cy={seat.y}
                r="7.5"
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

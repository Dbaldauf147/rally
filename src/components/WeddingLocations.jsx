import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { normalizeAreas } from '../lib/venueAreas';
import { normalizeVenue } from '../lib/weddingVenues';
import { VenueAreasEditor } from './VenueAreasEditor';
import styles from './WeddingPage.module.css';

/* Wedding → Locations: the places the wedding could be in, which every venue
   is matched to (the Area column on Venues). Saved as weddingVenueAreas. */
export function WeddingLocations() {
  const { user } = useAuth();
  const [areas, setAreas] = useState([]);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() || {};
      setAreas(normalizeAreas(data.weddingVenueAreas));
      setVenues(Array.isArray(data.weddingVenues) ? data.weddingVenues.map((v) => normalizeVenue(v)) : []);
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  const save = (next) => {
    setAreas(next);
    if (!user) return Promise.resolve();
    return setDoc(doc(db, 'users', user.uid), { weddingVenueAreas: next }, { merge: true })
      .then(() => setError(''))
      .catch((err) => setError(`Could not save: ${err.message}`));
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
      </div>
      {error && <p className={styles.digestErrMsg} role="status">{error}</p>}
      {loading ? <p className={styles.muted}>Loading…</p> : <VenueAreasEditor areas={areas} venues={venues} onSave={save} />}
    </div>
  );
}

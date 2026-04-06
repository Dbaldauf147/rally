import { useNavigate } from 'react-router-dom';
import styles from './TripDetail.module.css';

export function TripDetail() {
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate('/')}>← Back</button>
      <div className={styles.placeholder}>
        <div className={styles.icon}>🗺</div>
        <h2>Trip Planning</h2>
        <p>Trip itineraries, flights, accommodations, and budget tracking coming soon.</p>
      </div>
    </div>
  );
}

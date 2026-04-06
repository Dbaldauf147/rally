import { format } from 'date-fns';
import styles from './EventCard.module.css';

export function EventCard({ event, onClick }) {
  const date = event.date?.toDate ? event.date.toDate() : new Date(event.date);
  const members = event.members ? Object.values(event.members).filter(Boolean) : [];
  const memberCount = members.length;
  const now = new Date();
  const isPast = event.stage === 'finalized' && date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const stage = event.stage || 'voting';
  const showDate = stage === 'finalized' || isPast;

  return (
    <button className={styles.card} onClick={onClick}>
      {showDate ? (
        <div className={styles.dateChip}>
          <span className={styles.dateMonth}>{format(date, 'MMM')}</span>
          <span className={styles.dateDay}>{format(date, 'd')}</span>
        </div>
      ) : (
        <div className={styles.dateChip} style={{ background: stage === 'voting' ? '#FEF3C7' : '#EEF2FF' }}>
          <span className={styles.dateMonth} style={{ color: stage === 'voting' ? '#D97706' : '#6366F1' }}>{stage === 'voting' ? '📊' : '🗓'}</span>
          <span className={styles.dateDay} style={{ color: stage === 'voting' ? '#D97706' : '#6366F1', fontSize: '0.65rem' }}>TBD</span>
        </div>
      )}
      <div className={styles.info}>
        <h3 className={styles.title}>{event.title}</h3>
        <p className={styles.meta}>
          {showDate ? format(date, 'EEEE, MMM d · h:mm a') : ''}
          {event.location && <span className={styles.location}>{showDate ? ' · ' : ''}{event.location}</span>}
        </p>
        <div className={styles.rsvpRow}>
          {isPast && <span className={styles.rsvpNone}>Completed</span>}
          {!isPast && stage === 'finalized' && <span className={styles.rsvpYes}>Dates Finalized</span>}
        </div>
      </div>
    </button>
  );
}

import { format } from 'date-fns';
import styles from './EventCard.module.css';

export function EventCard({ event, onClick, votePct }) {
  const date = event.date?.toDate ? event.date.toDate() : new Date(event.date);
  const members = event.members ? Object.values(event.members).filter(Boolean) : [];
  const memberCount = members.length;
  const now = new Date();
  const isPast = event.stage === 'finalized' && date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const stage = event.stage || 'voting';
  const showDate = stage === 'finalized' || isPast;
  const cancelled = !!event.cancelled;

  return (
    <button
      className={styles.card}
      onClick={onClick}
      style={cancelled ? { opacity: 0.55, filter: 'grayscale(0.7)' } : undefined}
    >
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
        <h3 className={styles.title} style={cancelled ? { textDecoration: 'line-through' } : undefined}>{event.title}</h3>
        <p className={styles.meta}>
          {showDate ? format(date, 'EEEE, MMM d · h:mm a') : ''}
          {event.location && <span className={styles.location}>{showDate ? ' · ' : ''}{event.location}</span>}
        </p>
        <div className={styles.rsvpRow}>
          {cancelled && (
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
              color: '#B45309', background: '#FEF3C7', border: '1px solid #FDE68A',
              borderRadius: '999px', padding: '0.1rem 0.45rem',
            }}>🚫 Cancelled</span>
          )}
          {!cancelled && isPast && <span className={styles.rsvpNone}>Completed</span>}
          {!cancelled && !isPast && stage === 'finalized' && <span className={styles.rsvpYes}>Dates Finalized</span>}
          {!cancelled && !isPast && stage === 'voting' && votePct != null && (() => {
            const color = votePct >= 75 ? '#16a34a' : votePct >= 40 ? '#D97706' : '#DC2626';
            return (
              <div className={styles.votePct}>
                <div className={styles.votePctBar}>
                  <div className={styles.votePctFill} style={{ width: `${votePct}%`, background: color }} />
                </div>
                <span className={styles.votePctLabel} style={{ color }}>{votePct}% voted</span>
              </div>
            );
          })()}
        </div>
      </div>
    </button>
  );
}

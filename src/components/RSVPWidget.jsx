import styles from './RSVPWidget.module.css';

const OPTIONS = [
  { key: 'yes', label: 'Going', emoji: '✓' },
  { key: 'maybe', label: 'Maybe', emoji: '?' },
  { key: 'no', label: 'Can\'t go', emoji: '✗' },
];

export function RSVPWidget({ currentRsvp, onRsvp }) {
  return (
    <div className={styles.wrap}>
      {OPTIONS.map(o => (
        <button
          key={o.key}
          className={currentRsvp === o.key ? styles[`btn_${o.key}_active`] : styles.btn}
          onClick={() => onRsvp(o.key)}
        >
          <span className={styles.emoji}>{o.emoji}</span> {o.label}
        </button>
      ))}
    </div>
  );
}

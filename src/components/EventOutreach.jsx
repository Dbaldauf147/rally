import { useState } from 'react';
import { CHANNELS, KINDS, AUDIENCES } from '../lib/eventOutreach';
import styles from './EventDetail.module.css';

const groupLabel = { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', margin: '1rem 0 0.4rem' };
const choice = (on, disabled) => ({
  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
  padding: '0.45rem 0.85rem', borderRadius: 'var(--radius-full)',
  border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
  background: on ? 'var(--color-accent-light)' : 'var(--color-surface)',
  color: on ? 'var(--color-accent)' : 'var(--color-text-secondary)',
  fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});

/* The event page's Reach Out dialog: pick how (text or email), what (the poll
   or the calendar invite) and who, then hand the choice back. Nothing is sent
   from here — a text opens the draft panel, an email opens a compose window —
   so the dialog only has to make the choice clear and show who it reaches.

   `count(channel, audience)` is how many people that reaches: guests in the
   audience who have a phone (text) or an email address (email). */
export function EventOutreach({ dateTBD, count, onSend, onClose }) {
  const [channel, setChannel] = useState('text');
  const [kind, setKind] = useState('poll');
  const [audience, setAudience] = useState('all');
  const n = count(channel, audience);
  const need = channel === 'text' ? 'a phone number' : 'an email address';

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-label="Reach out" data-testid="reach-out-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Reach Out</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0' }}>
          Text or email your guests. You’ll see the message before anything goes out.
        </p>

        <div style={groupLabel}>How</div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} role="radiogroup" aria-label="How">
          {CHANNELS.map(c => (
            <button key={c.key} type="button" role="radio" aria-checked={channel === c.key} style={choice(channel === c.key)} onClick={() => setChannel(c.key)}>
              <span aria-hidden="true">{c.icon}</span>{c.label}
            </button>
          ))}
        </div>

        <div style={groupLabel}>What</div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} role="radiogroup" aria-label="What">
          {KINDS.map(k => {
            // A calendar invite needs a date to put on the calendar.
            const off = k.key === 'calendar' && dateTBD;
            return (
              <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} disabled={off} title={off ? 'Pick a date first' : undefined} style={choice(kind === k.key, off)} onClick={() => setKind(k.key)}>
                <span aria-hidden="true">{k.icon}</span>{k.label}
              </button>
            );
          })}
        </div>
        {dateTBD && <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.35rem 0 0' }}>A calendar invite can go out once the date is chosen.</p>}

        <div style={groupLabel}>Who</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }} role="radiogroup" aria-label="Who">
          {AUDIENCES.map(a => (
            <button key={a.key} type="button" role="radio" aria-checked={audience === a.key} data-audience={a.key} style={{ ...choice(audience === a.key), justifyContent: 'space-between', borderRadius: 'var(--radius-md)' }} onClick={() => setAudience(a.key)}>
              <span>{a.label}</span>
              <span style={{ fontWeight: 500, opacity: 0.8 }}>{count(channel, a.key)}</span>
            </button>
          ))}
        </div>

        <p data-testid="reach-out-summary" style={{ fontSize: '0.8rem', color: n ? 'var(--color-text-secondary)' : 'var(--color-warning)', margin: '0.9rem 0 0' }}>
          {n
            ? `${n} ${n === 1 ? 'person' : 'people'} with ${need}.`
            : `Nobody in this group has ${need}.`}
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button
            type="button"
            disabled={!n}
            data-testid="reach-out-go"
            onClick={() => onSend({ channel, kind, audience })}
            style={{ flex: 2, padding: '0.6rem', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: n ? 'pointer' : 'not-allowed', opacity: n ? 1 : 0.5, fontFamily: 'inherit' }}
          >{channel === 'text' ? 'Write the text' : 'Open the email'}</button>
        </div>
      </div>
    </div>
  );
}

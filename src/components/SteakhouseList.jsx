import { useEffect, useState } from 'react';
import { formatGuysNightDate, spotLink } from '../lib/guysNight';
import styles from './SteakhouseList.module.css';

/* The Guys Night Out steakhouse list (from Prep Day) on a steak-night event:
   what's still to go and what's done, with the days you went. The organizer
   can email it to everyone on the event, or take it off this event. */
export function SteakhouseList({ eventId, event, user, isOrganizer, onHide }) {
  const [state, setState] = useState({ loading: true });
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/prepday-steakhouses?eventId=${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setState({ error: res.status === 404 ? 'hidden' : body.error || `HTTP ${res.status}` });
        else setState({ data: body });
      } catch (err) {
        if (!cancelled) setState({ error: err.message || 'Could not load the list' });
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, user]);

  async function emailList() {
    const n = Object.values(event.members || {}).filter((m) => m?.email).length;
    if (!window.confirm(`Email the steakhouse list to ${n} ${n === 1 ? 'person' : 'people'} on this event (you included)?`)) return;
    setSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/prepday-steakhouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ eventId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      alert(body.failed?.length
        ? `Sent to ${body.sent} of ${body.of}. Couldn't reach: ${body.failed.map((f) => f.to).join(', ')}`
        : `Steakhouse list emailed to ${body.sent} ${body.sent === 1 ? 'person' : 'people'}.`);
    } catch (err) {
      alert(`Couldn't send the list: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  // Not this event's list (or not this person's): show nothing at all.
  if (state.error === 'hidden') return null;

  const data = state.data;
  const sentAt = event.steakhouseEmailSentAt ? new Date(event.steakhouseEmailSentAt) : null;

  return (
    <section className={styles.card} data-testid="steakhouse-list">
      <div className={styles.head}>
        <button type="button" className={styles.title} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          🥩 Steakhouses{data && data.total > 0 ? ` — ${data.doneCount} of ${data.total} done` : ''}
          <span className={styles.chev} aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        {isOrganizer && (
          <span className={styles.actions}>
            <button type="button" className={styles.primary} disabled={sending || !data || data.total === 0} onClick={emailList}>
              {sending ? 'Sending…' : '✉️ Email list to everyone'}
            </button>
            <button type="button" className={styles.link} onClick={onHide} title="Take the steakhouse list off this event">Hide</button>
          </span>
        )}
      </div>
      {sentAt && !Number.isNaN(sentAt.getTime()) && (
        <p className={styles.meta}>
          Last emailed {sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {event.steakhouseEmailResults && ` to ${event.steakhouseEmailResults.sent} of ${event.steakhouseEmailResults.of}`}
        </p>
      )}
      {open && (
        state.loading ? <p className={styles.meta}>Loading the list…</p>
          : state.error ? <p className={styles.error}>Couldn’t load the steakhouse list: {state.error}</p>
            : data.total === 0 ? <p className={styles.meta}>{data.reason || 'No steakhouses on the list yet.'}</p>
              : (
                <div className={styles.cols}>
                  <Section title="Still to go" spots={data.todo} done={false} />
                  <Section title="Done ✓" spots={data.done} done />
                </div>
              )
      )}
    </section>
  );
}

function Section({ title, spots, done }) {
  return (
    <div>
      <h4 className={styles.sectionTitle}>{title} <span className={styles.count}>{spots.length}</span></h4>
      {spots.length === 0 ? <p className={styles.meta}>{done ? 'None yet.' : 'All done!'}</p> : (
        <ul className={styles.list}>
          {spots.map((s) => {
            const link = spotLink(s);
            return (
              <li key={s.id || s.name} className={styles.spot}>
                <div className={styles.spotTop}>
                  {link ? <a href={link} target="_blank" rel="noreferrer" className={styles.name}>{s.name}</a> : <span className={styles.name}>{s.name}</span>}
                  {s.next && <span className={styles.next}>★ Next</span>}
                  {!done && <span className={styles.tag}>{s.visited ? 'Been before' : 'Never been'}</span>}
                  {s.area && <span className={styles.tag}>{s.area}</span>}
                </div>
                {done && s.dates.length > 0 && <div className={styles.detail}>Went {s.dates.map(formatGuysNightDate).join(', ')}</div>}
                {s.address && <div className={styles.detail}>{s.address}</div>}
                {s.dish && <div className={styles.detail}>Get: {s.dish}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

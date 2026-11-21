import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, FieldPath } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { secretSantaEnabled } from '../lib/secretSanta';
import { wishlistPeople, whoAmI, memberKeyByEmail, cleanWish, cleanLink, MAX_WISHES, MAX_WISH_TEXT } from '../lib/wishlist';
import styles from './WishlistPage.module.css';

// /wishlist/:eventId — the Secret Santa wishlist page (lib/wishlist.js).
// No sign-in, like the poll page: a guest taps their name, writes what they
// would like, and can look at everybody else's. Every list but your own is a
// wrapped present until it is clicked, so having one open on screen says
// nothing about who you drew — and it can be wrapped up again.

const rememberKey = (eventId) => `rally_wishlist_me_${eventId}`;
function remembered(eventId) {
  try { return localStorage.getItem(rememberKey(eventId)) || ''; } catch { return ''; }
}
function remember(eventId, key) {
  try {
    if (key) localStorage.setItem(rememberKey(eventId), key);
    else localStorage.removeItem(rememberKey(eventId));
  } catch { /* private window: asked again next visit */ }
}

function Shell({ children }) {
  return (
    <div className={styles.page}>
      <div className={styles.snow} aria-hidden="true" />
      <div className={styles.lights} aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <span key={i} className={styles.bulb} />)}
      </div>
      <div className={styles.inner}>{children}</div>
    </div>
  );
}

function Notice({ emoji, title, children }) {
  return (
    <Shell>
      <div className={`${styles.card} ${styles.notice}`}>
        <div className={styles.tree} aria-hidden="true">{emoji}</div>
        <h1 className={styles.cardTitle} style={{ marginTop: '0.6rem' }}>{title}</h1>
        <p className={styles.cardHint} style={{ marginBottom: 0 }}>{children}</p>
      </div>
    </Shell>
  );
}

function WishItems({ wishes, onRemove, busy }) {
  return (
    <ul className={styles.wishes}>
      {wishes.map((w) => (
        <li key={w.id} className={styles.wish} data-testid="wish">
          <span className={styles.wishDot} aria-hidden="true">🎁</span>
          <div className={styles.wishBody}>
            <div className={styles.wishText}>{w.text}</div>
            {w.link && (
              <a className={styles.wishLink} href={w.link} target="_blank" rel="noopener noreferrer">
                {linkLabel(w.link)} ↗
              </a>
            )}
          </div>
          {onRemove && (
            <button type="button" className={styles.removeBtn} disabled={busy} onClick={() => onRemove(w.id)} aria-label={`Remove ${w.text}`} title="Remove">×</button>
          )}
        </li>
      ))}
    </ul>
  );
}

function linkLabel(link) {
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return 'Link'; }
}

export function WishlistPage() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  // The name tapped on this visit; '' after "not you?", which also stops the
  // page from guessing again.
  const [chosen, setChosen] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'ok' | 'error', message }

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'events', eventId), (snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      else setMissing(true);
      setLoading(false);
    }, () => {
      setMissing(true);
      setLoading(false);
    });
    return unsub;
  }, [eventId]);

  const people = useMemo(() => wishlistPeople(event), [event]);
  const meKey = chosen !== null
    ? whoAmI(people, [chosen])
    : whoAmI(people, [searchParams.get('me'), remembered(eventId), user?.uid, memberKeyByEmail(event, user?.email)]);
  const me = people.find((p) => p.key === meKey) || null;
  const others = people.filter((p) => p.key !== meKey);

  function pick(key) {
    setChosen(key);
    remember(eventId, key);
    setStatus(null);
  }

  async function save(items, okMessage) {
    setBusy(true);
    setStatus(null);
    try {
      // A FieldPath, not a dotted string: a member key can hold a dot.
      await updateDoc(doc(db, 'events', eventId), new FieldPath('wishlists', meKey), { items, updatedAt: new Date().toISOString() });
      setStatus({ type: 'ok', message: okMessage });
      return true;
    } catch (err) {
      setStatus({ type: 'error', message: `That didn’t save — ${err.message || 'check your connection and try again.'}` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addWish(e) {
    e.preventDefault();
    if (!me || busy) return;
    const wish = cleanWish({ text, link });
    if (!wish) return;
    if (link.trim() && !cleanLink(link)) {
      setStatus({ type: 'error', message: 'That link doesn’t look like a web address — fix it, or leave it blank.' });
      return;
    }
    if (me.wishes.length >= MAX_WISHES) {
      setStatus({ type: 'error', message: `A list holds ${MAX_WISHES} wishes — take one off to add another.` });
      return;
    }
    if (await save([...me.wishes, wish], 'Added to your list.')) {
      setText('');
      setLink('');
    }
  }

  function removeWish(id) {
    if (!me || busy) return;
    save(me.wishes.filter((w) => w.id !== id), 'Taken off your list.');
  }

  function toggle(key) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (loading) return <Shell><p className={styles.lede} style={{ marginTop: '4rem', textAlign: 'center' }}>Loading…</p></Shell>;
  if (missing || !event) {
    return <Notice emoji="❄️" title="We couldn’t find that event">The link may be wrong, or the event may have been deleted. Ask whoever sent it to you for a new one.</Notice>;
  }
  if (!secretSantaEnabled(event) || event.cancelled) {
    return <Notice emoji="🎅" title="No wishlists here yet">{event.title ? <><strong>{event.title}</strong> doesn’t</> : 'This event doesn’t'} have a Secret Santa set up{event.cancelled ? ' — it was cancelled' : ''}. Check back once the organizer has started one.</Notice>;
  }

  const firstName = (me?.name || '').split(/\s+/)[0];

  return (
    <Shell>
      <header className={styles.header}>
        <div className={styles.tree} aria-hidden="true">🎄</div>
        <p className={styles.eyebrow}>Secret Santa wishlists</p>
        <h1 className={styles.title}>{event.title || 'Secret Santa'}</h1>
        <p className={styles.lede}>Tell your Secret Santa what you’d love, and peek at what everyone else is hoping for.</p>
      </header>

      {!me ? (
        <section className={styles.card} data-testid="wishlist-who">
          <h2 className={styles.cardTitle}>Who are you?</h2>
          {people.length === 0 ? (
            <p className={styles.cardHint} style={{ marginBottom: 0 }}>Nobody is on the guest list yet. Check back once the organizer has added people.</p>
          ) : (
            <>
              <p className={styles.cardHint}>Tap your name to write your wishlist.</p>
              <div className={styles.names}>
                {people.map((p) => (
                  <button key={p.key} type="button" className={styles.nameBtn} onClick={() => pick(p.key)} data-testid={`wishlist-name-${p.key}`}>{p.name}</button>
                ))}
              </div>
              <p className={styles.cardHint} style={{ margin: '0.9rem 0 0' }}>Not on the list? Ask the organizer to add you to the event.</p>
            </>
          )}
        </section>
      ) : (
        <section className={styles.card} data-testid="wishlist-mine">
          <h2 className={styles.cardTitle}>{firstName ? `${firstName}’s wishlist` : 'Your wishlist'}</h2>
          <p className={styles.cardHint}>
            Writing as <strong>{me.name}</strong> · <button type="button" className={styles.linkBtn} onClick={() => pick('')} data-testid="wishlist-not-you">not you?</button>
          </p>

          {me.wishes.length === 0
            ? <p className={styles.empty}>Your list is empty. Add a few ideas so your Secret Santa isn’t guessing.</p>
            : <WishItems wishes={me.wishes} onRemove={removeWish} busy={busy} />}

          <form className={styles.addForm} onSubmit={addWish}>
            <input
              className={styles.input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_WISH_TEXT}
              placeholder="Something you’d love…"
              aria-label="A gift you would like"
              data-testid="wishlist-text"
            />
            <input
              className={styles.input}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Link (optional)"
              aria-label="A link to it (optional)"
              data-testid="wishlist-link"
            />
            <button type="submit" className={styles.addBtn} disabled={busy || !text.trim()} data-testid="wishlist-add">Add to my list</button>
          </form>
          {status && <p role="status" data-testid="wishlist-status" className={`${styles.status} ${status.type === 'error' ? styles.statusError : ''}`}>{status.message}</p>}
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>Under the tree</h2>
          <p className={styles.sectionHint}>Everyone’s list is wrapped. Tap a present to open it.</p>
          <div className={styles.presents}>
            {others.map((p, i) => {
              const wrap = styles[`wrap${(i % 5) + 1}`];
              if (!open.has(p.key)) {
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`${styles.present} ${wrap}`}
                    onClick={() => toggle(p.key)}
                    aria-expanded="false"
                    aria-label={`Open ${p.name}’s wishlist`}
                    data-testid={`present-${p.key}`}
                  >
                    <span className={styles.bow} aria-hidden="true">🎀</span>
                    <span className={styles.tag}>
                      <span className={styles.tagName}>{p.name}</span>
                      <span className={styles.tagHint}>Tap to open</span>
                    </span>
                  </button>
                );
              }
              return (
                <div key={p.key} className={`${styles.opened} ${wrap}`} data-testid={`opened-${p.key}`}>
                  <div className={styles.openedHead}>
                    <h3 className={styles.openedName}>{p.name}’s wishlist</h3>
                    <button type="button" className={styles.linkBtn} onClick={() => toggle(p.key)} aria-expanded="true" data-testid={`rewrap-${p.key}`}>Wrap it back up</button>
                  </div>
                  {p.wishes.length === 0
                    ? <p className={styles.openedEmpty}>Nothing in here yet — {p.name.split(/\s+/)[0]} hasn’t written a list.</p>
                    : <WishItems wishes={p.wishes} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <p className={styles.footer}>Made with Rally · Merry everything 🎁</p>
    </Shell>
  );
}

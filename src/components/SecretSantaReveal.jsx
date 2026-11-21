import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { decodeReveal } from '../lib/secretSantaLink';
import { wishlistPath } from '../lib/wishlist';

// /santa?k=… — where a Secret Santa email's button lands. No sign-in: the
// link carries what to show (lib/secretSantaLink.js). The name starts covered
// and only appears on a tap, so opening this beside someone gives nothing
// away; it can be covered again, and is covered again whenever the page is
// left in the background.
export function SecretSantaReveal() {
  const [searchParams] = useSearchParams();
  const pick = useMemo(() => decodeReveal(searchParams.get('k')), [searchParams]);
  const [shown, setShown] = useState(false);
  const firstName = (pick?.giverName || '').split(/\s+/)[0];

  // Switching apps or tabs covers the name again, so it isn't sitting there
  // the next time the phone is picked up.
  useEffect(() => {
    const cover = () => { if (document.visibilityState === 'hidden') setShown(false); };
    document.addEventListener('visibilitychange', cover);
    return () => document.removeEventListener('visibilitychange', cover);
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem', background: '#FEF2F2', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: '440px', background: '#fff', border: '1px solid #FECACA', borderRadius: '16px', padding: '1.75rem 1.5rem', boxShadow: '0 10px 30px rgba(153,27,27,0.12)', textAlign: 'center' }}>
        <div style={{ fontSize: '2.4rem', lineHeight: 1 }} aria-hidden="true">🎅</div>
        {!pick ? (
          <>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#991B1B', margin: '0.6rem 0 0.4rem' }}>This link didn’t come through whole</h1>
            <p data-testid="reveal-broken" style={{ fontSize: '0.92rem', color: '#4B5563', lineHeight: 1.5, margin: 0 }}>
              Open it again from the button in your email. If it still doesn’t work, ask whoever organized the Secret Santa to send it again.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#991B1B', margin: '0.6rem 0 0.3rem' }}>
              {firstName ? `${firstName}, your` : 'Your'} Secret Santa pick
            </h1>
            <p style={{ fontSize: '0.92rem', color: '#4B5563', lineHeight: 1.5, margin: '0 0 1.1rem' }}>
              {pick.fromName || 'The organizer'} drew names{pick.eventTitle ? <> for <strong>{pick.eventTitle}</strong></> : null}.
            </p>

            <div
              data-testid="reveal-box"
              aria-live="polite"
              style={{ borderRadius: '12px', padding: '1.4rem 1rem', background: shown ? '#F0FDF4' : '#F3F4F6', border: `1px dashed ${shown ? '#86EFAC' : '#D1D5DB'}`, marginBottom: '1rem' }}
            >
              {shown ? (
                <>
                  <div style={{ fontSize: '0.8rem', color: '#166534', marginBottom: '0.3rem' }}>You’re buying a gift for</div>
                  <div data-testid="reveal-name" style={{ fontSize: '1.9rem', fontWeight: 800, color: '#14532D', overflowWrap: 'anywhere' }}>🎁 {pick.receiverName}</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '1.9rem', letterSpacing: '0.2em', color: '#9CA3AF' }} aria-hidden="true">● ● ● ●</div>
                  <div style={{ fontSize: '0.85rem', color: '#6B7280', marginTop: '0.4rem' }}>Hidden. Check nobody’s looking over your shoulder, then tap below.</div>
                </>
              )}
            </div>

            <button
              type="button"
              data-testid="reveal-toggle"
              onClick={() => setShown((v) => !v)}
              style={{
                width: '100%', padding: '0.85rem 1rem', border: shown ? '1px solid #D1D5DB' : 'none', borderRadius: '10px', fontFamily: 'inherit',
                fontSize: '1rem', fontWeight: 700, cursor: 'pointer', background: shown ? '#fff' : '#B91C1C', color: shown ? '#374151' : '#fff',
              }}
            >
              {shown ? 'Hide it again' : 'Reveal who I have'}
            </button>

            {pick.eventId && (
              <a
                data-testid="reveal-wishlists"
                href={wishlistPath(pick.eventId, pick.giverKey)}
                style={{ display: 'block', marginTop: '0.75rem', padding: '0.75rem 1rem', border: '1px solid #BBF7D0', borderRadius: '10px', background: '#F0FDF4', color: '#166534', fontSize: '0.92rem', fontWeight: 700, textDecoration: 'none' }}
              >
                🎄 Wishlists — see theirs, write yours
              </a>
            )}

            {(pick.note || pick.when || pick.location) && (
              <div style={{ marginTop: '1.1rem', paddingTop: '0.9rem', borderTop: '1px solid #F3F4F6', textAlign: 'left', fontSize: '0.88rem', color: '#4B5563', lineHeight: 1.5 }}>
                {pick.note && <p style={{ margin: '0 0 0.5rem', whiteSpace: 'pre-wrap', color: '#1F2937' }}>{pick.note}</p>}
                {pick.when && <div>📅 {pick.when}</div>}
                {pick.location && <div>📍 {pick.location}</div>}
              </div>
            )}
            <p style={{ fontSize: '0.75rem', color: '#9CA3AF', margin: '1.1rem 0 0' }}>Keep it a secret — this link is yours alone.</p>
          </>
        )}
      </div>
    </div>
  );
}

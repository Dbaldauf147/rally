import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePagePrivacy } from '../lib/pagePrivacyContext';
import { isOwnerEmail, pageKey, pageLabel, canBePrivate } from '../lib/pagePrivacy';
import { setPagePrivate } from '../lib/pagePrivacyStore';
import styles from './PagePrivacyToggle.module.css';

/* "Only I can see this page."

   Rendered on every signed-in page, and only ever for the owner — for everyone
   else this component returns nothing at all, so there is no hint that pages
   can be hidden. The state it writes is global, not per-viewer: hiding Plans
   hides it from every other account at once. */
export function PagePrivacyToggle() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const privatePages = usePagePrivacy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOwnerEmail(user?.email)) return null;

  const key = pageKey(pathname);
  // Invite/poll/share links are handed to people who aren't signed in at all;
  // hiding those would break links already sent.
  if (!canBePrivate(key)) return null;
  // Wait for the real answer rather than rendering "visible to all" and then
  // flipping, which reads as the button having been clicked.
  if (privatePages === null) return null;

  const isPrivate = !!privatePages[key];

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await setPagePrivate(key, !isPrivate);
    } catch (err) {
      // Almost always the rules not being deployed yet — worth saying so
      // rather than leaving a button that silently does nothing.
      setError(err?.code === 'permission-denied' ? 'Not allowed — check Firestore rules' : 'Could not save');
      setTimeout(() => setError(''), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={isPrivate ? `${styles.toggle} ${styles.on}` : styles.toggle}
      aria-pressed={isPrivate}
      title={isPrivate
        ? `${pageLabel(key)} is hidden from everyone else. Click to make it visible again.`
        : `Hide ${pageLabel(key)} from everyone but you.`}
    >
      <span aria-hidden="true">{isPrivate ? '🔒' : '👁'}</span>
      <span>{error || (busy ? 'Saving…' : isPrivate ? 'Only you' : 'Visible to all')}</span>
    </button>
  );
}

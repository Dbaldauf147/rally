import { useCallback, useEffect, useState } from 'react';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* An email to one venue: one of the Reply email tab's drafts (the first,
   until another is picked here) filled in for it by the server (api/wedding-venues.js, draftOutreach), edited
   here, then saved to Gmail's Drafts as a new email. Never sent from Rally. */
export function VenueReplyDraft({ venue, gmail, callApi, onReconnect, onClose, onSaved }) {
  const [draft, setDraft] = useState(null); // { to, subject, body, threadId, inReplyTo, references, tailored }
  const [busy, setBusy] = useState('write');
  const [error, setError] = useState(null); // { text, code }
  const [saved, setSaved] = useState(false);

  const write = useCallback(async (templateId) => {
    setBusy('write');
    setError(null);
    setSaved(false);
    try {
      setDraft(await callApi({ action: 'draftOutreach', venueId: venue.id, ...(typeof templateId === 'string' && templateId ? { templateId } : {}) }));
    } catch (err) {
      setError({ text: err.message, code: err.code });
    } finally {
      setBusy('');
    }
  }, [callApi, venue.id]);
  useEffect(() => { write(); }, [write]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setSaved(false); };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const { to, subject, body, threadId, inReplyTo, references } = draft;
      await callApi({ action: 'saveDraft', to, subject, body, threadId, inReplyTo, references });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError({ text: err.message, code: err.code });
    } finally {
      setBusy('');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.body);
      setError({ text: 'Copied the email.', ok: true });
    } catch {
      setError({ text: 'Could not copy — select the text and copy it instead.' });
    }
  };

  const draftsUrl = `https://mail.google.com/mail/u/${encodeURIComponent(gmail?.email || '0')}/#drafts`;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={`Outreach email to ${venue.name}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Email {venue.name}</h2>
          <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          {busy === 'write' ? (
            <p className={styles.muted} role="status">
              Filling in your email…
            </p>
          ) : draft && (
            <>
              <p className={`${styles.muted} ${vs.draftMeta}`}>
                Your email, filled in for {venue.name}. It goes as a new email — read it over and edit anything here before saving.
                {!draft.to && ' There’s no email address for this venue yet: add it under To.'}
              </p>
              <div className={styles.contactGrid}>
                {draft.templates?.length > 1 && (
                  <label className={`${styles.contactField} ${styles.contactWide}`}>
                    <span className={styles.contactLabel}>Which email</span>
                    <select className={styles.contactInput} value={draft.templateId} onChange={(e) => write(e.target.value)} disabled={!!busy} title="Picking another one replaces the text below">
                      {draft.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                )}
                <label className={styles.contactField}>
                  <span className={styles.contactLabel}>To</span>
                  <input className={styles.contactInput} value={draft.to} onChange={(e) => set('to', e.target.value)} autoComplete="off" />
                </label>
                <label className={styles.contactField}>
                  <span className={styles.contactLabel}>Subject</span>
                  <input className={styles.contactInput} value={draft.subject} onChange={(e) => set('subject', e.target.value)} autoComplete="off" />
                </label>
                <label className={`${styles.contactField} ${styles.contactWide}`}>
                  <span className={styles.contactLabel}>Email</span>
                  <textarea className={`${styles.contactInput} ${vs.draftBody}`} value={draft.body} onChange={(e) => set('body', e.target.value)} aria-label="Email body" spellCheck />
                </label>
              </div>
            </>
          )}
          {error && (
            <p className={error.ok ? styles.digestOkMsg : styles.digestErrMsg} role="status">
              {error.text}{' '}
              {(error.code === 'needs_compose' || error.code === 'not_connected') && (
                <button type="button" className={styles.tierLegendEdit} onClick={onReconnect}>
                  {error.code === 'needs_compose' ? 'Reconnect Gmail' : 'Connect Gmail'}
                </button>
              )}
            </p>
          )}
          {saved && (
            <p className={styles.digestOkMsg} role="status">
              Saved to Drafts in {gmail?.email || 'Gmail'}. Nothing has been sent.{' '}
              <a className={styles.link} href={draftsUrl} target="_blank" rel="noreferrer">Open Gmail drafts ↗</a>
            </p>
          )}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.modalSecondary} type="button" onClick={() => write(draft?.templateId)} disabled={!!busy} title="Fill it in again from the template">Start over</button>
          <button className={styles.modalSecondary} type="button" onClick={copy} disabled={!draft || !!busy}>Copy</button>
          <span className={styles.modalCount}>{gmail ? '' : 'Connect Gmail on All venues to save drafts'}</span>
          <button className={styles.modalPrimary} type="button" onClick={save} disabled={!draft || !!busy || !gmail || saved}>
            {busy === 'save' ? 'Saving…' : saved ? 'Saved ✓' : 'Save to Gmail drafts'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';
import { gmailDraftsUrl } from '../lib/weddingVenues';
import { bulkDraftPlan } from '../lib/venueBulk';

// A Gmail connection that can't take drafts stops the whole run: every venue
// after it would fail the same way.
const STOPS_RUN = new Set(['needs_compose', 'not_connected']);

/* The ticked venues' outreach emails, all saved to Gmail's Drafts in one go.

   Each one is what the ✉ button on a row makes — the chosen Outreach email
   filled in for that venue by the server (draftOutreach), then saved as a new
   email (saveDraft) — only without stopping to edit each. The first one is
   shown as a preview. Never sent from Rally: the drafts wait in Gmail. */
export function VenueBulkDrafts({ venues, gmail, callApi, onReconnect, onClose }) {
  const [skipReached, setSkipReached] = useState(true);
  const plan = useMemo(() => bulkDraftPlan(venues, { skipReached }), [venues, skipReached]);
  const ready = plan.filter((r) => r.state === 'ready');
  const reachedCount = venues.filter((v) => v.reachedOut).length;

  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [preview, setPreview] = useState(null); // { venueName, subject, body }
  const [previewError, setPreviewError] = useState('');
  const [status, setStatus] = useState({}); // venue id → 'saving' | 'saved' | error text
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(null); // { text, code } when the run had to stop
  const cancelled = useRef(false);
  // Closing the pop-up stops the run before the next venue. Reset on mount:
  // StrictMode mounts twice in development, and the first unmount would
  // otherwise leave every run cancelled before it began.
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  // The first venue's email, to read before making the rest — and the list
  // of saved emails to choose between, which comes back with it.
  const firstId = ready[0]?.venue.id;
  const firstName = ready[0]?.venue.name;
  useEffect(() => {
    if (!firstId) { setPreview(null); return undefined; }
    let stale = false;
    setPreviewError('');
    callApi({ action: 'draftOutreach', venueId: firstId, ...(templateId ? { templateId } : {}) })
      .then((d) => {
        if (stale) return;
        setTemplates(d.templates || []);
        setPreview({ venueName: firstName, subject: d.subject, body: d.body });
      })
      .catch((err) => { if (!stale) { setPreview(null); setPreviewError(err.message); } });
    return () => { stale = true; };
  }, [callApi, firstId, firstName, templateId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const todo = ready.filter((r) => status[r.venue.id] !== 'saved');
  const savedCount = plan.filter((r) => status[r.venue.id] === 'saved').length;
  const failedCount = plan.filter((r) => status[r.venue.id] && !['saved', 'saving'].includes(status[r.venue.id])).length;

  const run = useCallback(async () => {
    setRunning(true);
    setStopped(null);
    for (const { venue } of todo) {
      if (cancelled.current) break;
      setStatus((s) => ({ ...s, [venue.id]: 'saving' }));
      try {
        const d = await callApi({ action: 'draftOutreach', venueId: venue.id, ...(templateId ? { templateId } : {}) });
        await callApi({ action: 'saveDraft', to: d.to, subject: d.subject, body: d.body });
        setStatus((s) => ({ ...s, [venue.id]: 'saved' }));
      } catch (err) {
        if (STOPS_RUN.has(err.code)) {
          setStatus((s) => { const n = { ...s }; delete n[venue.id]; return n; });
          setStopped({ text: err.message, code: err.code });
          break;
        }
        setStatus((s) => ({ ...s, [venue.id]: err.message || 'Could not save' }));
      }
    }
    if (!cancelled.current) setRunning(false);
  }, [callApi, templateId, todo]);

  const rowNote = (r) => {
    const st = status[r.venue.id];
    if (st === 'saved') return <span className={vs.bulkDraftOk}>✓ Saved to Drafts</span>;
    if (st === 'saving') return <span className={styles.muted}>Saving…</span>;
    if (st) return <span className={vs.bulkDraftErr}>{st}</span>;
    if (r.state === 'noEmail') return <span className={vs.bulkDraftSkip}>Skipped — no email address</span>;
    if (r.state === 'reached') return <span className={vs.bulkDraftSkip}>Skipped — already reached out</span>;
    return <span className={styles.muted}>{r.venue.email}</span>;
  };

  const done = !running && savedCount > 0;
  const n = todo.length;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Email drafts for the selected venues" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Email drafts for {venues.length} venue{venues.length === 1 ? '' : 's'}</h2>
          <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          <p className={`${styles.muted} ${vs.draftMeta}`}>
            Your outreach email, filled in for each venue and saved to Gmail’s Drafts as a new email. Nothing is sent — read them over and send from Gmail.
          </p>
          <div className={vs.bulkDraftOpts}>
            {templates.length > 1 && (
              <label className={styles.contactField}>
                <span className={styles.contactLabel}>Which email</span>
                <select className={styles.contactInput} value={templateId || templates[0].id} onChange={(e) => setTemplateId(e.target.value)} disabled={running || savedCount > 0} title={savedCount > 0 ? 'Some drafts are already saved with this one' : undefined}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            {reachedCount > 0 && (
              <label className={vs.bulkDraftCheck}>
                <input type="checkbox" checked={skipReached} onChange={(e) => setSkipReached(e.target.checked)} disabled={running} />
                Skip the {reachedCount} we’ve already reached out to
              </label>
            )}
          </div>

          <ul className={vs.bulkDraftList} aria-label="Venues">
            {plan.map((r) => (
              <li key={r.venue.id} className={vs.bulkDraftRow}>
                <span className={vs.bulkDraftName}>{r.venue.name}</span>
                {rowNote(r)}
              </li>
            ))}
          </ul>

          {preview && (
            <details className={vs.bulkDraftPreview}>
              <summary>Preview — the one for {preview.venueName}</summary>
              <p className={vs.bulkDraftSubject}><strong>Subject:</strong> {preview.subject}</p>
              <pre className={vs.bulkDraftBody}>{preview.body}</pre>
            </details>
          )}
          {previewError && <p className={styles.digestErrMsg} role="status">Could not fill in the email: {previewError}</p>}

          {stopped && (
            <p className={styles.digestErrMsg} role="status">
              {stopped.text}{' '}
              <button type="button" className={styles.tierLegendEdit} onClick={onReconnect}>
                {stopped.code === 'needs_compose' ? 'Reconnect Gmail' : 'Connect Gmail'}
              </button>
            </p>
          )}
          {done && (
            <p className={styles.digestOkMsg} role="status">
              Saved {savedCount} draft{savedCount === 1 ? '' : 's'} to Drafts in {gmail?.email || 'Gmail'}. Nothing has been sent.{' '}
              <a className={styles.link} href={gmailDraftsUrl(gmail?.email)} target="_blank" rel="noreferrer">Open Gmail drafts ↗</a>
            </p>
          )}
        </div>
        <div className={styles.modalFooter}>
          <span className={styles.modalCount}>
            {!gmail ? 'Connect Gmail on All venues to save drafts'
              : running ? `Saving… ${savedCount} of ${savedCount + n}`
                : failedCount ? `${failedCount} could not be saved` : ''}
          </span>
          <button className={styles.modalSecondary} type="button" onClick={onClose}>{done && !n ? 'Done' : 'Close'}</button>
          <button className={styles.modalPrimary} type="button" onClick={run} disabled={running || !gmail || n === 0}>
            {running ? 'Saving…'
              : n === 0 ? (savedCount ? 'All saved ✓' : 'Nothing to draft')
                : failedCount || stopped ? `Try the remaining ${n}`
                  : `Create ${n} draft${n === 1 ? '' : 's'} in Gmail`}
          </button>
        </div>
      </div>
    </div>
  );
}

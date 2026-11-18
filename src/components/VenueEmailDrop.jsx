import { useCallback, useEffect, useState } from 'react';
import { matchVenue, planEmailVenue } from '../lib/weddingVenues';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

const NEW = '__new';

/* An email dragged (or pasted) onto the Venues page: read for the venue it's
   about — contact, status, pricing — then shown as the changes it would make,
   so nothing is saved until "Update" is pressed.

   `drop` is what the drag carried ({ text, url, subject, skipped }, see
   lib/emailDrop.js), or null to start with a box to paste into. The server
   reads it (api/wedding-venues.js, action readEmail) with the same reader as
   an inbox scan. Each venue found starts matched to the saved one it's about,
   if any; the dropdown moves it to another or adds it as new. */
export function VenueEmailDrop({ venues, callApi, drop, gmailConnected, onApply, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState(null); // [{ id, raw, targetId, include }]
  const [aiError, setAiError] = useState(''); // why the AI reader wasn't used, when it wasn't

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const read = useCallback(async (payload) => {
    if (!payload.text?.trim() && !payload.url && !payload.subject) {
      setError(payload.skipped?.length
        ? `Rally can’t read ${payload.skipped.join(', ')}. Drop the email’s text, or a saved .eml file (in Gmail: ⋮ → Download message).`
        : 'There was no email in that. Open the email in Gmail, select its text and drag that in — or copy and paste it below.');
      return;
    }
    setBusy(true);
    setError('');
    setRows(null);
    setAiError('');
    try {
      const res = await callApi({ action: 'readEmail', text: payload.text || '', url: payload.url || '', subject: payload.subject || '' });
      const found = (res.venues || []).filter((v) => String(v?.name || '').trim());
      if (!found.length) {
        setError('Rally didn’t find a wedding venue in that email. If it is one, paste the whole email below and try again.');
        if (payload.text) setText(payload.text);
      } else {
        setAiError(res.ai?.error || '');
        setRows(found.map((raw, i) => ({ id: i, raw, targetId: matchVenue(venues, raw)?.id || NEW, include: true })));
      }
    } catch (err) {
      setError(err.message || 'Could not read that email');
      if (payload.text) setText(payload.text);
    } finally {
      setBusy(false);
    }
  }, [callApi, venues]);

  // Opened by a drop: read it straight away.
  useEffect(() => {
    if (!drop) return undefined;
    const t = setTimeout(() => read(drop), 0);
    return () => clearTimeout(t);
  }, [drop, read]);

  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const target = (r) => (r.targetId === NEW ? null : venues.find((v) => v.id === r.targetId) || null);
  const plans = (rows || []).map((r) => ({ r, ...planEmailVenue(r.raw, target(r)) }));
  const chosen = plans.filter((p) => p.r.include && (p.changes.length || !target(p.r)));
  const apply = () => {
    if (!chosen.length) return;
    onApply(chosen.map((p) => ({ raw: p.r.raw, targetId: p.r.targetId === NEW ? '' : p.r.targetId })));
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <form
        className={`${styles.modal} ${vs.mapsModal}`}
        role="dialog"
        aria-modal="true"
        aria-label="Update venues from an email"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (rows) apply(); else read({ text }); }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Update from an email</h2>
          <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          {busy && <p className={styles.muted} role="status">Reading the email…</p>}
          {!busy && !rows && (
            <>
              <p className={styles.modalHint}>
                Open the email in Gmail, select its text (from the sender’s name down) and drag it onto the Venues page — or copy it and paste it here.
                A saved email file (in Gmail: ⋮ → <strong>Download message</strong>) can be dropped too.
                {!gmailConnected && ' With Gmail connected, a dragged link to the email works as well.'}
              </p>
              <textarea
                className={styles.modalTextarea}
                rows={8}
                value={text}
                autoFocus
                placeholder="Paste the email here…"
                aria-label="Email text"
                onChange={(e) => { setText(e.target.value); setError(''); }}
              />
            </>
          )}
          {error && <p className={styles.digestErrMsg} role="alert">{error}</p>}
          {rows && !busy && aiError && (
            <p className={vs.mapsWarn} role="status">
              AI reading isn’t available right now ({aiError}), so this is only what the email says outright — the sender, signature, address and any dollar amounts.
              Prices written out in words or kept in attachments aren’t picked up; check it over, or try again once the AI is back.
            </p>
          )}
          {rows && !busy && (
            <ul className={vs.mapsRows} aria-label="Venues in the email">
              {plans.map(({ r, changes }) => {
                const t = target(r);
                return (
                  <li key={r.id} className={vs.mapsRow}>
                    <input type="checkbox" className={vs.pick} checked={r.include} onChange={(e) => setRow(r.id, { include: e.target.checked })} aria-label={`Update ${r.raw.name}`} />
                    <div className={vs.mapsFields}>
                      <span className={vs.mapsMeta}>
                        <strong>{r.raw.name}</strong>
                        <span className={t ? vs.mapsTagUpdate : vs.mapsTagNew}>{t ? 'Updates' : 'New'}</span>
                        <select className={styles.filterSelect} value={r.targetId} onChange={(e) => setRow(r.id, { targetId: e.target.value })} aria-label={`Which venue ${r.raw.name} is`}>
                          <option value={NEW}>Add as a new venue</option>
                          {[...venues].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </span>
                      {r.raw.summary && <span className={vs.mapsNote}>{r.raw.summary}</span>}
                      {changes.length ? (
                        <table className={vs.emailChanges}>
                          <tbody>
                            {changes.map((c) => (
                              <tr key={c.key}>
                                <th scope="row">{c.label}</th>
                                <td>
                                  {c.from && <><s className={vs.emailFrom}>{c.from}</s>{' → '}</>}
                                  <span>{c.to || <em className={styles.muted}>cleared</em>}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <span className={vs.mapsNote}>Nothing new — {t ? `${t.name} already has all of this, or you’ve typed your own values over it` : 'nothing to save'}.</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={styles.modalFooter}>
          {rows ? (
            <>
              <span className={styles.modalCount}>Typed values are kept; the status only moves forward.</span>
              <button className={styles.modalSecondary} type="button" onClick={() => { setRows(null); setError(''); }}>Back</button>
              <button className={styles.modalPrimary} type="submit" disabled={!chosen.length}>
                {chosen.length > 1 ? `Update ${chosen.length} venues` : chosen.length && !target(chosen[0].r) ? 'Add venue' : 'Update venue'}
              </button>
            </>
          ) : (
            <>
              <button className={styles.modalSecondary} type="button" onClick={onClose}>Cancel</button>
              <button className={styles.modalPrimary} type="submit" disabled={busy || !text.trim()}>{busy ? 'Reading…' : 'Read email'}</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

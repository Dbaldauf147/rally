import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { API_BASE } from '../native';
import { ptoSummaryConfig, MAX_RECIPIENTS } from '../../lib/ptoSummary.js';
import styles from './WeddingPage.module.css';

/* The annual PTO email's settings, on the PTO page: on or off, and where it
   goes. The cron in api/pto-summary.js sends it every November 1st at 8 AM
   Eastern; Preview and Send now go through the same route.

   Uses the Wedding digest's panel styles so the two settings read the same.
   Saved on users/<uid>.ptoSummary, merged field by field so turning it off
   never touches lastSentYear. */
export function PTOSummaryEmail({ user }) {
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : {};
        const c = ptoSummaryConfig({ ...data, email: data.email || user.email });
        const lastResult = data.ptoSummary?.lastResult || null;
        setCfg({ ...c, emails: c.emails.length ? c.emails : [''], lastResult });
      })
      .catch(() => { if (!cancelled) setCfg({ ...ptoSummaryConfig({ email: user.email }), lastResult: null }); });
    return () => { cancelled = true; };
  }, [user?.uid, user?.email]);

  if (!cfg) return null;

  const save = async (patch) => {
    setCfg((c) => ({ ...c, ...patch }));
    setMsg(null);
    try {
      await setDoc(doc(db, 'users', user.uid), { ptoSummary: patch }, { merge: true });
    } catch (err) {
      setMsg({ type: 'error', text: `Couldn’t save: ${err.message}` });
    }
  };
  // Saving the list also pins `enabled`, so the owner's default-on becomes an
  // explicit setting the first time anything is changed.
  const saveEmails = (emails) => save({ emails: emails.map((e) => e.trim()).filter(Boolean), enabled: cfg.enabled });
  const setEmail = (i, value) => setCfg((c) => ({ ...c, emails: c.emails.map((e, j) => (j === i ? value : e)) }));

  const call = async (body) => {
    const res = await fetch(`${API_BASE}/api/pto-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: user.uid, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  const showPreview = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const { res, data } = await call({ preview: true });
      if (!res.ok) setMsg({ type: 'error', text: data.error || `Preview failed (${res.status})` });
      else if (data.skipped || data.reason) setMsg({ type: 'error', text: `Nothing to preview — ${data.skipped || data.reason}.` });
      else setPreview(data);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    if (busy) return;
    const to = cfg.emails.map((e) => e.trim()).filter(Boolean);
    if (!to.length) { setMsg({ type: 'error', text: 'Add an address first.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      // Save first, so a just-typed address is the one it goes to.
      await saveEmails(cfg.emails);
      const { res, data } = await call({});
      if (!res.ok) setMsg({ type: 'error', text: data.error || `Send failed (${res.status})` });
      else if (data.skipped || data.reason) setMsg({ type: 'error', text: `Nothing sent — ${data.skipped || data.reason}.` });
      else setMsg({ type: 'ok', text: `Sent to ${(data.sentTo || to).join(', ')}.` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const failed = cfg.lastResult?.failed || [];

  return (
    <div className={styles.digest}>
      <button type="button" className={styles.digestToggle} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>📧 Annual PTO summary email</span>
        <span className={cfg.enabled ? styles.digestOn : styles.digestOff}>
          {cfg.enabled ? `On · Nov 1 → ${cfg.emails.filter(Boolean).join(', ') || 'no address'}` : 'Off'}
        </span>
        <span className={styles.digestChevron} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.digestBody}>
          <p className={styles.digestHint}>
            Every November 1st at 8 AM Eastern: the current year&apos;s days left, what&apos;s scheduled, and every day taken so far.
          </p>
          <label className={styles.digestCheck}>
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ enabled: e.target.checked, emails: cfg.emails.map((x) => x.trim()).filter(Boolean) })} />
            <span>Email me a PTO summary every November 1st</span>
          </label>

          <div className={styles.digestFields}>
            <div className={styles.digestField}>
              <span>Send to</span>
              <div className={styles.digestEmails}>
                {cfg.emails.map((addr, i) => (
                  <div key={i} className={styles.digestEmailRow}>
                    <input
                      type="email"
                      value={addr}
                      placeholder="you@example.com"
                      aria-label={`Address ${i + 1} for the PTO summary`}
                      onChange={(e) => setEmail(i, e.target.value)}
                      onBlur={() => saveEmails(cfg.emails)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                    {cfg.emails.length > 1 && (
                      <button
                        type="button"
                        className={styles.digestEmailDrop}
                        aria-label={`Stop sending to ${addr || 'this address'}`}
                        onClick={() => { const next = cfg.emails.filter((_, j) => j !== i); setCfg((c) => ({ ...c, emails: next })); saveEmails(next); }}
                      >×</button>
                    )}
                  </div>
                ))}
                {cfg.emails.length < MAX_RECIPIENTS && (
                  <button type="button" className={styles.digestAddEmail} onClick={() => setCfg((c) => ({ ...c, emails: [...c.emails, ''] }))}>
                    + Add another address
                  </button>
                )}
              </div>
            </div>
          </div>

          {failed.length > 0 && (
            <div className={styles.digestFailed}>
              The last one didn&apos;t reach:
              <ul>{failed.map((f) => <li key={f.email}>{f.email}: {f.error}</li>)}</ul>
            </div>
          )}

          <div className={styles.digestActions}>
            <button type="button" className={styles.digestTest} onClick={showPreview} disabled={busy}>Preview</button>
            <button type="button" className={styles.digestTest} onClick={sendNow} disabled={busy}>Send now</button>
            {msg && <span className={msg.type === 'ok' ? styles.digestOkMsg : styles.digestErrMsg} role="status">{msg.text}</span>}
          </div>
          {cfg.lastSentYear && <p className={styles.digestNote}>Last sent for {cfg.lastSentYear}.</p>}

          {preview && (
            <div style={{ marginTop: '0.8rem' }}>
              <div className={styles.digestNote} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span><strong>Subject:</strong> {preview.subject}</span>
                <button type="button" className={styles.digestAddEmail} onClick={() => setPreview(null)}>Close preview</button>
              </div>
              <iframe
                title="PTO summary preview"
                srcDoc={preview.html}
                sandbox=""
                style={{ width: '100%', height: '560px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginTop: '0.4rem', background: '#fff' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

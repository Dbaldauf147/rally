import { useCallback, useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { callPeopleBackupApi, saveTextFile } from '../lib/peopleBackupApi';
import { listTrash, restoreTrash } from '../lib/friendTrash';
import styles from './WeddingPage.module.css';

/* The daily backup files of everything about people (api/people-backup.js):
   every contact here, both wedding guest lists, Reach Out and the gift list.

   A file is written each day something changed and kept on the server where
   no page can overwrite it; the same file is emailed, so there is a copy that
   doesn't depend on Rally at all. From here a file can be downloaded, and the
   contacts in it that have since gone missing can be put back — which only
   ever adds: nobody still here is changed or removed. */

const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function PeopleBackups({ user, onClose }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  // The trash: contacts deleted or merged away in the last thirty days.
  const [trash, setTrash] = useState(null);
  const loadTrash = useCallback(async () => {
    try { setTrash(await listTrash()); } catch { setTrash([]); }
  }, []);
  useEffect(() => { loadTrash(); }, [loadTrash]);

  const load = useCallback(async () => {
    try {
      setState(await callPeopleBackupApi(user, { action: 'list' }));
    } catch (err) {
      setError(`Couldn’t load the backups: ${err.message}`);
      setState({ files: [] });
    }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (key, fn) => {
    setBusy(key);
    setError('');
    setNote('');
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const backUpNow = () => run('now', async () => {
    const { saved } = await callPeopleBackupApi(user, { action: 'run' });
    setNote(saved ? 'Backed up just now.' : 'Nothing has changed since the last backup, so it still covers everything.');
    await load();
  });

  const download = (f) => run(`dl-${f.id}`, async () => {
    const { filename, json } = await callPeopleBackupApi(user, { action: 'download', id: f.id });
    saveTextFile(filename, json);
  });

  const restoreMissing = (f) => {
    if (!confirm(`Put back any contacts from ${fmtWhen(f.at)} that aren’t in Friends now?\n\nThis only adds people back. Nobody who is here now is changed or removed.`)) return;
    run(`rs-${f.id}`, async () => {
      const { restored, names = [] } = await callPeopleBackupApi(user, { action: 'restoreMissing', id: f.id });
      setNote(restored
        ? `Put back ${plural(restored, 'contact')}: ${names.join(', ')}${restored > names.length ? '…' : ''}.`
        : 'Everyone in that backup is already in Friends — nothing to put back.');
    });
  };

  const putBack = (items) => run(`tr-${items.length === 1 ? items[0].itemId : 'all'}`, async () => {
    const { restored, skipped } = await restoreTrash(items.map((i) => i.itemId));
    setNote(`${restored.length ? `Put back ${restored.length === 1 ? restored[0] : plural(restored.length, 'contact')}.` : ''}${skipped.length ? ` ${skipped.join(', ')} couldn’t be put back: a contact with the same email exists now.` : ''}`.trim());
    await loadTrash();
  });

  const setEmail = (on) => run('email', async () => {
    await setDoc(doc(db, 'users', user.uid), { peopleBackup: { email: on } }, { merge: true });
    setState((s) => ({ ...s, email: on }));
  });

  const files = state?.files || [];

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`${styles.modal} ${styles.backupModal}`} role="dialog" aria-label="People backups" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Backups &amp; trash</h2>
          <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.modalHint}>
            One file a day of everything about people: every contact, both wedding guest lists, Reach Out and
            the gift list. Written only on days something changed. Older files thin out to one a day, then one a month.
          </p>
          {state && (
            <label className={styles.modalCheckRow}>
              <input type="checkbox" checked={!!state.email} disabled={busy === 'email'} onChange={(e) => setEmail(e.target.checked)} />
              <span>
                Email me the file each day it changes{state.emailTo ? ` (${state.emailTo})` : ''}
                {state.email && !state.mail ? ' — email isn’t set up on the server, so nothing is being sent' : ''}
              </span>
            </label>
          )}
          {state?.lastRunAt > 0 && (
            <p className={styles.modalHint}>The daily check last ran {fmtWhen(state.lastRunAt)}.</p>
          )}
          {error && <p className={styles.saveError} role="alert">{error}</p>}
          {note && <p className={styles.categoryTabHint} role="status">{note}</p>}
          {trash && trash.length > 0 && (
            <>
              <h3 className={styles.backupHeading}>
                Recently deleted
                {trash.length > 1 && (
                  <button type="button" className={styles.tierLegendEdit} disabled={!!busy} onClick={() => putBack(trash)}>Put all {trash.length} back</button>
                )}
              </h3>
              <ul className={styles.backupList}>
                {trash.map((t) => (
                  <li key={t.itemId} className={styles.backupRow}>
                    <div>
                      <div className={styles.backupWhen}>{t.name || 'Unnamed contact'}</div>
                      <div className={styles.backupMeta}>
                        {t.reason === 'deleted' ? 'Deleted' : t.reason.replace(/^m/, 'M')} {fmtWhen(t.deletedAt)} · {plural(t.daysLeft, 'day')} left
                      </div>
                    </div>
                    <button type="button" className={styles.toolButton} disabled={!!busy} onClick={() => putBack([t])}>
                      {busy === `tr-${t.itemId}` ? 'Putting back…' : 'Put back'}
                    </button>
                  </li>
                ))}
              </ul>
              <h3 className={styles.backupHeading}>Daily files</h3>
            </>
          )}
          {state === null && <p className={styles.modalHint}>Loading…</p>}
          {state !== null && !files.length && !error && (
            <p className={styles.modalHint}>No backups yet. The first is written overnight, or now if you ask.</p>
          )}
          {files.length > 0 && (
            <ul className={styles.backupList}>
              {files.map((f) => (
                <li key={f.id} className={styles.backupRow}>
                  <div>
                    <div className={styles.backupWhen}>{fmtWhen(f.at)}</div>
                    <div className={styles.backupMeta}>
                      {plural(f.counts.friends || 0, 'contact')} · {plural(f.counts.guests || 0, 'guest')} · {fmtSize(f.bytes)}
                      {f.emailed ? ' · emailed' : ''}{f.reason === 'manual' ? ' · by hand' : ''}
                    </div>
                  </div>
                  <div className={styles.backupActions}>
                    <button type="button" className={styles.toolButton} disabled={!!busy} onClick={() => download(f)}>
                      {busy === `dl-${f.id}` ? 'Downloading…' : 'Download'}
                    </button>
                    <button type="button" className={styles.toolButton} disabled={!!busy} onClick={() => restoreMissing(f)} title="Add back contacts in this file that aren’t in Friends now">
                      {busy === `rs-${f.id}` ? 'Restoring…' : 'Restore missing'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className={styles.toolButton} disabled={!!busy} onClick={backUpNow}>
            {busy === 'now' ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>
    </div>
  );
}

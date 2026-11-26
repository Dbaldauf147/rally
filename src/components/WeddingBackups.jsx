import { useCallback, useEffect, useState } from 'react';
import { callBackupApi } from '../lib/weddingBackupApi';
import styles from './WeddingPage.module.css';

/* Restore points for the guest list (api/wedding-backup.js).

   The copies are kept on the server where no page can overwrite them: one
   from before each sitting (taken when the guest list opens, hourly at most)
   and one a day. Restoring puts a copy's guests back in place of the list as
   it stands — and copies that list first, so a restore can itself be undone
   from here. */

const REASONS = {
  open: 'When the guest list was opened',
  daily: 'Daily copy',
  'before-restore': 'Before a restore',
};

const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function WeddingBackups({ user, listName, currentCount, onClose }) {
  // 'main' | 'v2' — which list this dialog restores.
  const countKey = listName === 'v2' ? 'v2Count' : 'mainCount';
  const [backups, setBackups] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      setBackups((await callBackupApi(user, { action: 'list' })).backups || []);
    } catch (err) {
      setError(`Couldn’t load the restore points: ${err.message}`);
      setBackups([]);
    }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const restore = async (b) => {
    const n = b[countKey];
    if (!confirm(`Put back the ${n} guest${n === 1 ? '' : 's'} from ${fmtWhen(b.at)}?\n\nThis replaces the ${currentCount} on the list now. The list as it is now is saved as a restore point first, so you can undo this.`)) return;
    setBusy(b.id);
    setError('');
    setDone('');
    try {
      const { restored } = await callBackupApi(user, { action: 'restore', id: b.id, list: listName });
      setDone(`Restored ${restored} guest${restored === 1 ? '' : 's'} from ${fmtWhen(b.at)}.`);
      await load();
    } catch (err) {
      setError(`Couldn’t restore: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const usable = (backups || []).filter((b) => b[countKey] > 0);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`${styles.modal} ${styles.backupModal}`} role="dialog" aria-label="Guest list restore points" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Restore points{listName === 'v2' ? ' · Second version' : ''}</h2>
          <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.modalHint}>
            Copies of the guest list, kept apart from it: one from before each time you open this page
            (hourly at most) and one a day. Older ones thin out to one a day, then one a month.
          </p>
          {error && <p className={styles.saveError} role="alert">{error}</p>}
          {done && <p className={styles.categoryTabHint} role="status">{done}</p>}
          {backups === null && <p className={styles.modalHint}>Loading…</p>}
          {backups !== null && !usable.length && !error && (
            <p className={styles.modalHint}>No restore points yet. The first one is taken when the guest list opens.</p>
          )}
          {usable.length > 0 && (
            <ul className={styles.backupList}>
              {usable.map((b) => (
                <li key={b.id} className={styles.backupRow}>
                  <div>
                    <div className={styles.backupWhen}>{fmtWhen(b.at)}</div>
                    <div className={styles.backupMeta}>
                      {b[countKey]} guest{b[countKey] === 1 ? '' : 's'} · {REASONS[b.reason] || 'Copy'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.toolButton}
                    disabled={!!busy}
                    onClick={() => restore(b)}
                  >{busy === b.id ? 'Restoring…' : 'Restore'}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

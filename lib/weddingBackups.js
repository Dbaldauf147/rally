// Restore points for the wedding guest list — the rules, kept apart from the
// endpoint (api/wedding-backup.js) so they can be tested without Firestore.
import { createHash } from 'node:crypto';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

const list = (v) => (Array.isArray(v) ? v : []);

// Two copies with the same fingerprint hold the same guests, so the second
// one isn't worth keeping.
export function fingerprint(main, v2) {
  return createHash('sha1').update(JSON.stringify([list(main), list(v2)])).digest('hex');
}

/* Whether to take a restore point now.

   reason 'open'  — the guest list was opened in a browser. At most one an
                    hour, so a restore point from before each sitting without
                    one per page load.
   reason 'daily' — the cron.
   Anything else ('before-restore') is always taken when the list changed.

   Never when there is nothing to save, and never a second copy of what the
   newest restore point already holds. */
export function shouldSnapshot({ main, v2, reason, latest, now = Date.now() }) {
  if (!list(main).length && !list(v2).length) return false;
  if (!latest) return true;
  if (latest.fingerprint === fingerprint(main, v2)) return false;
  if (reason === 'open' && now - latest.at < HOUR) return false;
  return true;
}

/* Which restore points to delete: everything from the last two days is kept,
   then the last one of each day for sixty days, then the last one of each
   month for good. Returns ids. */
export function planPrune(backups, now = Date.now()) {
  const sorted = [...backups].sort((a, b) => b.at - a.at);
  const seen = new Set();
  const drop = [];
  for (const b of sorted) {
    const age = now - b.at;
    if (age <= 2 * DAY) continue;
    const iso = new Date(b.at).toISOString();
    const bucket = age <= 60 * DAY ? iso.slice(0, 10) : iso.slice(0, 7);
    if (seen.has(bucket)) drop.push(b.id);
    else seen.add(bucket);
  }
  return drop;
}

export const backupSummary = (id, d = {}) => ({
  id,
  at: d.at || 0,
  reason: d.reason || '',
  mainCount: d.mainCount ?? list(d.main).length,
  v2Count: d.v2Count ?? list(d.v2).length,
});

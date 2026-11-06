import React, { useMemo, useState } from 'react';
import styles from './FriendsPage.module.css';
import {
  friendChoicesFromGuest,
  guestKeepFirst,
  guestMergeConflicts,
  guestMergeFriends,
  mergeGuests,
} from '../lib/weddingGuestMerge';
import { mergeFriends } from '../lib/friendMerge';

const REASON_TEXT = { email: 'same email', phone: 'same phone', name: 'same name', friend: 'same Friends contact' };
const nameOf = (g) => `${g.firstName || ''} ${g.lastName || ''}`.trim() || '(no name)';
const guestLine = (g) => [g.email, g.phone, g.category, g.group].filter(Boolean).join(' · ');

/* The suggested duplicates on the guest list, one row per group. */
export function GuestDuplicatesModal({ groups, onReview, onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <h2 className={styles.modalTitle}>Possible duplicate guests</h2>
        {groups.length === 0 ? (
          <p className={styles.mergeMuted}>No duplicates found — no two guests share an email, a phone number, a name or a Friends contact.</p>
        ) : (
          <>
            <p className={styles.mergeMuted}>
              {groups.length} {groups.length === 1 ? 'group' : 'groups'} of guests that share an email, phone number, name or Friends contact. Review each before merging.
            </p>
            <div className={styles.dupList}>
              {groups.map((grp) => (
                <div key={grp.guests.map((g) => g.id).join('|')} className={styles.dupGroup}>
                  <div className={styles.dupPeople}>
                    {grp.guests.map((g) => (
                      <div key={g.id}>
                        <span className={styles.dupName}>{nameOf(g)}</span>
                        {guestLine(g) && <span className={styles.mergeMuted}> · {guestLine(g)}</span>}
                      </div>
                    ))}
                    <div className={styles.dupWhy}>{grp.reasons.map((r) => REASON_TEXT[r] || r).join(', ')}</div>
                  </div>
                  <button type="button" className={styles.saveBtn} onClick={() => onReview(grp.guests)}>Review merge</button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className={styles.formActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* Merging two or more guests: pick the one to keep, settle where they
 * disagree, and — when they're linked to different Friends contacts — settle
 * what's left on those too, since they're merged on the Friends page as well.
 * onConfirm({ guest, removedGuestIds, friendMerge }) does the writes;
 * friendMerge is { primary, others, choices } or null. */
export function GuestMergeModal({ guests, friendsById, onCancel, onConfirm }) {
  const [primaryId, setPrimaryId] = useState(() => [...guests].sort(guestKeepFirst)[0].id);
  const [choices, setChoices] = useState({});
  const [friendPicks, setFriendPicks] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const primary = guests.find((g) => g.id === primaryId);
  const others = guests.filter((g) => g.id !== primaryId);

  const conflicts = useMemo(() => guestMergeConflicts([primary, ...others]), [primary, others]);
  const friendSide = useMemo(() => guestMergeFriends([primary, ...others], friendsById), [primary, others, friendsById]);
  const keptFriendId = friendSide.primary?.id || '';
  const merged = useMemo(() => mergeGuests(primary, others, choices, keptFriendId), [primary, others, choices, keptFriendId]);

  const friendMerge = useMemo(() => {
    if (friendSide.others.length === 0) return null;
    const all = [friendSide.primary, ...friendSide.others];
    const auto = friendChoicesFromGuest(all, merged);
    return { all, auto, conflicts: auto.conflicts, choices: { ...auto.choices, ...friendPicks } };
  }, [friendSide, merged, friendPicks]);
  const mergedFriend = useMemo(
    () => (friendMerge ? mergeFriends(friendSide.primary, friendSide.others, friendMerge.choices) : null),
    [friendMerge, friendSide],
  );

  const chosenFrom = (c) => choices[c.key] ?? c.values.find((v) => v.from === primary.id)?.from ?? c.values[0].from;
  const friendChosen = (c) => friendMerge.choices[c.key] ?? mergedFriend?.[c.key];
  const showFriendValue = (key, v) => (key === 'linkedTo' ? friendsById.get(v)?.name || v : v);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm({
        guest: merged,
        removedGuestIds: others.map((g) => g.id),
        friendMerge: friendMerge ? { primary: friendSide.primary, others: friendSide.others, choices: friendMerge.choices } : null,
      });
    } catch (err) {
      console.error('Guest merge failed:', err);
      setError(`Merge failed: ${err.message}`);
      setBusy(false);
    }
  }

  const friendNote = friendSide.friends.length === 0
    ? 'None of them is on the Friends page.'
    : friendSide.others.length === 0
      ? `They stay linked to ${friendSide.primary.name || 'their Friends contact'} on the Friends page.`
      : `Their ${friendSide.friends.length} Friends contacts are merged into ${friendSide.primary.name || 'one'} on the Friends page too.`;

  return (
    <div className={styles.overlay} onClick={busy ? undefined : onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }} role="dialog" aria-label="Merge guests">
        <h2 className={styles.modalTitle}>Merge {guests.length} guests</h2>

        <div className={styles.mergeSection}>
          <div className={styles.mergeHeading}>Keep</div>
          {guests.map((g) => (
            <label key={g.id} className={styles.mergeOption}>
              <input
                type="radio"
                name="guest-merge-primary"
                checked={g.id === primaryId}
                onChange={() => { setPrimaryId(g.id); setChoices({}); setFriendPicks({}); }}
              />
              <span>
                <span className={styles.dupName}>{nameOf(g)}</span>
                {guestLine(g) && <span className={styles.mergeMuted}> · {guestLine(g)}</span>}
              </span>
            </label>
          ))}
          <p className={styles.mergeHint}>The others are folded into this one and removed from the guest list. {friendNote}</p>
        </div>

        {conflicts.length > 0 && (
          <div className={styles.mergeSection}>
            <div className={styles.mergeHeading}>Where they differ</div>
            {conflicts.map((c) => (
              <div key={c.key} className={styles.mergeConflict}>
                <div className={styles.mergeField}>{c.label}</div>
                {c.values.map((v) => (
                  <label key={v.from} className={styles.mergeOption}>
                    <input
                      type="radio"
                      name={`guest-merge-${c.key}`}
                      checked={chosenFrom(c) === v.from}
                      onChange={() => { setChoices((prev) => ({ ...prev, [c.key]: v.from })); setFriendPicks({}); }}
                    />
                    <span>{v.value}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        {friendMerge && friendMerge.conflicts.length > 0 && (
          <div className={styles.mergeSection}>
            <div className={styles.mergeHeading}>On the Friends page</div>
            {friendMerge.conflicts.map((c) => (
              <div key={c.key} className={styles.mergeConflict}>
                <div className={styles.mergeField}>{c.label}</div>
                {c.values.map((v) => (
                  <label key={v.value} className={styles.mergeOption}>
                    <input
                      type="radio"
                      name={`guest-merge-friend-${c.key}`}
                      checked={String(friendChosen(c) ?? '').toLowerCase() === v.value.toLowerCase()}
                      onChange={() => setFriendPicks((prev) => ({ ...prev, [c.key]: v.value }))}
                    />
                    <span>{showFriendValue(c.key, v.value)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className={styles.mergeSection}>
          <div className={styles.mergeHeading}>Result</div>
          <div className={styles.mergeResult}>
            <strong>{nameOf(merged)}</strong>
            {guestLine(merged) && <span className={styles.mergeMuted}> · {guestLine(merged)}</span>}
            {mergedFriend && (
              <div className={styles.mergeMuted}>Friends contact: {mergedFriend.name || '(no name)'}{mergedFriend.email ? ` · ${mergedFriend.email}` : ''}</div>
            )}
          </div>
        </div>

        {error && <p className={styles.mergeMuted} role="alert" style={{ color: 'var(--color-danger, #b91c1c)' }}>{error}</p>}

        <div className={styles.formActions}>
          <button type="button" className={styles.saveBtn} onClick={confirm} disabled={busy}>
            {busy ? 'Merging…' : `Merge ${guests.length} guests`}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

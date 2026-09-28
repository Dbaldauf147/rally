import React, { useMemo, useState } from 'react';
import styles from './FriendsPage.module.css';
import { mergeConflicts, mergeFriends } from '../lib/friendMerge';

const REASON_TEXT = { email: 'same email', phone: 'same phone', name: 'same name' };

const contactLine = (f) => [f.email, f.phone, f.group].filter(Boolean).join(' · ');

// How complete a record is — the fullest one is offered as the one to keep.
const filled = (f) => Object.values(f).filter((v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : !!v)).length;

/* The suggested duplicates, one row per group, each opening the merge screen. */
export function DuplicatesModal({ groups, onReview, onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <h2 className={styles.modalTitle}>Possible duplicates</h2>
        {groups.length === 0 ? (
          <p className={styles.mergeMuted}>No duplicates found — no two contacts share an email, a phone number or a name.</p>
        ) : (
          <>
            <p className={styles.mergeMuted}>
              {groups.length} {groups.length === 1 ? 'group' : 'groups'} of contacts that share an email, phone number or name. Review each before merging.
            </p>
            <div className={styles.dupList}>
              {groups.map((g) => (
                <div key={g.friends.map((f) => f.id).join('|')} className={styles.dupGroup}>
                  <div className={styles.dupPeople}>
                    {g.friends.map((f) => (
                      <div key={f.id}>
                        <span className={styles.dupName}>{f.name || '(no name)'}</span>
                        {contactLine(f) && <span className={styles.mergeMuted}> · {contactLine(f)}</span>}
                      </div>
                    ))}
                    <div className={styles.dupWhy}>{g.reasons.map((r) => REASON_TEXT[r] || r).join(', ')}</div>
                  </div>
                  <button type="button" className={styles.saveBtn} onClick={() => onReview(g.friends)}>Review merge</button>
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

/* Merging two or more contacts: pick the one to keep, settle the fields they
 * disagree on, see what gets combined, confirm. */
export function MergeModal({ contacts, friendsById, onCancel, onConfirm }) {
  const [primaryId, setPrimaryId] = useState(() => [...contacts].sort((a, b) => filled(b) - filled(a))[0].id);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const primary = contacts.find((f) => f.id === primaryId);
  const others = contacts.filter((f) => f.id !== primaryId);
  const conflicts = useMemo(() => mergeConflicts([primary, ...others]), [primary, others]);
  const merged = useMemo(() => mergeFriends(primary, others, choices), [primary, others, choices]);

  // A field's current answer: what was picked, else the kept contact's value,
  // else the first duplicate that has one — mergeFriends' own default.
  const chosen = (c) => choices[c.key] ?? merged[c.key];
  const show = (key, v) => (key === 'linkedTo' ? friendsById.get(v)?.name || v : v);

  const tags = merged.tag ? merged.tag.split(';').length : 0;
  const combined = [
    tags && `${tags} tag${tags === 1 ? '' : 's'}`,
    merged.addresses.length && `${merged.addresses.length} address${merged.addresses.length === 1 ? '' : 'es'}`,
    merged.kids.length && `${merged.kids.length} kid${merged.kids.length === 1 ? '' : 's'}`,
    merged.giftIdeas.length && `${merged.giftIdeas.length} gift idea${merged.giftIdeas.length === 1 ? '' : 's'}`,
    merged.notes && 'notes',
  ].filter(Boolean);

  async function confirm() {
    setBusy(true);
    try { await onConfirm(primary, others, choices); } finally { setBusy(false); }
  }

  return (
    <div className={styles.overlay} onClick={busy ? undefined : onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <h2 className={styles.modalTitle}>Merge {contacts.length} contacts</h2>

        <div className={styles.mergeSection}>
          <div className={styles.mergeHeading}>Keep</div>
          {contacts.map((f) => (
            <label key={f.id} className={styles.mergeOption}>
              <input
                type="radio"
                name="merge-primary"
                checked={f.id === primaryId}
                onChange={() => { setPrimaryId(f.id); setChoices({}); }}
              />
              <span>
                <span className={styles.dupName}>{f.name || '(no name)'}</span>
                {contactLine(f) && <span className={styles.mergeMuted}> · {contactLine(f)}</span>}
              </span>
            </label>
          ))}
          <p className={styles.mergeHint}>The others are folded into this one and then deleted. Reach Out, wedding guests and “comes with” links move over to it.</p>
        </div>

        {conflicts.length > 0 && (
          <div className={styles.mergeSection}>
            <div className={styles.mergeHeading}>Where they differ</div>
            {conflicts.map((c) => (
              <div key={c.key} className={styles.mergeConflict}>
                <div className={styles.mergeField}>{c.label}</div>
                {c.values.map((v) => (
                  <label key={v.value} className={styles.mergeOption}>
                    <input
                      type="radio"
                      name={`merge-${c.key}`}
                      checked={String(chosen(c) ?? '').toLowerCase() === v.value.toLowerCase()}
                      onChange={() => setChoices((prev) => ({ ...prev, [c.key]: v.value }))}
                    />
                    <span>{show(c.key, v.value)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className={styles.mergeSection}>
          <div className={styles.mergeHeading}>Result</div>
          <div className={styles.mergeResult}>
            <strong>{merged.name || '(no name)'}</strong>
            {[merged.email, merged.phone].filter(Boolean).length > 0 && (
              <span className={styles.mergeMuted}> · {[merged.email, merged.phone].filter(Boolean).join(' · ')}</span>
            )}
            {combined.length > 0 && <div className={styles.mergeMuted}>Combined: {combined.join(' · ')}</div>}
          </div>
        </div>

        <div className={styles.formActions}>
          <button type="button" className={styles.saveBtn} onClick={confirm} disabled={busy}>
            {busy ? 'Merging…' : `Merge ${contacts.length} contacts`}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

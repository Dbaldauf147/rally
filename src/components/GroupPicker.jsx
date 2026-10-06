import { useEffect, useRef, useState } from 'react';
import styles from './GroupPicker.module.css';
import { groupTokens, toggleGroup, groupOptions } from '../lib/peopleGroups';

/* A contact's groups as a dropdown: the chosen ones show as chips on the
 * button; open it to tick any number of the groups already in use, or type a
 * new one at the bottom. `value` stays the comma-separated string the rest of
 * Rally reads ("Family, College"); `options` is every contact's group value. */
export function GroupPicker({ value, onChange, options = [], id }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef(null);
  const chosen = groupTokens(value);
  const all = groupOptions(options, value);
  const isOn = (g) => chosen.some((c) => c.toLowerCase() === g.toLowerCase());

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  function addNew() {
    const n = draft.trim();
    if (!n) return;
    // Typing a group that already exists just ticks it.
    const existing = all.find((g) => g.toLowerCase() === n.toLowerCase());
    if (!existing || !isOn(existing)) onChange(toggleGroup(value, existing || n));
    setDraft('');
  }

  return (
    <div ref={ref} className={styles.wrap}>
      <button
        type="button"
        id={id}
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={chosen.length ? `Groups: ${chosen.join(', ')}` : 'Choose groups'}
      >
        <span className={styles.chips}>
          {chosen.length === 0
            ? <span className={styles.placeholder}>Choose groups…</span>
            : chosen.map((g) => <span key={g} className={styles.chip}>{g}</span>)}
        </span>
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={styles.panel} role="group" aria-label="Groups">
          {all.length === 0 ? (
            <p className={styles.empty}>No groups yet — add the first one below.</p>
          ) : (
            <div className={styles.list}>
              {all.map((g) => (
                <label key={g} className={styles.option}>
                  <input type="checkbox" checked={isOn(g)} onChange={() => onChange(toggleGroup(value, g))} />
                  <span>{g}</span>
                </label>
              ))}
            </div>
          )}
          <div className={styles.addRow}>
            <input
              className={styles.addInput}
              value={draft}
              placeholder="New group…"
              aria-label="New group name"
              onChange={(e) => setDraft(e.target.value)}
              // Enter adds the group instead of submitting the contact form.
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } }}
            />
            <button type="button" className={styles.addBtn} onClick={addNew} disabled={!draft.trim()}>+ Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

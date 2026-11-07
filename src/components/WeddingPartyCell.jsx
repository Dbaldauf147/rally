import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { partyKey, partySuggestions } from '../lib/weddingParty';
import styles from './WeddingPartyCell.module.css';

/* The guest table's Wedding group cell: type a group, or click in and pick
   one. Clicking in lists every group; typing narrows it, and a name that
   isn't a group yet can be created. ↑/↓ and Enter pick, Esc puts it back.
   Leaving the cell saves what's typed; clearing it takes them out of their
   group.

   The table's cells clip what overflows them, so the list is drawn in a
   layer on <body>, placed under the input and kept there on scroll. */
export function WeddingPartyCell({ value, parties, onCommit, label }) {
  // What's typed while you're in the cell; null the rest of the time, when the
  // saved value shows (so someone else's change, or a partner following, does).
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null);
  const inputRef = useRef(null);
  // Set when we blur the input ourselves after saving (or Esc), so the blur doesn't save again.
  const settled = useRef(false);

  const text = draft ?? (value || '');
  const { matches, canCreate } = partySuggestions(parties, text);
  const typed = text.trim();
  const options = [
    ...matches.map((p) => ({ kind: 'party', value: p })),
    ...(canCreate ? [{ kind: 'create', value: typed }] : []),
    ...(value ? [{ kind: 'clear', value: '' }] : []),
  ];

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 200), above: r.top });
  };
  const openList = () => { place(); setOpen(true); };
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const commit = (raw) => {
    const text = String(raw ?? '').trim();
    // An existing group, however it was typed, keeps its own spelling.
    const next = text ? partySuggestions(parties, text).exact || text : '';
    setDraft(null);
    setOpen(false);
    setActive(-1);
    if (next !== (value || '').trim()) onCommit(next);
  };

  const leave = () => { settled.current = true; inputRef.current?.blur(); };
  const pick = (opt) => { commit(opt.value); leave(); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      const n = options.length;
      if (!n) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && options[active]) pick(options[active]);
      else { commit(text); leave(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
      setOpen(false);
      setActive(-1);
      leave();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  // Opens upward when there isn't room below.
  const listHeight = Math.min(options.length, 7) * 34 + 8;
  const style = box && (box.top + listHeight > window.innerHeight && box.above > listHeight
    ? { left: box.left, top: box.above - listHeight - 2, width: box.width }
    : { left: box.left, top: box.top, width: box.width });

  return (
    <>
      <input
        ref={inputRef}
        className={styles.input}
        value={text}
        placeholder="—"
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => { setDraft(value || ''); openList(); setActive(-1); }}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { setDraft(e.target.value); if (!open) openList(); setActive(-1); }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (settled.current) { settled.current = false; return; }
          commit(text);
        }}
      />
      {open && style && options.length > 0 && createPortal(
        <ul className={styles.list} style={style} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {options.map((o, i) => (
            <li
              key={`${o.kind}:${o.value}`}
              role="option"
              aria-selected={i === active}
              className={[
                styles.option,
                i === active ? styles.active : '',
                o.kind === 'party' && partyKey(o.value) === partyKey(value) ? styles.current : '',
                o.kind !== 'party' ? styles.action : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.kind === 'create' ? <>+ New group “{o.value}”</> : o.kind === 'clear' ? 'Remove from group' : o.value}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

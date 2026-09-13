import React, { useEffect, useRef, useState } from 'react';
import {
  insertItem, setItemText, indentItem, outdentItem, removeItem, moveItem,
  parseOutline, mergeParsed, makeId, normalizeItems,
} from '../lib/friendProfile';
import styles from './FriendProfileEditor.module.css';

/* The Likes / Things I appreciate outlines on the friend pop-up.

   Works like a notes app: Enter starts the next line, Tab and Shift+Tab nest
   and un-nest, Backspace on an empty line removes it. Every one of those also
   has a button on the row, because a phone has no Tab key. Pasting several
   lines into a row turns them into rows, keeping their indentation. */
export function FriendProfileEditor({ value, onChange }) {
  const sections = value || [];
  const inputs = useRef(new Map());
  // The row to put the cursor in once the change that created or moved it has
  // rendered. A ref, not state: it's a note to the next render, not something
  // to render from.
  const pendingFocus = useRef(null);
  const setFocusId = (id) => { pendingFocus.current = id; };
  const [pasteFor, setPasteFor] = useState(null);
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = inputs.current.get(id);
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange?.(end, end);
  });

  const setSection = (id, patch) =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const setItems = (id, items) => setSection(id, { items });

  function addSection() {
    const s = { id: makeId(), title: 'New section', items: [] };
    onChange([...sections, s]);
  }

  function removeSection(s) {
    const filled = s.items.filter((i) => i.text.trim()).length;
    if (filled && !window.confirm(`Delete "${s.title || 'this section'}" and its ${filled} line${filled === 1 ? '' : 's'}?`)) return;
    onChange(sections.filter((x) => x.id !== s.id));
  }

  function moveSection(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function addLine(s, index, opts) {
    const { items, id } = insertItem(s.items, index, opts);
    setItems(s.id, items);
    setFocusId(id);
  }

  function onKeyDown(e, s, index) {
    const item = s.items[index];
    if (e.nativeEvent?.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      addLine(s, index);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setItems(s.id, e.shiftKey ? outdentItem(s.items, index) : indentItem(s.items, index));
      setFocusId(item.id);
    } else if (e.key === 'Backspace' && item.text === '') {
      e.preventDefault();
      setItems(s.id, removeItem(s.items, index));
      if (s.items[index - 1]) setFocusId(s.items[index - 1].id);
    } else if (e.key === 'ArrowUp' && s.items[index - 1]) {
      e.preventDefault();
      setFocusId(s.items[index - 1].id);
    } else if (e.key === 'ArrowDown' && s.items[index + 1]) {
      e.preventDefault();
      setFocusId(s.items[index + 1].id);
    }
  }

  // Several lines pasted into one row become rows, nested under wherever the
  // paste landed. A single line is left to paste normally.
  function onPaste(e, s, index) {
    const text = e.clipboardData?.getData('text') || '';
    if (!/\n/.test(text.trim())) return;
    e.preventDefault();
    const parsed = parseOutline(text);
    if (parsed.some((p) => p.title)) {
      onChange(mergeParsed(sections, parsed, s.id));
      return;
    }
    const base = s.items[index];
    const rows = (parsed[0]?.items || []).map((r) => ({ ...r, depth: r.depth + base.depth }));
    const keep = base.text.trim() ? s.items.slice(0, index + 1) : s.items.slice(0, index);
    setItems(s.id, normalizeItems([...keep, ...rows, ...s.items.slice(index + 1)]));
  }

  function applyPaste() {
    const parsed = parseOutline(pasteText);
    if (parsed.length) onChange(mergeParsed(sections, parsed, pasteFor));
    setPasteFor(null);
    setPasteText('');
  }

  return (
    <div className={styles.profile}>
      {sections.map((s, si) => (
        <section key={s.id} className={styles.section}>
          <div className={styles.sectionHead}>
            <input
              className={styles.sectionTitle}
              value={s.title}
              onChange={(e) => setSection(s.id, { title: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
              placeholder="Section name"
              aria-label="Section name"
            />
            <div className={styles.sectionTools}>
              <button type="button" className={styles.tool} onClick={() => setPasteFor(pasteFor === s.id ? null : s.id)} title="Paste a list">Paste list</button>
              <button type="button" className={styles.tool} onClick={() => moveSection(si, -1)} disabled={si === 0} aria-label="Move section up">↑</button>
              <button type="button" className={styles.tool} onClick={() => moveSection(si, 1)} disabled={si === sections.length - 1} aria-label="Move section down">↓</button>
              <button type="button" className={styles.tool} onClick={() => removeSection(s)} aria-label={`Delete section ${s.title}`}>×</button>
            </div>
          </div>

          {pasteFor === s.id && (
            <div className={styles.pasteBox}>
              <textarea
                className={styles.pasteArea}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={8}
                autoFocus
                placeholder={'Working out\n  Running\n  Hot yoga\nFood\n  Omakase\n\n# Things I appreciate\nShe drives to come see me'}
              />
              <div className={styles.pasteHint}>Indent with spaces or tabs to nest. A line starting with “# ” starts a section.</div>
              <div className={styles.pasteActions}>
                <button type="button" className={styles.addBtn} onClick={applyPaste} disabled={!pasteText.trim()}>Add to {s.title || 'section'}</button>
                <button type="button" className={styles.tool} onClick={() => { setPasteFor(null); setPasteText(''); }}>Cancel</button>
              </div>
            </div>
          )}

          <ul className={styles.outline}>
            {s.items.map((item, i) => (
              <li
                key={item.id}
                className={`${styles.row} ${item.depth === 0 ? styles.top : ''}`}
                style={{ '--depth': item.depth }}
              >
                <span className={styles.bullet} aria-hidden="true" />
                <input
                  ref={(el) => { if (el) inputs.current.set(item.id, el); else inputs.current.delete(item.id); }}
                  className={styles.itemInput}
                  value={item.text}
                  onChange={(e) => setItems(s.id, setItemText(s.items, i, e.target.value))}
                  onKeyDown={(e) => onKeyDown(e, s, i)}
                  onPaste={(e) => onPaste(e, s, i)}
                  placeholder={item.depth === 0 ? 'Category' : 'Detail'}
                  aria-label={`${s.title} line ${i + 1}`}
                />
                {/* mousedown is swallowed so a tap keeps the cursor in the row:
                    on a phone these only show while it's there. */}
                <span className={styles.rowTools} onMouseDown={(e) => e.preventDefault()}>
                  <button type="button" className={styles.tool} onClick={() => { setItems(s.id, outdentItem(s.items, i)); setFocusId(item.id); }} disabled={item.depth === 0} aria-label="Un-nest">⇤</button>
                  <button type="button" className={styles.tool} onClick={() => { setItems(s.id, indentItem(s.items, i)); setFocusId(item.id); }} disabled={i === 0} aria-label="Nest">⇥</button>
                  <button type="button" className={styles.tool} onClick={() => { setItems(s.id, moveItem(s.items, i, -1)); setFocusId(item.id); }} aria-label="Move up">↑</button>
                  <button type="button" className={styles.tool} onClick={() => { setItems(s.id, moveItem(s.items, i, 1)); setFocusId(item.id); }} aria-label="Move down">↓</button>
                  <button type="button" className={styles.tool} onClick={() => setItems(s.id, removeItem(s.items, i))} aria-label="Remove line">×</button>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.addLine} onClick={() => addLine(s, s.items.length - 1, { depth: 0 })}>+ Add line</button>
        </section>
      ))}
      <button type="button" className={styles.addSection} onClick={addSection}>+ Add section</button>
    </div>
  );
}

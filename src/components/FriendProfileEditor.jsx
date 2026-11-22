import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  insertItem, setItemText, indentItem, outdentItem, removeItem, moveItem,
  parseOutline, mergeParsed, makeId, normalizeItems, lineHint,
  offersFollowUp, setItemFollowUp, setItemDepth, maxDepthAt, previewOf,
} from '../lib/friendProfile';
import { DateField } from './DateField';
import styles from './FriendProfileEditor.module.css';

/* The Likes / Things I appreciate / Foods / Drinks / … / Pains outlines on the friend pop-up.

   Works like a notes app: Enter starts the next line, Tab and Shift+Tab nest
   and un-nest, Backspace on an empty line removes it. Every one of those also
   has a button on the row, because a phone has no Tab key. Pasting several
   lines into a row turns them into rows, keeping their indentation.

   A line under Pains also takes a follow-up date — the day to check back in on
   it — which the Reach Out page flags once it arrives.

   Likes is a card instead: what's in it at a glance, and a click opens it in
   a pop-up of its own where each line is a header, a subheader or an item in
   the list under them. Same rows, same depths — a header is depth 0, a
   subheader depth 1, an item anything deeper — so nothing about how it's
   stored changes, and the other sections still read it the same way. */
const POPUP_SECTIONS = new Set(['likes']);
const opensAsPopup = (title) => POPUP_SECTIONS.has(String(title ?? '').trim().toLowerCase());

const LEVELS = [
  { depth: 0, label: 'Header' },
  { depth: 1, label: 'Subheader' },
  { depth: 2, label: 'Item' },
];
const levelOf = (depth) => Math.min(depth, 2);
const LEVEL_CLASS = ['levelHeader', 'levelSub', 'levelItem'];
const LEVEL_HINT = ['Header — e.g. Food', 'Subheader — e.g. Pasta', 'Item — e.g. Cacio e pepe'];

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
  // The section open in the pop-up, by id.
  const [openId, setOpenId] = useState(null);
  const openSection = sections.find((s) => s.id === openId) || null;

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

  function closePopup() {
    setOpenId(null);
    if (pasteFor === openId) { setPasteFor(null); setPasteText(''); }
  }

  const pasteBox = (s) => pasteFor === s.id && (
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
  );

  // One section's lines. In the pop-up (`levels`) each row says what it is —
  // header, subheader or item — and is styled as one.
  const outline = (s, { levels = false } = {}) => (
    <ul className={`${styles.outline} ${levels ? styles.leveled : ''}`}>
      {s.items.map((item, i) => {
        const level = levelOf(item.depth);
        return (
          <li
            key={item.id}
            className={`${styles.row} ${item.depth === 0 ? styles.top : ''} ${levels ? styles[LEVEL_CLASS[level]] : ''}`}
            style={{ '--depth': item.depth }}
          >
            {!(levels && level < 2) && <span className={styles.bullet} aria-hidden="true" />}
            <input
              ref={(el) => { if (el) inputs.current.set(item.id, el); else inputs.current.delete(item.id); }}
              className={styles.itemInput}
              value={item.text}
              onChange={(e) => setItems(s.id, setItemText(s.items, i, e.target.value))}
              onKeyDown={(e) => onKeyDown(e, s, i)}
              onPaste={(e) => onPaste(e, s, i)}
              placeholder={levels ? LEVEL_HINT[level] : lineHint(s.title, item.depth)}
              aria-label={`${s.title} line ${i + 1}`}
            />
            {levels && (
              <select
                className={styles.levelSelect}
                value={level}
                onChange={(e) => { setItems(s.id, setItemDepth(s.items, i, Number(e.target.value))); setFocusId(item.id); }}
                aria-label={`What ${item.text.trim() || 'this line'} is`}
              >
                {LEVELS.map((l) => (
                  <option key={l.depth} value={l.depth} disabled={l.depth > maxDepthAt(s.items, i)}>{l.label}</option>
                ))}
              </select>
            )}
            {offersFollowUp(s.title) && (item.followUp || item.text.trim()) && (
              <DateField
                className={`${styles.followUp} ${item.followUp ? styles.followUpSet : ''}`}
                value={item.followUp || ''}
                onChange={(e) => setItems(s.id, setItemFollowUp(s.items, i, e.target.value))}
                placeholder="Follow up"
                title="When to follow up — it's flagged on Reach Out from that day"
                ariaLabel={`Follow-up date for ${item.text.trim() || 'this line'}`}
              />
            )}
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
        );
      })}
    </ul>
  );

  const sectionTools = (s, si, { paste = true } = {}) => (
    <div className={styles.sectionTools}>
      {paste && <button type="button" className={styles.tool} onClick={() => setPasteFor(pasteFor === s.id ? null : s.id)} title="Paste a list">Paste list</button>}
      <button type="button" className={styles.tool} onClick={() => moveSection(si, -1)} disabled={si === 0} aria-label="Move section up">↑</button>
      <button type="button" className={styles.tool} onClick={() => moveSection(si, 1)} disabled={si === sections.length - 1} aria-label="Move section down">↓</button>
      <button type="button" className={styles.tool} onClick={() => removeSection(s)} aria-label={`Delete section ${s.title}`}>×</button>
    </div>
  );

  // A pop-up section on the page: its name, its headers with the subheaders
  // under each, and the whole card opens it.
  function sectionCard(s, si) {
    const heads = previewOf(s.items);
    const shown = heads.slice(0, 5);
    const name = s.title || 'section';
    return (
      <section key={s.id} className={`${styles.section} ${styles.cardSection}`}>
        <div className={styles.sectionHead}>
          <button type="button" className={styles.cardTitle} onClick={() => setOpenId(s.id)} aria-haspopup="dialog">
            {s.title || 'Untitled'}
          </button>
          {sectionTools(s, si, { paste: false })}
        </div>
        <button type="button" className={styles.cardBody} onClick={() => setOpenId(s.id)} aria-haspopup="dialog" aria-label={`Open ${name}`}>
          {shown.length ? (
            <ul className={styles.cardList}>
              {shown.map((h) => (
                <li key={h.id} className={styles.cardHead}>
                  <span className={styles.cardHeadText}>{h.text}</span>
                  {h.subs.length > 0 && <span className={styles.cardSubs}>{h.subs.join(' · ')}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <span className={styles.cardEmpty}>Nothing yet — add headers, subheaders and lists.</span>
          )}
          <span className={styles.cardOpen}>
            {heads.length > shown.length ? `+${heads.length - shown.length} more · ` : ''}Open {name} →
          </span>
        </button>
      </section>
    );
  }

  const last = openSection?.items[openSection.items.length - 1];
  const popup = openSection && createPortal(
    <div className={styles.popOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) closePopup(); }}>
      <div
        className={styles.pop}
        role="dialog"
        aria-modal="true"
        aria-label={openSection.title || 'Section'}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopup(); } }}
      >
        <div className={styles.popHead}>
          <input
            className={`${styles.sectionTitle} ${styles.popTitle}`}
            value={openSection.title}
            onChange={(e) => setSection(openSection.id, { title: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            placeholder="Section name"
            aria-label="Section name"
          />
          <button type="button" className={styles.tool} onClick={() => setPasteFor(pasteFor === openSection.id ? null : openSection.id)}>Paste list</button>
          <button type="button" className={styles.popDone} onClick={closePopup}>Done</button>
        </div>
        <p className={styles.popHint}>Headers group the list, subheaders split a header up, and items are the specifics. Enter adds the next line at the same level; Tab nests it.</p>
        {pasteBox(openSection)}
        <div className={styles.popBody}>
          {openSection.items.length ? outline(openSection, { levels: true }) : (
            <p className={styles.cardEmpty}>Start with a header — Food, Hobbies, Music…</p>
          )}
        </div>
        <div className={styles.popAdd}>
          <button type="button" className={styles.addBtn} onClick={() => addLine(openSection, openSection.items.length - 1, { depth: 0 })}>+ Header</button>
          <button type="button" className={styles.addBtn} onClick={() => addLine(openSection, openSection.items.length - 1, { depth: 1 })}
            disabled={!last} title={last ? undefined : 'Add a header first'}>+ Subheader</button>
          <button type="button" className={styles.addBtn} onClick={() => addLine(openSection, openSection.items.length - 1, { depth: 2 })}
            disabled={!last || last.depth === 0} title={!last || last.depth === 0 ? 'Add a subheader first' : undefined}>+ Item</button>
        </div>
      </div>
    </div>,
    document.body,
  );

  return (
    <div className={styles.profile}>
      {sections.map((s, si) => (opensAsPopup(s.title) ? sectionCard(s, si) : (
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
            {sectionTools(s, si)}
          </div>
          {pasteBox(s)}
          {outline(s)}
          <button type="button" className={styles.addLine} onClick={() => addLine(s, s.items.length - 1, { depth: 0 })}>+ Add line</button>
        </section>
      )))}
      <button type="button" className={styles.addSection} onClick={addSection}>+ Add section</button>
      {popup}
    </div>
  );
}

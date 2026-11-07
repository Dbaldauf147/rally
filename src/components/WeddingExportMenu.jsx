import { useEffect, useRef, useState } from 'react';
import { EXPORT_COLUMNS } from '../lib/weddingGuestExport';
import pageStyles from './WeddingPage.module.css';
import styles from './WeddingExportMenu.module.css';

// The last columns picked, so the next export starts from them. Only a
// convenience: an empty or blocked storage just means every column.
const STORAGE_KEY = 'weddingExportColumns';
const ALL_KEYS = EXPORT_COLUMNS.map((c) => c.key);

function loadPicked() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved)) {
      const keys = ALL_KEYS.filter((k) => saved.includes(k));
      if (keys.length) return keys;
    }
  } catch { /* fall through to every column */ }
  return ALL_KEYS;
}

function savePicked(keys) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keys)); } catch { /* not remembered, that's all */ }
}

/* "Export to Excel ▾": a list of the file's columns to tick, then Export.
   `onExport(keys)` gets the chosen keys in the file's column order. */
export function WeddingExportMenu({ exporting, onExport }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(loadPicked);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Open on the side with room, bring the button up when there's barely any
  // space below it (on a phone it often sits near the tab bar), and cap the
  // height so the Export button at the bottom can always be scrolled to.
  function toggle() {
    if (open) { setOpen(false); return; }
    let r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const GAP = 12;
      const W = 230;
      const bottom = window.innerWidth < 768 ? 96 : GAP;
      const need = Math.min(560, window.innerHeight - bottom - 140);
      if (window.innerHeight - r.bottom - bottom < need && r.top > 120) {
        window.scrollBy({ top: r.top - 80 });
        r = wrapRef.current.getBoundingClientRect();
      }
      const alignLeft = r.left + W <= window.innerWidth - GAP || r.right < W + GAP;
      setPos({
        ...(alignLeft ? { left: 0, right: 'auto' } : { right: 0, left: 'auto' }),
        maxHeight: Math.max(220, window.innerHeight - r.bottom - bottom - 4),
        maxWidth: window.innerWidth - 2 * GAP,
      });
    }
    setOpen(true);
  }

  const choose = (keys) => { setPicked(keys); savePicked(keys); };
  const flip = (key) => choose(picked.includes(key) ? picked.filter((k) => k !== key) : ALL_KEYS.filter((k) => k === key || picked.includes(k)));

  function run() {
    if (!picked.length || exporting) return;
    setOpen(false);
    onExport(picked);
  }

  return (
    <div className={pageStyles.colMenu} ref={wrapRef}>
      <button className={pageStyles.toolButton} type="button" onClick={toggle} disabled={exporting} aria-expanded={open} aria-haspopup="dialog">
        {exporting ? 'Exporting…' : 'Export to Excel ▾'}
      </button>
      {open && (
        <div className={`${pageStyles.colMenuPopover} ${styles.popover}`} role="dialog" aria-label="Columns to export" style={pos || undefined}>
          <div className={styles.head}>
            <span>Columns to export</span>
            <span className={styles.quick}>
              <button type="button" onClick={() => choose(ALL_KEYS)}>All</button>
              <button type="button" onClick={() => choose([])}>None</button>
            </span>
          </div>
          {EXPORT_COLUMNS.map((col) => (
            <label key={col.key} className={pageStyles.colMenuItem}>
              <input type="checkbox" checked={picked.includes(col.key)} onChange={() => flip(col.key)} />
              {col.header}
            </label>
          ))}
          <div className={styles.foot}>
            <button type="button" className={styles.go} onClick={run} disabled={!picked.length}>
              {picked.length ? `Export ${picked.length === ALL_KEYS.length ? 'all' : picked.length} column${picked.length === 1 ? '' : 's'}` : 'Pick a column'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

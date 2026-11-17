import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A column's filter on the venue table: a button that opens a pop-up where
// you can tick as many of the column's values as you like, and — on a text
// column — type to match as well. `options` is [{ value, label, count }];
// `picked` the ticked values; `text` what's typed (undefined: no typing).
export function ColumnPickFilter({ label, options, picked = [], onPick, onSetPicked, text, onText }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const ticked = useMemo(() => new Set(picked), [picked]);
  const typed = String(text ?? '').trim();

  const summary = picked.length === 0
    ? (typed ? `“${typed}”` : 'All')
    : picked.length === 1
      ? (options.find((o) => o.value === picked[0])?.label || picked[0] || '(Blank)')
      : `${picked.length} selected`;
  const on = picked.length > 0 || !!typed;

  // Under the button, kept on screen; it follows the table as it scrolls.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      const el = popRef.current;
      if (!r || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = r.bottom + 4;
      const top = below + h > window.innerHeight - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const f = find.trim().toLowerCase();
  const listed = f ? options.filter((o) => (o.label || '').toLowerCase().includes(f)) : options;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setOpen((v) => !v); setFind(''); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter ${label}`}
        title={picked.length > 1 ? picked.map((v) => options.find((o) => o.value === v)?.label || v || '(Blank)').join(', ') : `Filter ${label}`}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.3rem', width: '100%', boxSizing: 'border-box',
          padding: '0.3rem 0.45rem', border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)',
          background: on ? 'var(--color-accent-light, #eef2ff)' : 'var(--color-surface)', color: on ? 'var(--color-accent)' : 'var(--color-text-secondary)',
          fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: on ? 600 : 400, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{summary}</span>
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: '0.65rem' }}>▾</span>
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Filter ${label}`}
          data-testid="col-pick-pop"
          style={{
            position: 'fixed', zIndex: 300, width: '250px', maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.15))', padding: '0.55rem', fontSize: '0.84rem',
            ...(pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }),
          }}
        >
          {onText && (
            <input
              autoFocus
              value={text || ''}
              onChange={(e) => onText(e.target.value)}
              placeholder="Contains…"
              aria-label={`${label} contains`}
              style={inputStyle}
            />
          )}
          {options.length > 8 && (
            <input
              autoFocus={!onText}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a value…"
              aria-label={`Find a ${label} value`}
              style={{ ...inputStyle, marginTop: onText ? '0.35rem' : 0 }}
            />
          )}
          <div style={{ display: 'flex', gap: '0.75rem', margin: '0.45rem 0 0.25rem', fontSize: '0.76rem' }}>
            <button type="button" style={linkStyle} disabled={!listed.length} onClick={() => onSetPicked([...new Set([...picked, ...listed.map((o) => o.value)])])}>
              Select {f ? 'these' : 'all'}
            </button>
            <button type="button" style={linkStyle} disabled={!picked.length} onClick={() => onSetPicked([])}>Clear</button>
          </div>
          <div style={{ maxHeight: '260px', overflowY: 'auto', margin: '0 -0.2rem' }}>
            {listed.length === 0 && <div style={{ padding: '0.3rem 0.2rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Nothing to pick.</div>}
            {listed.map((o) => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.2rem 0.2rem', borderRadius: '4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={ticked.has(o.value)} onChange={() => onPick(o.value)} style={{ flexShrink: 0, accentColor: 'var(--color-accent)' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: o.value === '' ? 'italic' : 'normal', color: o.value === '' ? 'var(--color-text-muted)' : 'var(--color-text)' }} title={o.label}>
                  {o.label || '(Blank)'}
                </span>
                {o.count != null && <span style={{ flexShrink: 0, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{o.count}</span>}
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const inputStyle = { display: 'block', width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.45rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit', fontSize: '0.8rem' };
const linkStyle = { padding: 0, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer' };

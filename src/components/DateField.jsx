import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths } from 'date-fns';
import { parseTypedDate, formatDateValue, isoToDate, dateToISO, withinBounds } from '../lib/dateInput';
import styles from './DateField.module.css';

// One date field for the whole app, in place of <input type="date">.
//
// The native control draws its own popup, which we cannot put anything inside —
// and on iOS it is a spinner you cannot type into at all. So this renders our
// own calendar with a type-in bar sitting above it: type "9/12/26", "Sep 12" or
// "tomorrow" and the grid follows along, or ignore the bar and pick a day.
//
// Deliberately API-compatible with the input it replaces: `value` is a
// 'YYYY-MM-DD' string and `onChange` is handed { target: { value } }, so the
// existing `e => setThing(e.target.value)` call sites work untouched.
export function DateField({
  value = '',
  onChange,
  onBlur,
  className = '',
  style,
  min,
  max,
  placeholder = 'mm/dd/yyyy',
  disabled = false,
  required = false,
  autoFocus = false,
  title,
  id,
  ariaLabel,
  'aria-label': ariaLabelAttr,
  clearable = true,
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(() => isoToDate(value) || new Date());
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const inputRef = useRef(null);
  // Read inside the blur handler, which fires as focus moves into the popup.
  const openRef = useRef(false);
  openRef.current = open;

  const commit = useCallback((iso) => {
    onChange?.({ target: { value: iso } });
    setOpen(false);
    // Hand focus back to the field. Keeps the keyboard path sane, and means an
    // onBlur that saves a draft still fires once the person moves on.
    triggerRef.current?.focus();
  }, [onChange]);

  // Reopening should always start from the value that is actually in the field.
  const openPopup = useCallback(() => {
    if (disabled) return;
    setCursor(isoToDate(value) || new Date());
    setText(formatDateValue(value));
    setOpen(true);
  }, [disabled, value]);

  // autoFocus on the input this replaces meant "ready to take a date" — so open
  // straight onto the type-in bar rather than just focusing a closed button.
  useEffect(() => {
    if (autoFocus) openPopup();
    // Mount only: re-running would reopen the popup every time the value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anchor the popup to the trigger. It is portalled to <body> and fixed, so it
  // escapes the tables and modals these fields sit in without being clipped.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 296, M = 8;
    // Measure once mounted; the estimate only covers the very first pass, and
    // the effect below re-runs with the real height. The popup's max-height
    // keeps this under the viewport even on a short screen.
    const H = popRef.current?.offsetHeight || 360;
    const left = Math.max(M, Math.min(r.left, window.innerWidth - W - M));
    const below = r.bottom + 4;
    // Prefer below; flip above only when below overflows and above genuinely fits.
    const top = below + H > window.innerHeight - M && r.top - 4 - H > M ? r.top - 4 - H : below;
    const next = { top: Math.max(M, Math.min(top, window.innerHeight - H - M)), left, width: W };
    // Same object back when nothing moved, so the re-place effect can't loop.
    setPos(prev => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, []);

  // Runs after every render while open: the first pass positions with an
  // estimated height, this one corrects it against the real box, and later
  // passes follow the height as the Clear button and hint line come and go.
  useLayoutEffect(() => { if (open) place(); });

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // What the bar currently reads, and whether it is usable.
  const typed = parseTypedDate(text);
  const typedOK = !!typed && withinBounds(typed, min, max);
  const showHint = text.trim().length > 0 && !typedOK;

  const handleType = (raw) => {
    setText(raw);
    const iso = parseTypedDate(raw);
    // Follow along as they type, so the day is already on screen.
    if (iso) {
      const d = isoToDate(iso);
      if (d) setCursor(d);
    }
  };

  const monthStart = startOfMonth(cursor);
  const lead = getDay(monthStart);
  const days = [];
  for (let i = lead; i > 0; i--) days.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - i));
  days.push(...eachDayOfInterval({ start: monthStart, end: endOfMonth(cursor) }));
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }

  const todayISO = dateToISO(new Date());

  const popup = open && pos && createPortal(
    <div
      ref={popRef}
      className={styles.popup}
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      role="dialog"
      aria-label="Choose a date"
    >
      {/* The type-in bar — the whole point of this component. */}
      <div className={styles.typeRow}>
        <label className={styles.typeLabel} htmlFor={`${id || 'date'}-type`}>Type a date</label>
        <input
          id={`${id || 'date'}-type`}
          ref={inputRef}
          className={`${styles.typeInput} ${showHint ? styles.typeInputBad : ''}`}
          value={text}
          placeholder="9/12/26 or Sep 12"
          inputMode="text"
          autoComplete="off"
          onChange={e => handleType(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (typedOK) commit(typed); }
          }}
        />
        <div className={showHint ? styles.typeHintBad : styles.typeHint}>
          {showHint
            ? (typed ? 'Outside the allowed range' : 'Try 9/12/26, Sep 12, or today')
            : typedOK ? format(isoToDate(typed), 'EEEE, MMMM d, yyyy') : 'Or pick a day below'}
        </div>
      </div>

      <div className={styles.calHeader}>
        <button type="button" className={styles.calNav} onClick={() => setCursor(c => subMonths(c, 1))} aria-label="Previous month">‹</button>
        <span className={styles.calMonth}>{format(cursor, 'MMMM yyyy')}</span>
        <button type="button" className={styles.calNav} onClick={() => setCursor(c => addMonths(c, 1))} aria-label="Next month">›</button>
      </div>

      <div className={styles.calGrid}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className={styles.calDayLabel}>{d}</div>
        ))}
        {days.map(day => {
          const iso = dateToISO(day);
          const otherMonth = day.getMonth() !== cursor.getMonth();
          const blocked = !withinBounds(iso, min, max);
          return (
            <button
              key={iso}
              type="button"
              disabled={blocked}
              className={[
                styles.calDay,
                otherMonth ? styles.calDayOther : '',
                iso === todayISO ? styles.calDayToday : '',
                iso === value ? styles.calDaySelected : '',
                typedOK && iso === typed && iso !== value ? styles.calDayTyped : '',
              ].filter(Boolean).join(' ')}
              onClick={() => commit(iso)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className={styles.popupFooter}>
        <button
          type="button"
          className={styles.footerBtn}
          disabled={!withinBounds(todayISO, min, max)}
          onClick={() => commit(todayISO)}
        >
          Today
        </button>
        {clearable && value && (
          <button type="button" className={styles.footerBtnMuted} onClick={() => commit('')}>Clear</button>
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`${styles.trigger} ${className}`}
        style={style}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel || ariaLabelAttr}
        aria-required={required || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPopup())}
        onBlur={e => { if (!openRef.current) onBlur?.(e); }}
      >
        <span className={value ? styles.triggerValue : styles.triggerPlaceholder}>
          {value ? formatDateValue(value) : placeholder}
        </span>
        <span className={styles.triggerIcon} aria-hidden="true">🗓</span>
      </button>
      {popup}
    </>
  );
}

export default DateField;

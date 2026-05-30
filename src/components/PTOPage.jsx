import { useMemo, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './PTOPage.module.css';

const STORAGE_KEY = 'rally.pto.v1';

const DEFAULT_STATE = {
  allotment: 20,
  year: new Date().getFullYear(),
  entries: [],
};

function parseLocal(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Count weekdays (Mon–Fri) inclusive between two ISO dates — a sensible default day count.
function weekdaysBetween(startIso, endIso) {
  const start = parseLocal(startIso);
  const end = parseLocal(endIso || startIso);
  if (!start || !end || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return DEFAULT_STATE;
  }
}

function makeId() {
  return `pto-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function PTOPage() {
  const { user } = useAuth();
  const [state, setState] = useState(() => loadStored());
  const [draft, setDraft] = useState({ label: '', start: '', end: '', days: '', note: '' });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const { allotment, entries } = state;

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.start || '').localeCompare(b.start || '')),
    [entries],
  );

  const used = useMemo(
    () => entries.reduce((sum, e) => sum + (Number(e.days) || 0), 0),
    [entries],
  );
  const remaining = Math.max(0, (Number(allotment) || 0) - used);
  const pct = allotment > 0 ? Math.min(100, Math.round((used / allotment) * 100)) : 0;

  // Auto-suggested day count for the draft, if the user hasn't typed one.
  const suggestedDays = useMemo(() => weekdaysBetween(draft.start, draft.end), [draft.start, draft.end]);

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  const setAllotment = (v) => setState((s) => ({ ...s, allotment: v === '' ? '' : Number(v) }));
  const setYear = (v) => setState((s) => ({ ...s, year: v === '' ? '' : Number(v) }));

  const updateEntry = (id, patch) =>
    setState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const removeEntry = (id) => {
    const e = entries.find((x) => x.id === id);
    if (e && !confirm(`Remove “${e.label || 'this entry'}”?`)) return;
    setState((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== id) }));
  };

  const addDraft = () => {
    if (!draft.start) return;
    const days = draft.days !== '' ? Number(draft.days) : suggestedDays;
    setState((s) => ({
      ...s,
      entries: [
        ...s.entries,
        {
          id: makeId(),
          label: draft.label.trim() || 'Time off',
          start: draft.start,
          end: draft.end || draft.start,
          days,
          note: draft.note.trim(),
        },
      ],
    }));
    setDraft({ label: '', start: '', end: '', days: '', note: '' });
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>PTO</h1>
        <div className={styles.progress}>{remaining} of {allotment || 0} days left</div>
      </div>
      <p className={styles.subtitle}>Track your paid time off — set your yearly allotment and log every trip and day off.</p>

      <div className={styles.summary}>
        <div className={styles.summaryFields}>
          <label className={styles.metaField}>
            <span className={styles.metaLabel}>Year</span>
            <input className={styles.metaInput} type="number" value={state.year} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label className={styles.metaField}>
            <span className={styles.metaLabel}>Annual allotment (days)</span>
            <input className={styles.metaInput} type="number" min="0" step="0.5" value={allotment} onChange={(e) => setAllotment(e.target.value)} />
          </label>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}><span className={styles.statNum}>{used}</span><span className={styles.statLbl}>Used</span></div>
          <div className={styles.stat}><span className={`${styles.statNum} ${remaining === 0 ? styles.statDanger : styles.statOk}`}>{remaining}</span><span className={styles.statLbl}>Remaining</span></div>
          <div className={styles.stat}><span className={styles.statNum}>{allotment || 0}</span><span className={styles.statLbl}>Total</span></div>
        </div>
        <div className={styles.barTrack}>
          <div className={styles.barFill} style={{ width: `${pct}%` }} />
        </div>
        {used > (Number(allotment) || 0) && (
          <div className={styles.overWarn}>You’re {used - allotment} day{used - allotment === 1 ? '' : 's'} over your allotment.</div>
        )}
      </div>

      <div className={styles.list}>
        {sorted.length === 0 && <div className={styles.empty}>No PTO logged yet. Add your first entry below.</div>}
        {sorted.map((e) => (
          <div key={e.id} className={styles.entry}>
            <div className={styles.entryMain}>
              <input
                className={styles.entryLabel}
                value={e.label}
                onChange={(ev) => updateEntry(e.id, { label: ev.target.value })}
                placeholder="Label"
              />
              <div className={styles.entryDates}>
                <input className={styles.dateInput} type="date" value={e.start} onChange={(ev) => updateEntry(e.id, { start: ev.target.value })} />
                <span className={styles.dash}>→</span>
                <input className={styles.dateInput} type="date" value={e.end} onChange={(ev) => updateEntry(e.id, { end: ev.target.value })} />
              </div>
              {e.note && <div className={styles.entryNote}>{e.note}</div>}
            </div>
            <div className={styles.entryDaysWrap}>
              <input
                className={styles.daysInput}
                type="number"
                min="0"
                step="0.5"
                value={e.days}
                onChange={(ev) => updateEntry(e.id, { days: ev.target.value === '' ? '' : Number(ev.target.value) })}
              />
              <span className={styles.daysLbl}>days</span>
            </div>
            <button className={styles.removeBtn} onClick={() => removeEntry(e.id)} title="Remove">×</button>
          </div>
        ))}
      </div>

      <div className={styles.addCard}>
        <div className={styles.addTitle}>Log time off</div>
        <div className={styles.addGrid}>
          <input
            className={styles.addInput}
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="Label (e.g. Hawaii trip)"
          />
          <label className={styles.addField}>
            <span className={styles.addFieldLbl}>Start</span>
            <input className={styles.addInput} type="date" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} />
          </label>
          <label className={styles.addField}>
            <span className={styles.addFieldLbl}>End</span>
            <input className={styles.addInput} type="date" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} />
          </label>
          <label className={styles.addField}>
            <span className={styles.addFieldLbl}>Days{draft.days === '' && suggestedDays > 0 ? ` (≈${suggestedDays})` : ''}</span>
            <input
              className={styles.addInput}
              type="number"
              min="0"
              step="0.5"
              value={draft.days}
              onChange={(e) => setDraft((d) => ({ ...d, days: e.target.value }))}
              placeholder={suggestedDays ? String(suggestedDays) : '0'}
            />
          </label>
        </div>
        <input
          className={styles.addInput}
          value={draft.note}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          placeholder="Note (optional)"
          style={{ marginTop: '0.5rem', width: '100%' }}
        />
        <button className={styles.addBtn} onClick={addDraft} disabled={!draft.start}>Add entry</button>
        {draft.start && (
          <span className={styles.addHint}>
            Logs {(draft.days !== '' ? Number(draft.days) : suggestedDays) || 0} day(s). Weekends are excluded from the auto count.
          </span>
        )}
      </div>
    </div>
  );
}

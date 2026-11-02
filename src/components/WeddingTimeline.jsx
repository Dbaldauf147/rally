import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  normalizeTimeline, seedTimeline, groupByMonth, itemDate, daysUntil, relativeLabel,
  splitDays, joinDays, nextItem, isOverdue, addItem, updateItem, removeItem, setDate, localToday,
} from '../lib/weddingTimeline';
import styles from './WeddingTimeline.module.css';

/* The planning timeline on real dates.

   One field on the owner's user document, `weddingTimeline`, beside the
   checklist and the guest list. Same sync as the checklist: edits land
   locally at once, go to Firestore after a short pause, and a cached copy
   carries the page when it opens offline. */
const CACHE_KEY = 'rally.weddingTimeline.v1';

function useTimeline(userId) {
  const [timeline, setTimeline] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizeTimeline(JSON.parse(raw));
    } catch { /* ignore a corrupt cache */ }
    return null;
  });
  const [loaded, setLoaded] = useState(false);

  const localEdits = useRef(0);
  const syncedEdits = useRef(0);
  const appliedJson = useRef(null);
  const writeTimer = useRef(null);
  const pendingWrite = useRef(null);

  const flushWrite = useCallback(() => {
    if (writeTimer.current) { clearTimeout(writeTimer.current); writeTimer.current = null; }
    const next = pendingWrite.current;
    if (!next || !userId) return;
    pendingWrite.current = null;
    const version = localEdits.current;
    setDoc(doc(db, 'users', userId), { weddingTimeline: next }, { merge: true })
      .catch(() => {}) // offline: the local cache still holds the edit
      .then(() => { syncedEdits.current = Math.max(syncedEdits.current, version); });
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    return onSnapshot(doc(db, 'users', userId), (snap) => {
      setLoaded(true);
      if (snap.metadata.hasPendingWrites) return;
      if (localEdits.current !== syncedEdits.current) return; // unsent edit wins
      const stored = snap.exists() ? snap.data()?.weddingTimeline : null;
      // Nothing saved yet reads as the draft; it's only written once edited.
      const remote = stored ? normalizeTimeline(stored) : seedTimeline();
      const json = JSON.stringify(remote);
      if (json === appliedJson.current) return;
      appliedJson.current = json;
      setTimeline(remote);
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
    }, () => setLoaded(true));
  }, [userId]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushWrite(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushWrite(); };
  }, [flushWrite]);

  const update = useCallback((updater) => {
    setTimeline((prev) => {
      const base = prev || seedTimeline();
      const next = normalizeTimeline(typeof updater === 'function' ? updater(base) : updater);
      const json = JSON.stringify(next);
      appliedJson.current = json;
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
      localEdits.current += 1;
      pendingWrite.current = next;
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(flushWrite, 600);
      return next;
    });
  }, [flushWrite]);

  return { timeline, loaded, update };
}

const fmtDay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

function ReadItem({ item, timeline, today, onToggle }) {
  const day = itemDate(timeline.date, item.daysBefore);
  const late = isOverdue(timeline, item, today);
  const cls = [
    styles.item,
    item.milestone ? styles.itemMilestone : '',
    item.done ? styles.itemDone : '',
    late ? styles.itemLate : '',
  ].filter(Boolean).join(' ');
  return (
    <li className={cls}>
      <span className={styles.dot} aria-hidden="true" />
      <label className={styles.itemLabel}>
        <input type="checkbox" className={styles.checkbox} checked={item.done} onChange={onToggle} />
        <span className={styles.itemBody}>
          <span className={styles.itemWhen}>
            {day ? <>{fmtDay(day)} <span className={styles.itemRel}>· {relativeLabel(item.daysBefore)}</span></> : relativeLabel(item.daysBefore)}
            {late && <span className={styles.lateTag}>Overdue</span>}
          </span>
          <span className={styles.itemTitle}>{item.title || <em className={styles.muted}>Untitled</em>}</span>
          {item.note && !item.done && <span className={styles.itemNote}>{item.note}</span>}
        </span>
      </label>
    </li>
  );
}

function EditItem({ item, onChange, onRemove }) {
  const when = splitDays(item.daysBefore);
  const setWhen = (patch) => onChange({ daysBefore: joinDays({ ...when, ...patch }) });
  return (
    <li className={styles.editItem}>
      <div className={styles.editWhen}>
        <input
          // Remounted when the timing changes, so 60 days typed in reads
          // back as "2 months" rather than "60" beside a months unit.
          key={item.daysBefore}
          className={styles.editAmount}
          type="number"
          min="0"
          defaultValue={when.amount}
          aria-label="How far from the wedding"
          onBlur={(e) => { if (Number(e.target.value) !== when.amount) setWhen({ amount: e.target.value }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <select className={styles.editSelect} value={when.unit} aria-label="Unit" onChange={(e) => setWhen({ unit: e.target.value })}>
          <option value="days">days</option>
          <option value="weeks">weeks</option>
          <option value="months">months</option>
        </select>
        <select className={styles.editSelect} value={when.side} aria-label="Before or after" onChange={(e) => setWhen({ side: e.target.value })}>
          <option value="before">before</option>
          <option value="after">after</option>
        </select>
        <label className={styles.editMilestone} title="Milestones get a highlight on the timeline">
          <input type="checkbox" checked={item.milestone} onChange={(e) => onChange({ milestone: e.target.checked })} />
          Milestone
        </label>
        <button type="button" className={styles.iconBtnDanger} title="Delete" aria-label={`Delete ${item.title || 'item'}`} onClick={onRemove}>×</button>
      </div>
      <input
        className={styles.editTitle}
        defaultValue={item.title}
        placeholder="What happens"
        aria-label="Title"
        // A just-added item is the only one with no title; focusing it also
        // scrolls to wherever it sorted to.
        autoFocus={!item.title}
        onBlur={(e) => { if (e.target.value.trim() !== item.title) onChange({ title: e.target.value }); }}
      />
      <textarea
        className={styles.editNote}
        defaultValue={item.note}
        placeholder="Notes (optional)"
        aria-label="Notes"
        rows={2}
        onBlur={(e) => { if (e.target.value.trim() !== item.note) onChange({ note: e.target.value }); }}
      />
    </li>
  );
}

export function WeddingTimeline() {
  const { user } = useAuth();
  const { timeline: stored, loaded, update } = useTimeline(user?.uid);
  const timeline = stored || seedTimeline();
  const [editing, setEditing] = useState(false);
  const today = localToday();

  const groups = groupByMonth(timeline);
  const next = nextItem(timeline);
  const doneCount = timeline.items.filter((it) => it.done).length;
  const toGo = daysUntil(timeline.date, today);
  const lateCount = timeline.items.filter((it) => isOverdue(timeline, it, today)).length;

  // The "Today" line goes above the first item that hasn't happened yet.
  const firstAhead = timeline.date
    ? timeline.items.find((it) => (daysUntil(itemDate(timeline.date, it.daysBefore), today) ?? 0) >= 0)
    : null;
  const todayBeforeId = firstAhead ? firstAhead.id : null;

  const resetToDraft = () => {
    if (!confirm('Replace your timeline with the original draft? Your edits and ticks will be lost; the wedding date stays.')) return;
    update(seedTimeline(timeline.date));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.cardTop}>
          <label className={styles.dateField}>
            <span className={styles.dateLabel}>Wedding date</span>
            <input
              type="date"
              className={styles.dateInput}
              value={timeline.date}
              onChange={(e) => update((t) => setDate(t, e.target.value))}
            />
          </label>
          {toGo !== null && (
            <div className={styles.countdown}>
              <span className={styles.countdownNum}>{toGo > 0 ? toGo : toGo === 0 ? 'Today!' : Math.abs(toGo)}</span>
              {toGo !== 0 && <span className={styles.countdownLabel}>{toGo > 0 ? `day${toGo === 1 ? '' : 's'} to go` : `day${toGo === -1 ? '' : 's'} married`}</span>}
            </div>
          )}
        </div>
        {!timeline.date && (
          <p className={styles.hint}>Set the date and every item below gets a real day, grouped by month.</p>
        )}
        <div className={styles.stats}>
          <span>{doneCount} of {timeline.items.length} done</span>
          {lateCount > 0 && <span className={styles.statLate}>{lateCount} overdue</span>}
          {next && (
            <span className={styles.next}>
              Next: <strong>{next.title}</strong>
              {timeline.date ? ` — ${fmtDay(itemDate(timeline.date, next.daysBefore))}` : ` — ${relativeLabel(next.daysBefore)}`}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={editing ? styles.btnPrimary : styles.btn}
            onClick={() => setEditing((e) => !e)}
          >{editing ? 'Done editing' : 'Edit timeline'}</button>
          {editing && <button type="button" className={styles.btn} onClick={resetToDraft}>Reset to the draft</button>}
        </div>
      </div>

      {editing && (
        <p className={styles.editHint}>
          Each item is set as a distance from the wedding, so changing the date moves the whole plan with it.
          Items re-sort as soon as you change when they happen.
        </p>
      )}

      {editing && (
        <button type="button" className={styles.addRow} onClick={() => update((t) => addItem(t, { title: '' }))}>
          + Add to timeline
        </button>
      )}

      {groups.map((g) => (
        <section key={g.key} className={styles.month}>
          {g.label && <h3 className={styles.monthTitle}>{g.label}</h3>}
          <ul className={editing ? styles.editList : styles.line}>
            {g.items.map((it) => (
              editing ? (
                <EditItem
                  key={it.id}
                  item={it}
                  onChange={(patch) => update((t) => updateItem(t, it.id, patch))}
                  onRemove={() => update((t) => removeItem(t, it.id))}
                />
              ) : (
                <FragmentWithToday key={it.id} showToday={todayBeforeId === it.id} today={today}>
                  <ReadItem
                    item={it}
                    timeline={timeline}
                    today={today}
                    onToggle={() => update((t) => updateItem(t, it.id, { done: !it.done }))}
                  />
                </FragmentWithToday>
              )
            ))}
          </ul>
        </section>
      ))}

      {!loaded && !stored && <p className={styles.footnote}>Loading…</p>}
      {!editing && (
        <p className={styles.footnote}>
          A draft to make your own — press Edit timeline to change, add or remove anything.
          Saved as you go, and synced to your phone.
        </p>
      )}
    </div>
  );
}

function FragmentWithToday({ showToday, today, children }) {
  return (
    <>
      {showToday && (
        <li className={styles.todayLine} aria-label="Today">
          <span>Today · {fmtDay(today)}</span>
        </li>
      )}
      {children}
    </>
  );
}

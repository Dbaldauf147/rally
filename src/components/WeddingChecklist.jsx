import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  taskKey, normalizeChecklist, seedChecklist, totalTasks, toggleTask, isDone,
  phaseProgress, overallProgress, nextUp,
  addTask, updateTask, removeTask, moveTask,
  addPhase, updatePhase, removePhase, movePhase, restoreSeed,
} from '../lib/weddingChecklist';
import styles from './WeddingChecklist.module.css';

/* The planning timeline, ticked off and edited in place.

   Sits beside the guest list on the Wedding tab and shares its storage: the
   whole checklist is one field on the owner's user document, next to
   `weddingContacts`. An account that predates editing has only ticks stored,
   and reads back against the built-in list — see normalizeChecklist. */
const CACHE_KEY = 'rally.weddingChecklist.v1';

function useChecklist(userId) {
  const [list, setList] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizeChecklist(JSON.parse(raw));
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
    setDoc(doc(db, 'users', userId), { weddingChecklist: next }, { merge: true })
      .catch(() => {}) // offline: the local cache still holds the edit
      .then(() => { syncedEdits.current = Math.max(syncedEdits.current, version); });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(doc(db, 'users', userId), (snap) => {
      setLoaded(true);
      if (snap.metadata.hasPendingWrites) return; // our own write echoing back
      if (localEdits.current !== syncedEdits.current) return; // unsent edit wins
      const remote = normalizeChecklist(snap.exists() ? snap.data()?.weddingChecklist : null);
      const json = JSON.stringify(remote);
      if (json === appliedJson.current) return;
      appliedJson.current = json;
      setList(remote);
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
    }, () => setLoaded(true) /* offline — the cached list stands */);
  }, [userId]);

  // The last edit would otherwise die with the debounce timer when the page
  // unmounts or the app is backgrounded on the phone.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushWrite(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushWrite(); };
  }, [flushWrite]);

  const update = useCallback((updater) => {
    setList((prev) => {
      const base = prev || seedChecklist();
      const next = normalizeChecklist(typeof updater === 'function' ? updater(base) : updater);
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

  return { list, loaded, update };
}

function ReadTask({ task, phaseId, done, onToggle }) {
  const key = taskKey(phaseId, task.id);
  const checked = isDone(done, key);
  return (
    <li className={task.milestone ? styles.taskMilestone : styles.task}>
      <label className={styles.taskLabel}>
        <input type="checkbox" className={styles.checkbox} checked={checked} onChange={() => onToggle(key)} />
        <span className={styles.taskBody}>
          <span className={checked ? styles.taskTextDone : styles.taskText}>{task.text}</span>
          {task.note && <span className={styles.taskNote}>{task.note}</span>}
        </span>
      </label>
    </li>
  );
}

/* One task, open for editing.

   The fields are uncontrolled and commit on blur rather than on every
   keystroke: the stored shape trims its strings, and rewriting state per
   character would eat the space the moment you typed it. */
function EditTask({ task, first, last, onChange, onRemove, onMove }) {
  return (
    <li className={styles.editTask}>
      <div className={styles.editFields}>
        <input
          className={styles.editText}
          defaultValue={task.text}
          placeholder="What has to happen"
          aria-label="Task"
          onBlur={(e) => onChange({ text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
        />
        <input
          className={styles.editNote}
          defaultValue={task.note}
          placeholder="Note (optional)"
          aria-label="Note"
          onBlur={(e) => onChange({ note: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
        />
      </div>
      <div className={styles.editTools}>
        <label className={styles.milestoneToggle} title="Mark as a milestone">
          <input
            type="checkbox"
            checked={task.milestone}
            onChange={(e) => onChange({ milestone: e.target.checked })}
          />
          Key
        </label>
        <button type="button" className={styles.iconBtn} title="Move up" disabled={first} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className={styles.iconBtn} title="Move down" disabled={last} onClick={() => onMove(1)}>↓</button>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          title={`Delete “${task.text || 'this task'}”`}
          onClick={onRemove}
        >×</button>
      </div>
    </li>
  );
}

export function WeddingChecklist() {
  const { user } = useAuth();
  const { list, loaded, update } = useChecklist(user?.uid);
  const [hideDone, setHideDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState({});

  const safe = useMemo(() => list || normalizeChecklist(null), [list]);
  const { phases, done } = safe;
  const progress = useMemo(() => overallProgress(safe), [safe]);
  const next = useMemo(() => nextUp(safe), [safe]);

  // Editing shows everything: a collapsed or hidden phase is one you can't fix.
  const isCollapsed = (phase) => {
    if (editing) return false;
    const explicit = collapsed[phase.id];
    if (explicit !== undefined) return explicit;
    return phaseProgress(phase, done).finished;
  };

  function handleRestore() {
    if (!window.confirm('Put the original checklist back? Tasks you added are removed, and edits to the built-in ones are undone. Ticks that still match a task are kept.')) return;
    update((l) => restoreSeed(l));
    // The edit fields are uncontrolled, so unmount them rather than leave the
    // old text sitting in the DOM.
    setEditing(false);
  }

  function handleRemoveTask(phase, task) {
    if (!window.confirm(`Delete “${task.text || 'this task'}”?`)) return;
    update((l) => removeTask(l, phase.id, task.id));
  }

  function handleRemovePhase(phase) {
    const n = phase.tasks.length;
    const warning = n
      ? `Delete “${phase.title || 'this section'}” and its ${n} task${n === 1 ? '' : 's'}?`
      : `Delete “${phase.title || 'this section'}”?`;
    if (window.confirm(warning)) update((l) => removePhase(l, phase.id));
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.progressCard}>
        <div className={styles.progressTop}>
          <div>
            <div className={styles.progressCount}>{progress.complete} of {progress.total} done</div>
            {next ? (
              <div className={styles.nextUp}>Next up: <strong>{next.text}</strong></div>
            ) : (
              <div className={styles.nextUp}>
                {progress.total ? 'Everything is ticked off. Go get married.' : 'The list is empty. Add a section to start one.'}
              </div>
            )}
          </div>
          <div className={styles.progressPct}>{progress.pct}%</div>
        </div>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${progress.pct}%` }} />
        </div>
        <div className={styles.toolRow}>
          {!editing && (
            <label className={styles.hideDone}>
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              Hide what’s done
            </label>
          )}
          <div className={styles.toolSpacer} />
          {editing && (
            <button type="button" className={styles.btn} onClick={handleRestore}>Restore original list</button>
          )}
          <button
            type="button"
            className={editing ? styles.btnPrimary : styles.btn}
            onClick={() => { setEditing((e) => !e); setHideDone(false); }}
          >{editing ? 'Done editing' : 'Edit list'}</button>
        </div>
      </div>

      {editing && (
        <p className={styles.editHint}>
          Editing the wording keeps a task ticked — ticks follow the task, not the words.
          Deleting one removes its tick too.
        </p>
      )}

      {phases.map((phase, pi) => {
        const { complete, total, finished } = phaseProgress(phase, done);
        const folded = isCollapsed(phase);
        const tasks = hideDone && !editing
          ? phase.tasks.filter((t) => !isDone(done, taskKey(phase.id, t.id)))
          : phase.tasks;
        if (hideDone && !editing && tasks.length === 0) return null;

        return (
          <section key={phase.id} className={styles.phase}>
            {editing ? (
              <div className={styles.editPhaseHead}>
                <input
                  className={styles.editPhaseTitle}
                  defaultValue={phase.title}
                  placeholder="Section name"
                  aria-label="Section name"
                  onBlur={(e) => update((l) => updatePhase(l, phase.id, { title: e.target.value }))}
                />
                <input
                  className={styles.editPhaseWhen}
                  defaultValue={phase.when}
                  placeholder="Timing (optional)"
                  aria-label="Timing"
                  onBlur={(e) => update((l) => updatePhase(l, phase.id, { when: e.target.value }))}
                />
                <button
                  type="button" className={styles.iconBtn} title="Move section up"
                  disabled={pi === 0} onClick={() => update((l) => movePhase(l, phase.id, -1))}
                >↑</button>
                <button
                  type="button" className={styles.iconBtn} title="Move section down"
                  disabled={pi === phases.length - 1} onClick={() => update((l) => movePhase(l, phase.id, 1))}
                >↓</button>
                <button
                  type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  title="Delete section" onClick={() => handleRemovePhase(phase)}
                >×</button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.phaseHead}
                aria-expanded={!folded}
                onClick={() => setCollapsed((c) => ({ ...c, [phase.id]: !folded }))}
              >
                <span className={styles.caret} aria-hidden="true">{folded ? '▸' : '▾'}</span>
                <span className={styles.phaseTitle}>{phase.title}</span>
                {phase.when && <span className={styles.phaseWhen}>{phase.when}</span>}
                <span className={finished ? styles.phaseCountDone : styles.phaseCount}>{complete}/{total}</span>
              </button>
            )}

            {!folded && (
              <ul className={styles.tasks}>
                {editing
                  ? phase.tasks.map((task, ti) => (
                    <EditTask
                      key={task.id}
                      task={task}
                      first={ti === 0}
                      last={ti === phase.tasks.length - 1}
                      onChange={(patch) => update((l) => updateTask(l, phase.id, task.id, patch))}
                      onMove={(d) => update((l) => moveTask(l, phase.id, task.id, d))}
                      onRemove={() => handleRemoveTask(phase, task)}
                    />
                  ))
                  : tasks.map((task) => (
                    <ReadTask
                      key={task.id}
                      task={task}
                      phaseId={phase.id}
                      done={done}
                      onToggle={(key) => update((l) => toggleTask(l, key))}
                    />
                  ))}
                {editing && (
                  <li>
                    <button
                      type="button"
                      className={styles.addRow}
                      onClick={() => update((l) => addTask(l, phase.id, { text: '' }))}
                    >+ Add task</button>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}

      {editing && (
        <button
          type="button"
          className={styles.addPhase}
          onClick={() => update((l) => addPhase(l, { title: 'New section' }))}
        >+ Add section</button>
      )}

      {!loaded && !list && <p className={styles.footnote}>Loading…</p>}
      {!editing && phases.length > 0 && (
        <p className={styles.footnote}>
          {totalTasks(phases)} tasks. Ticks are saved as you go and sync to your phone.
        </p>
      )}
    </div>
  );
}

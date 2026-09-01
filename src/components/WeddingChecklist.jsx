import { useState, useEffect, useMemo, useRef } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  PHASES, TOTAL_TASKS, taskKey, normalizeDone, toggleTask, isDone,
  phaseProgress, overallProgress, nextUp,
} from '../lib/weddingChecklist';
import styles from './WeddingChecklist.module.css';

/* The planning timeline, ticked off.

   Sits beside the guest list on the Wedding tab and shares its storage: the
   ticked set is one field on the owner's user document, next to
   `weddingContacts`. Ticks are discrete and idempotent, so unlike the lists
   that debounce a whole document, each one writes as it happens — the worst
   case for a lost write here is a single box, and going offline mid-tick
   leaves the box where Firestore's own local cache says it is. */
const CACHE_KEY = 'rally.weddingChecklist.v1';

function useChecklist(userId) {
  const [done, setDone] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizeDone(JSON.parse(raw));
    } catch { /* ignore a corrupt cache */ }
    return {};
  });
  const doneRef = useRef(done);
  useEffect(() => { doneRef.current = done; }, [done]);

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(doc(db, 'users', userId), (snap) => {
      if (snap.metadata.hasPendingWrites) return; // our own tick echoing back
      const remote = normalizeDone(snap.exists() ? snap.data()?.weddingChecklist?.done : null);
      setDone(remote);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(remote)); } catch { /* ignore */ }
    }, () => { /* offline — the cached ticks stand */ });
  }, [userId]);

  function toggle(key) {
    const next = toggleTask(doneRef.current, key);
    setDone(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    if (userId) {
      setDoc(doc(db, 'users', userId), { weddingChecklist: { done: next } }, { merge: true })
        .catch(() => {}); // offline: the local copy still holds the tick
    }
  }

  return { done, toggle };
}

function Task({ task, phaseId, done, onToggle }) {
  const key = taskKey(phaseId, task.id);
  const checked = isDone(done, key);
  return (
    <li className={task.milestone ? styles.taskMilestone : styles.task}>
      <label className={styles.taskLabel}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          onChange={() => onToggle(key)}
        />
        <span className={styles.taskBody}>
          <span className={checked ? styles.taskTextDone : styles.taskText}>{task.text}</span>
          {task.note && <span className={styles.taskNote}>{task.note}</span>}
        </span>
      </label>
    </li>
  );
}

export function WeddingChecklist() {
  const { user } = useAuth();
  const { done, toggle } = useChecklist(user?.uid);
  const [hideDone, setHideDone] = useState(false);
  // Phases the reader has collapsed. Finished ones fold themselves the first
  // time they're seen; anything explicitly opened stays open.
  const [collapsed, setCollapsed] = useState({});

  const progress = useMemo(() => overallProgress(done), [done]);
  const next = useMemo(() => nextUp(done), [done]);

  const isCollapsed = (phase) => {
    const explicit = collapsed[phase.id];
    if (explicit !== undefined) return explicit;
    return phaseProgress(phase, done).finished;
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.progressCard}>
        <div className={styles.progressTop}>
          <div>
            <div className={styles.progressCount}>
              {progress.complete} of {progress.total} done
            </div>
            {next ? (
              <div className={styles.nextUp}>
                Next up: <strong>{next.text}</strong>
              </div>
            ) : (
              <div className={styles.nextUp}>Everything is ticked off. Go get married.</div>
            )}
          </div>
          <div className={styles.progressPct}>{progress.pct}%</div>
        </div>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${progress.pct}%` }} />
        </div>
        <label className={styles.hideDone}>
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide what’s done
        </label>
      </div>

      {PHASES.map((phase) => {
        const { complete, total, finished } = phaseProgress(phase, done);
        const folded = isCollapsed(phase);
        const tasks = hideDone
          ? phase.tasks.filter((t) => !isDone(done, taskKey(phase.id, t.id)))
          : phase.tasks;
        // With "hide what's done" on, a finished phase has nothing left to show.
        if (hideDone && tasks.length === 0) return null;

        return (
          <section key={phase.id} className={styles.phase}>
            <button
              type="button"
              className={styles.phaseHead}
              aria-expanded={!folded}
              onClick={() => setCollapsed((c) => ({ ...c, [phase.id]: !folded }))}
            >
              <span className={styles.caret} aria-hidden="true">{folded ? '▸' : '▾'}</span>
              <span className={styles.phaseTitle}>{phase.title}</span>
              {phase.when && <span className={styles.phaseWhen}>{phase.when}</span>}
              <span className={finished ? styles.phaseCountDone : styles.phaseCount}>
                {complete}/{total}
              </span>
            </button>
            {!folded && (
              <ul className={styles.tasks}>
                {tasks.map((task) => (
                  <Task
                    key={task.id}
                    task={task}
                    phaseId={phase.id}
                    done={done}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className={styles.footnote}>
        {TOTAL_TASKS} tasks. Ticks are saved as you go and sync to your phone.
      </p>
    </div>
  );
}

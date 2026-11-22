import { useEffect, useRef, useState } from 'react';
import { QUESTIONS, OUTCOMES, walk, progress, isOutcome } from '../lib/inviteDecision';
import styles from './WeddingInviteDecision.module.css';

/* Invite Decision — the Guest List's "should we invite them?" tree.

   One question at a time, YES or NO, until it lands on Invite, Don't invite
   or Discuss. The whole state is the list of answers given so far: Back drops
   the last one, a step in the trail rewinds to it, Start over empties it.

   It is advice only. Nothing here reads or writes a guest, so it can't add
   anyone to the list or take anyone off it. */

const OUTCOME_ICON = {
  invite: (
    <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="19" cy="26" r="11" /><circle cx="29" cy="26" r="11" /><path d="M24 9l3 4h-6z" /></svg>
  ),
  skip: (
    <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="14" width="30" height="21" rx="2" /><path d="M9 16l15 11 15-11" /><path d="M31 6l10 10M41 6L31 16" /></svg>
  ),
  discuss: (
    <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 11h22a3 3 0 013 3v10a3 3 0 01-3 3H16l-6 5v-5H7a3 3 0 01-3-3V14a3 3 0 013-3z" /><path d="M36 19h5a3 3 0 013 3v9a3 3 0 01-3 3h-2v5l-6-5h-9a3 3 0 01-3-3v-1" /></svg>
  ),
};

// A sprig of leaves either side of a small heart — the divider under the title.
function Flourish() {
  return (
    <svg className={styles.flourish} viewBox="0 0 220 24" aria-hidden="true">
      <path d="M4 12h76M140 12h76" />
      <path d="M80 12c-6-7-14-7-18-3 5 3 12 4 18 3zM80 12c-6 7-14 7-18 3 5-3 12-4 18-3z" />
      <path d="M140 12c6-7 14-7 18-3-5 3-12 4-18 3zM140 12c6 7 14 7 18 3-5-3-12-4-18-3z" />
      <path className={styles.flourishHeart} d="M110 18c-6-4-10-7-10-11a4.5 4.5 0 0110-1 4.5 4.5 0 0110 1c0 4-4 7-10 11z" />
    </svg>
  );
}

// The two branches of the tree, as a small map below the question with the
// path you are on picked out.
const MAP = [
  { label: 'If yes', ids: ['q2', 'q3'] },
  { label: 'If no', ids: ['q4', 'q5'] },
];
const SHORT = {
  q1: 'Want them celebrating with us?',
  q2: 'Meaningful part of the past year?',
  q3: 'History or relationship to keep?',
  q4: 'Mainly out of obligation?',
  q5: 'Would we miss them?',
};
const LEADS = { invite: 'Invite', skip: "Don't invite", discuss: 'Discuss' };

export function WeddingInviteDecision() {
  const [answers, setAnswers] = useState([]);
  // Which way the last move went, so the card slides in from the right side.
  const [dir, setDir] = useState('forward');
  const headingRef = useRef(null);

  const { node, steps } = walk(answers);
  const done = isOutcome(node);
  const pct = Math.round(progress(answers) * 100);
  const visited = new Set(steps.map((s) => s.id));

  // Each move works on the answers as they stand (an answer after an outcome
  // is dropped), so the keyboard handler below can use them without a stale
  // copy of the state.
  const answer = (yes) => {
    setDir('forward');
    setAnswers((a) => (isOutcome(walk(a).node) ? a : [...a, yes]));
  };
  const rewindTo = (i) => {
    setDir('back');
    setAnswers((a) => a.slice(0, i));
  };
  const back = () => {
    setDir('back');
    setAnswers((a) => a.slice(0, -1));
  };
  const restart = () => rewindTo(0);

  // Y and N answer, Backspace goes back — unless you're typing somewhere.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k !== 'y' && k !== 'n' && k !== 'backspace') return;
      if (k === 'backspace') e.preventDefault();
      setDir(k === 'backspace' ? 'back' : 'forward');
      setAnswers((a) => {
        if (k === 'backspace') return a.slice(0, -1);
        return isOutcome(walk(a).node) ? a : [...a, k === 'y'];
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep focus with the card as it changes, so a screen reader hears the new
  // question and the keyboard stays where the buttons are.
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) headingRef.current?.focus({ preventScroll: true });
    moved.current = true;
  }, [answers.length]);

  const outcome = done ? OUTCOMES[node] : null;

  return (
    <section className={styles.wrap} aria-labelledby="invite-decision-title">
      <div className={styles.card}>
        <span className={`${styles.corner} ${styles.cornerTL}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.cornerBR}`} aria-hidden="true" />

        <header className={styles.intro}>
          <p className={styles.eyebrow}>The guest list, one name at a time</p>
          <h2 id="invite-decision-title" className={styles.heading}>Should we invite them?</h2>
          <Flourish />
          <p className={styles.lede}>Picture one person and answer honestly. A few yes-or-no questions will point you toward an answer.</p>
        </header>

        <div className={styles.progress}>
          <div className={styles.progressMeta}>
            <span>{done ? 'Your answer' : `Question ${steps.length + 1}`}</span>
            <span>{pct}%</span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Progress through the questions"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {steps.length > 0 && (
          <ol className={styles.trail} aria-label="Your answers so far">
            {steps.map((s, i) => (
              <li key={s.id} className={styles.trailItem}>
                <button
                  type="button"
                  className={styles.trailBtn}
                  onClick={() => rewindTo(i)}
                  title={`Change your answer: ${QUESTIONS[s.id].text}`}
                  aria-label={`Question ${i + 1}, answered ${s.yes ? 'yes' : 'no'}. Change this answer.`}
                >
                  <span className={styles.trailNum}>{i + 1}</span>
                  <span className={styles.trailText}>{SHORT[s.id]}</span>
                  <span className={s.yes ? styles.trailYes : styles.trailNo}>{s.yes ? 'Yes' : 'No'}</span>
                </button>
                <span className={styles.trailArrow} aria-hidden="true">↓</span>
              </li>
            ))}
          </ol>
        )}

        <div
          key={`${node}-${answers.length}`}
          className={`${styles.stage} ${dir === 'back' ? styles.stageBack : styles.stageForward}`}
          aria-live="polite"
        >
          {!done ? (
            <div className={styles.question}>
              <p className={styles.qNumber}>Question {steps.length + 1}</p>
              <h3 ref={headingRef} tabIndex={-1} className={styles.qText}>{QUESTIONS[node].text}</h3>
              <div className={styles.choices}>
                <button type="button" className={`${styles.choice} ${styles.choiceYes}`} onClick={() => answer(true)}>
                  <span className={styles.choiceMark} aria-hidden="true">✓</span>
                  Yes
                </button>
                <button type="button" className={`${styles.choice} ${styles.choiceNo}`} onClick={() => answer(false)}>
                  <span className={styles.choiceMark} aria-hidden="true">✕</span>
                  No
                </button>
              </div>
              <p className={styles.keyHint}>Press <kbd>Y</kbd> or <kbd>N</kbd></p>
            </div>
          ) : (
            <div className={`${styles.outcome} ${styles[`outcome_${node}`]}`} data-outcome={node}>
              <div className={styles.outcomeIcon}>{OUTCOME_ICON[node]}</div>
              <h3 ref={headingRef} tabIndex={-1} className={styles.outcomeTitle}>{outcome.title}</h3>
              <p className={styles.outcomeMessage}>{outcome.message}</p>
              <button type="button" className={styles.primary} onClick={restart}>Start again with someone new</button>
            </div>
          )}
        </div>

        <div className={styles.controls}>
          <button type="button" className={styles.ghost} onClick={back} disabled={!answers.length}>← Back</button>
          <button type="button" className={styles.ghost} onClick={restart} disabled={!answers.length}>Start over</button>
        </div>
      </div>

      <div className={styles.map} aria-label="The whole decision tree">
        <p className={styles.mapTitle}>The whole tree</p>
        <div className={`${styles.mapNode} ${styles.mapRoot} ${node === 'q1' ? styles.mapCurrent : visited.has('q1') ? styles.mapVisited : ''}`}>
          <span className={styles.mapDot} aria-hidden="true" />{SHORT.q1}
        </div>
        <div className={styles.mapBranches}>
          {MAP.map((branch) => (
            <div key={branch.label} className={styles.mapBranch}>
              <p className={styles.mapBranchLabel}>{branch.label}</p>
              {branch.ids.map((id) => {
                const q = QUESTIONS[id];
                const ends = [q.yes, q.no].map((n, i) => (isOutcome(n) ? { n, yes: i === 0 } : null)).filter(Boolean);
                const state = node === id ? styles.mapCurrent : visited.has(id) ? styles.mapVisited : '';
                return (
                  <div key={id} className={`${styles.mapNode} ${state}`}>
                    <span className={styles.mapDot} aria-hidden="true" />{SHORT[id]}
                    <span className={styles.mapEnds}>
                      {ends.map((e) => {
                        const reached = node === e.n && steps.at(-1)?.id === id && steps.at(-1)?.yes === e.yes;
                        return (
                          <span key={e.n + e.yes} className={`${styles.mapEnd} ${reached ? styles.mapEndOn : ''}`}>
                            {e.yes ? 'Yes' : 'No'} → {LEADS[e.n]}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className={styles.footnote}>Just a guide — nothing here changes your guest list.</p>
    </section>
  );
}

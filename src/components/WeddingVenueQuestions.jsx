import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { deleteField, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { normalizeVenue } from '../lib/weddingVenues';
import {
  QUESTIONS_FIELD, CUSTOM_CATEGORY, normalizeQuestionState, questionGroups, categoryOptions,
  answerFor, setAnswer, answerWrite, venueProgress, groupProgress,
  addQuestion, updateQuestion, removeQuestion, resetQuestion, isBuiltIn, pickerGroups, pickVenueId,
} from '../lib/weddingVenueQuestions';
import page from './WeddingPage.module.css';
import styles from './WeddingVenueQuestions.module.css';

// The venue last open here, so the tab comes back to it on this device.
const LAST_VENUE_KEY = 'rally.weddingQuestions.venue';
const readLastVenue = () => { try { return localStorage.getItem(LAST_VENUE_KEY) || ''; } catch { return ''; } };

/* The answer to one question. Typing stays local and saves itself a moment
   after you stop, when you leave the box, and when the phone puts the page
   in the background — so nothing typed mid-tour waits on a Save button. */
function NotesField({ saved, label, onSave, onFocusChange }) {
  const [val, setVal] = useState(saved);
  const [focused, setFocused] = useState(false);
  // An answer saved from the other phone shows up, unless you're typing here.
  const [seen, setSeen] = useState(saved);
  if (seen !== saved && !focused) {
    setSeen(saved);
    setVal(saved);
  }
  const timer = useRef(null);
  const latest = useRef({ val, saved, onSave });
  useEffect(() => { latest.current = { val, saved, onSave }; });

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = null;
    const cur = latest.current;
    if (cur.val.trim() !== cur.saved) cur.onSave(cur.val);
  };
  // Leaving this venue (or the tab) mid-word still saves it.
  useEffect(() => () => { if (timer.current) flush(); }, []);
  useEffect(() => {
    if (!focused) return undefined;
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [focused]);

  return (
    <textarea
      className={styles.notes}
      rows={1}
      maxLength={1000}
      value={val}
      placeholder="Their answer…"
      aria-label={label}
      onChange={(e) => {
        const next = e.target.value;
        setVal(next);
        latest.current = { ...latest.current, val: next };
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, 700);
      }}
      onFocus={() => { setFocused(true); onFocusChange(true); }}
      onBlur={() => { setFocused(false); onFocusChange(false); flush(); }}
    />
  );
}

/* A question open for rewording or refiling. A built-in one that has been
   edited can be put back to how it came. */
function QuestionEditor({ question, category, onSave, onCancel, onReset }) {
  const [text, setText] = useState(question.text);
  const [cat, setCat] = useState(category);
  const save = () => { if (text.trim()) onSave({ text, category: cat }); };
  return (
    <div className={styles.editor}>
      <input
        className={page.contactInput}
        value={text}
        maxLength={300}
        autoFocus
        aria-label="Question"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') onCancel(); }}
      />
      <div className={styles.editorRow}>
        <select className={`${page.contactInput} ${styles.categorySelect}`} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          {categoryOptions().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" className={page.modalPrimary} onClick={save} disabled={!text.trim()}>Save</button>
        <button type="button" className={page.modalSecondary} onClick={onCancel}>Cancel</button>
        {onReset && <button type="button" className={page.modalSecondary} onClick={onReset}>Restore original</button>}
      </div>
    </div>
  );
}

/* Wedding → Questions: the things to ask on a venue tour, answered venue by
   venue. The venues come from the Venues tab; the answers and your own
   questions are saved beside them on the user doc (lib/weddingVenueQuestions.js). */
export function WeddingVenueQuestions({ onOpenVenues }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [venues, setVenues] = useState([]);
  const [state, setState] = useState(() => normalizeQuestionState(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hideAnswered, setHideAnswered] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // The question being answered: "Hide answered" leaves it up while you type.
  const [typingId, setTypingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [draftCategory, setDraftCategory] = useState(CUSTOM_CATEGORY);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() || {};
      setVenues(Array.isArray(data.weddingVenues) ? data.weddingVenues.map((v) => normalizeVenue(v)) : []);
      setState(normalizeQuestionState(data[QUESTIONS_FIELD]));
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  // The latest state for a save that fires after a wait (a notes box's timer).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const write = (next, patch) => {
    stateRef.current = next;
    setState(next);
    if (!user) return;
    setDoc(doc(db, 'users', user.uid), patch, { merge: true })
      .then(() => setError(''))
      .catch((err) => setError(`Could not save: ${err.message}`));
  };

  const groups = useMemo(() => questionGroups(state), [state]);
  const picker = useMemo(() => pickerGroups(venues, state), [venues, state]);
  const venueId = pickVenueId(picker, searchParams.get('venue') || readLastVenue());
  const venue = venues.find((v) => v.id === venueId) || null;
  const progress = venueProgress(state, venueId);

  const pickVenue = (id) => {
    try { localStorage.setItem(LAST_VENUE_KEY, id); } catch { /* private mode: the URL still has it */ }
    setSearchParams({ view: 'questions', venue: id }, { replace: true });
  };

  const saveAnswer = (forVenue, questionId, patch) => {
    const { state: next, answer } = setAnswer(stateRef.current, forVenue, questionId, patch);
    write(next, answerWrite(forVenue, questionId, answer));
  };

  const saveCustom = (next, extra = {}) => write(next, { [QUESTIONS_FIELD]: { custom: next.custom, ...extra } });
  const add = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    saveCustom(addQuestion(stateRef.current, draft, draftCategory));
    setDraft('');
  };
  // A built-in question's edit is written as its own leaf (or removed, when
  // it reads as it shipped again); one of yours goes with the custom list.
  const saveQuestion = (id, next) => {
    if (!isBuiltIn(id)) { saveCustom(next); return; }
    write(next, { [QUESTIONS_FIELD]: { edits: { [id]: next.edits[id] || deleteField() } } });
  };
  const remove = (q) => {
    if (!confirm(`Delete “${q.text}”? Its answers for every venue go too.`)) return;
    const { state: next, venueIds } = removeQuestion(stateRef.current, q.id);
    const answers = Object.fromEntries(venueIds.map((id) => [id, { [q.id]: deleteField() }]));
    saveCustom(next, venueIds.length ? { answers } : {});
  };

  if (loading) return <p className={page.muted}>Loading…</p>;

  return (
    <div className={styles.wrap}>
      {error && <p className={page.digestErrMsg} role="status">{error}</p>}

      {picker.length === 0 ? (
        <div className={styles.card}>
          <p className={styles.emptyText}>Answers are kept per venue, and there are no venues yet.</p>
          <button type="button" className={page.modalPrimary} onClick={onOpenVenues}>Add a venue on the Venues tab</button>
        </div>
      ) : (
        <div className={`${styles.card} ${styles.sticky}`}>
          <label className={styles.pickerLabel} htmlFor="question-venue">Venue</label>
          <select id="question-venue" className={`${page.contactInput} ${styles.picker}`} value={venueId} onChange={(e) => pickVenue(e.target.value)}>
            {picker.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.venues.map((v) => {
                  const p = venueProgress(state, v.id);
                  return <option key={v.id} value={v.id}>{v.name}{p.answered ? ` (${p.answered}/${p.total})` : ''}</option>;
                })}
              </optgroup>
            ))}
          </select>
          <div className={styles.progressRow}>
            <span className={styles.progressCount} data-testid="question-progress">{progress.answered} of {progress.total} answered</span>
            <label className={styles.hideAnswered}>
              <input type="checkbox" checked={hideAnswered} onChange={(e) => setHideAnswered(e.target.checked)} />
              Hide answered
            </label>
          </div>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.answered} aria-label={`Questions answered for ${venue?.name || 'this venue'}`}>
            <div className={styles.barFill} style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      {groups.map((group) => {
        const { answered, total } = groupProgress(state, venueId, group);
        const questions = hideAnswered && venueId ? group.questions.filter((q) => !answerFor(state, venueId, q.id).done || q.id === editingId || q.id === typingId) : group.questions;
        if (!questions.length) return null;
        return (
          <section key={group.id} className={styles.group}>
            <h2 className={styles.groupHead}>
              <span>{group.name}</span>
              {venueId && <span className={answered === total ? styles.groupCountDone : styles.groupCount}>{answered}/{total}</span>}
            </h2>
            <ul className={styles.list}>
              {questions.map((q) => {
                const a = answerFor(state, venueId, q.id);
                if (q.id === editingId) {
                  return (
                    <li key={q.id} className={styles.item}>
                      <QuestionEditor
                        question={q}
                        category={group.id}
                        onCancel={() => setEditingId(null)}
                        onSave={(patch) => { saveQuestion(q.id, updateQuestion(stateRef.current, q.id, patch)); setEditingId(null); }}
                        onReset={q.edited ? () => { saveQuestion(q.id, resetQuestion(stateRef.current, q.id)); setEditingId(null); } : undefined}
                      />
                    </li>
                  );
                }
                return (
                  <li key={q.id} className={styles.item}>
                    <div className={styles.row}>
                      <label className={styles.label}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={a.done}
                          disabled={!venueId}
                          onChange={(e) => saveAnswer(venueId, q.id, { done: e.target.checked })}
                        />
                        <span className={a.done ? styles.textDone : styles.text}>{q.text}</span>
                      </label>
                      <span className={styles.tools}>
                        <button type="button" className={styles.iconBtn} onClick={() => setEditingId(q.id)} title="Edit question" aria-label={`Edit “${q.text}”`}>✎</button>
                        {q.custom && <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => remove(q)} title="Delete question" aria-label={`Delete “${q.text}”`}>×</button>}
                      </span>
                    </div>
                    {venueId && (
                      <NotesField
                        key={venueId}
                        saved={a.notes}
                        label={`Answer to “${q.text}” for ${venue?.name || 'this venue'}`}
                        onSave={(notes) => saveAnswer(venueId, q.id, { notes })}
                        onFocusChange={(on) => setTypingId((cur) => (on ? q.id : cur === q.id ? null : cur))}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <form className={styles.addForm} onSubmit={add}>
        <label className={styles.addLabel} htmlFor="question-new">Add your own question</label>
        <input
          id="question-new"
          className={page.contactInput}
          value={draft}
          maxLength={300}
          placeholder="e.g. Can we bring the dog?"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className={styles.editorRow}>
          <select className={`${page.contactInput} ${styles.categorySelect}`} value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} aria-label="Category for the new question">
            {categoryOptions().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit" className={page.modalPrimary} disabled={!draft.trim()}>Add question</button>
        </div>
        <p className={styles.addHint}>Your questions are asked at every venue. Any question can be reworded with ✎.</p>
      </form>
    </div>
  );
}

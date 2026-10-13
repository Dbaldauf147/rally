import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { OWNER_EMAIL } from '../lib/pagePrivacy';
import {
  PRO, CON, SCALE, ratingLabel, normalizeProsCons, addDecision, updateDecision, removeDecision,
  addItem, updateItem, removeItem, tally, makeId,
} from '../lib/prosCons';
import styles from './ProsConsPage.module.css';

/* Pros and cons for the decisions you're weighing.

   Owner-only, and stored like the Joanne list: on the owner's own
   `users/{uid}` document, which the Firestore rules let nobody else read. */

const CACHE_KEY = 'rally.prosCons.doc.v1';
const OPEN_KEY = 'rally.prosCons.open';

/* The saved decisions, kept in step with Firestore — the same hook shape as
   the Joanne page: subscribe so an edit on the phone lands on the laptop,
   cache locally so the page renders offline, and hold an unacknowledged local
   edit rather than letting the older server copy snap back over it. */
function useProsCons(userId) {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizeProsCons(JSON.parse(raw));
    } catch { /* a corrupt cache just means empty until the snapshot */ }
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
    setDoc(doc(db, 'users', userId), { prosCons: next }, { merge: true })
      .catch(() => {}) // offline: the local cache still holds the edit
      .then(() => { syncedEdits.current = Math.max(syncedEdits.current, version); });
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    return onSnapshot(doc(db, 'users', userId), (snap) => {
      setLoaded(true);
      if (snap.metadata.hasPendingWrites) return; // our own write echoing back
      if (localEdits.current !== syncedEdits.current) return; // an unsent edit wins
      const normalized = normalizeProsCons(snap.exists() ? snap.data()?.prosCons : null);
      const json = JSON.stringify(normalized);
      if (json === appliedJson.current) return;
      appliedJson.current = json;
      setData(normalized);
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
    }, () => setLoaded(true) /* offline — keep the cached copy */);
  }, [userId]);

  // The last edit would otherwise die with the debounce timer when the page
  // unmounts or the app is backgrounded on the phone.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushWrite(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushWrite(); };
  }, [flushWrite]);

  const update = useCallback((updater) => {
    setData((prev) => {
      const base = prev || normalizeProsCons(null);
      const next = normalizeProsCons(updater(base));
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

  return { data, loaded, update };
}

/* Text that reads as text until you reach for it. Uncontrolled and committed
   on blur, like the Joanne page's fields: the stored shape trims, so writing
   per keystroke would eat the space the moment you typed it. The caller keys
   it on the stored value so an edit from another device replaces it. */
function Field({ label, value, onCommit, placeholder, className, long = false }) {
  const commit = (e) => { if (e.target.value.trim() !== String(value || '')) onCommit(e.target.value); };
  const fit = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } };
  const common = {
    className: className ? `${styles.field} ${className}` : styles.field,
    defaultValue: value || '',
    placeholder,
    'aria-label': label,
    onBlur: commit,
  };
  if (long) return <textarea rows={1} ref={fit} onInput={(e) => fit(e.target)} {...common} />;
  return <input type="text" {...common} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }} />;
}

// How much one pro or con moves things, as three steps on its own side of the
// scale. Tapping the step you're on clears it.
function Rating({ item, onRate }) {
  const name = item.text || (item.side === PRO ? 'this pro' : 'this con');
  return (
    <div className={styles.rating}>
      <div className={styles.steps} role="group" aria-label={`How much ${name} matters`}>
        {SCALE[item.side].map((s) => {
          const on = item.rating === s.value;
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={on}
              title={s.label}
              className={`${styles.step} ${on ? styles[`on${Math.abs(s.value)}${item.side}`] : ''}`}
              onClick={() => onRate(on ? null : s.value)}
            >{s.short}</button>
          );
        })}
      </div>
      <div className={item.rating == null ? styles.ratingWordMuted : styles.ratingWord}>
        {item.rating == null ? 'How much does it matter?' : ratingLabel(item.rating)}
      </div>
    </div>
  );
}

function Item({ item, decisionId, update }) {
  const name = item.text || (item.side === PRO ? 'this pro' : 'this con');
  return (
    <li className={`${styles.item} ${item.rating === -3 ? styles.itemDealbreaker : ''}`}>
      <div className={styles.itemTop}>
        <Field
          key={`${item.id}:${item.text}`}
          label={`Wording of ${name}`}
          className={styles.itemText}
          value={item.text}
          placeholder={item.side === PRO ? 'A reason for' : 'A reason against'}
          onCommit={(t) => update((d) => updateItem(d, decisionId, item.id, { text: t }))}
          long
        />
        <button
          type="button"
          className={styles.delete}
          aria-label={`Delete ${name}`}
          title={`Delete ${name}`}
          onClick={() => update((d) => removeItem(d, decisionId, item.id))}
        >×</button>
      </div>
      <Rating item={item} onRate={(r) => update((d) => updateItem(d, decisionId, item.id, { rating: r }))} />
    </li>
  );
}

function Column({ side, decision, update }) {
  const [draft, setDraft] = useState('');
  const items = decision.items.filter((it) => it.side === side);
  const isPro = side === PRO;
  function add(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    update((d) => addItem(d, decision.id, { id: makeId(), side, text: draft }));
    setDraft('');
  }
  return (
    <section className={`${styles.column} ${isPro ? styles.columnPro : styles.columnCon}`} aria-label={isPro ? 'Pros' : 'Cons'}>
      <h2 className={styles.columnTitle}>
        {isPro ? 'Pros' : 'Cons'} <span className={styles.columnCount}>{items.length}</span>
      </h2>
      <form className={styles.addRow} onSubmit={add}>
        <input
          className={styles.addInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isPro ? 'Add a pro…' : 'Add a con…'}
          aria-label={isPro ? 'Add a pro' : 'Add a con'}
        />
        <button type="submit" className={styles.btnPrimary} disabled={!draft.trim()}>Add</button>
      </form>
      {items.length > 0 ? (
        <ul className={styles.items}>
          {items.map((it) => <Item key={it.id} item={it} decisionId={decision.id} update={update} />)}
        </ul>
      ) : (
        <p className={styles.columnEmpty}>{isPro ? 'No pros yet.' : 'No cons yet.'}</p>
      )}
    </section>
  );
}

// The two sides' weight as one bar, so five little pros against one big con
// looks like what it is.
function Balance({ t }) {
  const total = t.pro + t.con;
  const proPct = total ? (t.pro / total) * 100 : 50;
  const tone = t.dealbreakers ? styles.verdictBad : t.net > 0 ? styles.verdictGood : t.net < 0 ? styles.verdictBad : styles.verdictEven;
  return (
    <div className={styles.balance}>
      <div className={styles.balanceHead}>
        <span className={`${styles.verdict} ${tone}`}>{t.verdict}</span>
        {total > 0 && (
          <span className={styles.net}>
            Net {t.net > 0 ? '+' : ''}{t.net}
          </span>
        )}
      </div>
      {total > 0 && (
        <>
          <div className={styles.bar} role="img" aria-label={`Pros weigh ${t.pro}, cons weigh ${t.con}`}>
            <div className={styles.barPro} style={{ width: `${proPct}%` }} />
            <div className={styles.barCon} style={{ width: `${100 - proPct}%` }} />
          </div>
          <div className={styles.barLegend}>
            <span>Pros weigh {t.pro}</span>
            <span>Cons weigh {t.con}</span>
          </div>
        </>
      )}
      {t.unrated > 0 && (
        <div className={styles.unrated}>{t.unrated} not rated yet — they don’t count until they are.</div>
      )}
    </div>
  );
}

function Decision({ decision, update }) {
  const t = tally(decision);
  const title = decision.title || 'Untitled decision';
  return (
    <div className={styles.decision}>
      <div className={styles.decisionHead}>
        <Field
          key={`${decision.id}:title:${decision.title}`}
          label="What you're deciding"
          className={styles.decisionTitle}
          value={decision.title}
          placeholder="What are you deciding?"
          onCommit={(v) => update((d) => updateDecision(d, decision.id, { title: v }))}
        />
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            if (window.confirm(`Delete “${title}” and its ${t.pros + t.cons} pros and cons? This cannot be undone.`)) {
              update((d) => removeDecision(d, decision.id));
            }
          }}
        >Delete</button>
      </div>
      <Field
        key={`${decision.id}:notes:${decision.notes}`}
        label="Notes"
        className={styles.notes}
        value={decision.notes}
        placeholder="Notes — what's driving this, when it needs deciding…"
        onCommit={(v) => update((d) => updateDecision(d, decision.id, { notes: v }))}
        long
      />
      <Balance t={t} />
      <div className={styles.columns}>
        <Column side={PRO} decision={decision} update={update} />
        <Column side={CON} decision={decision} update={update} />
      </div>
    </div>
  );
}

export function ProsConsPage() {
  const { user } = useAuth();
  const { data, loaded, update } = useProsCons(user?.uid);
  const decisions = useMemo(() => (data || normalizeProsCons(null)).decisions, [data]);
  const [openId, setOpenId] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) || null; } catch { return null; }
  });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    try { if (openId) localStorage.setItem(OPEN_KEY, openId); } catch { /* ignore */ }
  }, [openId]);

  // The one you last had open, else the newest.
  const open = decisions.find((d) => d.id === openId) || decisions[0] || null;

  function handleNew(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    const id = makeId();
    update((d) => addDecision(d, { id, title: draft }));
    setOpenId(id);
    setDraft('');
  }

  if (user && user.email !== OWNER_EMAIL) return <Navigate to="/" replace />;
  if (!user) return null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Pros &amp; Cons</h1>
      <p className={styles.subtitle}>
        List the reasons for and against, and say how much each one matters. Only you can see this page.
      </p>

      <form className={styles.newRow} onSubmit={handleNew}>
        <input
          className={styles.addInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Something to decide — “Move to Denver?”"
          aria-label="New decision"
        />
        <button type="submit" className={styles.btnPrimary} disabled={!draft.trim()}>New decision</button>
      </form>

      {decisions.length > 0 && (
        <div className={styles.tabs} role="tablist" aria-label="Decisions">
          {decisions.map((d) => {
            const t = tally(d);
            const on = open?.id === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={on ? styles.tabOn : styles.tab}
                onClick={() => setOpenId(d.id)}
              >
                {d.title || 'Untitled'}
                {(t.pro + t.con) > 0 && (
                  <span className={`${styles.tabNet} ${t.dealbreakers ? styles.tabNetBad : t.net > 0 ? styles.tabNetGood : t.net < 0 ? styles.tabNetBad : ''}`}>
                    {t.dealbreakers ? '!' : `${t.net > 0 ? '+' : ''}${t.net}`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loaded && decisions.length === 0 && <div className={styles.empty}>Loading…</div>}
      {loaded && decisions.length === 0 && (
        <div className={styles.empty}>Nothing to decide yet. Start with the question above.</div>
      )}

      {open && <Decision key={open.id} decision={open} update={update} />}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  MAX_DRAFTS, REPLY_FIELDS, buildTemplate, fillTemplate, newDraftId, normalizeReplySettings, outreachSubject, readsAsReply, replySettingsFor,
  replySettingsToSave,
} from '../lib/weddingVenueReply';
import { normalizeVenue } from '../lib/weddingVenues';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* Wedding → Venues → Reply email: the facts a venue needs to quote, and the
   emails written from them — the first outreach, and any others added as
   drafts of their own, each on its own subtab. Written here once and used
   for every venue (the ✉ on each row of the venue table fills one in).
   Saves as you type. */
export function WeddingVenueReply({ subnav } = {}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(() => normalizeReplySettings(null).details);
  const [drafts, setDrafts] = useState(() => normalizeReplySettings(null).drafts);
  const [activeId, setActiveId] = useState('');
  const [venues, setVenues] = useState([]);
  const [previewId, setPreviewId] = useState('');
  const [saveState, setSaveState] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() || {};
      setVenues(Array.isArray(data.weddingVenues) ? data.weddingVenues.map((v) => normalizeVenue(v)) : []);
      // Only the first load fills the form: later snapshots are this page's
      // own saves, and replacing the form with them would fight the typing.
      if (!loaded.current) {
        loaded.current = true;
        const s = replySettingsFor(data);
        setDetails(s.details);
        setDrafts(s.drafts);
      }
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  // Saves a moment after the last keystroke.
  const timer = useRef(null);
  const save = (nextDetails, nextDrafts) => {
    clearTimeout(timer.current);
    setSaveState('…');
    timer.current = setTimeout(() => {
      if (!user) return;
      setDoc(doc(db, 'users', user.uid), { weddingVenueReply: replySettingsToSave(nextDetails, nextDrafts) }, { merge: true })
        .then(() => setSaveState('Saved'))
        .catch((err) => setSaveState(`Could not save: ${err.message}`));
    }, 600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const setDetail = (key, value) => {
    const next = { ...details, [key]: value };
    setDetails(next);
    save(next, drafts);
  };

  // The draft whose subtab is open.
  const active = drafts.find((d) => d.id === activeId) || drafts[0];
  const template = active.template;
  const isFirst = active.id === drafts[0].id;
  const setDraftList = (next) => { setDrafts(next); save(details, next); };
  const setActive = (patch) => setDraftList(drafts.map((d) => (d.id === active.id ? { ...d, ...patch } : d)));
  const shownTemplate = template || buildTemplate(details);
  const setTemplateText = (value) => setActive({ template: value });
  const resetTemplate = () => {
    if (template && !confirm('Replace your edited email with one rebuilt from the details?')) return;
    setActive({ template: '' });
  };
  // A new draft starts as a copy of the one on screen, to reword from there.
  const addDraft = () => {
    const id = newDraftId(drafts);
    setDraftList([...drafts, { id, name: `Draft ${drafts.length + 1}`, template: shownTemplate, subject: active.subject }]);
    setActiveId(id);
  };
  const deleteDraft = () => {
    if (drafts.length < 2 || !confirm(`Delete the “${active.name}” draft?`)) return;
    const at = drafts.findIndex((d) => d.id === active.id);
    const next = drafts.filter((d) => d.id !== active.id);
    setDraftList(next);
    setActiveId(next[Math.max(0, at - 1)].id);
  };

  const previewVenue = venues.find((x) => x.id === previewId) || venues.find((x) => x.contactName) || venues[0] || { name: 'The Venue', contactName: 'Alex' };
  const preview = { venue: previewVenue, text: fillTemplate(shownTemplate, previewVenue) };

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        {saveState && <span className={styles.count} role="status">{saveState}</span>}
      </div>
      {subnav}
      <p className={styles.subtitle}>
        The emails you send venues, written once from the same details — one draft per subtab. The ✉ on a venue&apos;s row in All venues fills one in for that venue as a new email to its address and saves it to your Gmail drafts to look over and send.
      </p>

      <div className={vs.replyLayout}>
        <section className={vs.replyCard} aria-label="Wedding details">
          <h2 className={vs.replyHeading}>The details</h2>
          <div className={styles.contactGrid}>
            {REPLY_FIELDS.map((f) => (
              <label key={f.key} className={f.multiline ? `${styles.contactField} ${styles.contactWide}` : styles.contactField}>
                <span className={styles.contactLabel}>{f.label}</span>
                {f.multiline ? (
                  <textarea className={styles.contactInput} rows={f.key === 'questions' ? 6 : 3} value={details[f.key]} placeholder={f.placeholder || ''} onChange={(e) => setDetail(f.key, e.target.value)} />
                ) : (
                  <input className={styles.contactInput} value={details[f.key]} placeholder={f.placeholder || ''} onChange={(e) => setDetail(f.key, e.target.value)} autoComplete="off" />
                )}
              </label>
            ))}
          </div>
          <p className={`${styles.muted} ${vs.replyHint}`}>One question per line. A blank field is left out of the email.</p>
        </section>

        <section className={vs.replyCard} aria-label="Email template">
          <div className={`${styles.categoryTabs} ${vs.draftTabs}`} role="tablist" aria-label="Email drafts">
            {drafts.map((d) => (
              <button key={d.id} type="button" role="tab" aria-selected={d.id === active.id} className={d.id === active.id ? styles.categoryTabActive : styles.categoryTab} onClick={() => setActiveId(d.id)}>
                {d.name}
              </button>
            ))}
            {drafts.length < MAX_DRAFTS && (
              <button type="button" className={styles.categoryTab} onClick={addDraft} title="Add another email, starting from a copy of this one">+ New draft</button>
            )}
          </div>
          <div className={vs.draftNameRow}>
            <label className={styles.contactField}>
              <span className={styles.contactLabel}>Draft name</span>
              <input className={styles.contactInput} value={active.name} onChange={(e) => setActive({ name: e.target.value })} onBlur={() => { if (!active.name.trim()) setActive({ name: `Draft ${drafts.indexOf(active) + 1}` }); }} autoComplete="off" />
            </label>
            <label className={styles.contactField}>
              <span className={styles.contactLabel}>Subject</span>
              <input className={styles.contactInput} value={active.subject} placeholder={outreachSubject(details)} onChange={(e) => setActive({ subject: e.target.value })} autoComplete="off" />
            </label>
            {drafts.length > 1 && <button type="button" className={vs.textBtn} onClick={deleteDraft}>Delete draft</button>}
          </div>
          <div className={vs.replyHeadRow}>
            <h2 className={vs.replyHeading}>The email</h2>
            <span className={styles.muted}>{template ? 'Edited by you' : 'Built from the details'}</span>
            {template && <button type="button" className={vs.textBtn} onClick={resetTemplate}>Rebuild from the details</button>}
          </div>
          {isFirst && template && readsAsReply(template) && (
            <p className={styles.digestErrMsg} role="status">
              Your saved email still reads as a reply (“thank you for getting back to us”).{' '}
              <button type="button" className={vs.textBtn} onClick={resetTemplate}>Rebuild it as an outreach email</button>{' '}
              or reword it below.
            </p>
          )}
          <textarea
            className={`${styles.contactInput} ${vs.replyTemplate}`}
            value={shownTemplate}
            onChange={(e) => setTemplateText(e.target.value)}
            aria-label="Email template"
            spellCheck
          />
          <p className={`${styles.muted} ${vs.replyHint}`}>
            {'{first name}'} and {'{venue}'} are filled in for each venue.{drafts.length > 1 ? ' On a venue’s ✉ you pick which draft to use.' : ''}
          </p>

          <div className={vs.replyHeadRow}>
            <h2 className={vs.replyHeading}>Preview</h2>
            {venues.length > 0 && (
              <select className={styles.filterSelect} value={preview.venue.id || ''} onChange={(e) => setPreviewId(e.target.value)} aria-label="Preview for venue">
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
          </div>
          <pre className={vs.replyPreview}>{preview.text}</pre>
        </section>
      </div>
    </div>
  );
}

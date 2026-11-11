import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  REPLY_FIELDS, buildTemplate, fillTemplate, normalizeReplySettings, replySettingsFor,
} from '../lib/weddingVenueReply';
import { normalizeVenue } from '../lib/weddingVenues';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* Wedding → Venues → Reply email: the facts a venue needs to quote, and the
   email they add up to, edited here once and used for every venue's reply
   (the ✉ on each row of the venue table drafts one). Saves as you type. */
export function WeddingVenueReply({ subnav } = {}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(() => normalizeReplySettings(null).details);
  const [template, setTemplate] = useState('');
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
        setTemplate(s.template);
      }
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  // Saves a moment after the last keystroke.
  const timer = useRef(null);
  const save = (nextDetails, nextTemplate) => {
    clearTimeout(timer.current);
    setSaveState('…');
    timer.current = setTimeout(() => {
      if (!user) return;
      setDoc(doc(db, 'users', user.uid), { weddingVenueReply: { details: nextDetails, template: nextTemplate } }, { merge: true })
        .then(() => setSaveState('Saved'))
        .catch((err) => setSaveState(`Could not save: ${err.message}`));
    }, 600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const setDetail = (key, value) => {
    const next = { ...details, [key]: value };
    setDetails(next);
    save(next, template);
  };
  const shownTemplate = template || buildTemplate(details);
  const setTemplateText = (value) => {
    setTemplate(value);
    save(details, value);
  };
  const resetTemplate = () => {
    if (template && !confirm('Replace your edited email with one rebuilt from the details?')) return;
    setTemplate('');
    save(details, '');
  };

  const preview = useMemo(() => {
    const v = venues.find((x) => x.id === previewId) || venues.find((x) => x.contactName) || venues[0] || { name: 'The Venue', contactName: 'Alex' };
    return { venue: v, text: fillTemplate(shownTemplate, v) };
  }, [venues, previewId, shownTemplate]);

  if (loading) return <div className={styles.page}><p className={styles.muted}>Loading…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        {saveState && <span className={styles.count} role="status">{saveState}</span>}
      </div>
      {subnav}
      <p className={styles.subtitle}>
        What every venue needs to quote you, written once. The ✉ on a venue&apos;s row in All venues turns this into a reply to that venue&apos;s latest email and saves it to your Gmail drafts to look over and send.
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
          <div className={vs.replyHeadRow}>
            <h2 className={vs.replyHeading}>The email</h2>
            <span className={styles.muted}>{template ? 'Edited by you' : 'Built from the details'}</span>
            {template && <button type="button" className={vs.textBtn} onClick={resetTemplate}>Rebuild from the details</button>}
          </div>
          <textarea
            className={`${styles.contactInput} ${vs.replyTemplate}`}
            value={shownTemplate}
            onChange={(e) => setTemplateText(e.target.value)}
            aria-label="Email template"
            spellCheck
          />
          <p className={`${styles.muted} ${vs.replyHint}`}>
            {'{first name}'} and {'{venue}'} are filled in for each venue. When a venue has emailed you, its reply is adapted to what they wrote — questions they already answered are dropped and anything they asked is answered.
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

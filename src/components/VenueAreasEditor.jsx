import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bulletBackspace, bulletDisplay, bulletParse } from '../lib/bulletText';
import { newAreaId, normalizeAreas, parseKeywords, venueArea } from '../lib/venueAreas';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* The list of locations the venues are matched into (lib/venueAreas.js).
   Edited as a draft and saved together, with a live count of which venues
   each location picks up and which match none, so a missing town can be
   added as a keyword before saving.

   It's the body of Wedding → Locations: Save keeps the draft, Discard puts
   it back to what's saved. */
/* Pros / cons: a textarea that's a bullet list — each line shows "• " and
   Enter starts the next. `value` is the plain lines, without bullets. */
function BulletArea({ value, onChange, ...props }) {
  const ref = useRef(null);
  const caret = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // As tall as its points, so none are hidden behind a scroll.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
    if (caret.current === null) return;
    el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const emit = (r) => { caret.current = r.caret; onChange(r.plain); };
  return (
    <textarea
      {...props}
      ref={ref}
      value={bulletDisplay(value)}
      onChange={(e) => emit(bulletParse(e.target.value, e.target.selectionStart))}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key !== 'Backspace' || el.selectionStart !== el.selectionEnd) return;
        const r = bulletBackspace(value, el.selectionStart);
        if (r) { e.preventDefault(); emit(r); }
      }}
    />
  );
}

const toRows = (areas) => (areas.length ? areas : [{ id: newAreaId(), name: '', keywords: [] }])
  .map((a) => ({ id: a.id, name: a.name, keywords: a.keywords.join(', '), pros: a.pros || '', cons: a.cons || '' }));

export function VenueAreasEditor({ areas, venues, onSave }) {
  const [rows, setRows] = useState(() => toRows(areas));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const draft = useMemo(() => normalizeAreas(rows.map((r) => ({ ...r, keywords: parseKeywords(r.keywords) }))), [rows]);
  const live = useMemo(() => venues.filter((v) => !v.hidden), [venues]);
  const placed = useMemo(() => {
    const by = new Map(draft.map((a) => [a.id, []]));
    const unmapped = [];
    for (const v of live) {
      const r = venueArea(v, draft);
      if (r.area) by.get(r.area.id)?.push(v.name);
      else if (r.how === 'unmapped') unmapped.push(v);
    }
    return { by, unmapped };
  }, [draft, live]);

  const set = (i, key, value) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const move = (i, dir) => setRows((rs) => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i) => setRows((rs) => rs.filter((_, j) => j !== i));
  const add = () => setRows((rs) => [...rs, { id: newAreaId(), name: '', keywords: '', pros: '', cons: '' }]);

  // Unsaved when the cleaned draft differs from what's saved. A blank
  // starter row on an empty list isn't a change.
  const dirty = JSON.stringify(draft.filter((a) => a.name)) !== JSON.stringify(normalizeAreas(areas).filter((a) => a.name));
  // A save from elsewhere (another tab or device) shows up, unless you're
  // part way through an edit here.
  // Compared by content: a fresh copy of the same list changes nothing.
  const savedKey = JSON.stringify(normalizeAreas(areas));
  const [seen, setSeen] = useState(savedKey);
  if (seen !== savedKey) {
    setSeen(savedKey);
    if (!dirty) setRows(toRows(areas));
  }

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft.filter((a) => a.name));
      setSavedMsg('Saved.');
    } finally {
      setSaving(false);
    }
  };
  const discard = () => { setRows(toRows(areas)); setSavedMsg(''); };

  return (
    <section className={vs.locationsPanel} aria-label="Locations">
        <div>
          <p className={`${styles.muted} ${vs.draftMeta}`}>
            The places you&apos;re considering. Each venue&apos;s address is matched to one of these and shown in the Area column.
            A location matches its own name (up to the comma) and any keyword: add the towns, neighborhoods or zip codes that appear in venue addresses.
          </p>
          <div className={vs.areaList}>
            {rows.map((r, i) => {
              const hits = placed.by.get(r.id) || [];
              return (
                <div key={r.id} className={vs.areaRow}>
                  <div className={vs.areaMove}>
                    <button type="button" className={vs.iconBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.name || 'location'} up`}>↑</button>
                    <button type="button" className={vs.iconBtn} onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${r.name || 'location'} down`}>↓</button>
                  </div>
                  <label className={`${styles.contactField} ${vs.areaName}`}>
                    <span className={styles.contactLabel}>Location</span>
                    <input className={styles.contactInput} value={r.name} placeholder={i === 0 ? 'e.g. North Fork' : 'Location'} onChange={(e) => set(i, 'name', e.target.value)} autoFocus={!r.name && i === rows.length - 1} autoComplete="off" />
                  </label>
                  <label className={`${styles.contactField} ${vs.areaKeywords}`}>
                    <span className={styles.contactLabel}>Also matches</span>
                    <input className={styles.contactInput} value={r.keywords} placeholder={i === 0 ? 'Greenport, Southold, Shelter Island, 11944' : 'Towns, neighborhoods or zip codes'} onChange={(e) => set(i, 'keywords', e.target.value)} autoComplete="off" />
                    <span className={vs.areaHits} title={hits.join(', ')}>
                      {r.name.trim() ? (hits.length ? `${hits.length} venue${hits.length === 1 ? '' : 's'}: ${hits.join(', ')}` : 'No venues yet') : ''}
                    </span>
                  </label>
                  <label className={`${styles.contactField} ${vs.areaNote}`}>
                    <span className={styles.contactLabel}>Pros</span>
                    <BulletArea className={`${styles.contactInput} ${vs.areaNoteInput}`} rows={2} value={r.pros} placeholder="• What's good about it" onChange={(v) => set(i, 'pros', v)} aria-label={`Pros of ${r.name || 'this location'}`} />
                  </label>
                  <label className={`${styles.contactField} ${vs.areaNote}`}>
                    <span className={styles.contactLabel}>Cons</span>
                    <BulletArea className={`${styles.contactInput} ${vs.areaNoteInput}`} rows={2} value={r.cons} placeholder="• What's not" onChange={(v) => set(i, 'cons', v)} aria-label={`Cons of ${r.name || 'this location'}`} />
                  </label>
                  <button type="button" className={vs.iconBtn} onClick={() => remove(i)} aria-label={`Remove ${r.name || 'location'}`} title="Remove">🗑</button>
                </div>
              );
            })}
          </div>
          <button type="button" className={vs.colMenuAdd} onClick={add}>+ Add location</button>

          {draft.length > 0 && (
            placed.unmapped.length ? (
              <div className={vs.areaWarn} role="status">
                <strong>⚠ {placed.unmapped.length} venue{placed.unmapped.length === 1 ? '' : 's'} can&apos;t be mapped to a location:</strong>
                <ul>
                  {placed.unmapped.map((v) => (
                    <li key={v.id}>{v.name}{v.location ? <span className={styles.muted}> — {v.location}</span> : <span className={styles.muted}> — no address</span>}</li>
                  ))}
                </ul>
                <span className={styles.muted}>Add a town from the address as a keyword above, or pick a location for the venue in its Area cell.</span>
              </div>
            ) : (
              <p className={styles.digestOkMsg}>Every venue matches a location.</p>
            )
          )}
        </div>
        <div className={vs.locationsFooter}>
          <span className={styles.modalCount}>
            {draft.filter((a) => a.name).length} location{draft.filter((a) => a.name).length === 1 ? '' : 's'}
            {dirty ? ' · unsaved changes' : savedMsg ? ` · ${savedMsg}` : ''}
          </span>
          <button className={styles.modalSecondary} type="button" onClick={discard} disabled={!dirty || saving}>Discard changes</button>
          <button className={styles.modalPrimary} type="button" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
    </section>
  );
}

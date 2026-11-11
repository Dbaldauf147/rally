import { useEffect, useMemo, useState } from 'react';
import { newAreaId, normalizeAreas, parseKeywords, venueArea } from '../lib/venueAreas';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* The list of locations the venues are matched into (lib/venueAreas.js).
   Edited as a draft and saved together, with a live count of which venues
   each location picks up and which match none, so a missing town can be
   added as a keyword before saving. */
export function VenueAreasEditor({ areas, venues, onSave, onClose }) {
  const [rows, setRows] = useState(() => (areas.length ? areas : [{ id: newAreaId(), name: '', keywords: [] }])
    .map((a) => ({ id: a.id, name: a.name, keywords: a.keywords.join(', ') })));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  const add = () => setRows((rs) => [...rs, { id: newAreaId(), name: '', keywords: '' }]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Locations" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Locations</h2>
          <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
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
        <div className={styles.modalFooter}>
          <span className={styles.modalCount}>{draft.length} location{draft.length === 1 ? '' : 's'}</span>
          <button className={styles.modalSecondary} type="button" onClick={onClose}>Cancel</button>
          <button className={styles.modalPrimary} type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

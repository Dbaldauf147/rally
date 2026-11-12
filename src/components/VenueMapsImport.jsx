import { useCallback, useEffect, useState } from 'react';
import { extractMapsLinks, isShortMapsUrl, parseMapsUrl, venueFieldsFromPlace } from '../lib/venueMaps';
import { sameVenue } from '../lib/weddingVenues';
import styles from './WeddingPage.module.css';
import vs from './WeddingVenues.module.css';

/* Add venues from Google Maps links. Paste one or more links (in Google
   Maps: Share → Copy link), look them up, check what was found, add.

   The server follows each link and asks Google for the place
   (api/wedding-venues.js, action mapsImport). If it can't be reached, a
   full link is still read here for what it says itself; a short link then
   only has the name the Share sheet wrote above it, if any. A place that's
   already on the list is updated — blanks filled, the link saved — rather
   than added twice. */
export function VenueMapsImport({ venues, callApi, initialText = '', onAdd, onClose }) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState(null); // looked-up places, or null before a look-up
  const canReadClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const lookUp = useCallback(async (source) => {
    const links = extractMapsLinks(source);
    if (!links.length) {
      setRows(null);
      setError('No Google Maps link in that. In Google Maps, open the place, tap Share, then Copy link.');
      return;
    }
    setBusy(true);
    setError('');
    let places = [];
    let offline = '';
    try {
      places = (await callApi({ action: 'mapsImport', urls: links.slice(0, 10).map((l) => l.url) })).places || [];
    } catch (err) {
      offline = err.message || 'Could not reach the server';
    }
    const next = links.slice(0, 10).map((link, i) => {
      const found = places.find((p) => p.url === link.url) || places[i] || null;
      let place = found && !found.error ? found : null;
      // On our own: a full link still names its place.
      if (!place && !isShortMapsUrl(link.url)) {
        const parsed = parseMapsUrl(link.url);
        if (parsed) place = { name: parsed.name, address: parsed.address, source: 'link' };
      }
      const fields = venueFieldsFromPlace(place, link);
      const problem = !place ? (found?.error || offline) : '';
      return { id: i, ...fields, include: !!fields.name, problem, partial: !!place && place.source !== 'places' };
    });
    setRows(next);
    if (links.length > 10) setError(`Only the first 10 links were looked up (${links.length} pasted).`);
    setBusy(false);
  }, [callApi]);

  // Opened with links already in hand (pasted onto the page): look them up.
  useEffect(() => {
    if (!initialText || !extractMapsLinks(initialText).length) return undefined;
    const t = setTimeout(() => lookUp(initialText), 0);
    return () => clearTimeout(t);
  }, [initialText, lookUp]);

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) { setError('The clipboard is empty.'); return; }
      const next = text.trim() ? `${text.trim()}\n${clip}` : clip;
      setText(next);
      lookUp(next);
    } catch {
      setError('Couldn’t read the clipboard — paste into the box instead.');
    }
  };

  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const existingFor = (r) => (r.name.trim() ? venues.find((v) => (r.mapsUrl && v.mapsUrl === r.mapsUrl) || sameVenue(v, { name: r.name })) : null);
  const chosen = (rows || []).filter((r) => r.include && r.name.trim());
  const add = () => {
    if (!chosen.length) return;
    onAdd(chosen.map((r) => ({
      fields: { name: r.name.trim(), location: r.location.trim(), phone: r.phone, website: r.website, mapsUrl: r.mapsUrl },
      existingId: existingFor(r)?.id || null,
    })));
  };
  const newCount = chosen.filter((r) => !existingFor(r)).length;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <form
        className={`${styles.modal} ${vs.mapsModal}`}
        role="dialog"
        aria-modal="true"
        aria-label="Add venues from Google Maps"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (rows && chosen.length) add(); else lookUp(text); }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Add venues from Google Maps</h2>
          <button className={styles.modalClose} type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.modalHint}>
            In Google Maps, open the place, tap <strong>Share</strong>, then <strong>Copy link</strong>, and paste it here.
            Several links at once are fine, one per line.
          </p>
          <textarea
            className={styles.modalTextarea}
            rows={3}
            value={text}
            autoFocus={!initialText}
            placeholder="https://maps.app.goo.gl/…"
            aria-label="Google Maps links"
            onChange={(e) => { setText(e.target.value); setError(''); }}
            onPaste={(e) => {
              // A pasted link is looked up straight away — one less tap on a phone.
              const clip = e.clipboardData?.getData('text/plain') || '';
              if (!extractMapsLinks(clip).length) return;
              e.preventDefault();
              const next = text.trim() ? `${text.trim()}\n${clip}` : clip;
              setText(next);
              lookUp(next);
            }}
          />
          <div className={vs.mapsActions}>
            {canReadClipboard && <button type="button" className={styles.modalSecondary} onClick={pasteFromClipboard} disabled={busy}>📋 Paste from clipboard</button>}
            <button type="button" className={styles.modalSecondary} onClick={() => lookUp(text)} disabled={busy || !text.trim()}>{busy ? 'Looking up…' : 'Look up'}</button>
          </div>
          {error && <p className={styles.digestErrMsg} role="alert">{error}</p>}
          {rows && (
            <ul className={vs.mapsRows} aria-label="Places found">
              {rows.map((r) => {
                const existing = existingFor(r);
                return (
                  <li key={r.id} className={vs.mapsRow}>
                    <input type="checkbox" className={vs.pick} checked={r.include && !!r.name.trim()} disabled={!r.name.trim()} onChange={(e) => setRow(r.id, { include: e.target.checked })} aria-label={`Add ${r.name || 'this place'}`} />
                    <div className={vs.mapsFields}>
                      <input className={styles.contactInput} value={r.name} placeholder="Venue name" aria-label="Venue name" onChange={(e) => setRow(r.id, { name: e.target.value, include: !!e.target.value.trim() })} />
                      <input className={styles.contactInput} value={r.location} placeholder="Address" aria-label={`Address of ${r.name || 'this place'}`} onChange={(e) => setRow(r.id, { location: e.target.value })} />
                      <span className={vs.mapsMeta}>
                        <span className={existing ? vs.mapsTagUpdate : vs.mapsTagNew}>{existing ? `Updates ${existing.name}` : 'New'}</span>
                        {[r.phone, r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')].filter(Boolean).join(' · ')}
                        {r.mapsUrl && <a className={styles.link} href={r.mapsUrl} target="_blank" rel="noreferrer">Open in Maps ↗</a>}
                      </span>
                      {r.problem && <span className={vs.mapsWarn}>{r.name ? `${r.problem} — using what was pasted with the link.` : `${r.problem}. Type the venue’s name to add it with the link anyway.`}</span>}
                      {!r.problem && r.partial && !r.phone && <span className={vs.mapsNote}>Only what the link itself says — add the phone and website by hand.</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={styles.modalFooter}>
          <span className={styles.modalCount}>
            {!rows ? 'Paste a link to begin' : chosen.length ? `${newCount} new · ${chosen.length - newCount} updated` : 'Nothing ticked'}
          </span>
          <button className={styles.modalSecondary} type="button" onClick={onClose}>Cancel</button>
          <button className={styles.modalPrimary} type="button" onClick={add} disabled={!chosen.length || busy}>
            {chosen.length > 1 ? `Add ${chosen.length} venues` : 'Add venue'}
          </button>
        </div>
      </form>
    </div>
  );
}

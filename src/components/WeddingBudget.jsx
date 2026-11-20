import { Fragment, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  normalizePlan, seedCategories, newId, categoryPct, totalPct, contributorTotals, effectiveTotal,
  amountFor, pctFromAmount, setCategoryPct, scaleTo100, parseMoney, parsePct, formatMoney, formatPct, roundPct,
  formatRate, guestCounts, headcount, plateAmount, resolveCategories,
  categoryTaxPct, totalTaxPct, grossPct, calculatorGroups, calculatorTotals,
  saveVenueQuote, findVenueQuote, sameCalc, toggleCalcPerPerson, venueComparison, effectiveCalc, lineFromSubs, clearedCalculator, calcHasAnswers, subDollars, calculatorGroupTotals, venueGroupOf, setVenueAvailable,
} from '../lib/weddingBudgetPlan';
import { areaForName, areasByVenueName } from '../lib/venueAreas';
import { IMPORT_ACCEPT, planQuoteImport, quoteSheetLines, quoteSheetRows, readVenueFile } from '../lib/venueQuoteSheet';
import styles from './WeddingBudget.module.css';
import navStyles from './WeddingDreamVenue.module.css';

/* Wedding → Budget: who is helping and with how much, the total that comes
   to, and that total split across line items by percentage.

   Saved as it's edited, like the checklist: one field on the owner's user
   document, written a moment after the last change. */
const FIELD = 'weddingBudgetPlan';
const CACHE_KEY = 'rally.weddingBudgetPlan.v1';

function usePlan(userId) {
  const [plan, setPlan] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return normalizePlan(JSON.parse(raw));
    } catch { /* ignore a corrupt cache */ }
    return null;
  });
  const [saved, setSaved] = useState(true);
  // Head counts off the guest list on the same document, for per-plate lines.
  const [counts, setCounts] = useState(() => guestCounts([]));
  // Names off the Venues tab on the same document, offered when saving a venue's pricing.
  const [venueNames, setVenueNames] = useState([]);
  // Venue name → its location on the Venues tab, for the comparison's Area column.
  const [venueAreas, setVenueAreas] = useState(() => new Map());
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
    setDoc(doc(db, 'users', userId), { [FIELD]: next }, { merge: true })
      .catch(() => {}) // offline: the local cache still holds the edit
      .then(() => {
        syncedEdits.current = Math.max(syncedEdits.current, version);
        if (syncedEdits.current === localEdits.current) setSaved(true);
      });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    return onSnapshot(doc(db, 'users', userId), (snap) => {
      const nextCounts = guestCounts(snap.exists() ? snap.data()?.weddingContacts : []);
      setCounts((prev) => (JSON.stringify(prev) === JSON.stringify(nextCounts) ? prev : nextCounts));
      const rawVenues = snap.exists() && Array.isArray(snap.data()?.weddingVenues) ? snap.data().weddingVenues : [];
      const names = [...new Set(rawVenues.filter((v) => v && !v.hidden).map((v) => String(v.name || '').trim()).filter(Boolean))].sort();
      setVenueNames((prev) => (prev.join('\n') === names.join('\n') ? prev : names));
      const nextAreas = areasByVenueName(rawVenues, snap.exists() ? snap.data()?.weddingVenueAreas : []);
      setVenueAreas((prev) => (JSON.stringify([...prev]) === JSON.stringify([...nextAreas]) ? prev : nextAreas));
      // Not skipped on hasPendingWrites: another field's write to this doc
      // (e.g. on sign-in) would hide the first load, and the server ack is a
      // metadata-only change that never fires here. Our own echo matches
      // appliedJson and is dropped below.
      if (localEdits.current !== syncedEdits.current) return; // unsent edit wins
      const remote = normalizePlan(snap.exists() ? snap.data()?.[FIELD] : null);
      const json = JSON.stringify(remote);
      if (json === appliedJson.current) return;
      appliedJson.current = json;
      setPlan(remote);
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
    }, () => setPlan((p) => p || normalizePlan(null)) /* offline */);
  }, [userId]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushWrite(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushWrite(); };
  }, [flushWrite]);

  const update = useCallback((updater) => {
    setPlan((prev) => {
      const base = prev || normalizePlan(null);
      const next = normalizePlan(updater(base));
      const json = JSON.stringify(next);
      appliedJson.current = json;
      try { localStorage.setItem(CACHE_KEY, json); } catch { /* ignore */ }
      localEdits.current += 1;
      pendingWrite.current = next;
      setSaved(false);
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(flushWrite, 600);
      return next;
    });
  }, [flushWrite]);

  return { plan, update, saved, counts, venueNames, venueAreas };
}

/* A number field ("$12,000", "7.5%") that only commits when you leave it or
   press Enter — so a half-typed "1." doesn't rescale anything. Blank commits
   null; text that doesn't read as a number keeps the old value. */
function NumberField({ value, format, parse, onCommit, label, placeholder, className }) {
  const [draft, setDraft] = useState(null);
  const startDraft = useRef('');
  const commit = () => {
    if (draft == null) return;
    const parsed = parse(draft);
    setDraft(null);
    if (draft === startDraft.current) return; // focused and left untouched
    if (parsed === null && draft.trim() !== '') return; // unreadable: keep the old value
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className={className || styles.num}
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? (value == null ? '' : format(value))}
      onFocus={(e) => {
        // Starts from exactly what's shown — the parsers read "$12,000" and
        // "7.5%" — so focusing never rewrites the text under the cursor.
        const start = value == null ? '' : format(value);
        startDraft.current = start;
        setDraft(start);
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(null); requestAnimationFrame(() => e.target.blur()); }
      }}
    />
  );
}

const moneyField = { format: formatMoney, parse: parseMoney };
const pctField = { format: formatPct, parse: parsePct };

function Contributors({ plan, update }) {
  const totals = contributorTotals(plan.contributors);
  const edit = (id, patch) => update((p) => ({
    ...p, contributors: p.contributors.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  }));
  const remove = (id) => update((p) => ({ ...p, contributors: p.contributors.filter((c) => c.id !== id) }));
  const add = () => update((p) => ({
    ...p, contributors: [...p.contributors, { id: newId('p'), name: '', low: null, high: null, note: '' }],
  }));

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Who's helping</h2>
      <p className={styles.cardHint}>Each person and the range they can put toward the wedding.</p>
      {plan.contributors.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th className={styles.numHead}>From</th>
                <th className={styles.numHead}>Up to</th>
                <th className={styles.noteCol}>Note</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {plan.contributors.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      className={styles.text}
                      aria-label="Name"
                      placeholder="Name"
                      value={c.name}
                      autoFocus={!c.name && c === plan.contributors[plan.contributors.length - 1]}
                      onChange={(e) => edit(c.id, { name: e.target.value })}
                    />
                  </td>
                  <td><NumberField {...moneyField} label={`${c.name || 'Person'} can give from`} placeholder="$0" value={c.low} onCommit={(v) => edit(c.id, { low: v })} /></td>
                  <td><NumberField {...moneyField} label={`${c.name || 'Person'} can give up to`} placeholder="$0" value={c.high} onCommit={(v) => edit(c.id, { high: v })} /></td>
                  <td className={styles.noteCol}>
                    <input className={styles.text} aria-label="Note" placeholder="Note" value={c.note} onChange={(e) => edit(c.id, { note: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" className={styles.remove} title="Remove" aria-label={`Remove ${c.name || 'person'}`}
                      onClick={() => { if (!c.name && c.low == null && c.high == null) return remove(c.id); if (window.confirm(`Remove ${c.name || 'this person'}?`)) remove(c.id); }}
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.footLabel}>Total</td>
                <td className={styles.footNum} data-testid="contrib-low">{formatMoney(totals.low)}</td>
                <td className={styles.footNum} data-testid="contrib-high">{formatMoney(totals.high)}</td>
                <td className={styles.noteCol} />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <button type="button" className={styles.add} onClick={add}>+ Add person</button>
    </section>
  );
}

const SOURCE_LABELS = {
  all: (n) => `Guest list — everyone (${n})`,
  attending: (n) => `Guest list — not counting “Not coming” (${n})`,
  confirmed: (n) => `Guest list — confirmed only (${n})`,
  manual: () => 'A number I type',
};

/* How many people the wedding is for: linked to the guest list or typed.
   Per-plate lines and the per-person column both count from it. */
function GuestsField({ plan, update, counts, hint = 'used for per-plate lines and the per-person column' }) {
  const g = plan.guests;
  const n = headcount(g, counts);
  const set = (patch) => update((p) => ({ ...p, guests: { ...p.guests, ...patch } }));
  return (
    <div className={styles.guestsRow}>
      <span className={styles.guestsLabel}>Guests</span>
      <select
        className={styles.guestsSelect}
        aria-label="Guest count"
        value={g.source}
        onChange={(e) => set({
          source: e.target.value,
          // Switching to a typed number starts from the count you were on.
          ...(e.target.value === 'manual' && g.count == null ? { count: n } : {}),
        })}
      >
        {Object.entries(SOURCE_LABELS).map(([k, label]) => (
          <option key={k} value={k}>{label(counts[k])}</option>
        ))}
      </select>
      {g.source === 'manual' && (
        <NumberField
          format={(v) => String(v)}
          parse={(t) => { const v = parseMoney(t); return v == null ? null : Math.round(v); }}
          className={styles.guestsNum}
          label="Number of guests"
          placeholder="0"
          value={g.count}
          onCommit={(v) => set({ count: v })}
        />
      )}
      <span className={styles.guestsHint} data-testid="guest-n">{n} {n === 1 ? 'guest' : 'guests'} — {hint}</span>
    </div>
  );
}

function TotalCard({ plan, update, counts }) {
  const totals = contributorTotals(plan.contributors);
  const eff = effectiveTotal(plan);
  const set = (v) => update((p) => ({ ...p, total: v }));
  let gap = null;
  if (plan.total != null && totals.counted) {
    if (plan.total > totals.high) gap = { tone: 'warn', text: `${formatMoney(plan.total - totals.high)} more than the most everyone can give` };
    else if (plan.total < totals.low) gap = { tone: 'ok', text: `${formatMoney(totals.low - plan.total)} under what everyone can give at the low end` };
    else gap = { tone: 'ok', text: 'Within what everyone can give' };
  }
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Total budget</h2>
      <div className={styles.totalRow}>
        <NumberField
          {...moneyField}
          className={styles.totalInput}
          label="Total budget"
          placeholder={eff.source === 'contributors' ? formatMoney(eff.amount) : '$0'}
          value={plan.total}
          onCommit={set}
        />
        {totals.counted > 0 && (
          <div className={styles.quick}>
            <button type="button" onClick={() => set(totals.low)}>Use low {formatMoney(totals.low)}</button>
            <button type="button" onClick={() => set(Math.round(totals.mid))}>Use middle {formatMoney(totals.mid)}</button>
            <button type="button" onClick={() => set(totals.high)}>Use high {formatMoney(totals.high)}</button>
          </div>
        )}
      </div>
      <GuestsField plan={plan} update={update} counts={counts} />
      <p className={styles.cardHint}>
        {totals.counted > 0 ? <>Everyone together can give <strong>{formatMoney(totals.low)}–{formatMoney(totals.high)}</strong>. </> : null}
        {eff.source === 'contributors' && <>No total set yet, so the split below uses the middle, {formatMoney(eff.amount)}.</>}
        {eff.source === 'none' && <>Type a total, or add the people helping above, to see dollar amounts below.</>}
      </p>
      {gap && <p className={gap.tone === 'warn' ? styles.gapWarn : styles.gapOk}>{gap.text}</p>}
    </section>
  );
}

const COLS = 6;

/* The Tax column's tick: on a line, whether sales tax is added to it; on a
   category with items, all of them at once (half-ticked when they differ). */
function TaxCheck({ checked, mixed, label, onChange }) {
  return (
    <input
      type="checkbox"
      className={styles.taxCheck}
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = !!mixed; }}
      aria-label={label}
      title={checked ? 'Sales tax added — untick for no tax' : 'No sales tax — tick to add it'}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/* Under a per-plate item: price × the guest count = dollars. */
function PlateRow({ item, guestN, onChange }) {
  const pp = item.perPlate;
  return (
    <tr className={styles.plateRow}>
      <td colSpan={COLS}>
        <div className={styles.plate}>
          <NumberField
            {...moneyField}
            className={styles.plateNum}
            label={`${item.name} price per plate`}
            placeholder="$0"
            value={pp.price}
            onCommit={(v) => onChange({ ...pp, price: v })}
          />
          <span className={styles.plateOp}>per plate × {guestN} {guestN === 1 ? 'guest' : 'guests'} =</span>
          <strong className={styles.plateTotal} data-testid={`plate-total-${item.id}`}>{formatMoney(plateAmount(pp, guestN))}</strong>
          <span className={styles.plateNote}>Guests are set beside the total budget.</span>
        </div>
      </td>
    </tr>
  );
}

/* A pop-up pinned to the button that opened it: below it, right-aligned,
   flipped above when there's no room underneath, kept on screen and
   following the page as it scrolls. Closes on a click outside or Escape. */
function useAnchoredPop(anchor, onClose, deps = []) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect?.();
      const el = ref.current;
      if (!r || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // A value still being typed is saved by its box losing focus, so let it
    // go first: closing pulls the box out from under it.
    const close = () => {
      const a = document.activeElement;
      if (a && ref.current?.contains(a)) a.blur();
      onClose();
    };
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor?.contains?.(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [anchor, onClose]);
  return { ref, pos };
}

/* A markup's settings — rate % of the lines ticked — in a pop-up beside the
   line, opened by clicking its % or its % button. Any line in the same
   category can be ticked, other markups included (tax on the service charge).
   Closes on a click outside, Escape, or Done. */
function MarkupPopover({ item, cat, total, anchor, onChange, onOff, onClose }) {
  const m = item.markup;
  const others = cat.items.filter((i) => i.id !== item.id);
  const base = cat.items.filter((i) => m.of.includes(i.id)).reduce((s, i) => s + i.pct, 0);
  const toggle = (id) => onChange({ ...m, of: m.of.includes(id) ? m.of.filter((x) => x !== id) : [...m.of, id] });
  const { ref, pos } = useAnchoredPop(anchor, onClose, [m.of.length, others.length]);

  return createPortal(
    <div
      ref={ref}
      className={styles.markupPop}
      role="dialog"
      aria-label={`${item.name || 'Line'} calculation`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      <div className={styles.markupPopHead}>
        <strong>{item.name || 'Untitled'}</strong>
        <button type="button" className={styles.markupPopClose} onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className={styles.markupPopRate}>
        <NumberField
          format={formatRate}
          parse={parsePct}
          className={styles.plateNum}
          label={`${item.name} rate`}
          placeholder="0%"
          value={m.rate}
          onCommit={(v) => onChange({ ...m, rate: v ?? 0 })}
        />
        <span className={styles.plateOp}>of</span>
      </div>
      <div className={styles.markupPopBases}>
        {others.map((o) => (
          <label key={o.id} className={m.of.includes(o.id) ? styles.baseOn : styles.base}>
            <input type="checkbox" checked={m.of.includes(o.id)} onChange={() => toggle(o.id)} aria-label={`${item.name} includes ${o.name}`} />
            {o.name || 'Untitled'}
          </label>
        ))}
        {others.length === 0 && <span className={styles.plateOp}>No other lines in this category yet.</span>}
      </div>
      {total > 0 && <p className={styles.markupPopSum}>= {formatRate(m.rate)} of {formatMoney(amountFor(base, total))}</p>}
      <div className={styles.markupPopFoot}>
        <button type="button" className={styles.markupPopOff} onClick={onOff} title="Stop working this out from other lines">Back to a plain %</button>
        <button type="button" className={styles.markupPopDone} onClick={onClose}>Done</button>
      </div>
    </div>,
    document.body,
  );
}

function Split({ plan, update, counts }) {
  const { amount: total } = effectiveTotal(plan);
  const guestN = headcount(plan.guests, counts);
  // Per-plate lines and markups get their % before anything sums.
  const cats = resolveCategories(plan.categories, total, guestN);
  const sum = totalPct(cats);
  const rate = plan.salesTax.rate;
  const taxSum = totalTaxPct(cats, rate);
  // Lines plus their tax is what has to fit in the total.
  const gross = grossPct(cats, rate);
  const canMoney = total > 0;
  // Per person is what each guest costs: the line and its tax.
  const perPerson = (pct) => (canMoney && guestN > 0 ? formatMoney(amountFor(pct, total) / guestN) : '—');
  const setRate = (v) => update((p) => ({ ...p, salesTax: { rate: v ?? 0 } }));
  // The markup pop-up that's open: which line, and what it's pinned beside.
  const [markupPop, setMarkupPop] = useState(null); // { id, anchor }
  const closeMarkupPop = useCallback(() => setMarkupPop(null), []);
  const openMarkupPop = (item, el) => setMarkupPop((cur) => (cur?.id === item.id ? null : { id: item.id, anchor: el }));
  const setCatTaxed = (cat, taxed) => editCat(cat.id, (c) => (c.items.length
    ? { ...c, items: c.items.map((i) => ({ ...i, taxed })) }
    : { ...c, taxed }));

  const editCat = (id, fn) => update((p) => ({ ...p, categories: p.categories.map((c) => (c.id === id ? fn(c) : c)) }));
  // Scaling has to see computed lines at their real size, so it runs on the
  // resolved split.
  const resolved = (p) => resolveCategories(p.categories, effectiveTotal(p).amount, headcount(p.guests, counts));
  const scaleCat = (id, pct) => update((p) => ({ ...p, categories: setCategoryPct(resolved(p), id, pct) }));
  const editItem = (catId, itemId, patch) => editCat(catId, (c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
  // Switching a line between plain %, per plate and markup keeps the dollars
  // it shows right now, so nothing jumps.
  const shown = (itemId) => cats.flatMap((c) => c.items).find((i) => i.id === itemId)?.pct ?? 0;
  const togglePlate = (catId, item) => {
    if (item.perPlate) return editItem(catId, item.id, { perPlate: null, pct: shown(item.id) });
    const price = guestN > 0 && total > 0 ? Math.round(amountFor(shown(item.id), total) / guestN) : null;
    editItem(catId, item.id, { perPlate: { price }, markup: null });
  };
  const toggleMarkup = (cat, item) => {
    if (item.markup) return editItem(cat.id, item.id, { markup: null, pct: shown(item.id) });
    const of = cat.items.filter((i) => i.id !== item.id && !i.markup).map((i) => i.id);
    const base = cat.items.filter((i) => of.includes(i.id)).reduce((s, i) => s + i.pct, 0);
    const rate = base > 0 ? roundPct((shown(item.id) / base) * 100) : 0;
    editItem(cat.id, item.id, { markup: { rate, of }, perPlate: null });
  };
  const removeItem = (catId, itemId) => editCat(catId, (c) => {
    const items = c.items.filter((i) => i.id !== itemId);
    // An item takes its share with it, the last one included.
    return { ...c, items, pct: items.length ? c.pct : 0 };
  });
  const addItem = (catId) => editCat(catId, (c) => ({
    ...c,
    // A category's own share becomes its first item when it gains items.
    items: c.items.length
      ? [...c.items, { id: newId('i'), name: '', pct: 0 }]
      : [{ id: newId('i'), name: c.name, pct: c.pct }, { id: newId('i'), name: '', pct: 0 }],
  }));
  const removeCat = (cat) => {
    if (!window.confirm(`Remove “${cat.name || 'this category'}” and its ${formatPct(categoryPct(cat))}?`)) return;
    update((p) => ({ ...p, categories: p.categories.filter((c) => c.id !== cat.id) }));
  };
  const addCat = () => update((p) => ({ ...p, categories: [...p.categories, { id: newId('c'), name: '', pct: 0, items: [] }] }));
  const moveCat = (idx, dir) => update((p) => {
    const list = [...p.categories];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return p;
    [list[idx], list[j]] = [list[j], list[idx]];
    return { ...p, categories: list };
  });
  const reset = () => {
    if (!window.confirm('Replace every line item with the suggested split? Your total, guests, tax rate and the people helping stay.')) return;
    // Scaled so the suggested split and its tax fit the total exactly.
    update((p) => ({
      ...p,
      categories: scaleTo100(resolveCategories(seedCategories(), effectiveTotal(p).amount, headcount(p.guests, counts)), p.salesTax.rate),
    }));
  };

  const fromAmount = (v) => (v == null ? 0 : pctFromAmount(v, total));
  const diff = roundPct(100 - gross);

  return (
    <section className={styles.card}>
      <div className={styles.splitHead}>
        <div>
          <h2 className={styles.cardTitle}>Budget split</h2>
          <p className={styles.cardHint}>
            Change any % or $ — the other follows. A category's % is the sum of its items; changing it scales them together.
            {' '}🍽 prices a line per plate; % makes it a percentage of other lines (like the service charge).
          </p>
        </div>
        <button type="button" className={styles.link} onClick={reset}>Reset to suggested split</button>
      </div>
      <div className={styles.taxRow}>
        <span className={styles.guestsLabel}>Sales tax</span>
        <NumberField format={formatRate} parse={parsePct} className={styles.guestsNum} label="Sales tax rate" placeholder="0%" value={rate} onCommit={setRate} />
        <span className={styles.guestsHint}>added to every line ticked in the Sales tax column; the lines plus their tax have to fit in the total</span>
      </div>
      <div className={styles.scroll}>
        <table className={styles.splitTable}>
          <colgroup>
            <col />
            <col className={styles.pctCol} />
            <col className={styles.amtCol} />
            <col className={styles.taxCol} />
            <col className={styles.ppCol} />
            <col className={styles.actCol} />
          </colgroup>
          <thead>
            <tr>
              <th>Line item</th>
              <th className={styles.numHead}>% of total</th>
              <th className={styles.numHead}>Amount</th>
              <th className={styles.numHead}>Sales tax</th>
              <th className={styles.numHead} title="Amount plus its sales tax, divided by the guests">Per person</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          {cats.map((cat, ci) => {
            const cp = categoryPct(cat);
            const ctax = categoryTaxPct(cat, rate);
            const lines = cat.items.length ? cat.items : [cat];
            const allTaxed = lines.every((l) => l.taxed);
            const someTaxed = lines.some((l) => l.taxed);
            return (
              <tbody key={cat.id} className={styles.catGroup}>
                <tr className={styles.catRow}>
                  <td>
                    <input
                      className={styles.catName}
                      aria-label="Category"
                      placeholder="Category"
                      value={cat.name}
                      title={cat.name}
                      autoFocus={!cat.name && ci === cats.length - 1}
                      onChange={(e) => editCat(cat.id, (c) => ({ ...c, name: e.target.value }))}
                    />
                  </td>
                  <td><NumberField {...pctField} className={styles.numStrong} label={`${cat.name} %`} value={cp} onCommit={(v) => scaleCat(cat.id, v ?? 0)} /></td>
                  <td>
                    {canMoney
                      ? <NumberField {...moneyField} className={styles.numStrong} label={`${cat.name} amount`} value={amountFor(cp, total)} onCommit={(v) => scaleCat(cat.id, fromAmount(v))} />
                      : <span className={styles.dash}>—</span>}
                  </td>
                  <td className={styles.taxCell}>
                    <TaxCheck checked={allTaxed} mixed={someTaxed && !allTaxed} label={`${cat.name} sales tax`} onChange={(on) => setCatTaxed(cat, on)} />
                    <span className={styles.taxAmtStrong} data-testid={`tax-${cat.id}`}>{canMoney && ctax > 0 ? formatMoney(amountFor(ctax, total)) : '—'}</span>
                  </td>
                  <td className={styles.perPersonStrong} data-testid={`pp-${cat.id}`}>{perPerson(cp + ctax)}</td>
                  <td className={styles.actions}>
                    <button type="button" className={styles.iconBtn} title="Move up" aria-label={`Move ${cat.name} up`} disabled={ci === 0} onClick={() => moveCat(ci, -1)}>↑</button>
                    <button type="button" className={styles.iconBtn} title="Move down" aria-label={`Move ${cat.name} down`} disabled={ci === cats.length - 1} onClick={() => moveCat(ci, 1)}>↓</button>
                    <button type="button" className={styles.remove} title="Remove category" aria-label={`Remove ${cat.name}`} onClick={() => removeCat(cat)}>×</button>
                  </td>
                </tr>
                {cat.items.map((item) => {
                  const computed = item.perPlate || item.markup;
                  const dollars = item.perPlate ? plateAmount(item.perPlate, guestN) : amountFor(item.pct, total);
                  const taxDollars = item.taxed ? (dollars * rate) / 100 : 0;
                  const showMoney = canMoney || !!item.perPlate;
                  return (
                    <Fragment key={item.id}>
                      <tr className={styles.itemRow}>
                        <td>
                          <input
                            className={styles.itemName}
                            aria-label="Line item"
                            placeholder="Line item"
                            value={item.name}
                            title={item.name}
                            autoFocus={!item.name && item === cat.items[cat.items.length - 1]}
                            onChange={(e) => editItem(cat.id, item.id, { name: e.target.value })}
                          />
                        </td>
                        {computed ? (
                          <>
                            <td className={styles.derived} data-testid={`pct-${item.id}`} title={item.perPlate ? 'Worked out from the price per plate' : 'Worked out from the lines it’s charged on'}>
                              {item.markup ? (
                                <button
                                  type="button"
                                  className={styles.derivedBtn}
                                  onClick={(e) => openMarkupPop(item, e.currentTarget.closest('tr'))}
                                  aria-haspopup="dialog"
                                  aria-expanded={markupPop?.id === item.id}
                                  title={`${formatRate(item.markup.rate)} of ${item.markup.of.length} line${item.markup.of.length === 1 ? '' : 's'} — click to change`}
                                >{canMoney ? formatPct(item.pct) : formatRate(item.markup.rate)}</button>
                              ) : (canMoney ? formatPct(item.pct) : '—')}
                            </td>
                            <td className={styles.derived} data-testid={`amount-${item.id}`}>{canMoney || item.perPlate ? formatMoney(dollars) : '—'}</td>
                          </>
                        ) : (
                          <>
                            <td><NumberField {...pctField} label={`${item.name} %`} value={item.pct} onCommit={(v) => editItem(cat.id, item.id, { pct: v ?? 0 })} /></td>
                            <td>
                              {canMoney
                                ? <NumberField {...moneyField} label={`${item.name} amount`} value={dollars} onCommit={(v) => editItem(cat.id, item.id, { pct: fromAmount(v) })} />
                                : <span className={styles.dash}>—</span>}
                            </td>
                          </>
                        )}
                        <td className={styles.taxCell}>
                          <TaxCheck checked={item.taxed} label={`${item.name} sales tax`} onChange={(on) => editItem(cat.id, item.id, { taxed: on })} />
                          <span className={styles.taxAmt} data-testid={`tax-${item.id}`}>{showMoney && item.taxed ? formatMoney(taxDollars) : '—'}</span>
                        </td>
                        <td className={styles.perPerson} data-testid={`pp-${item.id}`}>{guestN > 0 && showMoney ? formatMoney((dollars + taxDollars) / guestN) : '—'}</td>
                        <td className={styles.actions}>
                          <button
                            type="button"
                            className={item.perPlate ? styles.plateBtnOn : styles.plateBtn}
                            title={item.perPlate ? 'Per plate — click to go back to a % of the total' : 'Price this per plate'}
                            aria-label={`${item.name} per plate`}
                            aria-pressed={!!item.perPlate}
                            onClick={() => togglePlate(cat.id, item)}
                          >🍽</button>
                          <button
                            type="button"
                            className={item.markup ? styles.markupBtnOn : styles.markupBtn}
                            title={item.markup ? 'A % of other lines — click to change what it’s charged on' : 'Make this a % of other lines (service charge, tax)'}
                            aria-label={`${item.name} percent of other lines`}
                            aria-pressed={!!item.markup}
                            aria-haspopup="dialog"
                            onClick={(e) => {
                              const row = e.currentTarget.closest('tr');
                              if (!item.markup) {
                                toggleMarkup(cat, item);
                                setMarkupPop({ id: item.id, anchor: row });
                              } else openMarkupPop(item, row);
                            }}
                          >%</button>
                          <button type="button" className={styles.remove} title="Remove item" aria-label={`Remove ${item.name}`} onClick={() => removeItem(cat.id, item.id)}>×</button>
                        </td>
                      </tr>
                      {item.perPlate && (
                        <PlateRow item={item} guestN={guestN} onChange={(perPlate) => editItem(cat.id, item.id, { perPlate })} />
                      )}
                      {item.markup && markupPop?.id === item.id && (
                        <MarkupPopover
                          item={item}
                          cat={cat}
                          total={total}
                          anchor={markupPop.anchor}
                          onChange={(markup) => editItem(cat.id, item.id, { markup })}
                          onOff={() => { closeMarkupPop(); toggleMarkup(cat, item); }}
                          onClose={closeMarkupPop}
                        />
                      )}
                    </Fragment>
                  );
                })}
                <tr className={styles.addRow}>
                  <td colSpan={COLS}>
                    <button type="button" className={styles.addItem} onClick={() => addItem(cat.id)}>+ item</button>
                  </td>
                </tr>
              </tbody>
            );
          })}
          <tfoot>
            <tr className={styles.sumRow}>
              <td className={styles.footLabel}>Subtotal</td>
              <td className={styles.footNumLight} data-testid="split-pct-pretax">{formatPct(sum)}</td>
              <td className={styles.footNumLight} data-testid="split-amount-pretax">{canMoney ? formatMoney(amountFor(sum, total)) : '—'}</td>
              <td className={styles.footNumLight} data-testid="split-tax">{canMoney ? formatMoney(amountFor(taxSum, total)) : '—'}</td>
              <td />
              <td />
            </tr>
            <tr className={styles.grossRow}>
              <td className={styles.footLabel}>Total with tax</td>
              <td className={diff === 0 ? styles.footNum : styles.footNumWarn} data-testid="split-pct">{formatPct(gross)}</td>
              <td className={styles.footNum} data-testid="split-amount">{canMoney ? formatMoney(amountFor(gross, total)) : '—'}</td>
              <td />
              <td className={styles.footNum} data-testid="split-pp">{perPerson(gross)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className={styles.splitFoot}>
        <button type="button" className={styles.add} onClick={addCat}>+ Add category</button>
        {diff !== 0 && (
          <span className={styles.balance} role="status">
            {diff > 0
              ? <>{formatPct(diff)}{canMoney ? ` (${formatMoney(amountFor(diff, total))})` : ''} not assigned yet.</>
              : <>{formatPct(-diff)}{canMoney ? ` (${formatMoney(amountFor(-diff, total))})` : ''} over the total.</>}
            {gross > 0 && <button type="button" className={styles.link} onClick={() => update((p) => ({ ...p, categories: scaleTo100(resolved(p), p.salesTax.rate) }))}>Scale to 100%</button>}
          </span>
        )}
      </div>
    </section>
  );
}

/* The calculator, on its own tab: type what each budget line actually costs —
   a quote, an invoice — and it adds them up to the total fee, with sales tax
   on the lines ticked for it in the split. Each box's placeholder is what the
   split budgets for that line, and the total is held against the budget. */
function Calculator({ plan, update, counts, venueNames, onCompare }) {
  const { amount: budget } = effectiveTotal(plan);
  const cats = resolveCategories(plan.categories, budget, headcount(plan.guests, counts));
  const perPerson = plan.calculator.perPerson;
  const subs = plan.calculator.subs;
  const guestN = headcount(plan.guests, counts);
  // Every line in dollars — flat fees as typed, per-person prices × the
  // guests, lines with sub-items summed — and which lines are included.
  const { amounts, included } = effectiveCalc(plan.calculator, guestN);
  const rate = plan.salesTax.rate;
  const t = calculatorTotals(cats, amounts, rate, included);
  // Each category's own sum, shown under it and — for the venue's bill — per person.
  const groupTotals = new Map(calculatorGroupTotals(cats, amounts, rate, included).map((g) => [g.id, g]));
  const venueGroup = venueGroupOf([...groupTotals.values()]);
  const budgeted = (line) => {
    if (budget > 0) return formatMoney(amountFor(line.pct, budget));
    return '$0';
  };
  const budgetedEach = (line) => (budget > 0 && guestN > 0 ? formatMoney(amountFor(line.pct, budget) / guestN) || '$0' : '$0');
  const byId = new Map(cats.flatMap((c) => (c.items.length ? c.items : [c])).map((l) => [l.id, l]));
  const setAmount = (id, v) => update((p) => {
    const next = { ...p.calculator.amounts };
    if (v == null) delete next[id]; else next[id] = v;
    return { ...p, calculator: { ...p.calculator, amounts: next } };
  });
  // A per-person line keeps its switch when the box is cleared ($0 a head).
  const setPrice = (id, v) => update((p) => ({
    ...p, calculator: { ...p.calculator, perPerson: { ...p.calculator.perPerson, [id]: v ?? 0 } },
  }));
  const togglePerPerson = (id) => update((p) => ({ ...p, calculator: toggleCalcPerPerson(p.calculator, id, guestN) }));
  // "Included": the venue's price already covers this line. It carries no
  // amount of its own; unticking brings the empty box back.
  const setIncluded = (id, on) => update((p) => {
    const inc = { ...p.calculator.included };
    const amt = { ...p.calculator.amounts };
    const pp = { ...p.calculator.perPerson };
    if (on) { inc[id] = true; delete amt[id]; delete pp[id]; } else delete inc[id];
    return { ...p, calculator: { ...p.calculator, amounts: amt, included: inc, perPerson: pp } };
  });
  // Sub-items: a line broken down (Food → cocktail hour, raw bar, dinner).
  const editSubs = (lineId, fn) => update((p) => {
    const list = fn(p.calculator.subs[lineId] || []);
    const next = { ...p.calculator.subs };
    if (list.length) next[lineId] = list; else delete next[lineId];
    return { ...p, calculator: { ...p.calculator, subs: next } };
  });
  const addSub = (lineId) => editSubs(lineId, (list) => [...list, { id: newId('s'), name: '', amount: null, pp: false, included: false }]);
  const patchSub = (lineId, subId, patch) => editSubs(lineId, (list) => list.map((x) => (x.id === subId ? { ...x, ...patch } : x)));
  const removeSub = (lineId, subId) => editSubs(lineId, (list) => list.filter((x) => x.id !== subId));
  const clear = () => {
    if (!t.filled || !window.confirm('Clear every amount in the calculator? Sub-items stay, emptied, ready for the next venue.')) return;
    update((p) => ({ ...p, calculator: clearedCalculator(p.calculator) }));
  };
  const diff = budget > 0 ? budget - t.total : null;

  // Saving what's typed under a venue's name, and bringing a saved one back.
  const quotes = plan.venueQuotes;
  const [venueName, setVenueName] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const existing = findVenueQuote(quotes, venueName);
  const saveVenue = () => {
    const name = venueName.trim();
    if (!name || !t.filled) return;
    update((p) => ({ ...p, venueQuotes: saveVenueQuote(p.venueQuotes, name, p.calculator) }));
    setSavedNote(`${existing ? 'Updated' : 'Saved'} ${name}.`);
  };
  const loadVenue = (q) => {
    const unsaved = t.filled > 0 && !quotes.some((x) => sameCalc(x, plan.calculator));
    if (unsaved && !window.confirm(`Replace what's in the calculator with ${q.name}'s pricing? What's typed now isn't saved under any venue.`)) return;
    update((p) => ({ ...p, calculator: structuredClone({ amounts: q.amounts, included: q.included, perPerson: q.perPerson, subs: q.subs }) }));
    setVenueName(q.name);
    setSavedNote('');
  };
  const removeVenue = (q) => {
    if (!window.confirm(`Delete the saved pricing for ${q.name}?`)) return;
    update((p) => ({ ...p, venueQuotes: p.venueQuotes.filter((x) => x.id !== q.id) }));
  };

  return (
    <aside className={`${styles.card} ${styles.calc}`} aria-label="Calculator">
      <div className={styles.calcHead}>
        <h2 className={styles.cardTitle}>Calculator</h2>
        {t.filled > 0 && <button type="button" className={styles.link} onClick={clear}>Clear</button>}
      </div>
      <p className={styles.cardHint}>Type what each line costs to get the total fee. Press 👤 on a line to price it per person instead of as a flat fee, or + to break it into sub-items (raw bar, cocktail hour) that add up to it. The grey figure is what the split budgets for it; sales tax is added to the lines ticked for it in the split.</p>
      {/* The same guest count as the Budget tab's, here because per-person lines turn on it. */}
      <GuestsField plan={plan} update={update} counts={counts} hint="what a per-person line is multiplied by" />
      <div className={styles.calcIncHead} aria-hidden="true">Incl.</div>
      <div className={styles.calcList}>
        {calculatorGroups(cats).map((g) => (
          <div key={g.id} className={styles.calcGroup}>
            {(g.lines.length > 1 || g.lines[0].id !== g.id) && <div className={styles.calcCat}>{g.name || 'Untitled'}</div>}
            {g.lines.map((l) => (
              <Fragment key={l.id}>
                <div className={styles.calcLine}>
                  <button
                    type="button"
                    className={styles.calcSubAdd}
                    aria-label={`Add a sub-item under ${l.name || 'this line'}`}
                    data-testid={`calc-sub-add-${l.id}`}
                    title="Add a sub-item (raw bar, cocktail hour…)"
                    onClick={() => addSub(l.id)}
                  >+</button>
                  <label className={styles.calcLabel}>
                    <span className={g.lines[0].id === g.id ? styles.calcCatName : styles.calcName} title={l.name}>
                      {l.name || 'Untitled'}
                    </span>
                    {lineFromSubs(plan.calculator, l.id) ? (
                      <span className={included[l.id] ? styles.calcIncluded : styles.calcDerived} data-testid={`calc-derived-${l.id}`} title="The sum of its sub-items">
                        {included[l.id] ? 'Included' : formatMoney(amounts[l.id]) || '$0'}
                      </span>
                    ) : included[l.id] ? (
                      <span className={styles.calcIncluded} data-testid={`calc-included-${l.id}`}>Included</span>
                    ) : l.id in perPerson ? (
                      <NumberField
                        {...moneyField}
                        className={`${styles.calcNum} ${styles.calcNumPp}`}
                        label={`${l.name || 'Line'} cost per person`}
                        placeholder={guestN > 0 ? budgetedEach(byId.get(l.id) || { pct: 0 }) : '$0'}
                        value={perPerson[l.id] || null}
                        onCommit={(v) => setPrice(l.id, v)}
                      />
                    ) : (
                      <NumberField
                        {...moneyField}
                        className={styles.calcNum}
                        label={`${l.name || 'Line'} cost`}
                        placeholder={budgeted(byId.get(l.id) || { pct: 0 })}
                        value={amounts[l.id] ?? null}
                        onCommit={(v) => setAmount(l.id, v)}
                      />
                    )}
                  </label>
                  <button
                    type="button"
                    disabled={lineFromSubs(plan.calculator, l.id)}
                    className={l.id in perPerson ? styles.calcPpOn : styles.calcPpBtn}
                    aria-pressed={l.id in perPerson}
                    aria-label={`${l.name || 'Line'} priced per person`}
                    data-testid={`calc-pp-toggle-${l.id}`}
                    title={l.id in perPerson ? 'Per person — click to go back to a flat fee' : 'Price this per person instead of a flat fee'}
                    onClick={() => togglePerPerson(l.id)}
                  >👤</button>
                  <input
                    type="checkbox"
                    className={styles.calcIncCheck}
                    checked={!!included[l.id]}
                    disabled={lineFromSubs(plan.calculator, l.id)}
                    aria-label={`${l.name || 'Line'} included in the venue's price`}
                    title={included[l.id] ? 'Included in the venue’s price — untick to type a cost' : 'Tick if the venue’s price already includes this'}
                    onChange={(e) => setIncluded(l.id, e.target.checked)}
                  />
                </div>
                {(subs[l.id] || []).map((x, xi) => (
                  <div key={x.id} className={styles.calcSub} data-testid="calc-sub">
                    <span className={styles.calcSubDot} aria-hidden="true">•</span>
                    <input
                      className={styles.calcSubName}
                      aria-label={`Sub-item ${xi + 1} of ${l.name || 'line'}`}
                      placeholder="Sub-item (raw bar…)"
                      value={x.name}
                      autoFocus={!x.name && !x.included && x.amount == null && xi === subs[l.id].length - 1}
                      onChange={(e) => patchSub(l.id, x.id, { name: e.target.value })}
                    />
                    {x.included ? (
                      <span className={styles.calcSubIncluded}>Included</span>
                    ) : (
                      <NumberField
                        {...moneyField}
                        className={`${styles.calcSubNum} ${x.pp ? styles.calcNumPp : ''}`}
                        label={`${x.name || 'Sub-item'} cost${x.pp ? ' per person' : ''}`}
                        placeholder="$0"
                        value={x.amount}
                        onCommit={(v) => patchSub(l.id, x.id, { amount: v })}
                      />
                    )}
                    <button
                      type="button"
                      disabled={x.included}
                      className={x.pp ? styles.calcPpOn : styles.calcPpBtn}
                      aria-pressed={x.pp}
                      aria-label={`${x.name || 'Sub-item'} priced per person`}
                      title={x.pp ? `Per person${guestN > 0 && x.amount != null ? ` × ${guestN} guests = ${formatMoney(subDollars(x, guestN)) || '$0'}` : ''} — click for a flat fee` : 'Price this per person'}
                      onClick={() => patchSub(l.id, x.id, { pp: !x.pp })}
                    >👤</button>
                    <input
                      type="checkbox"
                      className={styles.calcIncCheck}
                      checked={x.included}
                      aria-label={`${x.name || 'Sub-item'} included in the venue's price`}
                      title={x.included ? 'Included — untick to type a cost' : 'Tick if the venue’s price already includes this'}
                      onChange={(e) => patchSub(l.id, x.id, e.target.checked ? { included: true, amount: null, pp: false } : { included: false })}
                    />
                    <button type="button" className={styles.calcSubRemove} aria-label={`Remove ${x.name || 'sub-item'}`} title="Remove this sub-item" onClick={() => removeSub(l.id, x.id)}>×</button>
                  </div>
                ))}
                {lineFromSubs(plan.calculator, l.id) ? (
                  l.food && amounts[l.id] != null && guestN > 0 && (
                    <div className={styles.calcPerPerson} data-testid={`calc-pp-${l.id}`}>
                      {formatMoney(amounts[l.id] / guestN) || '$0'} per person × {guestN} guests
                    </div>
                  )
                ) : l.id in perPerson ? (
                  <div className={styles.calcPerPerson} data-testid={`calc-pp-${l.id}`}>
                    {guestN > 0
                      ? <>per person × {guestN} guests = <strong>{formatMoney(amounts[l.id]) || '$0'}</strong></>
                      : 'per person — set a guest count above'}
                  </div>
                ) : l.food && amounts[l.id] != null && guestN > 0 && (
                  <div className={styles.calcPerPerson} data-testid={`calc-pp-${l.id}`}>
                    {formatMoney(amounts[l.id] / guestN) || '$0'} per person × {guestN} guests
                  </div>
                )}
              </Fragment>
            ))}
            {(() => {
              const gt = groupTotals.get(g.id);
              if (!gt || gt.priced === 0 || g.lines.length < 2) return null;
              return (
                <div className={styles.calcGroupSum} data-testid={`calc-group-${g.id}`}>
                  <span>{g.name || 'Untitled'} total</span>
                  <strong>{formatMoney(gt.subtotal) || '$0'}</strong>
                  {guestN > 0 && <span className={styles.calcGroupPp}>{formatMoney(gt.subtotal / guestN) || '$0'} per person</span>}
                </div>
              );
            })()}
          </div>
        ))}
      </div>
      <dl className={styles.calcTotals}>
        <div><dt>Subtotal</dt><dd data-testid="calc-subtotal">{formatMoney(t.subtotal) || '$0'}</dd></div>
        <div><dt>Sales tax{rate > 0 ? ` (${formatRate(rate)})` : ''}</dt><dd data-testid="calc-tax">{formatMoney(t.tax) || '$0'}</dd></div>
        <div className={styles.calcGrand}><dt>Total fee</dt><dd data-testid="calc-total">{formatMoney(t.total) || '$0'}</dd></div>
        {venueGroup && venueGroup.priced > 0 && guestN > 0 && (
          <div className={styles.calcVenuePp}>
            <dt>{venueGroup.name} — per person<span className={styles.calcSmall}>{formatMoney(venueGroup.subtotal) || '$0'} ÷ {guestN} guests{venueGroup.tax > 0 ? `, ${formatMoney(venueGroup.total / guestN)} with tax` : ''}</span></dt>
            <dd data-testid="calc-venue-pp">{formatMoney(venueGroup.subtotal / guestN) || '$0'}</dd>
          </div>
        )}
        {t.foodLines > 0 && guestN > 0 && (
          <div><dt>Food per person</dt><dd data-testid="calc-food-pp">{formatMoney(t.food / guestN) || '$0'}</dd></div>
        )}
        {guestN > 0 && t.filled > 0 && (
          <div><dt>Total per person</dt><dd data-testid="calc-total-pp">{formatMoney(t.total / guestN) || '$0'}</dd></div>
        )}
      </dl>
      <p className={styles.calcNote} data-testid="calc-note">
        {t.filled === 0
          ? 'Nothing typed in yet.'
          : <>{t.filled} of {t.lines} lines filled in{t.included > 0 ? ` (${t.included} included)` : ''}.{diff != null && (
            <> <span className={diff >= 0 ? styles.calcUnder : styles.calcOver}>
              {diff >= 0 ? `${formatMoney(diff)} under` : `${formatMoney(-diff)} over`} the {formatMoney(budget)} budget.
            </span></>
          )}</>}
      </p>

      <div className={styles.venueSave} data-testid="venue-save">
        <div className={styles.venueSaveTitle}>Save this pricing for a venue</div>
        <div className={styles.venueSaveRow}>
          <input
            className={styles.venueSaveName}
            list="budget-venue-names"
            aria-label="Venue name"
            placeholder="Venue name"
            value={venueName}
            onChange={(e) => { setVenueName(e.target.value); setSavedNote(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') saveVenue(); }}
          />
          <datalist id="budget-venue-names">
            {[...new Set([...quotes.map((q) => q.name), ...venueNames])].map((n) => <option key={n} value={n} />)}
          </datalist>
          <button type="button" className={styles.venueSaveBtn} disabled={!venueName.trim() || !t.filled} onClick={saveVenue}>
            {existing ? 'Update' : 'Save'}
          </button>
        </div>
        {savedNote && <p className={styles.calcUnder} style={{ fontSize: '0.78rem', margin: '0.3rem 0 0' }} role="status">{savedNote}</p>}
        {!t.filled && <p className={styles.calcNote}>Type the venue's prices above first.</p>}
        {quotes.length > 0 && (
          <ul className={styles.venueList}>
            {quotes.map((q) => (
              <li key={q.id} data-testid={`venue-quote-${q.name}`}>
                <button type="button" className={styles.venueLoad} title={`Put ${q.name}'s pricing in the calculator`} onClick={() => loadVenue(q)}>{q.name}</button>
                <span className={styles.venueTotal}>{(() => { const e = effectiveCalc(q, guestN); return formatMoney(calculatorTotals(cats, e.amounts, rate, e.included).total) || '$0'; })()}</span>
                <button type="button" className={styles.remove} title={`Delete ${q.name}`} aria-label={`Delete ${q.name}`} onClick={() => removeVenue(q)}>×</button>
              </li>
            ))}
          </ul>
        )}
        {quotes.length > 0 && <button type="button" className={styles.link} onClick={onCompare}>Compare venues →</button>}
      </div>
    </aside>
  );
}

/* Budget → Venue cost comparison: every saved venue's pricing side by side,
   on the budget's own lines, with the split's figure beside them. */
/* Many venues at once: download a sheet (one row per venue, one column per
   budget line, the saved venues already in it) and import it back — by the
   button or by dropping the file anywhere on the tab. Importing shows what
   would change first; nothing is saved until it's confirmed. */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function useVenueImport({ plan, update, categories, setMsg }) {
  const [pending, setPending] = useState(null); // { fileName, rows, mapping }
  const [dragging, setDragging] = useState(false);

  const openFile = useCallback(async (file) => {
    if (!file) return;
    setPending(null);
    try {
      const XLSX = await import('xlsx');
      const rows = readVenueFile(file.name, await file.arrayBuffer(), XLSX); // throws on a non-.xlsx file / no Venues sheet
      planQuoteImport(categories, plan.venueQuotes, rows); // throws on no Venue column / no rows
      // Headings that match no line start skipped; the preview offers the likely line, it doesn't pick it.
      setMsg(null);
      setPending({ fileName: file.name, rows, mapping: {} });
    } catch (err) {
      setMsg({ type: 'error', text: `Couldn’t import ${file.name}: ${err.message}. Nothing was changed.` });
    }
  }, [categories, plan.venueQuotes, setMsg]);

  // The whole tab takes a dropped file; without this a stray drop would open the file in the browser.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const enter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth += 1; setDragging(true); };
    const over = (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      openFile(e.dataTransfer.files?.[0]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  const confirm = () => {
    const { rows, mapping } = pending;
    const r = planQuoteImport(categories, plan.venueQuotes, rows, new Date(), { mapping });
    update((p) => ({ ...p, venueQuotes: planQuoteImport(categories, p.venueQuotes, rows, new Date(), { mapping }).quotes }));
    setPending(null);
    const did = [r.added.length ? `added ${plural(r.added.length, 'venue')}` : '', r.updated.length ? `updated ${plural(r.updated.length, 'venue')}` : ''].filter(Boolean).join(' and ');
    const cells = Object.values(r.changes).reduce((n, c) => n + c.length, 0);
    const left = [r.bad.length ? `${plural(r.bad.length, 'cell')} left out` : '', r.unknown.length ? `${plural(r.unknown.length, 'column')} skipped` : ''].filter(Boolean).join(', ');
    setMsg({ type: 'ok', text: `Imported ${pending.fileName}: ${did} (${plural(cells, 'cell')} set)${left ? ` — ${left}` : ''}.` });
  };
  const setMapping = (index, id) => setPending((p) => ({ ...p, mapping: { ...p.mapping, [index]: id } }));
  return { pending, dragging, openFile, confirm, cancel: () => setPending(null), setMapping };
}

function VenueSheetTools({ plan, categories, msg, setMsg, importer }) {
  const fileRef = useRef(null);
  const download = async () => {
    try {
      const XLSX = await import('xlsx');
      const { venues, howTo } = quoteSheetRows(categories, plan.venueQuotes);
      const ws = XLSX.utils.aoa_to_sheet(venues);
      ws['!cols'] = venues[0].map((h, i) => ({ wch: i === 0 ? 28 : i === venues[0].length - 1 ? 44 : Math.min(30, Math.max(12, String(h).length + 2)) }));
      ws['!freeze'] = { xSplit: 1, ySplit: 1 };
      const notes = XLSX.utils.aoa_to_sheet(howTo);
      notes['!cols'] = [{ wch: 46 }, { wch: 52 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Venues');
      XLSX.utils.book_append_sheet(wb, notes, 'How to fill in');
      XLSX.writeFile(wb, 'venue-pricing-template.xlsx');
      const n = plan.venueQuotes.length;
      setMsg({ type: 'ok', text: `Downloaded the template${n ? ` with your ${n} saved venue${n === 1 ? '' : 's'} in it` : ''}. Add one venue per row, then drop it here.` });
    } catch (err) {
      setMsg({ type: 'error', text: `Could not make the template: ${err.message}` });
    }
  };
  return (
    <div className={styles.sheetTools} data-testid="venue-sheet-tools">
      <button type="button" className={styles.sheetBtn} onClick={download} title="An Excel sheet with one row per venue and a column for each budget line — your saved venues are already in it">⬇ Download Excel template</button>
      <button type="button" className={styles.sheetBtn} onClick={() => fileRef.current?.click()} title="Add or update many venues from a filled-in template (.xlsx)">⬆ Import venues from Excel</button>
      <span className={styles.sheetDropHint}>or drop a filled-in .xlsx anywhere on this tab</span>
      <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} hidden aria-label="Venue pricing spreadsheet to import" data-testid="venue-import-input"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; importer.openFile(f); }} />
      {msg && <p className={msg.type === 'error' ? styles.sheetMsgErr : styles.sheetMsg} role="status">{msg.text}</p>}
      {importer.pending && <VenueImportPreview plan={plan} categories={categories} importer={importer} />}
    </div>
  );
}

function VenueImportPreview({ plan, categories, importer }) {
  const { pending, confirm, cancel, setMapping } = importer;
  const r = planQuoteImport(categories, plan.venueQuotes, pending.rows, new Date(), { mapping: pending.mapping });
  const groups = calculatorGroups(categories);
  const lines = quoteSheetLines(categories);
  const labelOf = new Map(lines.map((l) => [l.id, l.label]));
  const toMap = r.columns.filter((c) => c.kind !== 'line');
  const nothing = !r.added.length && !r.updated.length;
  const changeList = (name, isNew) => (
    <ul className={styles.importCells}>
      {r.changes[name].map((ch) => (
        <li key={ch.column}>
          <span className={styles.importCol}>{ch.column}</span>{isNew ? ': ' : ' '}
          {!isNew && <><span className={styles.importFrom}>{ch.from}</span> → </>}<strong>{ch.to}</strong>
        </li>
      ))}
      {r.changes[name].length === 0 && <li className={styles.importFrom}>Name only — no prices yet</li>}
    </ul>
  );
  return (
    <div className={styles.importPreview} role="dialog" aria-label={`Import ${pending.fileName}`} data-testid="venue-import-preview">
      <h3 className={styles.importTitle}>Import {pending.fileName}?</h3>
      <p className={styles.cardHint}>
        {nothing ? 'Nothing would change — every venue in the file matches what’s saved.' : [r.added.length ? `${plural(r.added.length, 'venue')} to add` : '', r.updated.length ? `${plural(r.updated.length, 'venue')} to update` : ''].filter(Boolean).join(', ') + '. Nothing is saved until you import.'}
        {' '}Blank cells leave what’s saved as it is.
      </p>

      {toMap.length > 0 && (
        <div className={styles.importSection} data-testid="venue-import-mapping">
          <h4 className={styles.importHead}>Columns that don’t match a budget line</h4>
          <p className={styles.cardHint}>These are skipped unless you pick the budget line each one is for.</p>
          <table className={styles.importMapTable}>
            <tbody>
              {toMap.map((c) => (
                <tr key={c.index}>
                  <td className={styles.importCol}>{c.header}</td>
                  <td>
                    <select className={styles.importSelect} aria-label={`Budget line for the “${c.header}” column`} value={c.id || ''} onChange={(e) => setMapping(c.index, e.target.value)}>
                      <option value="">Skip this column</option>
                      {groups.map((g) => (
                        <optgroup key={g.id} label={g.name || 'Untitled'}>
                          {g.lines.map((l) => <option key={l.id} value={l.id}>{labelOf.get(l.id)}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {c.suggestion && !c.id && (
                      <button type="button" className={styles.importSuggest} onClick={() => setMapping(c.index, c.suggestion)} data-testid={`venue-import-suggest-${c.index}`}>
                        Use “{labelOf.get(c.suggestion)}”?
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.added.length > 0 && (
        <div className={styles.importSection} data-testid="venue-import-added">
          <h4 className={styles.importHead}>New venues</h4>
          {r.added.map((n) => <div key={n} className={styles.importVenue}><strong>{n}</strong>{changeList(n, true)}</div>)}
        </div>
      )}
      {r.updated.length > 0 && (
        <div className={styles.importSection} data-testid="venue-import-updated">
          <h4 className={styles.importHead}>Venues to update</h4>
          {r.updated.map((n) => <div key={n} className={styles.importVenue}><strong>{n}</strong>{changeList(n)}</div>)}
        </div>
      )}
      {r.unchanged.length > 0 && <p className={styles.cardHint}>Already up to date: {r.unchanged.join(', ')}.</p>}
      {(r.unknown.length > 0 || r.bad.length > 0 || r.skipped > 0) && (
        <div className={styles.importSection} data-testid="venue-import-problems">
          <h4 className={styles.importHead}>Left out</h4>
          <ul className={styles.importCells}>
            {r.unknown.length > 0 && <li>Skipped columns: {r.unknown.join(', ')}</li>}
            {r.bad.map((b, i) => <li key={i}>Couldn’t read <strong>{b.venue}</strong> · {b.column}: “{b.value}”</li>)}
            {r.skipped > 0 && <li>{plural(r.skipped, 'row')} without a venue name</li>}
          </ul>
        </div>
      )}
      <div className={styles.importActs}>
        <button type="button" className={styles.importGo} onClick={confirm} disabled={nothing}>Import</button>
        <button type="button" className={styles.sheetBtn} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}

/* A venue's availability: its notes (free text, from the Excel import) and
   the couple's own yes / no, set here. Opened from the Available? pill. */
function AvailabilityPopover({ venue, anchor, onSet, onClose }) {
  const { ref, pos } = useAnchoredPop(anchor, onClose, [venue.availability]);
  const choice = (val, label) => (
    <button type="button" className={venue.available === val ? styles.availChoiceOn : styles.availChoice} aria-pressed={venue.available === val} onClick={() => onSet(venue.available === val ? null : val)}>
      {label}
    </button>
  );
  return createPortal(
    <div
      ref={ref}
      className={`${styles.markupPop} ${styles.availPop}`}
      role="dialog"
      aria-label={`${venue.name} availability`}
      data-testid="venue-avail-pop"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      <div className={styles.markupPopHead}>
        <strong>{venue.name}</strong>
        <button type="button" className={styles.markupPopClose} onClick={onClose} aria-label="Close">×</button>
      </div>
      <h4 className={styles.importHead}>Availability notes</h4>
      {venue.availability
        ? <p className={styles.availNotes} data-testid="venue-avail-notes">{venue.availability}</p>
        : <p className={styles.cardHint}>No notes yet. They come from the Availability column of the Excel template.</p>}
      <h4 className={styles.importHead}>Available for your date?</h4>
      <div className={styles.availChoices}>
        {choice(true, 'Yes')}
        {choice(false, 'No')}
      </div>
      {venue.available != null && <button type="button" className={styles.markupPopOff} onClick={() => onSet(null)}>Clear — not decided</button>}
    </div>,
    document.body,
  );
}

function VenueCompare({ plan, update, counts, venueAreas, onOpen }) {
  const { amount: budget } = effectiveTotal(plan);
  const guestN = headcount(plan.guests, counts);
  const cats = resolveCategories(plan.categories, budget, guestN);
  const rate = plan.salesTax.rate;
  const c = venueComparison(cats, plan.venueQuotes, rate, budget, guestN);
  // Kept here, not in the tools, so it survives the switch from the empty card to the table.
  const [sheetMsg, setSheetMsg] = useState(null);
  const importer = useVenueImport({ plan, update, categories: cats, setMsg: setSheetMsg });
  const dropZone = importer.dragging && (
    <div className={styles.dropZone} data-testid="venue-drop-zone" aria-hidden="true">
      <span>Drop your .xlsx to import venues</span>
    </div>
  );
  const cell = (v) => (v == null ? <span className={styles.dash}>—</span> : formatMoney(v) || '$0');
  // Area, from the Venues tab: shown when locations are set up there.
  const showArea = venueAreas?.size > 0;
  const areaCell = (v) => {
    const a = areaForName(venueAreas, v.name);
    return a ? a : <span className={styles.dash} title={a === null ? 'Not on the Venues tab under this name' : 'In none of your locations'}>—</span>;
  };
  // The venue whose availability pop-up is open, and the pill it hangs off.
  const [availFor, setAvailFor] = useState(null);
  const closeAvail = useCallback(() => setAvailFor(null), []);
  const availVenue = availFor && plan.venueQuotes.find((q) => q.id === availFor.id);
  // Venues are the rows; the budget's lines (and their sub-items) are the
  // columns, under their category. A category with no items is one column.
  const groups = [];
  for (const r of c.rows) {
    if (r.kind === 'category') groups.push({ key: r.id, name: r.name, cols: [] });
    else if (r.kind === 'line' && r.standalone) groups.push({ key: `g-${r.id}`, name: r.name, cols: [r], standalone: true });
    else groups[groups.length - 1]?.cols.push(r);
  }
  for (const g of groups) g.single = g.standalone && g.cols.length === 1;
  const cols = groups.flatMap((g) => g.cols);
  const td = (key, className, content, testid) => <td key={key} className={className} data-testid={testid}>{content}</td>;
  const venuePP = c.venues.find((v) => v.venuePerPerson)?.venuePerPerson;
  const summary = [
    { key: 'subtotal', label: 'Subtotal', venue: (v) => td('subtotal', styles.compareFoot, v.filled ? formatMoney(v.subtotal) || '$0' : '—') },
    { key: 'tax', label: 'Sales tax', venue: (v) => td('tax', styles.compareFoot, v.filled ? formatMoney(v.tax) || '$0' : '—') },
    { key: 'total', label: 'Total', budget: budget > 0 ? formatMoney(budget) : null,
      venue: (v) => td('total', c.cheapest === v.id ? styles.compareTotalLow : styles.compareTotal, v.filled ? formatMoney(v.total) || '$0' : '—', `compare-total-${v.name}`) },
    { key: 'pp', label: 'Per person', budget: budget > 0 && guestN > 0 ? formatMoney(budget / guestN) : null,
      venue: (v) => td('pp', styles.compareFoot, v.perPerson == null ? '—' : formatMoney(v.perPerson)) },
    ...(venuePP ? [{ key: 'venuePP', label: <>{venuePP.name} per person <span className={styles.compareSmall}>before tax</span></>,
      venue: (v) => td('venuePP', styles.compareFoot, v.venuePerPerson ? formatMoney(v.venuePerPerson.subtotal) || '$0' : '—', `compare-venue-pp-${v.name}`) }] : []),
    { key: 'food', label: <>Food per person <span className={styles.compareSmall}>before tax</span></>,
      venue: (v) => td('food', styles.compareFoot, v.foodPerPerson == null ? '—' : formatMoney(v.foodPerPerson) || '$0', `compare-food-pp-${v.name}`) },
    { key: 'diff', label: 'Against the budget',
      venue: (v) => td('diff', styles.compareFoot, v.diff == null ? '—' : (
        <span className={v.diff >= 0 ? styles.calcUnder : styles.calcOver}>{v.diff >= 0 ? `${formatMoney(v.diff) || '$0'} under` : `${formatMoney(-v.diff)} over`}</span>
      ), `compare-diff-${v.name}`) },
    { key: 'lines', label: 'Lines priced', venue: (v) => td('lines', styles.compareFoot, `${v.filled} of ${v.lines}${v.included > 0 ? ` (${v.included} incl.)` : ''}`) },
    { key: 'avail', label: 'Available?',
      venue: (v) => {
        const word = v.available === true ? 'Yes' : v.available === false ? 'No' : 'Set';
        const cls = v.available === true ? styles.availYes : v.available === false ? styles.availNo : styles.availUnset;
        return td('avail', styles.compareAvailCell, (
          <button
            type="button"
            className={cls}
            aria-haspopup="dialog"
            aria-expanded={availFor?.id === v.id}
            aria-label={`${v.name} available: ${v.available == null ? 'not set' : word}${v.availability ? ', has notes' : ''}. Show notes`}
            onClick={(e) => { const a = e.currentTarget; setAvailFor((o) => (o?.id === v.id ? null : { id: v.id, anchor: a })); }}
          >
            {word}{v.availability && <span className={styles.availNote} aria-hidden="true" />}
          </button>
        ), `compare-avail-${v.name}`);
      } },
  ];
  // What decides between venues sits next to the name; the tax arithmetic follows the lines.
  const LEAD = ['total', 'pp', 'diff', 'lines', 'avail'];
  const lead = LEAD.map((k) => summary.find((t) => t.key === k)).filter(Boolean);
  const tail = summary.filter((t) => !LEAD.includes(t.key));
  const remove = (v) => {
    if (!window.confirm(`Delete the saved pricing for ${v.name}?`)) return;
    update((p) => ({ ...p, venueQuotes: p.venueQuotes.filter((x) => x.id !== v.id) }));
  };
  const open = (v) => {
    const q = plan.venueQuotes.find((x) => x.id === v.id);
    const calc = plan.calculator;
    const unsaved = calcHasAnswers(calc) && !plan.venueQuotes.some((x) => sameCalc(x, calc));
    if (unsaved && !window.confirm(`Replace what's in the calculator with ${v.name}'s pricing? What's typed there now isn't saved under any venue.`)) return;
    update((p) => ({ ...p, calculator: structuredClone({ amounts: q.amounts, included: q.included, perPerson: q.perPerson, subs: q.subs }) }));
    onOpen();
  };

  if (c.venues.length === 0) {
    return (
      <section className={styles.card} data-testid="venue-compare-empty">
        <h2 className={styles.cardTitle}>Venue cost comparison</h2>
        <p className={styles.cardHint}>
          No venue pricing saved yet. On the Calculator tab, type a venue's prices, give it the venue's name under
          “Save this pricing for a venue”, and it will show up here beside the others.
        </p>
        <button type="button" className={styles.link} onClick={onOpen}>Go to the calculator →</button>
        <p className={styles.cardHint}>Or, for lots of venues at once, fill in the Excel template and import it.</p>
        <VenueSheetTools plan={plan} categories={cats} msg={sheetMsg} setMsg={setSheetMsg} importer={importer} />
        {dropZone}
      </section>
    );
  }

  return (
    <section className={styles.card} data-testid="venue-compare">
      <h2 className={styles.cardTitle}>Venue cost comparison</h2>
      <p className={styles.cardHint}>
        Each venue's saved pricing on the same budget lines. Sales tax{rate > 0 ? ` (${formatRate(rate)})` : ''} is added to the lines ticked for it in the split
        {guestN > 0 ? <>, and per person divides by {guestN} guests</> : null}. The lowest price on a line is in green.
      </p>
      <VenueSheetTools plan={plan} categories={cats} msg={sheetMsg} setMsg={setSheetMsg} importer={importer} />
      {dropZone}
      {c.rows.length === 0 && <p className={styles.cardHint}>None of the saved venues has a price on a current budget line.</p>}
      <div className={styles.scroll}>
        <table className={styles.compareTable} data-testid="compare-table">
          <thead>
            <tr>
              {showArea && <th rowSpan={2} className={styles.compareAreaHead}>Area</th>}
              <th rowSpan={2} className={showArea ? `${styles.compareCorner} ${styles.compareAfterArea}` : styles.compareCorner}>Venue</th>
              {lead.map((t) => <th key={t.key} rowSpan={2} className={t.key === 'total' ? styles.compareTotalHead : styles.compareColHead}>{t.label}</th>)}
              {groups.map((g) => (g.single ? (
                <th key={g.key} rowSpan={2} className={styles.compareColHead} title={g.name}>{g.name}</th>
              ) : (
                <th key={g.key} colSpan={g.cols.length} className={styles.compareGroupHead}>{g.name}</th>
              )))}
              {tail.map((t) => <th key={t.key} rowSpan={2} className={styles.compareColHead}>{t.label}</th>)}
            </tr>
            <tr>
              {groups.filter((g) => !g.single).flatMap((g) => g.cols.map((r) => (
                <th key={r.id} className={r.kind === 'sub' ? styles.compareSubHead : styles.compareColHead} title={r.name}>{r.kind === 'sub' ? `• ${r.name}` : r.name}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {budget > 0 && (
              <tr className={styles.compareBudgetRow} data-testid="compare-budget-row">
                {showArea && <td className={styles.compareArea} />}
                <th scope="row" className={showArea ? `${styles.compareRowHead} ${styles.compareAfterArea}` : styles.compareRowHead}>Budgeted</th>
                {lead.map((t) => <td key={t.key} className={styles.compareBudget}>{t.budget ?? ''}</td>)}
                {cols.map((r) => <td key={r.id} className={styles.compareBudget}>{r.kind === 'line' ? cell(r.budgeted) : ''}</td>)}
                {tail.map((t) => <td key={t.key} className={styles.compareBudget}>{t.budget ?? ''}</td>)}
              </tr>
            )}
            {c.venues.map((v, i) => (
              <tr key={v.id} data-testid={`compare-venue-${v.name}`}>
                {showArea && <td className={styles.compareArea} data-testid={`compare-area-${v.name}`}>{areaCell(v)}</td>}
                <th scope="row" className={showArea ? `${styles.compareRowHead} ${styles.compareAfterArea}` : styles.compareRowHead} data-testid={`compare-head-${v.name}`}>
                  <span className={styles.compareVenue}>{v.name}</span>
                  {c.cheapest === v.id && <span className={styles.compareBest}>Lowest total</span>}
                  <span className={styles.compareActs}>
                    <button type="button" className={styles.link} onClick={() => open(v)} title={`Open ${v.name} in the calculator to change it`}>Edit</button>
                    <button type="button" className={styles.remove} aria-label={`Delete ${v.name}`} title={`Delete ${v.name}`} onClick={() => remove(v)}>×</button>
                  </span>
                </th>
                {lead.map((t) => t.venue(v))}
                {cols.map((r) => (
                  <td key={r.id} className={`${r.low === i ? styles.compareLow : styles.compareNum} ${r.kind === 'sub' ? styles.compareSubCell : ''}`} data-testid={`compare-cell-${v.name}-${r.id}`}>
                    {r.included[i] ? 'Included' : cell(r.amounts[i])}
                    {r.perPerson[i] != null && <span className={styles.compareEach}>{formatMoney(r.perPerson[i]) || '$0'} {r.kind === 'sub' ? 'each' : 'per person'}</span>}
                  </td>
                ))}
                {tail.map((t) => t.venue(v))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {availVenue && (
        <AvailabilityPopover
          venue={availVenue}
          anchor={availFor.anchor}
          onSet={(val) => update((p) => ({ ...p, venueQuotes: setVenueAvailable(p.venueQuotes, availVenue.id, val) }))}
          onClose={closeAvail}
        />
      )}
      <p className={styles.calcNote}>
        A venue with fewer lines priced will look cheaper than it is — check “Lines priced” before comparing totals.
      </p>
    </section>
  );
}

export function WeddingBudget() {
  const { user } = useAuth();
  const { plan, update, saved, counts, venueNames, venueAreas } = usePlan(user?.uid);
  const [searchParams, setSearchParams] = useSearchParams();
  // Three tabs, kept in the URL: the plan (who's helping, the total, the
  // split), the calculator (what a venue actually charges), and the saved
  // venues side by side.
  const raw = searchParams.get('budget');
  const sub = raw === 'compare' || raw === 'calc' ? raw : 'plan';
  const setSub = (v) => setSearchParams(v === 'plan' ? { view: 'budget' } : { view: 'budget', budget: v });
  if (!plan) return <p className={styles.loading}>Loading…</p>;
  const tab = (key, label) => (
    <button type="button" role="tab" aria-selected={sub === key} className={sub === key ? navStyles.subnavOn : navStyles.subnavBtn} onClick={() => setSub(key)}>{label}</button>
  );
  const subnav = (
    <div className={navStyles.subnav} role="tablist" aria-label="Budget">
      {tab('plan', 'Budget')}
      {tab('calc', 'Calculator')}
      {tab('compare', `Venue cost comparison${plan.venueQuotes.length ? ` (${plan.venueQuotes.length})` : ''}`)}
    </div>
  );
  const status = <div className={styles.status} data-testid="budget-status">{saved ? 'Saved' : 'Saving…'}</div>;
  if (sub === 'compare') {
    return (
      <div>
        {subnav}
        <div className={styles.compareWrap}>
          {status}
          <VenueCompare plan={plan} update={update} counts={counts} venueAreas={venueAreas} onOpen={() => setSub('calc')} />
        </div>
      </div>
    );
  }
  if (sub === 'calc') {
    return (
      <div>
        {subnav}
        <div className={styles.calcWrap}>
          {status}
          <Calculator plan={plan} update={update} counts={counts} venueNames={venueNames} onCompare={() => setSub('compare')} />
        </div>
      </div>
    );
  }
  return (
    <div>
      {subnav}
      <div className={styles.wrap}>
        {status}
        <Contributors plan={plan} update={update} />
        <TotalCard plan={plan} update={update} counts={counts} />
        <Split plan={plan} update={update} counts={counts} />
      </div>
    </div>
  );
}

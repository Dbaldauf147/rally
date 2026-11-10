import { Fragment, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  normalizePlan, seedCategories, newId, categoryPct, totalPct, contributorTotals, effectiveTotal,
  amountFor, pctFromAmount, setCategoryPct, scaleTo100, parseMoney, parsePct, formatMoney, formatPct, roundPct,
  formatRate, guestCounts, headcount, plateAmount, resolveCategories,
  categoryTaxPct, totalTaxPct, grossPct,
} from '../lib/weddingBudgetPlan';
import styles from './WeddingBudget.module.css';

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

  return { plan, update, saved, counts };
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
function GuestsField({ plan, update, counts }) {
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
      <span className={styles.guestsHint} data-testid="guest-n">{n} {n === 1 ? 'guest' : 'guests'} — used for per-plate lines and the per-person column</span>
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

/* A markup's settings — rate % of the lines ticked — in a pop-up beside the
   line, opened by clicking its % or its % button. Any line in the same
   category can be ticked, other markups included (tax on the service charge).
   Closes on a click outside, Escape, or Done. */
function MarkupPopover({ item, cat, total, anchor, onChange, onOff, onClose }) {
  const m = item.markup;
  const others = cat.items.filter((i) => i.id !== item.id);
  const base = cat.items.filter((i) => m.of.includes(i.id)).reduce((s, i) => s + i.pct, 0);
  const toggle = (id) => onChange({ ...m, of: m.of.includes(id) ? m.of.filter((x) => x !== id) : [...m.of, id] });
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  // Below the line, right-aligned to the button, flipped above when there's
  // no room underneath, and kept on screen. Follows the page as it scrolls.
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
  }, [anchor, m.of.length, others.length]);

  useEffect(() => {
    // A rate still being typed is saved by its box losing focus, so let it
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

export function WeddingBudget() {
  const { user } = useAuth();
  const { plan, update, saved, counts } = usePlan(user?.uid);
  if (!plan) return <p className={styles.loading}>Loading…</p>;
  return (
    <div className={styles.wrap}>
      <div className={styles.status} data-testid="budget-status">{saved ? 'Saved' : 'Saving…'}</div>
      <Contributors plan={plan} update={update} />
      <TotalCard plan={plan} update={update} counts={counts} />
      <Split plan={plan} update={update} counts={counts} />
    </div>
  );
}

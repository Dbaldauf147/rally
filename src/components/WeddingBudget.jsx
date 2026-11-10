import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  normalizePlan, seedCategories, newId, categoryPct, totalPct, contributorTotals, effectiveTotal,
  amountFor, pctFromAmount, setCategoryPct, scaleTo100, parseMoney, parsePct, formatMoney, formatPct, roundPct,
  guestCounts, plateGuests, plateAmount, resolveCategories,
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

function TotalCard({ plan, update }) {
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
      <p className={styles.cardHint}>
        {totals.counted > 0 ? <>Everyone together can give <strong>{formatMoney(totals.low)}–{formatMoney(totals.high)}</strong>. </> : null}
        {eff.source === 'contributors' && <>No total set yet, so the split below uses the middle, {formatMoney(eff.amount)}.</>}
        {eff.source === 'none' && <>Type a total, or add the people helping above, to see dollar amounts below.</>}
      </p>
      {gap && <p className={gap.tone === 'warn' ? styles.gapWarn : styles.gapOk}>{gap.text}</p>}
    </section>
  );
}

const SOURCE_LABELS = {
  all: (n) => `Guest list — everyone (${n})`,
  attending: (n) => `Guest list — not counting “Not coming” (${n})`,
  confirmed: (n) => `Guest list — confirmed only (${n})`,
  manual: () => 'Type a number',
};

/* The line under a per-plate item: price × guests = dollars. */
function PlateRow({ item, counts, onChange }) {
  const pp = item.perPlate;
  const guests = plateGuests(pp, counts);
  return (
    <tr className={styles.plateRow}>
      <td colSpan={4}>
        <div className={styles.plate}>
          <NumberField
            {...moneyField}
            className={styles.plateNum}
            label={`${item.name} price per plate`}
            placeholder="$0"
            value={pp.price}
            onCommit={(v) => onChange({ ...pp, price: v })}
          />
          <span className={styles.plateOp}>per plate ×</span>
          <select
            className={styles.plateSelect}
            aria-label={`${item.name} guest count`}
            value={pp.source}
            onChange={(e) => onChange({
              ...pp,
              source: e.target.value,
              // Switching to a typed number starts from the count you were on.
              count: e.target.value === 'manual' && pp.count == null ? guests : pp.count,
            })}
          >
            {Object.entries(SOURCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label(counts[k])}</option>
            ))}
          </select>
          {pp.source === 'manual' && (
            <NumberField
              format={(n) => String(n)}
              parse={(t) => { const n = parseMoney(t); return n == null ? null : Math.round(n); }}
              className={styles.plateNum}
              label={`${item.name} number of guests`}
              placeholder="0"
              value={pp.count}
              onCommit={(v) => onChange({ ...pp, count: v })}
            />
          )}
          <span className={styles.plateOp}>{pp.source === 'manual' ? 'guests' : ''} =</span>
          <strong className={styles.plateTotal} data-testid={`plate-total-${item.id}`}>{formatMoney(plateAmount(pp, counts))}</strong>
        </div>
      </td>
    </tr>
  );
}

function Split({ plan, update, counts }) {
  const { amount: total } = effectiveTotal(plan);
  // Per-plate items get their % from their dollars before anything sums.
  const cats = resolveCategories(plan.categories, total, counts);
  const sum = totalPct(cats);
  const canMoney = total > 0;

  const editCat = (id, fn) => update((p) => ({ ...p, categories: p.categories.map((c) => (c.id === id ? fn(c) : c)) }));
  // Scaling has to see per-plate items at their real size, so it runs on
  // the resolved split.
  const resolved = (p) => resolveCategories(p.categories, effectiveTotal(p).amount, counts);
  const scaleCat = (id, pct) => update((p) => ({ ...p, categories: resolved(p).map((c) => (c.id === id ? setCategoryPct(c, pct) : c)) }));
  const togglePlate = (catId, item) => editCat(catId, (c) => ({
    ...c,
    items: c.items.map((i) => {
      if (i.id !== item.id) return i;
      if (i.perPlate) {
        // Back to a share: keep the dollars it had as its %.
        const pct = total > 0 ? roundPct((plateAmount(i.perPlate, counts) / total) * 100) : i.pct;
        return { ...i, pct, perPlate: null };
      }
      // Into per plate: start at the price that keeps today's dollars.
      const guests = counts.all;
      const price = guests > 0 && total > 0 ? Math.round(amountFor(i.pct, total) / guests) : null;
      return { ...i, perPlate: { price, source: 'all', count: null } };
    }),
  }));
  const editItem = (catId, itemId, patch) => editCat(catId, (c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
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
    const cats = [...p.categories];
    const j = idx + dir;
    if (j < 0 || j >= cats.length) return p;
    [cats[idx], cats[j]] = [cats[j], cats[idx]];
    return { ...p, categories: cats };
  });
  const reset = () => {
    if (!window.confirm('Replace every line item with the suggested split? Your total and the people helping stay.')) return;
    update((p) => ({ ...p, categories: seedCategories() }));
  };

  const fromAmount = (v) => (v == null ? 0 : pctFromAmount(v, total));
  const diff = roundPct(100 - sum);

  return (
    <section className={styles.card}>
      <div className={styles.splitHead}>
        <div>
          <h2 className={styles.cardTitle}>Budget split</h2>
          <p className={styles.cardHint}>Change any % or $ — the other follows. A category's % is the sum of its items; changing it scales them together. 🍽 prices an item per plate instead.</p>
        </div>
        <button type="button" className={styles.link} onClick={reset}>Reset to suggested split</button>
      </div>
      <div className={styles.scroll}>
        <table className={styles.splitTable}>
          <colgroup>
            <col />
            <col className={styles.pctCol} />
            <col className={styles.amtCol} />
            <col className={styles.actCol} />
          </colgroup>
          <thead>
            <tr>
              <th>Line item</th>
              <th className={styles.numHead}>% of total</th>
              <th className={styles.numHead}>Amount</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          {cats.map((cat, ci) => {
            const cp = categoryPct(cat);
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
                  <td className={styles.actions}>
                    <button type="button" className={styles.iconBtn} title="Move up" aria-label={`Move ${cat.name} up`} disabled={ci === 0} onClick={() => moveCat(ci, -1)}>↑</button>
                    <button type="button" className={styles.iconBtn} title="Move down" aria-label={`Move ${cat.name} down`} disabled={ci === cats.length - 1} onClick={() => moveCat(ci, 1)}>↓</button>
                    <button type="button" className={styles.remove} title="Remove category" aria-label={`Remove ${cat.name}`} onClick={() => removeCat(cat)}>×</button>
                  </td>
                </tr>
                {cat.items.map((item) => (
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
                    {item.perPlate ? (
                      <>
                        <td className={styles.derived} data-testid={`pct-${item.id}`} title="Worked out from the price per plate">{canMoney ? formatPct(item.pct) : '—'}</td>
                        <td className={styles.derived} data-testid={`amount-${item.id}`} title="Price per plate × guests">{formatMoney(plateAmount(item.perPlate, counts))}</td>
                      </>
                    ) : (
                      <>
                        <td><NumberField {...pctField} label={`${item.name} %`} value={item.pct} onCommit={(v) => editItem(cat.id, item.id, { pct: v ?? 0 })} /></td>
                        <td>
                          {canMoney
                            ? <NumberField {...moneyField} label={`${item.name} amount`} value={amountFor(item.pct, total)} onCommit={(v) => editItem(cat.id, item.id, { pct: fromAmount(v) })} />
                            : <span className={styles.dash}>—</span>}
                        </td>
                      </>
                    )}
                    <td className={styles.actions}>
                      <button
                        type="button"
                        className={item.perPlate ? styles.plateBtnOn : styles.plateBtn}
                        title={item.perPlate ? 'Per plate — click to go back to a % of the total' : 'Price this per plate'}
                        aria-label={`${item.name} per plate`}
                        aria-pressed={!!item.perPlate}
                        onClick={() => togglePlate(cat.id, item)}
                      >🍽</button>
                      <button type="button" className={styles.remove} title="Remove item" aria-label={`Remove ${item.name}`} onClick={() => removeItem(cat.id, item.id)}>×</button>
                    </td>
                  </tr>
                  {item.perPlate && (
                    <PlateRow item={item} counts={counts} onChange={(perPlate) => editItem(cat.id, item.id, { perPlate })} />
                  )}
                  </Fragment>
                ))}
                <tr className={styles.addRow}>
                  <td colSpan={4}>
                    <button type="button" className={styles.addItem} onClick={() => addItem(cat.id)}>+ item</button>
                  </td>
                </tr>
              </tbody>
            );
          })}
          <tfoot>
            <tr className={styles.sumRow}>
              <td className={styles.footLabel}>Total</td>
              <td className={diff === 0 ? styles.footNum : styles.footNumWarn} data-testid="split-pct">{formatPct(sum)}</td>
              <td className={styles.footNum} data-testid="split-amount">{canMoney ? formatMoney(amountFor(sum, total)) : '—'}</td>
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
            {sum > 0 && <button type="button" className={styles.link} onClick={() => update((p) => ({ ...p, categories: scaleTo100(resolved(p)) }))}>Scale to 100%</button>}
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
      <TotalCard plan={plan} update={update} />
      <Split plan={plan} update={update} counts={counts} />
    </div>
  );
}

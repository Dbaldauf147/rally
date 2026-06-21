import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { REACH_OUT_SEED } from '../reachOutSeed';
import styles from './ReachOutPage.module.css';

const METHODS = ['Text', 'Call'];
const KNOWN_CATEGORIES = ['Family', 'City Friends', 'Npt Friends', 'Far Away Friends', 'GF', 'Girlfriend', 'Holiday'];

function genId() {
  return crypto.randomUUID?.() || `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseKey(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const fmtMDY = (d) => d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : '';

// Derive the schedule fields for a contact relative to today.
function decorate(c, today) {
  const last = parseKey(c.lastReachOut);
  const cadence = (typeof c.cadenceDays === 'number' && c.cadenceDays > 0) ? c.cadenceDays : null;
  const bday = parseKey(c.birthday);
  const daysSince = last ? daysBetween(last, today) : null;
  let reachDay = null;
  let overdue = null;
  if (last && cadence) {
    reachDay = addDays(last, cadence);
    overdue = daysBetween(reachDay, today); // >0 overdue, <0 upcoming
  }
  const hasCadence = !!cadence;
  const due = hasCadence && !c.done && overdue != null && overdue >= 0;
  // Birthday coming up within two weeks (by month/day, any year).
  let bdaySoon = false;
  if (bday) {
    let next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
    const until = daysBetween(today, next);
    bdaySoon = until >= 0 && until <= 14;
  }
  return { ...c, _last: last, _bday: bday, _bdaySoon: bdaySoon, _reachDay: reachDay, _overdue: overdue, _daysSince: daysSince, _hasCadence: hasCadence, _due: due };
}

// Sort by Overdue descending (most overdue on top), matching the source sheet;
// contacts with no cadence (blank overdue) fall to the bottom by recency.
function sortRows(a, b) {
  if (a._hasCadence !== b._hasCadence) return a._hasCadence ? -1 : 1;
  if (!a._hasCadence) return (b._daysSince || 0) - (a._daysSince || 0);
  return (b._overdue ?? -99999) - (a._overdue ?? -99999);
}

const BLANK_FORM = { name: '', category: 'Family', method: 'Text', cadenceDays: '', lastReachOut: todayKey(), note: '', birthday: '' };

export function ReachOutPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState(null); // null = loading
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dueOnly, setDueOnly] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const v = snap.exists() ? snap.data().reachOuts : undefined;
      setContacts(Array.isArray(v) ? v : []);
    }, () => setContacts([]));
    return unsub;
  }, [user]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  async function persist(next) {
    setContacts(next); // optimistic
    if (user) {
      try { await setDoc(doc(db, 'users', user.uid), { reachOuts: next }, { merge: true }); }
      catch (err) { console.error('Failed to save reach-outs:', err); }
    }
  }

  async function importSeed() {
    const seeded = REACH_OUT_SEED.map(c => ({ id: genId(), ...c }));
    await persist(seeded);
  }

  function startAdd() {
    setForm({ ...BLANK_FORM, lastReachOut: todayKey() });
    setAdding(true);
    setEditingId(null);
  }

  function startEdit(c) {
    setForm({
      name: c.name || '', category: c.category || 'Family', method: c.method || 'Text',
      cadenceDays: c.cadenceDays == null ? '' : String(c.cadenceDays),
      lastReachOut: c.lastReachOut || '', note: c.note || '', birthday: c.birthday || '',
    });
    setEditingId(c.id);
    setAdding(false);
  }

  function cancelForm() { setAdding(false); setEditingId(null); }

  async function saveForm() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || 'Family',
      method: form.method || 'Text',
      cadenceDays: form.cadenceDays === '' ? null : Math.max(1, parseInt(form.cadenceDays, 10) || 0) || null,
      lastReachOut: form.lastReachOut || '',
      note: form.note.trim(),
      birthday: form.birthday || '',
    };
    const list = contacts || [];
    let next;
    if (adding) {
      next = [...list, { id: genId(), done: false, ...payload }];
    } else {
      next = list.map(c => c.id === editingId ? { ...c, ...payload } : c);
    }
    await persist(next);
    cancelForm();
  }

  async function logReachOut(id) {
    const next = (contacts || []).map(c => c.id === id ? { ...c, lastReachOut: todayKey(), done: false } : c);
    await persist(next);
  }

  async function toggleDone(id) {
    const next = (contacts || []).map(c => c.id === id ? { ...c, done: !c.done } : c);
    await persist(next);
  }

  async function remove(id) {
    const c = (contacts || []).find(x => x.id === id);
    if (!confirm(`Remove ${c?.name || 'this person'} from Reach Out?`)) return;
    await persist((contacts || []).filter(x => x.id !== id));
  }

  const decorated = useMemo(() => (contacts || []).map(c => decorate(c, today)), [contacts, today]);
  const categories = useMemo(() => {
    const set = new Set(decorated.map(c => c.category).filter(Boolean));
    return [...set].sort();
  }, [decorated]);
  const dueCount = decorated.filter(c => c._due).length;

  const visible = useMemo(() => {
    let rows = decorated;
    if (categoryFilter !== 'all') rows = rows.filter(c => c.category === categoryFilter);
    if (dueOnly) rows = rows.filter(c => c._due);
    return [...rows].sort(sortRows);
  }, [decorated, categoryFilter, dueOnly]);

  if (contacts === null) {
    return <div className={styles.page}><div className={styles.header}><h1 className={styles.title}>Reach Out</h1></div><p className={styles.muted}>Loading…</p></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Reach Out</h1>
          <p className={styles.subtitle}>
            {dueCount > 0 ? `${dueCount} due now` : 'All caught up 🎉'} · {decorated.length} {decorated.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnPrimary} onClick={startAdd}>+ Add person</button>
        </div>
      </div>

      {contacts.length === 0 && !adding && (
        <div className={styles.emptyCard}>
          <p className={styles.muted}>No one here yet.</p>
          <button className={styles.btnPrimary} onClick={importSeed}>Import starter list ({REACH_OUT_SEED.length} people)</button>
        </div>
      )}

      {(adding || editingId) && (
        <div className={styles.form}>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>Name</span>
              <input className={styles.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Person's name" autoFocus />
            </label>
            <label className={styles.field}>
              <span>Category</span>
              <input className={styles.input} list="reachout-cats" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
              <datalist id="reachout-cats">
                {[...new Set([...KNOWN_CATEGORIES, ...categories])].map(c => <option key={c} value={c} />)}
              </datalist>
            </label>
          </div>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>Method</span>
              <select className={styles.input} value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>Every (days)</span>
              <input className={styles.input} type="number" min="1" value={form.cadenceDays} onChange={e => setForm({ ...form, cadenceDays: e.target.value })} placeholder="e.g. 30" />
            </label>
          </div>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>Last reached out</span>
              <input className={styles.input} type="date" value={form.lastReachOut} onChange={e => setForm({ ...form, lastReachOut: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>Birthday</span>
              <input className={styles.input} type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} />
            </label>
          </div>
          <label className={styles.field}>
            <span>What's going on</span>
            <input className={styles.input} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Optional note" />
          </label>
          <div className={styles.formActions}>
            <button className={styles.btn} onClick={cancelForm}>Cancel</button>
            <button className={styles.btnPrimary} onClick={saveForm} disabled={!form.name.trim()}>{adding ? 'Add' : 'Save'}</button>
          </div>
        </div>
      )}

      {contacts.length > 0 && (
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className={dueOnly ? styles.toggleActive : styles.toggle}
            onClick={() => setDueOnly(v => !v)}
          >{dueOnly ? '● Due only' : 'Due only'}</button>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Last Reach Out</th>
              <th className={styles.colCheck} title="Reached out this cycle">✓</th>
              <th>Person</th>
              <th>What's going on</th>
              <th>Category</th>
              <th className={styles.colNum}>Overdue</th>
              <th className={styles.colNum}>Days</th>
              <th>Birthday</th>
              <th className={styles.colActions} aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => {
              const overdueClass = c._overdue == null ? ''
                : c._overdue > 0 ? styles.over
                : c._overdue === 0 ? styles.overToday
                : styles.under;
              return (
                <tr key={c.id} className={c.done ? styles.trDone : ''} onClick={() => startEdit(c)} title="Click to edit">
                  <td>{fmtMDY(c._last)}</td>
                  <td className={styles.colCheck} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={!!c.done} onChange={() => toggleDone(c.id)} aria-label="Reached out this cycle" />
                  </td>
                  <td className={styles.person}>{c.name}</td>
                  <td className={styles.tdNote}>{c.note}</td>
                  <td>{c.category}</td>
                  <td className={`${styles.colNum} ${overdueClass}`}>{c._overdue == null ? '' : c._overdue}</td>
                  <td className={styles.colNum}>{c._hasCadence ? c.cadenceDays : ''}</td>
                  <td className={c._bdaySoon ? styles.bdaySoon : ''}>{fmtMDY(c._bday)}</td>
                  <td className={styles.colActions} onClick={e => e.stopPropagation()}>
                    <button className={styles.reachBtnSm} onClick={() => logReachOut(c.id)} title="Mark reached out today">✓</button>
                    <button className={styles.iconBtn} onClick={() => remove(c.id)} title="Remove" aria-label="Remove">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {contacts.length > 0 && visible.length === 0 && (
          <p className={styles.muted}>No one matches this filter.</p>
        )}
      </div>
    </div>
  );
}

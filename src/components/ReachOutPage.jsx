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
  const status = c.status === 'retired' ? 'retired' : 'active';
  const retired = status === 'retired';
  const due = hasCadence && !c.done && !retired && overdue != null && overdue >= 0;
  // Birthday today (by month/day), and "coming up within two weeks".
  let bdaySoon = false;
  let bdayToday = false;
  if (bday) {
    bdayToday = bday.getMonth() === today.getMonth() && bday.getDate() === today.getDate();
    let next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
    const until = daysBetween(today, next);
    bdaySoon = until >= 0 && until <= 14;
  }
  return { ...c, _last: last, _bday: bday, _bdaySoon: bdaySoon, _bdayToday: bdayToday, _reachDay: reachDay, _overdue: overdue, _daysSince: daysSince, _hasCadence: hasCadence, _status: status, _retired: retired, _due: due };
}

// The comparable value for a contact under a given sort column. Returns null
// for "empty" values, which always sort to the bottom regardless of direction.
function sortValue(c, key) {
  switch (key) {
    case 'lastReachOut': return c._last ? c._last.getTime() : null;
    case 'check': return c.done ? 1 : 0;
    case 'person': return (c.name || '').toLowerCase() || null;
    case 'note': return (c.note || '').toLowerCase() || null;
    case 'category': return (c.category || '').toLowerCase() || null;
    case 'overdue': return c._overdue ?? null;
    case 'days': return c._hasCadence ? c.cadenceDays : null;
    case 'birthday': return c._bday ? c._bday.getMonth() * 100 + c._bday.getDate() : null;
    case 'status': return c._status || 'active';
    default: return null;
  }
}

function compareRows(a, b, key, dir) {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  const aEmpty = va === null || va === undefined;
  const bEmpty = vb === null || vb === undefined;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;   // empties always last
  if (bEmpty) return -1;
  const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
  return dir === 'asc' ? cmp : -cmp;
}

const BLANK_FORM = { name: '', category: 'Family', method: 'Text', cadenceDays: '', lastReachOut: todayKey(), note: '', birthday: '' };

// Columns the user can show/hide (Person and the actions column are always on).
const COLS_KEY = 'rally.reachout.cols';
const COLUMNS = [
  { key: 'lastReachOut', label: 'Last Reach Out' },
  { key: 'check', label: 'Done ✓' },
  { key: 'note', label: "What's going on" },
  { key: 'category', label: 'Category' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'days', label: 'Days' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'status', label: 'Status' },
];
function loadColVis() {
  const base = Object.fromEntries(COLUMNS.map(c => [c.key, true]));
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_KEY) || '{}');
    return { ...base, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch { return base; }
}

export function ReachOutPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState(null); // null = loading
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dueOnly, setDueOnly] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [colVis, setColVis] = useState(loadColVis);
  // Default sort: Overdue largest→smallest (matches the source sheet).
  const [sortKey, setSortKey] = useState('overdue');
  const [sortDir, setSortDir] = useState('desc');

  function onSort(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Numeric/date columns feel natural starting high→low; text starts A→Z.
      setSortDir(['overdue', 'days', 'lastReachOut', 'birthday', 'check'].includes(key) ? 'desc' : 'asc');
    }
  }
  const sortArrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  function toggleCol(key) {
    setColVis(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

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

  // The check column doubles as "reached out today": checking it stamps the
  // last reach-out to today (so the row drops down the overdue sort); unchecking
  // just clears the flag and leaves the date.
  async function toggleDone(id) {
    const next = (contacts || []).map(c => {
      if (c.id !== id) return c;
      return c.done ? { ...c, done: false } : { ...c, done: true, lastReachOut: todayKey() };
    });
    await persist(next);
  }

  async function remove(id) {
    const c = (contacts || []).find(x => x.id === id);
    if (!confirm(`Remove ${c?.name || 'this person'} from Reach Out?`)) return;
    await persist((contacts || []).filter(x => x.id !== id));
  }

  async function setStatus(id, status) {
    const next = (contacts || []).map(c => c.id === id ? { ...c, status } : c);
    await persist(next);
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
    return [...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [decorated, categoryFilter, dueOnly, sortKey, sortDir]);

  // Daily goal: reach out to at least one family member and one friend today.
  const todayK = todayKey();
  const reachedToday = (match) => (contacts || []).some(c => c.lastReachOut === todayK && match(c.category || ''));
  const reachedFamilyToday = reachedToday(cat => cat === 'Family');
  const reachedFriendToday = reachedToday(cat => /friend/i.test(cat));
  const dailyNeeds = [
    ...(!reachedFamilyToday ? ['a family member'] : []),
    ...(!reachedFriendToday ? ['a friend'] : []),
  ];

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

      {contacts.length > 0 && dailyNeeds.length > 0 && (
        <div className={styles.alert} role="status">
          <span className={styles.alertIcon}>🔔</span>
          <span>Reach out to {dailyNeeds.join(' and ')} today.</span>
        </div>
      )}

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
          <details className={styles.colMenu}>
            <summary className={styles.colMenuBtn}>Columns ▾</summary>
            <div className={styles.colMenuPanel}>
              {COLUMNS.map(col => (
                <label key={col.key} className={styles.colMenuItem}>
                  <input type="checkbox" checked={colVis[col.key] !== false} onChange={() => toggleCol(col.key)} />
                  {col.label}
                </label>
              ))}
            </div>
          </details>
        </div>
      )}

      {contacts.length > 0 && (
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={`${styles.sw} ${styles.swBday}`} />Birthday today</span>
          <span className={styles.legendItem}><span className={`${styles.sw} ${styles.swDone}`} />Reached out this cycle</span>
          <span className={styles.legendItem}><span className={`${styles.sw} ${styles.swRetired}`} />Retired</span>
          <span className={styles.legendItem}><span className={`${styles.sw} ${styles.swBdaySoon}`} />Birthday within 2 weeks</span>
          <span className={styles.legendItem}><b className={styles.over}>+N</b> Overdue</span>
          <span className={styles.legendItem}><b className={styles.overToday}>0</b> Due today</span>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {colVis.lastReachOut !== false && <th className={styles.thSort} onClick={() => onSort('lastReachOut')}>Last Reach Out{sortArrow('lastReachOut')}</th>}
              {colVis.check !== false && <th className={`${styles.colCheck} ${styles.thSort}`} title="Reached out today" onClick={() => onSort('check')}>✓{sortArrow('check')}</th>}
              <th className={styles.thSort} onClick={() => onSort('person')}>Person{sortArrow('person')}</th>
              {colVis.note !== false && <th className={styles.thSort} onClick={() => onSort('note')}>What's going on{sortArrow('note')}</th>}
              {colVis.category !== false && <th className={styles.thSort} onClick={() => onSort('category')}>Category{sortArrow('category')}</th>}
              {colVis.overdue !== false && <th className={styles.thSort} onClick={() => onSort('overdue')}>Overdue{sortArrow('overdue')}</th>}
              {colVis.days !== false && <th className={styles.thSort} onClick={() => onSort('days')}>Days{sortArrow('days')}</th>}
              {colVis.birthday !== false && <th className={styles.thSort} onClick={() => onSort('birthday')}>Birthday{sortArrow('birthday')}</th>}
              {colVis.status !== false && <th className={styles.thSort} onClick={() => onSort('status')}>Status{sortArrow('status')}</th>}
              <th className={styles.colActions} aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => {
              const overdueClass = c._overdue == null ? ''
                : c._overdue > 0 ? styles.over
                : c._overdue === 0 ? styles.overToday
                : styles.under;
              const rowClass = c._bdayToday ? styles.trBday : (c._retired ? styles.trRetired : (c.done ? styles.trDone : ''));
              return (
                <tr key={c.id} className={rowClass} onClick={() => startEdit(c)} title="Click to edit">
                  {colVis.lastReachOut !== false && <td>{fmtMDY(c._last)}</td>}
                  {colVis.check !== false && (
                    <td className={styles.colCheck} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={!!c.done} onChange={() => toggleDone(c.id)} aria-label="Reached out today" title="Reached out today" />
                    </td>
                  )}
                  <td className={styles.person}>{c.name}</td>
                  {colVis.note !== false && <td className={styles.tdNote}>{c.note}</td>}
                  {colVis.category !== false && <td>{c.category}</td>}
                  {colVis.overdue !== false && <td className={`${styles.colNum} ${overdueClass}`}>{c._overdue == null ? '' : c._overdue}</td>}
                  {colVis.days !== false && <td className={styles.colNum}>{c._hasCadence ? c.cadenceDays : ''}</td>}
                  {colVis.birthday !== false && (
                    <td className={c._bdayToday ? '' : (c._bdaySoon ? styles.bdaySoon : '')}>
                      {c._bdayToday && c._bday ? `🎂 ${fmtMDY(c._bday)}` : fmtMDY(c._bday)}
                    </td>
                  )}
                  {colVis.status !== false && (
                    <td onClick={e => e.stopPropagation()}>
                      <select className={styles.statusSelect} value={c._status} onChange={e => setStatus(c.id, e.target.value)} aria-label="Status">
                        <option value="active">Active</option>
                        <option value="retired">Retired</option>
                      </select>
                    </td>
                  )}
                  <td className={styles.colActions} onClick={e => e.stopPropagation()}>
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

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import styles from './TodayPage.module.css';

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 22 * 60;
const SLOT_MIN = 30;
const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;

const DEFAULT_TEMPLATES = [
  { id: 'tpl-workout', name: 'Workout', durationMin: 90 },
  { id: 'tpl-lunch', name: 'Lunch', durationMin: 60 },
  { id: 'tpl-dinner', name: 'Dinner', durationMin: 60 },
  { id: 'tpl-walk', name: 'Walk', durationMin: 30 },
];

const DEFAULT_ITEMS_FOR_TODAY = [
  { startMin: 12 * 60, durationMin: 60, label: 'Lunch' },
  { startMin: 18 * 60, durationMin: 60, label: 'Dinner' },
];

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function minutesToLabel(min) {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function durationToLabel(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDateHeading(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function buildSlotMap(items) {
  const map = new Map();
  items.forEach((item) => {
    const start = item.startMin;
    const end = start + item.durationMin;
    for (let t = start; t < end; t += SLOT_MIN) {
      if (t < DAY_START_MIN || t >= DAY_END_MIN) continue;
      map.set(t, { item, isStart: t === start });
    }
  });
  return map;
}

function newId() {
  return (crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

export function TodayPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [editingSlot, setEditingSlot] = useState(null);
  const [draft, setDraft] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplHours, setTplHours] = useState('');
  const [tplMins, setTplMins] = useState('30');
  const [seedAttempted, setSeedAttempted] = useState(false);

  const dateKey = todayKey();

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        const data = snap.exists() ? snap.data() : {};
        const tpls = Array.isArray(data.todayTemplates) ? data.todayTemplates : null;
        const schedules = (data.todaySchedules && typeof data.todaySchedules === 'object')
          ? data.todaySchedules
          : {};
        const todayItems = Array.isArray(schedules[dateKey]?.items) ? schedules[dateKey].items : null;

        if (tpls) {
          setTemplates(tpls);
        } else if (!seedAttempted) {
          setSeedAttempted(true);
          try {
            await setDoc(ref, { todayTemplates: DEFAULT_TEMPLATES }, { merge: true });
          } catch (err) {
            console.error('Failed to seed today templates:', err);
            setTemplates(DEFAULT_TEMPLATES);
          }
        }

        if (todayItems) {
          setItems(todayItems);
        } else if (!seedAttempted) {
          try {
            const seeded = DEFAULT_ITEMS_FOR_TODAY.map((it) => ({ id: newId(), ...it }));
            await setDoc(
              ref,
              { todaySchedules: { ...schedules, [dateKey]: { items: seeded } } },
              { merge: true }
            );
          } catch (err) {
            console.error('Failed to seed today schedule:', err);
            setItems(DEFAULT_ITEMS_FOR_TODAY.map((it) => ({ id: newId(), ...it })));
          }
        }

        setLoading(false);
      },
      (err) => {
        console.error('Today snapshot error:', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [user, dateKey, seedAttempted]);

  const slotMap = useMemo(() => buildSlotMap(items), [items]);

  async function persistItems(next) {
    setItems(next);
    if (!user) return;
    await setDoc(
      doc(db, 'users', user.uid),
      { todaySchedules: { [dateKey]: { items: next } } },
      { merge: true },
    );
  }

  async function persistTemplates(next) {
    setTemplates(next);
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { todayTemplates: next }, { merge: true });
  }

  function slotsFitFrom(startMin, durationMin, ignoreItemId = null) {
    const end = startMin + durationMin;
    if (end > DAY_END_MIN) return false;
    for (const it of items) {
      if (it.id === ignoreItemId) continue;
      const a = it.startMin;
      const b = it.startMin + it.durationMin;
      if (startMin < b && end > a) return false;
    }
    return true;
  }

  function handleSlotClick(slotStart) {
    const slot = slotMap.get(slotStart);
    if (slot) return;
    if (activeTemplateId) {
      const tpl = templates.find((t) => t.id === activeTemplateId);
      if (!tpl) {
        setActiveTemplateId(null);
        return;
      }
      if (!slotsFitFrom(slotStart, tpl.durationMin)) {
        alert(`"${tpl.name}" (${durationToLabel(tpl.durationMin)}) doesn't fit here — overlaps another item or runs past the day.`);
        return;
      }
      const next = [...items, { id: newId(), startMin: slotStart, durationMin: tpl.durationMin, label: tpl.name }];
      persistItems(next);
      setActiveTemplateId(null);
      return;
    }
    setEditingSlot(slotStart);
    setDraft('');
  }

  function saveDraft() {
    if (editingSlot == null) return;
    const text = draft.trim();
    if (!text) {
      setEditingSlot(null);
      setDraft('');
      return;
    }
    const next = [...items, { id: newId(), startMin: editingSlot, durationMin: SLOT_MIN, label: text }];
    persistItems(next);
    setEditingSlot(null);
    setDraft('');
  }

  function cancelDraft() {
    setEditingSlot(null);
    setDraft('');
  }

  function deleteItem(itemId) {
    persistItems(items.filter((it) => it.id !== itemId));
  }

  function renameItem(itemId, label) {
    persistItems(items.map((it) => (it.id === itemId ? { ...it, label } : it)));
  }

  function changeDuration(itemId, durationMin) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    if (!slotsFitFrom(it.startMin, durationMin, itemId)) {
      alert(`Can't extend to ${durationToLabel(durationMin)} — would overlap another item or run past the day.`);
      return;
    }
    persistItems(items.map((x) => (x.id === itemId ? { ...x, durationMin } : x)));
  }

  function addTemplate(e) {
    e?.preventDefault?.();
    const name = tplName.trim();
    if (!name) return;
    const hours = parseInt(tplHours, 10) || 0;
    const mins = parseInt(tplMins, 10) || 0;
    let totalMin = hours * 60 + mins;
    if (totalMin <= 0) totalMin = SLOT_MIN;
    totalMin = Math.round(totalMin / SLOT_MIN) * SLOT_MIN;
    const next = [...templates, { id: newId(), name, durationMin: totalMin }];
    persistTemplates(next);
    setTplName('');
    setTplHours('');
    setTplMins('30');
  }

  function deleteTemplate(id) {
    persistTemplates(templates.filter((t) => t.id !== id));
    if (activeTemplateId === id) setActiveTemplateId(null);
  }

  function clearAll() {
    if (!confirm('Clear today’s entire schedule?')) return;
    persistItems([]);
  }

  const slotRows = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const startMin = DAY_START_MIN + i * SLOT_MIN;
    slotRows.push(startMin);
  }

  const activeTpl = templates.find((t) => t.id === activeTemplateId) || null;

  if (!user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Today</h1>
          <div className={styles.subtitle}>{formatDateHeading()}</div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btn} onClick={clearAll} disabled={items.length === 0}>Clear day</button>
        </div>
      </div>

      {activeTpl && (
        <div className={styles.bannerActive}>
          <span>Click a time to drop <strong>{activeTpl.name}</strong> ({durationToLabel(activeTpl.durationMin)})</span>
          <button className={styles.bannerCancel} onClick={() => setActiveTemplateId(null)}>Cancel</button>
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.scheduleCol}>
          <div className={styles.scheduleHeader}>
            <span className={styles.colTime}>Time</span>
            <span className={styles.colLabel}>Task</span>
          </div>
          <div className={styles.schedule}>
            {loading ? (
              <div className={styles.empty}>Loading...</div>
            ) : (
              slotRows.map((startMin) => {
                const cell = slotMap.get(startMin);
                const item = cell?.item;
                const isContinuation = cell && !cell.isStart;
                const isEditing = editingSlot === startMin;
                return (
                  <div
                    key={startMin}
                    className={`${styles.row} ${item ? styles.rowFilled : ''} ${isContinuation ? styles.rowContinuation : ''}`}
                  >
                    <span className={styles.colTime}>{minutesToLabel(startMin)}</span>
                    {isContinuation ? (
                      <span className={styles.continuation} aria-hidden />
                    ) : item ? (
                      <div className={styles.itemBlock}>
                        <input
                          className={styles.itemInput}
                          value={item.label}
                          onChange={(e) => renameItem(item.id, e.target.value)}
                          placeholder="(untitled)"
                        />
                        <div className={styles.itemMeta}>
                          <select
                            className={styles.durationSelect}
                            value={item.durationMin}
                            onChange={(e) => changeDuration(item.id, parseInt(e.target.value, 10))}
                            title="Duration"
                          >
                            {Array.from({ length: SLOT_COUNT }, (_, i) => (i + 1) * SLOT_MIN).map((d) => (
                              <option key={d} value={d}>{durationToLabel(d)}</option>
                            ))}
                          </select>
                          <button
                            className={styles.deleteBtn}
                            onClick={() => deleteItem(item.id)}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ) : isEditing ? (
                      <div className={styles.editor}>
                        <input
                          className={styles.editorInput}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveDraft();
                            if (e.key === 'Escape') cancelDraft();
                          }}
                          onBlur={saveDraft}
                          autoFocus
                          placeholder="What's the task?"
                        />
                      </div>
                    ) : (
                      <button
                        className={styles.emptyCell}
                        onClick={() => handleSlotClick(startMin)}
                      >
                        {activeTpl ? `+ Drop ${activeTpl.name} here` : ''}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <h2 className={styles.sidebarTitle}>Templates</h2>
            <p className={styles.sidebarHelp}>Click a template, then click a time slot to add it.</p>
            <div className={styles.tplList}>
              {templates.length === 0 && (
                <div className={styles.tplEmpty}>No templates yet.</div>
              )}
              {templates.map((t) => {
                const active = t.id === activeTemplateId;
                return (
                  <div key={t.id} className={`${styles.tplRow} ${active ? styles.tplRowActive : ''}`}>
                    <button
                      className={styles.tplBtn}
                      onClick={() => setActiveTemplateId(active ? null : t.id)}
                    >
                      <span className={styles.tplName}>{t.name}</span>
                      <span className={styles.tplDur}>{durationToLabel(t.durationMin)}</span>
                    </button>
                    <button
                      className={styles.tplDelete}
                      onClick={() => deleteTemplate(t.id)}
                      title="Delete template"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <form className={styles.sidebarSection} onSubmit={addTemplate}>
            <h2 className={styles.sidebarTitle}>New template</h2>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Name</span>
              <input
                className={styles.fieldInput}
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="Workout, Standup, etc."
              />
            </label>
            <div className={styles.fieldRow}>
              <label className={styles.fieldHalf}>
                <span className={styles.fieldLabel}>Hours</span>
                <input
                  className={styles.fieldInput}
                  type="number"
                  min="0"
                  value={tplHours}
                  onChange={(e) => setTplHours(e.target.value)}
                  placeholder="1"
                />
              </label>
              <label className={styles.fieldHalf}>
                <span className={styles.fieldLabel}>Minutes</span>
                <select
                  className={styles.fieldInput}
                  value={tplMins}
                  onChange={(e) => setTplMins(e.target.value)}
                >
                  <option value="0">0</option>
                  <option value="30">30</option>
                </select>
              </label>
            </div>
            <button type="submit" className={styles.btnPrimary} disabled={!tplName.trim()}>
              Add template
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}

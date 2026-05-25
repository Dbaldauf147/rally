import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import styles from './TodayPage.module.css';

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 22 * 60;
const SLOT_MIN = 30;
const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;

const DEFAULT_TEMPLATES = [
  { id: 'tpl-breakfast', name: 'Breakfast', durationMin: 60 },
  { id: 'tpl-workout', name: 'Workout', durationMin: 90 },
  { id: 'tpl-lunch', name: 'Lunch', durationMin: 60 },
  { id: 'tpl-dinner', name: 'Dinner', durationMin: 60 },
  { id: 'tpl-walk', name: 'Walk', durationMin: 30 },
];

const DEFAULT_ITEMS_FOR_TODAY = [
  { startMin: 8 * 60, durationMin: 60, label: 'Breakfast' },
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

function buildStartMap(items) {
  const map = new Map();
  items.forEach((item) => {
    const arr = map.get(item.startMin) || [];
    arr.push(item);
    map.set(item.startMin, arr);
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
  const [editingSlot, setEditingSlot] = useState(null);
  const [draft, setDraft] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplHours, setTplHours] = useState('');
  const [tplMins, setTplMins] = useState('30');
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const seedRanRef = useRef(false);
  const migrationRanRef = useRef(false);
  const dragRef = useRef(null);

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

        // First-time seed for brand-new users / days
        if (!tpls && !seedRanRef.current) {
          seedRanRef.current = true;
          try {
            await setDoc(ref, { todayTemplates: DEFAULT_TEMPLATES }, { merge: true });
          } catch (err) {
            console.error('Failed to seed today templates:', err);
            setTemplates(DEFAULT_TEMPLATES);
          }
        } else if (tpls) {
          setTemplates(tpls);
        }

        if (!todayItems && !seedRanRef.current) {
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
        } else if (todayItems) {
          setItems(todayItems);
        }

        // One-off migrations for users who seeded before Breakfast was a default
        if (!migrationRanRef.current && (tpls || todayItems)) {
          migrationRanRef.current = true;
          const patch = {};
          if (tpls) {
            const existingNames = new Set(tpls.map((t) => (t.name || '').toLowerCase()));
            const missing = DEFAULT_TEMPLATES.filter(
              (t) => !existingNames.has(t.name.toLowerCase())
            );
            if (missing.length > 0) {
              patch.todayTemplates = [...tpls, ...missing];
            }
          }
          if (todayItems) {
            const hasBreakfast = todayItems.some(
              (it) => (it.label || '').toLowerCase() === 'breakfast'
            );
            const hasItemAt8 = todayItems.some((it) => it.startMin === DAY_START_MIN);
            if (!hasBreakfast && !hasItemAt8) {
              patch.todaySchedules = {
                ...schedules,
                [dateKey]: {
                  items: [
                    ...todayItems,
                    { id: newId(), startMin: DAY_START_MIN, durationMin: 60, label: 'Breakfast' },
                  ],
                },
              };
            }
          }
          if (Object.keys(patch).length > 0) {
            try {
              await setDoc(ref, patch, { merge: true });
            } catch (err) {
              console.error('Today migration failed:', err);
            }
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
  }, [user, dateKey]);

  const startMap = useMemo(() => buildStartMap(items), [items]);

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

  function addItemFromTemplate(slotStart, tpl) {
    if (slotStart + tpl.durationMin > DAY_END_MIN) {
      alert(`"${tpl.name}" (${durationToLabel(tpl.durationMin)}) runs past the end of the day.`);
      return;
    }
    const next = [
      ...items,
      { id: newId(), startMin: slotStart, durationMin: tpl.durationMin, label: tpl.name },
    ];
    persistItems(next);
  }

  function startEditing(slotStart) {
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
    const next = [
      ...items,
      { id: newId(), startMin: editingSlot, durationMin: SLOT_MIN, label: text },
    ];
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
    if (it.startMin + durationMin > DAY_END_MIN) {
      alert(`Can't extend to ${durationToLabel(durationMin)} — runs past the end of the day.`);
      return;
    }
    persistItems(items.map((x) => (x.id === itemId ? { ...x, durationMin } : x)));
  }

  function moveItem(itemId, newStartMin) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    if (newStartMin + it.durationMin > DAY_END_MIN) {
      alert(`Can't move ${it.label || 'item'} there — its ${durationToLabel(it.durationMin)} runs past the end of the day.`);
      return;
    }
    if (it.startMin === newStartMin) return;
    persistItems(items.map((x) => (x.id === itemId ? { ...x, startMin: newStartMin } : x)));
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
  }

  function clearAll() {
    if (!confirm('Clear today’s entire schedule?')) return;
    persistItems([]);
  }

  // Drag-and-drop
  function onTemplateDragStart(tpl, e) {
    dragRef.current = { type: 'template', id: tpl.id };
    try { e.dataTransfer.effectAllowed = 'copy'; } catch {}
    try { e.dataTransfer.setData('text/plain', tpl.name); } catch {}
  }
  function onItemDragStart(item, e) {
    dragRef.current = { type: 'item', id: item.id };
    try { e.dataTransfer.effectAllowed = 'move'; } catch {}
    try { e.dataTransfer.setData('text/plain', item.label || ''); } catch {}
  }
  function onDragEnd() {
    dragRef.current = null;
    setDragOverSlot(null);
  }
  function onSlotDragOver(slotStart, e) {
    if (!dragRef.current) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = dragRef.current.type === 'item' ? 'move' : 'copy'; } catch {}
    if (dragOverSlot !== slotStart) setDragOverSlot(slotStart);
  }
  function onSlotDrop(slotStart, e) {
    e.preventDefault();
    const payload = dragRef.current;
    dragRef.current = null;
    setDragOverSlot(null);
    if (!payload) return;
    if (payload.type === 'item') {
      moveItem(payload.id, slotStart);
    } else if (payload.type === 'template') {
      const tpl = templates.find((t) => t.id === payload.id);
      if (tpl) addItemFromTemplate(slotStart, tpl);
    }
  }

  const slotRows = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const startMin = DAY_START_MIN + i * SLOT_MIN;
    slotRows.push(startMin);
  }

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

      <div className={styles.grid}>
        <div className={styles.scheduleCol}>
          <div className={styles.scheduleHeader}>
            <span className={styles.colTime}>Time</span>
            <span className={styles.colLabel}>Tasks</span>
          </div>
          <div className={styles.schedule}>
            {loading ? (
              <div className={styles.empty}>Loading...</div>
            ) : (
              slotRows.map((startMin) => {
                const itemsHere = startMap.get(startMin) || [];
                const isEditing = editingSlot === startMin;
                const isDropTarget = dragOverSlot === startMin;
                return (
                  <div
                    key={startMin}
                    className={`${styles.row} ${isDropTarget ? styles.rowDropTarget : ''}`}
                    onDragOver={(e) => onSlotDragOver(startMin, e)}
                    onDrop={(e) => onSlotDrop(startMin, e)}
                  >
                    <span className={styles.colTime}>{minutesToLabel(startMin)}</span>
                    <div className={styles.rowContent}>
                      {itemsHere.map((item) => (
                        <div key={item.id} className={styles.itemBlock}>
                          <span
                            className={styles.dragHandle}
                            draggable
                            onDragStart={(e) => onItemDragStart(item, e)}
                            onDragEnd={onDragEnd}
                            title="Drag to a different time"
                            aria-label="Drag to reschedule"
                          >
                            ⋮⋮
                          </span>
                          <input
                            className={styles.itemInput}
                            value={item.label}
                            onChange={(e) => renameItem(item.id, e.target.value)}
                            placeholder="(untitled)"
                          />
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
                      ))}

                      {isEditing ? (
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
                          className={`${styles.emptyCell} ${itemsHere.length > 0 ? styles.emptyCellInline : ''}`}
                          onClick={() => startEditing(startMin)}
                          title={itemsHere.length > 0 ? 'Add another at this time' : 'Add task'}
                        >
                          {itemsHere.length > 0 ? '+' : '+ Add task'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <h2 className={styles.sidebarTitle}>Templates</h2>
            <p className={styles.sidebarHelp}>Drag a template onto a time slot — or click a slot and type directly.</p>
            <div className={styles.tplList}>
              {templates.length === 0 && (
                <div className={styles.tplEmpty}>No templates yet.</div>
              )}
              {templates.map((t) => (
                <div key={t.id} className={styles.tplRow}>
                  <div
                    className={styles.tplBtn}
                    draggable
                    onDragStart={(e) => onTemplateDragStart(t, e)}
                    onDragEnd={onDragEnd}
                    title={`Drag ${t.name} onto a time slot`}
                  >
                    <span className={styles.tplName}>{t.name}</span>
                    <span className={styles.tplDur}>{durationToLabel(t.durationMin)}</span>
                  </div>
                  <button
                    className={styles.tplDelete}
                    onClick={() => deleteTemplate(t.id)}
                    title="Delete template"
                  >
                    ×
                  </button>
                </div>
              ))}
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

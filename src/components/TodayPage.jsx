import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import styles from './TodayPage.module.css';

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 22 * 60;
const SLOT_MIN = 30;
const DURATION_STEP = 15; // lengths can be finer than the 30-min grid (15, 45, …)
const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;
const ROW_HEIGHT = 44; // px per 30-min slot

const DEFAULT_TEMPLATES = [
  { id: 'tpl-breakfast', name: 'Breakfast', durationMin: 60 },
  { id: 'tpl-workout', name: 'Workout', durationMin: 90 },
  { id: 'tpl-lunch', name: 'Lunch', durationMin: 60 },
  { id: 'tpl-dinner', name: 'Dinner', durationMin: 60 },
  { id: 'tpl-walk', name: 'Walk', durationMin: 30 },
];

const DEFAULT_ITEMS_FOR_TODAY = [
  { id: 'default-breakfast', startMin: 8 * 60, durationMin: 60, label: 'Breakfast' },
  { id: 'default-lunch', startMin: 12 * 60, durationMin: 60, label: 'Lunch' },
  { id: 'default-dinner', startMin: 18 * 60, durationMin: 60, label: 'Dinner' },
];

const SEED_FLAG_KEY = 'rally.today.seeded.v1';

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

function shortTime(min) {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

function timeRangeLabel(startMin, durationMin) {
  const endMin = startMin + durationMin;
  const startIsPm = Math.floor(startMin / 60) >= 12;
  const endIsPm = Math.floor((endMin - 1) / 60) >= 12;
  if (startIsPm === endIsPm) {
    const period = startIsPm ? 'PM' : 'AM';
    return `${shortTime(startMin)}–${shortTime(endMin)} ${period}`;
  }
  return `${minutesToLabel(startMin)} – ${minutesToLabel(endMin)}`;
}

function durationToLabel(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Selectable slot start times (8:00 AM … 9:30 PM) and lengths (30m … full day).
const START_OPTIONS = [];
for (let m = DAY_START_MIN; m <= DAY_END_MIN - SLOT_MIN; m += SLOT_MIN) START_OPTIONS.push(m);
const LENGTH_OPTIONS = [];
for (let d = DURATION_STEP; d <= DAY_END_MIN - DAY_START_MIN; d += DURATION_STEP) LENGTH_OPTIONS.push(d);

// Resolve a template's effective start time + length for a given weekday (0=Sun).
// A per-day override wins; otherwise start is unset and length falls back to the
// template default.
function resolveTemplateForDay(tpl, weekday) {
  const ov = (tpl.days && tpl.days[weekday]) || {};
  const startMin = ov.startMin != null ? ov.startMin : null;
  const durationMin = ov.durationMin != null ? ov.durationMin : tpl.durationMin;
  return { startMin, durationMin };
}

function formatDateHeading(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// Compute lane / totalLanes for each item so overlapping items render side-by-side
// within a cluster. Items that never overlap with anyone get totalLanes=1 (full width).
function computeLayout(items) {
  const sorted = [...items].sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return (a.id || '').localeCompare(b.id || '');
  });
  const placements = new Map();
  let cluster = [];
  let lanes = []; // lanes[i] = end time of last item in lane i, within current cluster
  let clusterEnd = -Infinity;

  function flushCluster() {
    const totalLanes = Math.max(1, lanes.length);
    cluster.forEach((it) => {
      const prev = placements.get(it.id) || { lane: 0 };
      placements.set(it.id, { ...prev, totalLanes });
    });
    cluster = [];
    lanes = [];
    clusterEnd = -Infinity;
  }

  for (const item of sorted) {
    const start = item.startMin;
    const end = item.startMin + item.durationMin;
    if (start >= clusterEnd) flushCluster();
    let lane = lanes.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(end);
    } else {
      lanes[lane] = end;
    }
    cluster.push(item);
    placements.set(item.id, { lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flushCluster();
  return placements;
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
  const [isDragging, setIsDragging] = useState(false);
  const [resizingPreview, setResizingPreview] = useState(null); // { id, duration }
  const [expandedTpl, setExpandedTpl] = useState(null);
  const seedAttemptedRef = useRef(false);
  const initFlagSetRef = useRef(false);
  const dragRef = useRef(null);

  const dateKey = todayKey();
  const todayWeekday = useMemo(() => new Date().getDay(), []);

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

        // Seed gating: NEVER auto-write to Firestore if we've already seeded once
        // (tracked via a Firestore flag AND a browser localStorage flag, belt-and-braces).
        // This guarantees that a spurious empty snapshot cannot overwrite real data.
        const alreadySeeded =
          data.todayInitialized === true || !!localStorage.getItem(SEED_FLAG_KEY);

        if (tpls) {
          setTemplates(tpls);
          if (!data.todayInitialized && !initFlagSetRef.current) {
            initFlagSetRef.current = true;
            localStorage.setItem(SEED_FLAG_KEY, '1');
            setDoc(ref, { todayInitialized: true }, { merge: true }).catch((err) =>
              console.error('Failed to set today init flag:', err)
            );
          }
        } else if (!alreadySeeded && !seedAttemptedRef.current) {
          seedAttemptedRef.current = true;
          initFlagSetRef.current = true;
          localStorage.setItem(SEED_FLAG_KEY, '1');
          try {
            await setDoc(
              ref,
              { todayTemplates: DEFAULT_TEMPLATES, todayInitialized: true },
              { merge: true }
            );
          } catch (err) {
            console.error('Failed to seed today templates:', err);
            setTemplates(DEFAULT_TEMPLATES);
          }
        } else {
          // Doc was seeded before but tpls is missing — show defaults locally,
          // do NOT write to Firestore.
          setTemplates(DEFAULT_TEMPLATES);
        }

        if (todayItems) {
          setItems(todayItems);
        } else {
          // No items for today in Firestore — render defaults locally, no auto-write.
          setItems(DEFAULT_ITEMS_FOR_TODAY);
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

  const layout = useMemo(() => computeLayout(items), [items]);

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
    persistItems([
      ...items,
      { id: newId(), startMin: slotStart, durationMin: tpl.durationMin, label: tpl.name },
    ]);
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
    persistItems([
      ...items,
      { id: newId(), startMin: editingSlot, durationMin: SLOT_MIN, label: text },
    ]);
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
    if (totalMin <= 0) totalMin = DURATION_STEP;
    totalMin = Math.round(totalMin / DURATION_STEP) * DURATION_STEP;
    persistTemplates([...templates, { id: newId(), name, durationMin: totalMin }]);
    setTplName('');
    setTplHours('');
    setTplMins('30');
  }

  function deleteTemplate(id) {
    persistTemplates(templates.filter((t) => t.id !== id));
    if (expandedTpl === id) setExpandedTpl(null);
  }

  // Click-to-add: drop the template onto today's schedule using the start time
  // and length configured for today's weekday (falling back to 8 AM / default).
  function applyTemplateToToday(tpl) {
    const { startMin, durationMin } = resolveTemplateForDay(tpl, todayWeekday);
    const dur = durationMin || SLOT_MIN;
    const start = startMin != null ? startMin : DAY_START_MIN;
    if (start + dur > DAY_END_MIN) {
      alert(`"${tpl.name}" (${durationToLabel(dur)}) starting ${minutesToLabel(start)} runs past the end of the day.`);
      return;
    }
    persistItems([
      ...items,
      { id: newId(), startMin: start, durationMin: dur, label: tpl.name },
    ]);
  }

  function setTemplateDefaultDuration(id, durationMin) {
    persistTemplates(templates.map((t) => (t.id === id ? { ...t, durationMin } : t)));
  }

  // Patch one weekday's override for a template. Null clears a field; an empty
  // day object is removed entirely (so Firestore never stores undefined).
  function setTemplateDay(id, dayIdx, patch) {
    persistTemplates(templates.map((t) => {
      if (t.id !== id) return t;
      const days = { ...(t.days || {}) };
      const cur = { ...(days[dayIdx] || {}), ...patch };
      if (cur.startMin == null) delete cur.startMin;
      if (cur.durationMin == null) delete cur.durationMin;
      if (Object.keys(cur).length === 0) delete days[dayIdx];
      else days[dayIdx] = cur;
      return { ...t, days };
    }));
  }

  function clearAll() {
    if (!confirm('Clear today’s entire schedule?')) return;
    persistItems([]);
  }

  function onTemplateDragStart(tpl, e) {
    dragRef.current = { type: 'template', id: tpl.id };
    setIsDragging(true);
    try { e.dataTransfer.effectAllowed = 'copy'; } catch {}
    try { e.dataTransfer.setData('text/plain', tpl.name); } catch {}
  }
  function onItemDragStart(item, e) {
    dragRef.current = { type: 'item', id: item.id };
    setIsDragging(true);
    try { e.dataTransfer.effectAllowed = 'move'; } catch {}
    try { e.dataTransfer.setData('text/plain', item.label || ''); } catch {}
  }
  function onDragEnd() {
    dragRef.current = null;
    setDragOverSlot(null);
    setIsDragging(false);
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
    setIsDragging(false);
    if (!payload) return;
    if (payload.type === 'item') {
      moveItem(payload.id, slotStart);
    } else if (payload.type === 'template') {
      const tpl = templates.find((t) => t.id === payload.id);
      if (tpl) {
        const { durationMin } = resolveTemplateForDay(tpl, todayWeekday);
        addItemFromTemplate(slotStart, { ...tpl, durationMin: durationMin || tpl.durationMin });
      }
    }
  }

  function onResizeStart(e, item) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startDuration = item.durationMin;
    const startMin = item.startMin;
    const itemId = item.id;
    const itemsAtStart = items;
    let currentDuration = startDuration;
    setResizingPreview({ id: itemId, duration: startDuration });

    function onMove(ev) {
      const deltaY = ev.clientY - startY;
      const deltaSlots = Math.round(deltaY / ROW_HEIGHT);
      let nd = startDuration + deltaSlots * SLOT_MIN;
      if (nd < SLOT_MIN) nd = SLOT_MIN;
      const maxDuration = DAY_END_MIN - startMin;
      if (nd > maxDuration) nd = maxDuration;
      if (nd !== currentDuration) {
        currentDuration = nd;
        setResizingPreview({ id: itemId, duration: nd });
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setResizingPreview(null);
      if (currentDuration !== startDuration) {
        const next = itemsAtStart.map((x) =>
          x.id === itemId ? { ...x, durationMin: currentDuration } : x
        );
        persistItems(next);
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const slotRows = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    slotRows.push(DAY_START_MIN + i * SLOT_MIN);
  }

  if (!user) return null;

  const totalHeight = SLOT_COUNT * ROW_HEIGHT;

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
              <>
                <div className={styles.timesCol} style={{ height: totalHeight }}>
                  {slotRows.map((startMin) => (
                    <div key={startMin} className={styles.timeRow} style={{ height: ROW_HEIGHT }}>
                      <span className={styles.colTime}>{minutesToLabel(startMin)}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.itemsCol} style={{ height: totalHeight }}>
                  {slotRows.map((startMin, idx) => (
                    <div
                      key={startMin}
                      className={`${styles.dropRow} ${dragOverSlot === startMin ? styles.dropRowActive : ''}`}
                      style={{ top: idx * ROW_HEIGHT, height: ROW_HEIGHT }}
                      onDragOver={(e) => onSlotDragOver(startMin, e)}
                      onDrop={(e) => onSlotDrop(startMin, e)}
                    >
                      <button
                        className={styles.rowAdd}
                        onClick={() => startEditing(startMin)}
                        title="Add task at this time"
                      >
                        +
                      </button>
                    </div>
                  ))}

                  <div className={`${styles.itemsLayer} ${isDragging ? styles.itemsLayerDragging : ''}`}>
                    {items.map((item) => {
                      const place = layout.get(item.id) || { lane: 0, totalLanes: 1 };
                      const previewDuration =
                        resizingPreview?.id === item.id ? resizingPreview.duration : item.durationMin;
                      const topPx = ((item.startMin - DAY_START_MIN) / SLOT_MIN) * ROW_HEIGHT + 2;
                      const heightPx = (previewDuration / SLOT_MIN) * ROW_HEIGHT - 4;
                      const leftPct = (place.lane / place.totalLanes) * 100;
                      const widthPct = (1 / place.totalLanes) * 100;
                      const isResizing = resizingPreview?.id === item.id;
                      return (
                        <div
                          key={item.id}
                          className={`${styles.itemBlock} ${isResizing ? styles.itemBlockResizing : ''}`}
                          style={{
                            top: topPx,
                            height: heightPx,
                            left: `${leftPct}%`,
                            width: `calc(${widthPct}% - 4px)`,
                          }}
                        >
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
                          <div className={styles.itemBody}>
                            <div className={styles.itemTopRow}>
                              <input
                                className={styles.itemInput}
                                value={item.label}
                                onChange={(e) => renameItem(item.id, e.target.value)}
                                placeholder="(untitled)"
                              />
                              <span className={styles.itemTime}>
                                {timeRangeLabel(item.startMin, previewDuration)}
                              </span>
                            </div>
                            <div className={styles.itemMeta}>
                              <select
                                className={styles.durationSelect}
                                value={item.durationMin}
                                onChange={(e) => changeDuration(item.id, parseInt(e.target.value, 10))}
                                title="Duration"
                              >
                                {LENGTH_OPTIONS.map((d) => (
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
                          <span
                            className={styles.resizeHandle}
                            onMouseDown={(e) => onResizeStart(e, item)}
                            title="Drag to resize"
                            aria-label="Drag to resize"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {editingSlot !== null && (
                    <div
                      className={styles.editor}
                      style={{
                        top: ((editingSlot - DAY_START_MIN) / SLOT_MIN) * ROW_HEIGHT + 2,
                        height: ROW_HEIGHT - 4,
                      }}
                    >
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
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <h2 className={styles.sidebarTitle}>Templates</h2>
            <p className={styles.sidebarHelp}>Click a template to drop it at today’s time, or drag it onto a slot. Hit ✎ to set per-weekday start times &amp; lengths.</p>
            <div className={styles.tplList}>
              {templates.length === 0 && (
                <div className={styles.tplEmpty}>No templates yet.</div>
              )}
              {templates.map((t) => {
                const today = resolveTemplateForDay(t, todayWeekday);
                const hint = today.startMin != null
                  ? `${minutesToLabel(today.startMin)} · ${durationToLabel(today.durationMin)}`
                  : durationToLabel(today.durationMin);
                const isOpen = expandedTpl === t.id;
                return (
                  <div key={t.id} className={styles.tplWrap}>
                    <div className={styles.tplRow}>
                      <div
                        className={styles.tplBtn}
                        role="button"
                        tabIndex={0}
                        draggable
                        onClick={() => applyTemplateToToday(t)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyTemplateToToday(t); } }}
                        onDragStart={(e) => onTemplateDragStart(t, e)}
                        onDragEnd={onDragEnd}
                        title={`Click to add ${t.name} at today’s time, or drag onto a slot`}
                      >
                        <span className={styles.tplName}>{t.name}</span>
                        <span className={styles.tplDur}>{hint}</span>
                      </div>
                      <button
                        className={`${styles.tplEdit} ${isOpen ? styles.tplEditActive : ''}`}
                        onClick={() => setExpandedTpl(isOpen ? null : t.id)}
                        title="Set weekly start times & lengths"
                        aria-label="Edit weekly times"
                      >
                        ✎
                      </button>
                      <button
                        className={styles.tplDelete}
                        onClick={() => deleteTemplate(t.id)}
                        title="Delete template"
                      >
                        ×
                      </button>
                    </div>
                    {isOpen && (
                      <div className={styles.tplEditor}>
                        <label className={styles.tplEditorTop}>
                          <span className={styles.fieldLabel}>Default length</span>
                          <select
                            className={styles.daySelect}
                            value={t.durationMin}
                            onChange={(e) => setTemplateDefaultDuration(t.id, parseInt(e.target.value, 10))}
                          >
                            {LENGTH_OPTIONS.map((d) => (
                              <option key={d} value={d}>{durationToLabel(d)}</option>
                            ))}
                          </select>
                        </label>
                        <div className={styles.dayGridHead}>
                          <span />
                          <span>Start</span>
                          <span>Length</span>
                        </div>
                        {WEEKDAYS_SHORT.map((lbl, d) => {
                          const ov = (t.days && t.days[d]) || {};
                          return (
                            <div key={d} className={styles.dayRow}>
                              <span className={`${styles.dayLabel} ${d === todayWeekday ? styles.dayToday : ''}`}>{lbl}</span>
                              <select
                                className={styles.daySelect}
                                value={ov.startMin != null ? String(ov.startMin) : ''}
                                onChange={(e) => setTemplateDay(t.id, d, { startMin: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
                              >
                                <option value="">—</option>
                                {START_OPTIONS.map((m) => (
                                  <option key={m} value={m}>{minutesToLabel(m)}</option>
                                ))}
                              </select>
                              <select
                                className={styles.daySelect}
                                value={ov.durationMin != null ? String(ov.durationMin) : ''}
                                onChange={(e) => setTemplateDay(t.id, d, { durationMin: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
                              >
                                <option value="">Default</option>
                                {LENGTH_OPTIONS.map((dd) => (
                                  <option key={dd} value={dd}>{durationToLabel(dd)}</option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                        <p className={styles.tplEditorHint}>Set a Start to enable one-click add for that day. “Default” length uses {durationToLabel(t.durationMin)}.</p>
                      </div>
                    )}
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
                  <option value="15">15</option>
                  <option value="30">30</option>
                  <option value="45">45</option>
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

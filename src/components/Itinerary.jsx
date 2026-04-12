import { useState } from 'react';
import styles from './Itinerary.module.css';

function formatItemDateTime(item) {
  if (!item.date) return '';
  const d = new Date(item.date + 'T' + (item.time || '00:00'));
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = item.time ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  return timeStr ? `${dateStr} · ${timeStr}` : dateStr;
}

export function Itinerary({ event, onSave, canEdit }) {
  const items = Array.isArray(event?.itinerary) ? event.itinerary : [];
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', date: '', time: '', location: '', notes: '', type: 'activity', url: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [aiError, setAiError] = useState('');

  async function handleAiPrompt() {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError('');
    setAiMessage('');
    try {
      const eventContext = {
        title: event?.title || '',
        startDate: event?.startDate || event?.date || '',
        endDate: event?.endDate || '',
        location: event?.location || '',
        description: event?.description || '',
      };
      const resp = await fetch('/api/itinerary-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, itinerary: items, eventContext }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to reach assistant');

      // Apply the action to the itinerary
      const newItems = (data.items || []).map(it => ({
        id: it.id && it.id.trim() ? it.id : crypto.randomUUID(),
        title: it.title || '',
        date: it.date || '',
        time: it.time || '',
        location: it.location || '',
        notes: it.notes || '',
        type: it.type || 'activity',
        url: it.url || '',
        imageQuery: it.imageQuery || '',
      }));

      let next;
      if (data.action === 'replace') {
        next = newItems;
      } else if (data.action === 'merge') {
        const byId = new Map(items.map(i => [i.id, i]));
        for (const it of newItems) byId.set(it.id, { ...byId.get(it.id), ...it });
        next = Array.from(byId.values());
      } else {
        // 'add'
        next = [...items, ...newItems];
      }
      next.sort((a, b) => {
        const ad = (a.date || '') + 'T' + (a.time || '00:00');
        const bd = (b.date || '') + 'T' + (b.time || '00:00');
        return ad.localeCompare(bd);
      });
      await onSave({ itinerary: next });
      setAiMessage(data.message || 'Updated!');
      setAiPrompt('');
    } catch (err) {
      setAiError(err.message || 'Something went wrong');
    } finally {
      setAiLoading(false);
    }
  }

  function startAdd() {
    setForm({ title: '', date: '', time: '', location: '', notes: '', type: 'activity', url: '' });
    setAdding(true);
    setEditingId(null);
  }

  function startEdit(item) {
    setForm({
      title: item.title || '',
      date: item.date || '',
      time: item.time || '',
      location: item.location || '',
      notes: item.notes || '',
      type: item.type || 'activity',
      url: item.url || '',
    });
    setEditingId(item.id);
    setAdding(false);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
  }

  async function saveItem() {
    if (!form.title.trim()) return;
    let next;
    if (adding) {
      const newItem = { ...form, id: crypto.randomUUID() };
      next = [...items, newItem];
    } else {
      next = items.map(i => (i.id === editingId ? { ...i, ...form } : i));
    }
    next.sort((a, b) => {
      const ad = (a.date || '') + 'T' + (a.time || '00:00');
      const bd = (b.date || '') + 'T' + (b.time || '00:00');
      return ad.localeCompare(bd);
    });
    await onSave({ itinerary: next });
    cancel();
  }

  async function deleteItem(id) {
    if (!confirm('Delete this itinerary item?')) return;
    const next = items.filter(i => i.id !== id);
    await onSave({ itinerary: next });
  }

  // Group by date
  const groups = {};
  for (const item of items) {
    const key = item.date || 'Unscheduled';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => {
    if (a === 'Unscheduled') return 1;
    if (b === 'Unscheduled') return -1;
    return a.localeCompare(b);
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Trip Itinerary</h3>
        {canEdit && !adding && !editingId && (
          <button className={styles.addBtn} onClick={startAdd}>+ Add Item</button>
        )}
      </div>

      {canEdit && (
        <div className={styles.aiBox}>
          <div className={styles.aiLabel}>
            <span className={styles.aiSparkle}>✨</span>
            Ask Claude to plan your trip
          </div>
          <div className={styles.aiRow}>
            <input
              className={styles.aiInput}
              type="text"
              placeholder='e.g., "Plan a day in Rome with 4 activities" or "Move the museum to morning"'
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleAiPrompt(); }}
              disabled={aiLoading}
            />
            <button
              className={styles.aiSendBtn}
              onClick={handleAiPrompt}
              disabled={aiLoading || !aiPrompt.trim()}
            >
              {aiLoading ? '…' : 'Send'}
            </button>
          </div>
          {aiMessage && <div className={styles.aiMessage}>{aiMessage}</div>}
          {aiError && <div className={styles.aiErrorMsg}>{aiError}</div>}
        </div>
      )}

      {(adding || editingId) && (
        <div className={styles.form}>
          <div className={styles.typeRow}>
            {[
              { key: 'activity', label: 'Activity', icon: '🎯' },
              { key: 'travel', label: 'Travel', icon: '✈️' },
              { key: 'lodging', label: 'Lodging', icon: '🏨' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                className={form.type === t.key ? styles.typeBtnActive : styles.typeBtn}
                onClick={() => setForm({ ...form, type: t.key })}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder={form.type === 'travel' ? 'Title (e.g., Flight to Barcelona)' : form.type === 'lodging' ? 'Title (e.g., Hotel Montecarlo)' : 'Title (e.g., Dinner at Le Bernardin)'}
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            autoFocus
          />
          <div className={styles.row}>
            <input
              className={styles.input}
              type="date"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
            />
            <input
              className={styles.input}
              type="time"
              value={form.time}
              onChange={e => setForm({ ...form, time: e.target.value })}
            />
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder="Location (optional)"
            value={form.location}
            onChange={e => setForm({ ...form, location: e.target.value })}
          />
          <input
            className={styles.input}
            type="url"
            placeholder="Link (optional — website or booking URL)"
            value={form.url}
            onChange={e => setForm({ ...form, url: e.target.value })}
          />
          <textarea
            className={styles.textarea}
            placeholder="Notes (optional)"
            rows={3}
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
          />
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={cancel}>Cancel</button>
            <button className={styles.saveBtn} onClick={saveItem} disabled={!form.title.trim()}>
              {adding ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Trip highlights — key activities with images */}
      {(() => {
        const highlights = items
          .filter(i => (i.type || 'activity') === 'activity' && i.title)
          .slice(0, 6);
        const lodgingHighlight = items.find(i => i.type === 'lodging' && i.title);
        if (highlights.length === 0) return null;
        return (
          <div className={styles.highlightsSection}>
            <h4 className={styles.highlightsTitle}>Trip Highlights</h4>
            <div className={styles.highlightsImages}>
              {highlights.slice(0, 4).map(item => {
                const query = encodeURIComponent(item.imageQuery || item.title);
                return (
                  <div key={item.id} className={styles.highlightCard}>
                    <img
                      className={styles.highlightImg}
                      src={`https://image.pollinations.ai/prompt/${query}%20travel%20photo?width=400&height=250&nologo=true`}
                      alt={item.title}
                      loading="lazy"
                    />
                    <div className={styles.highlightLabel}>{item.title}</div>
                  </div>
                );
              })}
            </div>
            <ul className={styles.highlightsList}>
              {highlights.map(item => (
                <li key={item.id}>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                  ) : item.title}
                  {item.location && <span className={styles.highlightMeta}> — {item.location}</span>}
                </li>
              ))}
              {lodgingHighlight && (
                <li>
                  🏨 {lodgingHighlight.url ? (
                    <a href={lodgingHighlight.url} target="_blank" rel="noopener noreferrer">{lodgingHighlight.title}</a>
                  ) : lodgingHighlight.title}
                  {lodgingHighlight.location && <span className={styles.highlightMeta}> — {lodgingHighlight.location}</span>}
                </li>
              )}
            </ul>
          </div>
        );
      })()}

      {items.length === 0 && !adding ? (
        <div className={styles.empty}>
          <p>No itinerary items yet.</p>
          {canEdit && <p className={styles.emptyHint}>Click "+ Add Item" to start planning your trip.</p>}
        </div>
      ) : (
        <div className={styles.list}>
          {sortedDates.map(dateKey => {
            const dateItems = groups[dateKey].slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
            const dateLabel = dateKey === 'Unscheduled'
              ? 'Unscheduled'
              : new Date(dateKey + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            return (
              <div key={dateKey} className={styles.dateGroup}>
                <div className={styles.dateLabel}>{dateLabel}</div>
                <div className={styles.scheduleGrid}>
                  {[
                    { key: 'travel', label: 'Travel', icon: '✈️', color: '#0891b2' },
                    { key: 'activity', label: 'Activities', icon: '🎯', color: '#6366F1' },
                    { key: 'lodging', label: 'Lodging', icon: '🏨', color: '#d97706' },
                  ].map(col => {
                    const colItems = dateItems.filter(i => (i.type || 'activity') === col.key);
                    return (
                      <div key={col.key} className={styles.scheduleCol}>
                        <div className={styles.scheduleColHeader} style={{ borderBottomColor: col.color, color: col.color }}>
                          <span>{col.icon}</span> {col.label}
                        </div>
                        <div className={styles.scheduleColItems}>
                          {colItems.length === 0 ? (
                            <div className={styles.scheduleEmpty}>—</div>
                          ) : (
                            colItems.map(item => (
                              <div key={item.id} className={styles.scheduleItem} style={{ borderLeftColor: col.color }}>
                                <div className={styles.itemContent}>
                                  <div className={styles.itemHeader}>
                                    {item.url ? (
                                      <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.itemTitleLink}>{item.title}</a>
                                    ) : (
                                      <span className={styles.itemTitle}>{item.title}</span>
                                    )}
                                  </div>
                                  {item.time && <div className={styles.itemTime}>{new Date('2000-01-01T' + item.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>}
                                  {item.location && <div className={styles.itemLocation}>📍 {item.location}</div>}
                                  {item.url && <div className={styles.itemUrl}><a href={item.url} target="_blank" rel="noopener noreferrer">🔗 View details</a></div>}
                                  {item.notes && <div className={styles.itemNotes}>{item.notes}</div>}
                                </div>
                                {canEdit && (
                                  <div className={styles.itemActions}>
                                    <button className={styles.iconBtn} onClick={() => startEdit(item)} title="Edit">✎</button>
                                    <button className={styles.iconBtn} onClick={() => deleteItem(item.id)} title="Delete">×</button>
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

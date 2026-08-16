import { useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  MONTH_NAMES, WEEKDAY_NAMES, WEEKDAY_SHORT, WEEK_OPTIONS,
  defaultRuleFromDate, describeRecurrence, normalizeRecurrence,
} from '../recurrence';
import styles from './EventForm.module.css';

export function EventForm({ event, onSave, onCancel }) {
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [dateTBD, setDateTBD] = useState(event?.dateTBD || false);
  const [date, setDate] = useState(() => {
    if (event?.date) {
      const d = event.date.toDate ? event.date.toDate() : new Date(event.date);
      return d.toISOString().slice(0, 16);
    }
    return '';
  });
  const [endDate, setEndDate] = useState(() => {
    if (event?.endDate) {
      const d = event.endDate.toDate ? event.endDate.toDate() : new Date(event.endDate);
      return d.toISOString().slice(0, 16);
    }
    return '';
  });
  // Which planning areas this event needs handled. Captured at creation so the
  // event knows up front whether an itinerary, travel, and/or lodging are in scope.
  const [planning, setPlanning] = useState({
    itinerary: event?.planning?.itinerary || false,
    travel: event?.planning?.travel || false,
    lodging: event?.planning?.lodging || false,
  });
  const togglePlanning = (key) => setPlanning(p => ({ ...p, [key]: !p[key] }));

  // --- repeating events ---
  // One occurrence per event document, so an occurrence of a series is edited
  // like any other event; the rule below lives on the series it belongs to.
  // An occurrence can't start a series of its own — that's what `seriesId` gates.
  const isOccurrence = !!event?.seriesId;
  const [rule, setRule] = useState(() => normalizeRecurrence(event?.recurrence));
  const patchRule = (patch) => setRule(r => ({ ...r, ...patch }));
  // The start date seeds the rule, so "every year" already means "on this date".
  function setFreq(freq) {
    if (!freq) { setRule(null); return; }
    const seed = defaultRuleFromDate(date ? new Date(date) : null, freq);
    setRule(rule ? { ...seed, ...rule, freq } : seed);
  }
  // Switching between "day 25" and "the 4th Thursday" fills whichever fields
  // the stored rule never had from the start date, so neither lands on 1/first.
  function setMode(mode) {
    const seed = defaultRuleFromDate(date ? new Date(date) : null, rule.freq);
    patchRule({
      mode,
      day: rule.day ?? seed.day,
      weekday: rule.weekday ?? seed.weekday,
      week: rule.week ?? seed.week,
    });
  }
  const toggleWeekday = (d) => patchRule({
    weekdays: (rule.weekdays || []).includes(d)
      ? rule.weekdays.filter(x => x !== d)
      : [...(rule.weekdays || []), d].sort((a, b) => a - b),
  });
  // Only a rule that can actually produce dates gets saved.
  const savedRule = dateTBD || isOccurrence ? null : normalizeRecurrence(rule);
  const ruleText = describeRecurrence(savedRule);

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!dateTBD && !date) return;
    const data = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      dateTBD,
      planning,
    };
    if (dateTBD) {
      data.date = event?.date || Timestamp.fromDate(new Date());
      data.endDate = event?.endDate || null;
    } else {
      data.date = Timestamp.fromDate(new Date(date));
      data.endDate = endDate ? Timestamp.fromDate(new Date(endDate)) : null;
    }
    if (!isOccurrence) {
      const previous = normalizeRecurrence(event?.recurrence);
      if (savedRule) {
        data.recurrence = savedRule;
        // A repeating event's dates are settled by its rule, so it skips the
        // voting stage and lands on the calendars right away.
        data.stage = 'finalized';
        // A changed rule starts its window over. Without this the dates the new
        // rule wants sit behind the old rule's high-water mark, which reads as
        // "already handled", and nothing new would ever be created.
        if (JSON.stringify(savedRule) !== JSON.stringify(previous)) data.recurrenceGeneratedThrough = null;
      } else if (previous) {
        data.recurrence = null; // repeating was turned off
      }
    }
    onSave(data);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.heading}>{event ? 'Edit Event' : 'Create Event'}</h2>

      <label className={styles.label}>
        Event Name
        <input className={styles.input} type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Game night, birthday dinner..." required autoFocus />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 500, color: dateTBD ? '#4f46e5' : '#6b7280' }}>
        <input type="checkbox" checked={dateTBD} onChange={e => setDateTBD(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }} />
        Date & time to be determined (based on poll voting)
      </label>

      {!dateTBD && (
        <div className={styles.row}>
          <label className={styles.label}>
            Start
            <input className={styles.input} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required />
          </label>
          <label className={styles.label}>
            End (optional)
            <input className={styles.input} type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
        </div>
      )}

      {dateTBD && (
        <div style={{ padding: '0.75rem', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '8px', fontSize: '0.82rem', color: '#4338CA' }}>
          📊 Date will be decided by poll votes. You can finalize it later.
        </div>
      )}

      {isOccurrence && (
        <div style={{ padding: '0.6rem 0.75rem', background: 'var(--color-accent-light)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
          🔁 This is one occurrence of a repeating event. Changes here affect this date only — edit the series to change the rest.
        </div>
      )}

      {!dateTBD && !isOccurrence && (
        <div>
          <label className={styles.label}>
            Repeats
            <select className={styles.input} value={rule?.freq || ''} onChange={e => setFreq(e.target.value)}>
              <option value="">Doesn’t repeat</option>
              <option value="yearly">Every year</option>
              <option value="monthly">Every month</option>
              <option value="weekly">Every week</option>
            </select>
          </label>

          {rule && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '0.6rem', padding: '0.85rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)' }}>
              {rule.freq === 'yearly' && (
                <label className={styles.label}>
                  Month
                  <select className={styles.input} value={rule.month ?? 0} onChange={e => patchRule({ month: Number(e.target.value) })}>
                    {MONTH_NAMES.map((m, i) => <option key={m} value={i}>{m}</option>)}
                  </select>
                </label>
              )}

              {rule.freq === 'weekly' ? (
                <div>
                  <div className={styles.label} style={{ marginBottom: '0.4rem' }}>On these days</div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {WEEKDAY_SHORT.map((name, i) => {
                      const on = (rule.weekdays || []).includes(i);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => toggleWeekday(i)}
                          aria-pressed={on}
                          style={{
                            padding: '0.35rem 0.6rem', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: '0.78rem', fontWeight: 600,
                            border: on ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                            background: on ? 'var(--color-accent)' : 'var(--color-surface)',
                            color: on ? '#fff' : 'var(--color-text-secondary)',
                          }}
                        >{name}</button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem', cursor: 'pointer' }}>
                    <input type="radio" checked={rule.mode !== 'nth'} onChange={() => setMode('date')} style={{ accentColor: 'var(--color-accent)' }} />
                    On day
                    <input
                      className={styles.input}
                      type="number"
                      min="1"
                      max="31"
                      value={rule.day ?? 1}
                      onChange={e => patchRule({ day: Number(e.target.value), mode: 'date' })}
                      style={{ width: '5rem', padding: '0.35rem 0.5rem' }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem', cursor: 'pointer', flexWrap: 'wrap' }}>
                    <input type="radio" checked={rule.mode === 'nth'} onChange={() => setMode('nth')} style={{ accentColor: 'var(--color-accent)' }} />
                    On the
                    <select
                      className={styles.input}
                      value={rule.week ?? 1}
                      onChange={e => patchRule({ week: Number(e.target.value), mode: 'nth' })}
                      style={{ width: 'auto', padding: '0.35rem 0.5rem' }}
                    >
                      {WEEK_OPTIONS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                    <select
                      className={styles.input}
                      value={rule.weekday ?? 0}
                      onChange={e => patchRule({ weekday: Number(e.target.value), mode: 'nth' })}
                      style={{ width: 'auto', padding: '0.35rem 0.5rem' }}
                    >
                      {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </label>
                </div>
              )}

              <label className={styles.label}>
                Ends (optional)
                <input className={styles.input} type="date" value={rule.until || ''} onChange={e => patchRule({ until: e.target.value })} />
              </label>

              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: ruleText ? 'var(--color-accent)' : 'var(--color-warning)' }}>
                {ruleText ? `🔁 ${ruleText}` : '⚠️ Pick at least one day for this to repeat.'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                Each occurrence becomes its own event with its own guest list, chat and planning.
                A date that doesn’t exist in a given month — the 31st, or a fifth Friday — is skipped.
              </div>
            </div>
          )}
        </div>
      )}

      <label className={styles.label}>
        Location
        <input className={styles.input} type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Address or venue name" />
      </label>

      <label className={styles.label}>
        Description
        <textarea className={styles.textarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="What should people know?" rows={3} />
      </label>

      <div>
        <div className={styles.label} style={{ marginBottom: '0.4rem' }}>What needs planning?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {[
            { key: 'itinerary', label: 'Itinerary', icon: '🗓️' },
            { key: 'travel', label: 'Travel', icon: '✈️' },
            { key: 'lodging', label: 'Lodging', icon: '🏨' },
          ].map(opt => (
            <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 500, color: planning[opt.key] ? '#4f46e5' : '#6b7280' }}>
              <input type="checkbox" checked={planning[opt.key]} onChange={() => togglePlanning(opt.key)} style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }} />
              <span aria-hidden="true">{opt.icon}</span>
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.saveBtn} type="submit">{event ? 'Save Changes' : 'Create Event'}</button>
        {onCancel && <button className={styles.cancelBtn} type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

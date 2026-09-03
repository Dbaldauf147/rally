import { useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  WEEK_ORDINALS,
  describeRecurrence,
  normalizeRecurrence,
  recurrenceFromDate,
} from '../lib/recurrence';
import styles from './EventForm.module.css';
import { DateField } from './DateField';

const pad = (n) => String(n).padStart(2, '0');

function asDate(value) {
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Local yyyy-mm-dd / HH:mm for the date and time inputs. Built by hand rather
// than sliced off toISOString(), which is UTC and shifts the day for anyone
// west of Greenwich in the evening.
function dayValue(value) {
  const d = asDate(value);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}

function timeValue(value) {
  const d = asDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

// Combine the two inputs into a local Date. A blank time means midnight, which
// is what an all-day event is stored as.
function combine(day, time) {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = (time || '00:00').split(':').map(Number);
  if (!y || !m || !d || !Number.isFinite(h) || !Number.isFinite(min)) return null;
  return new Date(y, m - 1, d, h, min);
}

export function EventForm({ event, onSave, onCancel }) {
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [dateTBD, setDateTBD] = useState(event?.dateTBD || false);
  // Day and time are separate fields so the time can be left off entirely. A
  // single datetime-local can't express "no time": leaving its clock half-typed
  // makes the whole field invalid and the browser blocks the submit.
  const [startDay, setStartDay] = useState(() => dayValue(event?.date));
  const [startTime, setStartTime] = useState(() => (event?.allDay ? '' : timeValue(event?.date)));
  const [endDay, setEndDay] = useState(() => dayValue(event?.endDate));
  const [endTime, setEndTime] = useState(() => (event?.allDay ? '' : timeValue(event?.endDate)));
  // No start time means an all-day event: the date is what matters and every
  // surface hides the clock.
  const allDay = !startTime;
  // Which planning areas this event needs handled. Captured at creation so the
  // event knows up front whether an itinerary, travel, and/or lodging are in scope.
  const [planning, setPlanning] = useState({
    itinerary: event?.planning?.itinerary || false,
    travel: event?.planning?.travel || false,
    lodging: event?.planning?.lodging || false,
  });
  const togglePlanning = (key) => setPlanning(p => ({ ...p, [key]: !p[key] }));

  // The date field is our own control, so there is no native "required" bubble
  // to lean on. Submitting without a start date says so in the form instead.
  const [dateMissing, setDateMissing] = useState(false);

  // --- Yearly repeat. The rule is seeded from whatever start date is in the
  // form and keeps tracking it until the user edits the rule themselves, so
  // picking a date first and ticking "repeats" second does the obvious thing.
  const savedRule = normalizeRecurrence(event?.recurrence);
  const [repeats, setRepeats] = useState(!!savedRule);
  const [rule, setRule] = useState(() => savedRule || recurrenceFromDate(event?.date || new Date(), 'date'));
  const [ruleTouched, setRuleTouched] = useState(!!savedRule);
  const [endsMode, setEndsMode] = useState(savedRule?.endYear != null ? 'year' : 'never');
  const [endYear, setEndYear] = useState(String(savedRule?.endYear ?? new Date().getFullYear() + 5));

  // Local Date for the start field, or null while the day is empty/half-typed.
  function startAsDate(day = startDay) {
    return combine(day, startTime);
  }

  function handleStartDayChange(value) {
    setStartDay(value);
    if (value) setDateMissing(false);
    // Untouched rules follow the start date; a hand-edited rule is left alone.
    if (ruleTouched) return;
    const d = combine(value, startTime);
    if (d) setRule(recurrenceFromDate(d, rule.mode));
  }

  function editRule(patch) {
    setRuleTouched(true);
    setRule(r => ({ ...r, ...patch }));
  }

  function switchMode(mode) {
    setRuleTouched(true);
    // Re-derive from the start date so switching to "3rd Saturday of…" lands on
    // the week the chosen date actually falls in, not on a stale default.
    const d = startAsDate() || (event?.date?.toDate?.() ?? null) || new Date();
    setRule(r => ({ ...recurrenceFromDate(d, mode), startYear: r.startYear, endYear: r.endYear }));
  }

  // The rule as it will be saved, including the "ends" choice — also what the
  // plain-English preview under the picker is rendered from.
  function buildRule() {
    const anchorYear = startAsDate()?.getFullYear() ?? rule.startYear ?? new Date().getFullYear();
    // The first year of the series is sticky. The form's start date is whatever
    // occurrence is currently showing (it rolls forward every year), so taking
    // the year straight off it would keep chopping the earlier years out of the
    // series each time somebody opens the edit form.
    const startYear = savedRule?.startYear != null ? Math.min(savedRule.startYear, anchorYear) : anchorYear;
    const parsedEndYear = endsMode === 'year' ? Number(endYear) : null;
    return normalizeRecurrence({
      ...rule,
      freq: 'yearly',
      startYear,
      endYear: Number.isFinite(parsedEndYear) ? parsedEndYear : null,
    });
  }

  const previewRule = repeats && !dateTBD ? buildRule() : null;
  // normalizeRecurrence drops an end year that lands before the first
  // occurrence (it would leave a series that never happens) — say so instead of
  // silently ignoring what was typed.
  const endYearIgnored = !!previewRule && endsMode === 'year' && previewRule.endYear === null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const start = dateTBD ? null : startAsDate();
    if (!dateTBD && !start) { setDateMissing(true); return; }
    setDateMissing(false);
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
      data.allDay = false;
    } else {
      data.date = Timestamp.fromDate(start);
      // An end day with no end time keeps the start's time, so "same time, three
      // days later" doesn't silently become "ends at midnight".
      const end = combine(endDay, allDay ? '' : (endTime || startTime));
      data.endDate = end ? Timestamp.fromDate(end) : null;
      // Written on every save (not just when true) so adding a time to an
      // all-day event clears the flag.
      data.allDay = allDay;
    }
    // null (not undefined) so saving an edit that turns repeating off actually
    // clears the rule on the stored doc.
    data.recurrence = dateTBD || !repeats ? null : buildRule();
    // A yearly rule means the date is settled, so the event skips straight past
    // the date-poll stages — otherwise it would sit in "Voting" forever and
    // never reach the surfaces that only show finalized events.
    if (data.recurrence && event?.stage !== 'finalized') data.stage = 'finalized';
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
        <div className={styles.dateRow}>
          <label className={styles.label}>
            Start
            <div className={styles.dateTimePair}>
              <DateField className={styles.input} value={startDay} onChange={e => handleStartDayChange(e.target.value)} required />
              {dateMissing && <span className={styles.fieldError}>Pick a start date, or tick “to be determined” above.</span>}
              <input className={styles.inputTime} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} aria-label="Start time (optional)" />
            </div>
          </label>
          <label className={styles.label}>
            End (optional)
            <div className={styles.dateTimePair}>
              <DateField className={styles.input} value={endDay} min={startDay || undefined} onChange={e => setEndDay(e.target.value)} />
              <input
                className={styles.inputTime}
                type="time"
                value={allDay ? '' : endTime}
                disabled={allDay}
                onChange={e => setEndTime(e.target.value)}
                aria-label="End time (optional)"
                title={allDay ? 'Add a start time first' : undefined}
              />
            </div>
          </label>
        </div>
      )}

      {!dateTBD && (
        <p className={styles.timeHint}>
          {allDay
            ? 'Time is optional — with none set this is an all-day event.'
            : 'Clear the time fields to make this an all-day event.'}
        </p>
      )}

      {!dateTBD && (
        <div className={styles.repeatBox}>
          <label className={styles.repeatToggle} style={{ color: repeats ? '#4f46e5' : '#6b7280' }}>
            <input type="checkbox" checked={repeats} onChange={e => setRepeats(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }} />
            <span aria-hidden="true">🔁</span>
            Repeats every year
          </label>

          {repeats && (
            <div className={styles.repeatBody}>
              <label className={styles.repeatOption}>
                <input type="radio" name="repeat-mode" checked={rule.mode === 'date'} onChange={() => switchMode('date')} style={{ accentColor: '#4f46e5' }} />
                <span className={styles.repeatOptionLabel}>On</span>
                <select className={styles.repeatSelect} value={rule.month} disabled={rule.mode !== 'date'} onChange={e => editRule({ month: Number(e.target.value) })}>
                  {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select className={styles.repeatSelect} value={rule.day ?? 1} disabled={rule.mode !== 'date'} onChange={e => editRule({ day: Number(e.target.value) })}>
                  {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </select>
              </label>

              <label className={styles.repeatOption}>
                <input type="radio" name="repeat-mode" checked={rule.mode === 'weekday'} onChange={() => switchMode('weekday')} style={{ accentColor: '#4f46e5' }} />
                <span className={styles.repeatOptionLabel}>On the</span>
                <select className={styles.repeatSelect} value={rule.week ?? 1} disabled={rule.mode !== 'weekday'} onChange={e => editRule({ week: Number(e.target.value) })}>
                  {WEEK_ORDINALS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select className={styles.repeatSelect} value={rule.weekday ?? 0} disabled={rule.mode !== 'weekday'} onChange={e => editRule({ weekday: Number(e.target.value) })}>
                  {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
                <span className={styles.repeatOptionLabel}>of</span>
                <select className={styles.repeatSelect} value={rule.month} disabled={rule.mode !== 'weekday'} onChange={e => editRule({ month: Number(e.target.value) })}>
                  {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </label>

              <div className={styles.repeatEnds}>
                <span className={styles.repeatOptionLabel}>Ends</span>
                <select className={styles.repeatSelect} value={endsMode} onChange={e => setEndsMode(e.target.value)}>
                  <option value="never">never</option>
                  <option value="year">after a year</option>
                </select>
                {endsMode === 'year' && (
                  <input
                    className={styles.repeatSelect}
                    type="number"
                    min="1900"
                    max="2999"
                    value={endYear}
                    onChange={e => setEndYear(e.target.value)}
                    style={{ width: '5.5rem' }}
                    aria-label="Last year this event repeats"
                  />
                )}
              </div>

              <p className={styles.repeatPreview}>
                {previewRule ? describeRecurrence(previewRule) : 'Pick a start date to set the repeat.'}
              </p>
              {endYearIgnored && (
                <p className={styles.repeatWarning}>
                  That end year is before the first occurrence, so it will be ignored — pick {previewRule.startYear} or later.
                </p>
              )}
              {previewRule && (
                <p className={styles.repeatHint}>
                  Your dashboard shows the next occurrence; the calendar shows every year.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {dateTBD && (
        <div style={{ padding: '0.75rem', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '8px', fontSize: '0.82rem', color: '#4338CA' }}>
          📊 Date will be decided by poll votes. You can finalize it later.
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

import { useMemo, useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './HolidaysPage.module.css';
import { DateField } from './DateField';
import {
  WEEKDAY_NAMES, MONTH_NAMES, normalizeRule, ruleProblem, describeRule,
  occurrencesForYear, nextOccurrences, parseIso, toIso, ordinal,
} from '../lib/holidayRules';
import { loadHolidays, saveHolidays, makeHolidayId, missingDefaults } from '../lib/holidayStore';
import { syncHolidayList } from '../lib/holidaySync';

const SHORT_DAYS = WEEKDAY_NAMES.map((d) => d.slice(0, 3));
const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

const KIND_OPTIONS = [
  { value: 'date', label: 'On a date' },
  { value: 'weekday', label: 'On a weekday of the month' },
  { value: 'interval', label: 'Every so many days, weeks, months or years' },
  { value: 'relative', label: 'Around another holiday' },
  { value: 'easter', label: 'Around Easter' },
  { value: 'once', label: 'Just once' },
];

const ADJUST_OPTIONS = [
  { value: 'none', label: 'Leave it where it lands' },
  { value: 'nearestWeekday', label: 'On a weekend → nearest weekday' },
  { value: 'nextMonday', label: 'On a weekend → the Monday after' },
  { value: 'previousFriday', label: 'On a weekend → the Friday before' },
  { value: 'weekdayOnOrAfter', label: 'Move to a weekday on or after it' },
  { value: 'weekdayOnOrBefore', label: 'Move to a weekday on or before it' },
  { value: 'weekdayNearest', label: 'Move to the nearest weekday of my choice' },
];
const ADJUST_NEEDS_WEEKDAY = new Set(['weekdayOnOrAfter', 'weekdayOnOrBefore', 'weekdayNearest']);

const NTH_OPTIONS = [
  { value: 1, label: 'First' }, { value: 2, label: 'Second' }, { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' }, { value: 5, label: 'Fifth' }, { value: -1, label: 'Last' },
];

function formatLong(iso) {
  const d = parseIso(iso);
  if (!d) return '—';
  return `${WEEKDAY_NAMES[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatShort(iso, withYear = true) {
  const d = parseIso(iso);
  if (!d) return '—';
  return `${SHORT_DAYS[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ''}`;
}

// One day reads "Thursday, Nov 26, 2026"; a span reads "Sat, May 23 – Mon, May 25, 2026".
function formatOccurrence(occ) {
  if (!occ) return '—';
  if (occ.start === occ.end) return formatLong(occ.start);
  return `${formatShort(occ.start, occ.start.slice(0, 4) !== occ.end.slice(0, 4))} – ${formatShort(occ.end)}`;
}

function countdown(occ, todayIso) {
  if (!occ) return null;
  if (occ.start <= todayIso && todayIso <= occ.end) return { text: occ.start === occ.end ? 'Today' : 'Now', past: false };
  const days = Math.round((parseIso(occ.start) - parseIso(todayIso)) / 86400000);
  if (days > 0) return { text: `in ${days}d`, past: false };
  return { text: `${Math.round((parseIso(todayIso) - parseIso(occ.end)) / 86400000)}d ago`, past: true };
}

// The form keeps what was typed (so a number field can be emptied mid-edit) and
// the shift as an amount + direction; ruleFromDraft turns that into a rule.
function blankDraft(year) {
  return {
    id: null,
    name: '',
    note: '',
    timeOff: true,
    calendar: true,
    rule: { ...normalizeRule({ kind: 'date', months: [1], day: 1 }), anchorYear: year },
    offsetAmount: '0',
    offsetDir: 'later',
  };
}

function draftFromHoliday(h, year) {
  const rule = normalizeRule(h.rule);
  return {
    id: h.id,
    name: h.name,
    note: h.note || '',
    timeOff: !!h.timeOff,
    calendar: h.calendar !== false,
    rule: { ...rule, anchorYear: rule.anchorYear ?? year },
    offsetAmount: String(Math.abs(rule.offsetDays)),
    offsetDir: rule.offsetDays < 0 ? 'earlier' : 'later',
  };
}

function ruleFromDraft(draft) {
  const amount = Math.abs(Math.round(Number(draft.offsetAmount)) || 0);
  return normalizeRule({ ...draft.rule, offsetDays: draft.offsetDir === 'earlier' ? -amount : amount });
}

export function HolidaysPage() {
  const { user } = useAuth();
  const [holidays, setHolidays] = useState(() => loadHolidays());
  const todayIso = useMemo(() => toIso(new Date()), []);
  const thisYear = Number(todayIso.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [draft, setDraft] = useState(() => blankDraft(thisYear));
  const [expanded, setExpanded] = useState(() => new Set());
  const formRef = useRef(null);

  useEffect(() => {
    saveHolidays(holidays);
  }, [holidays]);

  // The holiday reach-out reminders run on the server, which can't read this
  // device's list — mirror it onto the user doc (debounced while typing).
  useEffect(() => {
    if (!user?.uid) return;
    const t = setTimeout(() => syncHolidayList(user.uid, holidays), 1500);
    return () => clearTimeout(t);
  }, [holidays, user?.uid]);

  // One row per holiday: every date it has in the chosen year, and the one to
  // lead with — the next one still to come, or failing that the last one.
  const { rows, dormant } = useMemo(() => {
    const rows = [];
    const dormant = [];
    for (const h of holidays) {
      const occs = occurrencesForYear(h, year, holidays);
      if (occs.length === 0) {
        dormant.push({ h, next: nextOccurrences(h, todayIso, 1, holidays)[0] || null });
      } else {
        const focus = occs.find((o) => o.end >= todayIso) || occs[occs.length - 1];
        rows.push({ h, occs, focus });
      }
    }
    rows.sort((a, b) => a.focus.start.localeCompare(b.focus.start) || a.h.name.localeCompare(b.h.name));
    dormant.sort((a, b) => (a.next?.start || '9999').localeCompare(b.next?.start || '9999'));
    return { rows, dormant };
  }, [holidays, year, todayIso]);

  const nextUp = useMemo(() => {
    let best = null;
    for (const h of holidays) {
      const occ = nextOccurrences(h, todayIso, 1, holidays)[0];
      if (occ && (!best || occ.start < best.occ.start)) best = { h, occ };
    }
    return best;
  }, [holidays, todayIso]);

  // Weekdays covered by a "day off" holiday in the chosen year.
  const weekdaysOff = useMemo(() => {
    const days = new Set();
    for (const { h, occs } of rows) {
      if (!h.timeOff) continue;
      for (const o of occs) {
        for (const ds of o.dates) {
          const dow = parseIso(ds).getDay();
          if (dow !== 0 && dow !== 6 && ds.startsWith(String(year))) days.add(ds);
        }
      }
    }
    return days.size;
  }, [rows, year]);

  const draftRule = useMemo(() => ruleFromDraft(draft), [draft]);
  const draftProblem = useMemo(() => ruleProblem(draftRule, holidays, draft.id), [draftRule, holidays, draft.id]);
  const draftPreview = useMemo(() => {
    if (draftProblem) return [];
    return nextOccurrences({ id: draft.id || '__draft__', rule: draftRule }, todayIso, 5, holidays);
  }, [draftRule, draftProblem, draft.id, holidays, todayIso]);

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  const update = (id, patch) =>
    setHolidays((list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const remove = (id) => {
    const h = holidays.find((x) => x.id === id);
    if (!h) return;
    const followers = holidays.filter((x) => x.rule?.kind === 'relative' && x.rule.baseId === id);
    const warning = followers.length
      ? `\n\n${followers.map((f) => f.name).join(', ')} ${followers.length === 1 ? 'is' : 'are'} timed off it and will stop showing until given a new cadence.`
      : '';
    if (!confirm(`Remove “${h.name}”?${warning}`)) return;
    setHolidays((list) => list.filter((x) => x.id !== id));
    if (draft.id === id) setDraft(blankDraft(thisYear));
  };

  const startEdit = (h) => {
    setDraft(draftFromHoliday(h, thisYear));
    // The form sits below the table; bring it to the person rather than leaving
    // the click looking like it did nothing.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const cancelEdit = () => setDraft(blankDraft(thisYear));

  const canSave = !!draft.name.trim() && !draftProblem;
  const saveDraft = () => {
    if (!canSave) return;
    const fields = {
      name: draft.name.trim(),
      note: draft.note,
      timeOff: draft.timeOff,
      calendar: draft.calendar,
      rule: draftRule,
    };
    if (draft.id) update(draft.id, fields);
    else setHolidays((list) => [...list, { id: makeHolidayId(), ...fields }]);
    // Jump to a year the saved holiday actually appears in, so it is visibly there.
    const first = draftPreview[0];
    if (first && occurrencesForYear({ id: draft.id || '__draft__', rule: draftRule }, year, holidays).length === 0) {
      setYear(Number(first.start.slice(0, 4)));
    }
    setDraft(blankDraft(thisYear));
  };

  const restorable = missingDefaults(holidays);
  const restoreDefaults = () => setHolidays((list) => [...list, ...missingDefaults(list)]);

  const setRule = (patch) => setDraft((d) => ({ ...d, rule: { ...d.rule, ...patch } }));
  const toggleMonth = (m) => setDraft((d) => {
    const has = d.rule.months.includes(m);
    return { ...d, rule: { ...d.rule, months: has ? d.rule.months.filter((x) => x !== m) : [...d.rule.months, m] } };
  });
  const toggleExpanded = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const r = draft.rule;
  const kind = r.kind;
  const showMonths = kind === 'date' || kind === 'weekday';
  const showYearCycle = kind === 'date' || kind === 'weekday' || kind === 'easter' || kind === 'relative';
  const baseChoices = holidays.filter((h) => h.id !== draft.id);

  const weekdaySelect = (value, onChange, label) => (
    <select className={styles.select} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
    </select>
  );

  const renderRow = ({ h, occs, focus, next }) => {
    const shown = focus || next;
    const cd = countdown(shown, todayIso);
    const isPast = !!focus && occs.every((o) => o.end < todayIso);
    const problem = ruleProblem(h.rule, holidays, h.id);
    const open = expanded.has(h.id);
    return (
      <tr key={h.id} className={isPast || !focus ? styles.rowPast : ''} data-holiday={h.name}>
        <td className={styles.tdOff}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={!!h.timeOff}
            onChange={() => update(h.id, { timeOff: !h.timeOff })}
            title="Taking this day off"
            aria-label={`${h.name}: day off`}
          />
        </td>
        <td className={styles.tdOff}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={h.calendar !== false}
            onChange={() => update(h.id, { calendar: h.calendar === false })}
            title="Show on the calendars"
            aria-label={`${h.name}: show on calendars`}
          />
        </td>
        <td>
          <input
            className={styles.nameInput}
            value={h.name}
            onChange={(e) => update(h.id, { name: e.target.value })}
            placeholder="Holiday name"
            aria-label="Holiday name"
          />
        </td>
        <td>
          <div className={styles.dateCell}>
            {shown ? (
              <span className={styles.dayBadge}>{!focus && 'Next: '}{formatOccurrence(shown)}</span>
            ) : (
              <span className={styles.dayBadge}>{problem || 'No upcoming dates'}</span>
            )}
            {cd && <span className={`${styles.countdown} ${cd.past ? styles.countdownPast : ''}`}>{cd.text}</span>}
            {occs && occs.length > 1 && (
              <button type="button" className={styles.moreBtn} onClick={() => toggleExpanded(h.id)} aria-expanded={open}>
                {occs.length}× in {year} {open ? '▴' : '▾'}
              </button>
            )}
          </div>
          {open && occs && occs.length > 1 && (
            <div className={styles.allDates}>
              {occs.map((o) => (
                <span key={o.start} className={`${styles.dateChip} ${o.end < todayIso ? styles.dateChipPast : ''}`}>
                  {formatShort(o.start, false)}{o.start !== o.end && ` – ${formatShort(o.end, false)}`}
                </span>
              ))}
            </div>
          )}
        </td>
        <td>
          <div className={styles.ruleWrap}>
            <span className={styles.ruleCell}>{describeRule(h.rule, holidays)}</span>
            <button type="button" className={styles.editBtn} onClick={() => startEdit(h)} aria-label={`Edit cadence of ${h.name}`}>Edit</button>
          </div>
        </td>
        <td>
          <input
            className={styles.noteInput}
            value={h.note || ''}
            onChange={(e) => update(h.id, { note: e.target.value })}
            placeholder="Plans / notes"
            aria-label="Notes"
          />
        </td>
        <td>
          <button className={styles.removeBtn} onClick={() => remove(h.id)} title="Remove" aria-label={`Remove ${h.name}`}>×</button>
        </td>
      </tr>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Holidays</h1>
        <div className={styles.yearNav}>
          <button type="button" className={styles.yearBtn} onClick={() => setYear((y) => y - 1)} aria-label="Previous year">‹</button>
          <span className={styles.yearLabel} aria-live="polite">{year}</span>
          <button type="button" className={styles.yearBtn} onClick={() => setYear((y) => y + 1)} aria-label="Next year">›</button>
          {year !== thisYear && (
            <button type="button" className={styles.btn} onClick={() => setYear(thisYear)}>This year</button>
          )}
        </div>
      </div>
      <p className={styles.subtitle}>
        Every holiday and when it falls in {year} — {rows.length} holiday{rows.length === 1 ? '' : 's'}, {weekdaysOff} weekday{weekdaysOff === 1 ? '' : 's'} off.
        Tick <strong>Off</strong> for days you’re taking, <strong>Cal</strong> to show one on the calendars.
      </p>

      {nextUp && (
        <div className={styles.nextCard}>
          <span className={styles.nextLabel}>Next up</span>
          <span className={styles.nextName}>{nextUp.h.name}</span>
          <span className={styles.nextMeta}>
            {formatOccurrence(nextUp.occ)} · {countdown(nextUp.occ, todayIso).text.replace(/^in (\d+)d$/, (_, n) => `in ${n} day${n === '1' ? '' : 's'}`).toLowerCase()}
          </span>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thOff} title="Taking this day off">Off</th>
              <th className={styles.thOff} title="Show on the calendars">Cal</th>
              <th>Holiday</th>
              <th>Date in {year}</th>
              <th>Cadence</th>
              <th>Notes</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map(renderRow)}
            {rows.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No holidays fall in {year}.</td></tr>
            )}
            {dormant.length > 0 && (
              <tr className={styles.groupRow}><td colSpan={7}>Not in {year}</td></tr>
            )}
            {dormant.map(renderRow)}
          </tbody>
        </table>
      </div>

      <div className={styles.addCard} ref={formRef} data-testid="holiday-form">
        <div className={styles.addTitle}>{draft.id ? `Edit “${holidays.find((h) => h.id === draft.id)?.name || draft.name}”` : 'Add a holiday'}</div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              className={styles.addName}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Anniversary, Payday, Opening Day"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Repeats</span>
            <select className={styles.select} value={kind} onChange={(e) => setRule({ kind: e.target.value })} aria-label="Repeats">
              {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>When</span>
          <div className={styles.inline}>
            {kind === 'date' && (
              <>
                <span>The</span>
                <select className={styles.select} value={r.day} onChange={(e) => setRule({ day: Number(e.target.value) })} aria-label="Day of the month">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
                  <option value={-1}>last day</option>
                </select>
                <span>of</span>
              </>
            )}
            {kind === 'weekday' && (
              <>
                <span>The</span>
                <select className={styles.select} value={r.nth} onChange={(e) => setRule({ nth: Number(e.target.value) })} aria-label="Which one">
                  {NTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label.toLowerCase()}</option>)}
                </select>
                {weekdaySelect(r.weekday, (v) => setRule({ weekday: v }), 'Weekday')}
                <span>of</span>
              </>
            )}
            {showMonths && (
              <span className={styles.monthHint}>
                {r.months.length === 0 ? 'every month' : r.months.length === 12 ? 'every month' : 'the months picked below'}
              </span>
            )}
            {kind === 'interval' && (
              <>
                <span>Every</span>
                <input
                  type="number" min="1" max="1000" className={styles.numInput}
                  value={r.every} onChange={(e) => setRule({ every: e.target.value })} aria-label="How many"
                />
                <select className={styles.select} value={r.unit} onChange={(e) => setRule({ unit: e.target.value })} aria-label="Unit">
                  <option value="day">day(s)</option>
                  <option value="week">week(s)</option>
                  <option value="month">month(s)</option>
                  <option value="year">year(s)</option>
                </select>
                <span>counting from</span>
                <DateField className={styles.addDate} value={r.anchor} onChange={(e) => setRule({ anchor: e.target.value })} ariaLabel="Counting from" />
              </>
            )}
            {kind === 'relative' && (
              <>
                <span>Timed off</span>
                <select className={styles.select} value={r.baseId} onChange={(e) => setRule({ baseId: e.target.value })} aria-label="Other holiday">
                  <option value="">Pick a holiday…</option>
                  {baseChoices.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
                <span className={styles.monthHint}>— set how many days before or after under “Shift”</span>
              </>
            )}
            {kind === 'easter' && (
              <span className={styles.monthHint}>Easter Sunday — set how many days before or after under “Shift” (Good Friday is 2 days earlier)</span>
            )}
            {kind === 'once' && (
              <DateField className={styles.addDate} value={r.date} onChange={(e) => setRule({ date: e.target.value })} ariaLabel="Date" />
            )}
          </div>
          {showMonths && (
            <div className={styles.monthRow} role="group" aria-label="Months">
              {SHORT_MONTHS.map((m, i) => {
                const on = r.months.includes(i + 1);
                return (
                  <button
                    key={m} type="button" aria-pressed={on}
                    className={`${styles.monthChip} ${on ? styles.monthChipOn : ''}`}
                    onClick={() => toggleMonth(i + 1)}
                  >{m}</button>
                );
              })}
              <button type="button" className={styles.linkBtn} onClick={() => setRule({ months: [] })} disabled={r.months.length === 0}>Every month</button>
            </div>
          )}
        </div>

        <div className={styles.fineTitle}>Fine-tune</div>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>If it needs moving</span>
            <div className={styles.inline}>
              <select
                className={styles.select} value={r.adjust.type} aria-label="Move rule"
                onChange={(e) => setRule({ adjust: { ...r.adjust, type: e.target.value } })}
              >
                {ADJUST_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {ADJUST_NEEDS_WEEKDAY.has(r.adjust.type)
                && weekdaySelect(r.adjust.weekday, (v) => setRule({ adjust: { ...r.adjust, weekday: v } }), 'Move to weekday')}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Shift</span>
            <div className={styles.inline}>
              <input
                type="number" min="0" max="366" className={styles.numInput} aria-label="Shift days"
                value={draft.offsetAmount} onChange={(e) => setDraft((d) => ({ ...d, offsetAmount: e.target.value }))}
              />
              <span>day(s)</span>
              <select className={styles.select} value={draft.offsetDir} onChange={(e) => setDraft((d) => ({ ...d, offsetDir: e.target.value }))} aria-label="Shift direction">
                <option value="later">later</option>
                <option value="earlier">earlier</option>
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Lasts</span>
            <div className={styles.inline}>
              <input
                type="number" min="1" max="60" className={styles.numInput} aria-label="Lasts days"
                value={r.durationDays} onChange={(e) => setRule({ durationDays: e.target.value })}
              />
              <span>day(s)</span>
            </div>
          </div>

          {showYearCycle && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Which years</span>
              <div className={styles.inline}>
                <span>Every</span>
                <input
                  type="number" min="1" max="100" className={styles.numInput} aria-label="Every how many years"
                  value={r.everyYears} onChange={(e) => setRule({ everyYears: e.target.value })}
                />
                <span>year(s)</span>
                {Number(r.everyYears) > 1 && (
                  <>
                    <span>counting from</span>
                    <input
                      type="number" min="1900" max="2200" className={styles.yearInput} aria-label="Counting from year"
                      value={r.anchorYear ?? ''} onChange={(e) => setRule({ anchorYear: e.target.value })}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {kind !== 'once' && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Only between (optional)</span>
              <div className={styles.inline}>
                <DateField className={styles.addDate} value={r.startDate} onChange={(e) => setRule({ startDate: e.target.value })} ariaLabel="Starts" placeholder="starts" />
                <span>and</span>
                <DateField className={styles.addDate} value={r.endDate} onChange={(e) => setRule({ endDate: e.target.value })} ariaLabel="Ends" placeholder="ends" />
              </div>
            </div>
          )}
        </div>

        <div className={styles.preview} data-testid="holiday-preview">
          <div className={styles.previewRule}>{describeRule(draftRule, holidays)}</div>
          {draftProblem ? (
            <div className={styles.previewProblem}>{draftProblem}</div>
          ) : draftPreview.length === 0 ? (
            <div className={styles.previewProblem}>No dates from today onward — it will be saved, but nothing is coming up.</div>
          ) : (
            <div className={styles.allDates}>
              <span className={styles.previewLabel}>Next:</span>
              {draftPreview.map((o) => (
                <span key={o.start} className={styles.dateChip}>
                  {formatShort(o.start)}{o.start !== o.end && ` – ${formatShort(o.end)}`}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={styles.addRow}>
          <label className={styles.addOff}>
            <input type="checkbox" checked={draft.timeOff} onChange={(e) => setDraft((d) => ({ ...d, timeOff: e.target.checked }))} />
            Day off
          </label>
          <label className={styles.addOff}>
            <input type="checkbox" checked={draft.calendar} onChange={(e) => setDraft((d) => ({ ...d, calendar: e.target.checked }))} />
            Show on calendars
          </label>
          <span className={styles.spacer} />
          {draft.id && <button type="button" className={styles.btn} onClick={cancelEdit}>Cancel</button>}
          <button type="button" className={styles.addBtn} onClick={saveDraft} disabled={!canSave}>
            {draft.id ? 'Save changes' : 'Add holiday'}
          </button>
        </div>
      </div>

      {restorable.length > 0 && (
        <div className={styles.toolbar}>
          <button type="button" className={styles.btn} onClick={restoreDefaults}>
            Restore {restorable.length} built-in holiday{restorable.length === 1 ? '' : 's'}
          </button>
          <span className={styles.toolbarHint}>{restorable.map((h) => h.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

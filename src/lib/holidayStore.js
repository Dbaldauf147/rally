/* The holiday list: built-in defaults, plus whatever has been added or changed
   on the Holidays page.

   Each holiday is { id, name, rule, timeOff, calendar, note }. `rule` is a
   cadence (see holidayRules.js); `calendar` says whether it is drawn on the
   calendars, plans and date polls.

   The list lives in localStorage on this device. That is the same place the
   Holidays page has always kept it — it does not sync between devices. */

import { normalizeRule, occurrencesForYear } from './holidayRules.js';

export const STORAGE_KEY = 'rally.holidays.v2';
// The pre-cadence list: one fixed 2026 date per holiday. Read once, to migrate.
const LEGACY_KEY = 'rally.holidays.v1';
const LEGACY_SEED_FLAG = 'rally.holidays.seed.v3';
const LEGACY_YEAR = 2026;

const on = (month, day) => ({ kind: 'date', months: [month], day });
const nth = (month, weekday, n, extra = {}) => ({ kind: 'weekday', months: [month], weekday, nth: n, ...extra });
// A Monday holiday, drawn as its whole Saturday–Monday weekend.
const longWeekend = (month, n) => nth(month, 1, n, { offsetDays: -2, durationDays: 3 });

// Ids are the ones the page has always used, so a saved list still matches.
// `calendar: false` marks the ones the calendars never showed.
const DEFS = [
  { id: 'h-2026-newyears', name: "New Year's Day", timeOff: true, calendar: true, rule: on(1, 1) },
  { id: 'h-2026-mlk', name: 'Martin Luther King Jr. Day', timeOff: true, calendar: true, rule: nth(1, 1, 3) },
  { id: 'h-2026-presidents', name: "Presidents' Day", timeOff: true, calendar: false, rule: nth(2, 1, 3) },
  { id: 'h-stpatricks', name: "St. Patrick's Day", timeOff: false, calendar: true, rule: on(3, 17) },
  { id: 'h-mothers', name: "Mother's Day", timeOff: false, calendar: true, rule: nth(5, 0, 2) },
  { id: 'h-memorial-fri', name: 'Memorial Day Weekend', timeOff: true, calendar: false, rule: nth(5, 1, -1, { offsetDays: -3 }) },
  { id: 'h-2026-memorial', name: 'Memorial Day', timeOff: true, calendar: true, rule: longWeekend(5, -1) },
  { id: 'h-2026-juneteenth', name: 'Juneteenth', timeOff: true, calendar: false, rule: on(6, 19) },
  { id: 'h-fathers', name: "Father's Day", timeOff: false, calendar: true, rule: nth(6, 0, 3) },
  { id: 'h-2026-july4', name: 'Independence Day', timeOff: true, calendar: true, rule: on(7, 4) },
  { id: 'h-2026-labor', name: 'Labor Day', timeOff: true, calendar: true, rule: longWeekend(9, 1) },
  { id: 'h-cowharbor', name: 'Cow Harbor Day', timeOff: false, calendar: true, rule: nth(9, 6, 3) },
  { id: 'h-cowharbor-parade', name: 'Cow Harbor Day Parade', timeOff: false, calendar: true, rule: nth(9, 0, 3) },
  { id: 'h-2026-columbus', name: 'Columbus Day', timeOff: true, calendar: false, rule: nth(10, 1, 2) },
  { id: 'h-halloween', name: 'Halloween', timeOff: false, calendar: true, rule: on(10, 31) },
  { id: 'h-2026-veterans', name: 'Veterans Day', timeOff: true, calendar: false, rule: on(11, 11) },
  { id: 'h-2026-thanksgiving', name: 'Thanksgiving Day', timeOff: true, calendar: true, rule: nth(11, 4, 4) },
  { id: 'h-day-after-thanksgiving', name: 'Day after Thanksgiving', timeOff: true, calendar: true, rule: nth(11, 4, 4, { offsetDays: 1 }) },
  { id: 'h-christmas-eve', name: 'Christmas Eve', timeOff: true, calendar: true, rule: on(12, 24) },
  { id: 'h-2026-christmas', name: 'Christmas Day', timeOff: true, calendar: true, rule: on(12, 25) },
  { id: 'h-newyears-eve', name: "New Year's Eve", timeOff: true, calendar: true, rule: on(12, 31) },
];

export function defaultHolidays() {
  return DEFS.map((d) => ({ ...d, rule: normalizeRule(d.rule), note: '' }));
}

export function normalizeHoliday(raw) {
  const h = raw && typeof raw === 'object' ? raw : {};
  return {
    id: typeof h.id === 'string' && h.id ? h.id : makeHolidayId(),
    name: typeof h.name === 'string' ? h.name : '',
    rule: normalizeRule(h.rule),
    timeOff: !!h.timeOff,
    calendar: h.calendar !== false,
    note: typeof h.note === 'string' ? h.note : '',
  };
}

export function makeHolidayId() {
  return `h-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// Built-ins missing from `list` (by id) — what "Restore built-in holidays" adds.
export function missingDefaults(list) {
  const have = new Set(list.map((h) => h.id));
  return defaultHolidays().filter((h) => !have.has(h.id));
}

// Turns the old fixed-date list into cadences. A built-in still on its own
// date gets its real rule; anything else (a holiday that was added by hand, or
// a built-in whose date was changed) had only ever been a day of the year, so
// it becomes that same day every year.
export function migrateLegacy(legacy, { backfill = false } = {}) {
  const defaults = defaultHolidays();
  const byId = new Map(defaults.map((d) => [d.id, d]));
  const out = (Array.isArray(legacy) ? legacy : []).filter((h) => h && typeof h === 'object').map((h) => {
    const def = byId.get(h.id);
    const date = typeof h.date === 'string' ? h.date : '';
    const onDefaultDate = def && occurrencesForYear(def, LEGACY_YEAR, defaults).some((o) => o.dates.includes(date));
    const [, m, d] = date.split('-').map(Number);
    const rule = onDefaultDate ? def.rule
      : m && d ? { kind: 'date', months: [m], day: d }
      : { kind: 'once', date: '' };
    return normalizeHoliday({
      id: h.id,
      name: h.name,
      rule,
      timeOff: h.timeOff,
      calendar: def ? def.calendar : true,
      note: h.note,
    });
  });
  if (backfill) out.push(...missingDefaults(out));
  return out;
}

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// The calendars ask for the list on every render, so the parsed copy is kept
// for as long as the stored text is unchanged.
let cache = { raw: undefined, list: null };

export function loadHolidays() {
  const ls = storage();
  if (!ls) return defaultHolidays();
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (raw !== null) {
      if (cache.raw === raw && cache.list) return cache.list;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const list = parsed.map(normalizeHoliday);
        cache = { raw, list };
        return list;
      }
    }
    const legacyRaw = ls.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (Array.isArray(legacy)) {
        // The old key is left in place, untouched.
        const list = migrateLegacy(legacy, { backfill: !ls.getItem(LEGACY_SEED_FLAG) });
        saveHolidays(list);
        return list;
      }
    }
  } catch { /* fall through to the defaults */ }
  return defaultHolidays();
}

export function saveHolidays(list) {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* storage full or blocked — the page still works for this visit */ }
}

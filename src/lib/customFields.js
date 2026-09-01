// User-defined fields for the friends list.
//
// The built-in friend record (name, email, birthday…) covers what everyone
// tracks; this lets one user add the data points only they care about — shirt
// size, kids' names, how you met — without a schema change.
//
// Definitions live on the user doc as `friendFields` (an ordered array, same
// place WeddingPage keeps its column config). Values live on each friend doc
// under `custom`, keyed by the field's generated id rather than its label, so
// renaming "Shirt size" to "T-shirt" keeps every value attached.

import { parseLooseDate, validParts, pad2 } from './looseDate';

export const CUSTOM_FIELD_TYPES = [
  { key: 'text', label: 'Text' },
  { key: 'number', label: 'Number' },
  { key: 'date', label: 'Date' },
  { key: 'select', label: 'Choice list' },
  { key: 'checkbox', label: 'Yes / No' },
  { key: 'link', label: 'Link' },
];
const TYPE_KEYS = CUSTOM_FIELD_TYPES.map(t => t.key);

// Ids are opaque and stable for the life of the field. The `cf_` prefix keeps
// them clear of the built-in keys, and the character set stays inside what
// Firestore accepts as a map key (no dots, slashes or brackets).
export const newFieldId = () =>
  `cf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Read definitions back off the user doc defensively — a hand-edited or
// half-written array shouldn't be able to break the page.
export function normalizeFieldDefs(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const id = String(f.id || '').trim();
    const label = String(f.label || '').trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label,
      type: TYPE_KEYS.includes(f.type) ? f.type : 'text',
      options: Array.isArray(f.options)
        ? [...new Set(f.options.map(o => String(o).trim()).filter(Boolean))]
        : [],
      // Fields default to visible; only an explicit false hides the column.
      showInTable: f.showInTable !== false,
    });
  }
  return out;
}

// Choice lists are typed into a textarea — one per line, or comma separated.
export function parseOptionList(text) {
  return [...new Set(
    String(text || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)
  )];
}
export const optionListText = (options) => (options || []).join('\n');

/* A pasted address, as an href.

   Only http(s) is ever followed — a `javascript:` URL pasted into a cell must
   not become a clickable script. A bare "zocdoc.com/dr-x" is what people
   actually paste, so a scheme-less value that looks like a host gets https://
   put on the front rather than being rejected. */
export function linkHref(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  // Anything carrying a scheme we did not just accept is refused outright.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s) ? `https://${s}` : null;
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'x', '✓', 'checked']);

// Anything a form, a spreadsheet cell or a paste can hand us → the shape the
// field stores. Unusable input becomes '' rather than a half-read value, the
// same bargain normalizeBirthday makes.
export function coerceCustomValue(field, raw) {
  const type = field?.type || 'text';
  if (raw === undefined || raw === null) return type === 'checkbox' ? false : '';
  if (type === 'checkbox') {
    if (typeof raw === 'boolean') return raw;
    return TRUTHY.has(String(raw).trim().toLowerCase());
  }
  const s = String(raw).trim();
  if (!s) return '';
  if (type === 'number') {
    // Strip the units and currency a spreadsheet cell carries ("$40", "3 kids"),
    // but text with no digits at all is not a zero — it's nothing.
    const digits = s.replace(/[^0-9.-]/g, '');
    const n = Number(digits);
    return digits !== '' && Number.isFinite(n) ? n : '';
  }
  if (type === 'link') return s;
  if (type === 'date') {
    const p = parseLooseDate(s);
    // A date field wants the whole date; a year-less "7/30" has nowhere to go.
    return validParts(p) && p.year ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : '';
  }
  return s;
}

// Coerce a whole `custom` map on the way to storage. Values for fields that no
// longer exist pass through untouched: the field may be hidden or deleted, but
// the answer someone typed isn't ours to throw away.
export function coerceCustomMap(fields, values) {
  const out = { ...(values || {}) };
  for (const f of fields || []) {
    if (!(f.id in out)) continue;
    out[f.id] = coerceCustomValue(f, out[f.id]);
  }
  return out;
}

// Display form for tables, cards and the Excel export. '' means "show a dash".
export function formatCustomValue(field, value) {
  const type = field?.type || 'text';
  if (type === 'checkbox') return value === true ? 'Yes' : value === false ? 'No' : '';
  if (value === undefined || value === null || value === '') return '';
  // A link reads as its address in text — the table draws it as an anchor.
  if (type === 'link') return String(value);
  if (type === 'date') {
    const p = parseLooseDate(value);
    return validParts(p) && p.year ? `${p.month}/${p.day}/${p.year}` : String(value);
  }
  return String(value);
}

export const customValue = (friend, field) => friend?.custom?.[field?.id];

// Sort key for the contacts table. Numbers and booleans stay comparable as
// numbers; everything else lowercases so sorting reads alphabetically. '' means
// empty, which the table always sorts last.
export function customSortValue(field, value) {
  const type = field?.type || 'text';
  if (type === 'checkbox') return value === true ? 1 : value === false ? 0 : '';
  if (value === undefined || value === null || value === '') return '';
  if (type === 'number') return Number(value);
  return String(value).toLowerCase();
}

// Every value a field actually holds across the contact list, so filters and
// the choice-list editor can offer what's really there — including values that
// arrived through an import and were never in the options list.
export function customFieldValues(friends, field) {
  const seen = new Set();
  for (const f of friends || []) {
    const v = f?.custom?.[field?.id];
    const s = formatCustomValue(field, v);
    if (s) seen.add(s);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

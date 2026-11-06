/* Pasting a block of cells from Excel or Google Sheets into the guest list.

   Pure, so it's tested on its own. Three steps:

   1. parsePastedCells — the clipboard text into rows of cells. Both apps copy
      tab-separated, and both wrap a cell in double quotes when it holds a line
      break, a tab or a quote (doubling the quotes inside), so a two-line
      address arrives as one cell rather than splitting the row.
   2. autoDetectMappings — guesses which guest field each column is from its
      header.
   3. planGuestImport — matches every pasted row to a guest already on the
      list and works out what changes. A match fills that guest's blanks (or,
      with overwrite, replaces anything the row has a value for); a row with no
      match is a new guest. Nothing is ever blanked out: an empty pasted cell
      leaves the guest's value alone.

   Matching uses the same keys as the Friends link (lib/weddingGuestFriend.js):
   email, then ten-digit phone, then the exact full name — and only when that
   key points at one guest. A key shared by two guests would be a guess, so the
   row is set aside as ambiguous instead of filling the wrong one or adding a
   third copy. Rows join the list as they're planned, so the same person pasted
   twice is one guest, not two. */

export const IMPORT_FIELDS = [
  { key: '', label: '— Skip —' },
  { key: 'fullName', label: 'Full Name (auto-split)' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'Zip' },
  { key: 'status', label: 'Status' },
  { key: 'group', label: 'Group' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'guestOf', label: 'Guest Of' },
  { key: 'side', label: 'Side' },
  { key: 'party', label: 'Wedding group' },
];

export const FIELD_LABELS = Object.fromEntries(IMPORT_FIELDS.filter((f) => f.key).map((f) => [f.key, f.label]));
FIELD_LABELS.fullName = 'Name';
FIELD_LABELS.firstName = 'First name';
FIELD_LABELS.lastName = 'Last name';

// Order matters: the first field whose pattern fits wins, so the specific
// ones (subcategory, wedding group, guest of) come before the loose ones.
const FIELD_PATTERNS = [
  { key: 'subcategory', patterns: [/^sub[-\s]*category/i, /^sub[-\s]*type$/i] },
  { key: 'party', patterns: [/^wedding\s*group/i, /^party$/i, /^household/i] },
  { key: 'guestOf', patterns: [/^guest\s*of/i] },
  { key: 'firstName', patterns: [/^first\s*(name)?$/i, /^fname$/i, /^given/i] },
  { key: 'lastName', patterns: [/^last\s*(name)?$/i, /^lname$/i, /^surname$/i, /^family\s*name/i] },
  { key: 'fullName', patterns: [/^(full\s*|guest\s*)?name$/i, /^contact$/i, /^guest$/i] },
  { key: 'email', patterns: [/^e[-\s]?mail/i] },
  { key: 'phone', patterns: [/^phone/i, /^mobile/i, /^cell/i, /^tel/i, /number/i] },
  { key: 'address', patterns: [/^(mailing\s*|street\s*)?address/i, /^street/i, /^addr/i] },
  { key: 'city', patterns: [/^city$/i, /^town$/i] },
  { key: 'state', patterns: [/^state/i, /^province/i, /^region/i] },
  { key: 'zip', patterns: [/^zip/i, /^postal/i, /^post\s*code$/i] },
  { key: 'status', patterns: [/^status$/i, /^rsvp/i, /^attending/i] },
  { key: 'group', patterns: [/^group/i, /^tier$/i, /^tag/i] },
  { key: 'category', patterns: [/^category/i, /^type$/i] },
  { key: 'side', patterns: [/side/i] },
];

const clean = (v) => String(v ?? '').trim();
const norm = (v) => clean(v).toLowerCase();
const phoneKey = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};
const nameKey = (g) => norm(`${clean(g?.firstName)} ${clean(g?.lastName)}`).replace(/\s+/g, ' ');

export function parsePastedCells(text) {
  if (!text) return [];
  const s = String(text).replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let atCellStart = true;
  while (i < s.length) {
    const ch = s[i];
    if (atCellStart && ch === '"') {
      // A quoted cell runs to the next quote that isn't doubled.
      let j = i + 1;
      let val = '';
      let closed = false;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') { val += '"'; j += 2; continue; }
          closed = true;
          j += 1;
          break;
        }
        val += s[j];
        j += 1;
      }
      // Only a real quoted cell if the closing quote ends the cell; otherwise
      // the quote was just text ("6" tall) and the cell is read plainly.
      if (closed && (j >= s.length || s[j] === '\t' || s[j] === '\n')) {
        cell = val;
        i = j;
        atCellStart = false;
        continue;
      }
    }
    atCellStart = false;
    if (ch === '\t') {
      row.push(cell);
      cell = '';
      atCellStart = true;
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines (and the trailing newline both apps add) carry nothing.
  return rows.filter((r) => r.some((c) => clean(c)));
}

export function autoDetectMappings(headerRow) {
  const used = new Set();
  return (headerRow || []).map((h) => {
    const cleaned = clean(h);
    if (!cleaned) return '';
    for (const f of FIELD_PATTERNS) {
      if (used.has(f.key)) continue;
      if (f.patterns.some((re) => re.test(cleaned))) {
        used.add(f.key);
        return f.key;
      }
    }
    return '';
  });
}

// Whether row one is column names rather than a guest: it has letters and at
// least one of them reads as a known field.
export function looksLikeHeader(rows) {
  const header = rows?.[0] || [];
  return header.some((h) => /[a-z]/i.test(h || '')) && autoDetectMappings(header).some(Boolean);
}

// The page's three statuses, plus what people actually type in an RSVP column.
const STATUS_WORDS = {
  pending: 'Pending', invited: 'Pending', maybe: 'Pending', awaiting: 'Pending', 'no response': 'Pending', tbd: 'Pending',
  confirmed: 'Confirmed', yes: 'Confirmed', y: 'Confirmed', attending: 'Confirmed', accepted: 'Confirmed', coming: 'Confirmed', going: 'Confirmed',
  'not coming': 'Not coming', no: 'Not coming', n: 'Not coming', declined: 'Not coming', regrets: 'Not coming', 'not attending': 'Not coming', "can't come": 'Not coming',
};
export function normalizeStatus(v) {
  return STATUS_WORDS[norm(v).replace(/[.!]+$/, '')] || '';
}

// "Mary Ann Smith" → first "Mary Ann", last "Smith" (same as the page's
// add-guest form), so a pasted full name lines up with one typed in by hand.
function splitName(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts.pop() : '';
  return { firstName: parts.join(' '), lastName };
}

// One pasted row as guest fields, holding only the cells that have a value.
export function rowToFields(row, mappings) {
  const out = {};
  (mappings || []).forEach((field, i) => {
    if (!field) return;
    const val = clean(row?.[i]);
    if (!val) return;
    if (field === 'fullName') {
      const { firstName, lastName } = splitName(val);
      if (firstName && !out.firstName) out.firstName = firstName;
      if (lastName && !out.lastName) out.lastName = lastName;
    } else if (field === 'status') {
      const st = normalizeStatus(val);
      if (st) out.status = st;
    } else {
      out[field] = val;
    }
  });
  // A First Name column set beside a Full Name column wins over the split.
  (mappings || []).forEach((field, i) => {
    if (field === 'firstName' || field === 'lastName') {
      const val = clean(row?.[i]);
      if (val) out[field] = val;
    }
  });
  return out;
}

function sameValue(key, a, b) {
  if (key === 'phone') {
    const da = String(a).replace(/\D/g, '');
    const db = String(b).replace(/\D/g, '');
    return !!da && (da === db || (phoneKey(a) && phoneKey(a) === phoneKey(b)));
  }
  return norm(a).replace(/\s+/g, ' ') === norm(b).replace(/\s+/g, ' ');
}

const hasIdentity =(f) => !!(f.firstName || f.lastName || f.email || f.phone);

// A shared email or phone is common on a wedding list (a couple on one
// number), so a key that fits several guests is narrowed by the name before
// it's called ambiguous.
function findMatches(list, fields) {
  const name = nameKey(fields);
  const narrow = (hits) => {
    if (hits.length < 2 || !name) return hits;
    const byName = hits.filter((g) => nameKey(g) === name);
    return byName.length === 1 ? byName : hits;
  };
  const email = norm(fields.email);
  if (email) {
    const hits = list.filter((g) => norm(g.email) === email);
    if (hits.length) return narrow(hits);
  }
  const phone = phoneKey(fields.phone);
  if (phone) {
    const hits = list.filter((g) => phoneKey(g.phone) === phone);
    if (hits.length) return narrow(hits);
  }
  if (name) return list.filter((g) => nameKey(g) === name);
  return [];
}

/* Returns:
   {
     contacts,   // the whole list after the import, in order (new ones last)
     added,      // [guest] new guests
     updated,    // [{ id, name, fields: [key], before, after }] guests that changed
     unchanged,  // count of rows that matched a guest and had nothing new
     ambiguous,  // [{ row, name }] rows whose key fits two or more guests
     skipped,    // count of rows with no name, email or phone
   }
   `rows` are data rows (header already dropped). `overwrite` replaces a
   matched guest's existing values; without it only blanks are filled. */
export function planGuestImport(existing, rows, mappings, { overwrite = false, now = Date.now(), makeId } = {}) {
  const list = (existing || []).map((g) => ({ ...g }));
  const original = new Map((existing || []).map((g) => [g.id, g]));
  const addedIds = new Set();
  const touched = new Map(); // id → Set(field)
  const ambiguous = [];
  let unchanged = 0;
  let skipped = 0;
  const newId = makeId || ((i) => `import-${now}-${i}-${Math.random().toString(36).slice(2, 8)}`);

  (rows || []).forEach((row, i) => {
    const fields = rowToFields(row, mappings);
    if (!hasIdentity(fields)) { skipped += 1; return; }
    const hits = findMatches(list, fields);
    if (hits.length > 1) {
      ambiguous.push({ row: i, name: displayName(fields) });
      return;
    }
    if (hits.length === 0) {
      const guest = { id: newId(i), ...fields };
      list.push(guest);
      addedIds.add(guest.id);
      return;
    }
    const guest = hits[0];
    let changed = false;
    for (const [k, v] of Object.entries(fields)) {
      const cur = clean(guest[k]);
      if (cur === v) continue;
      if (cur && !overwrite) continue;
      // The same value written differently isn't news: an email or name in
      // another case, a phone with other punctuation.
      if (cur && sameValue(k, cur, v)) continue;
      guest[k] = v;
      changed = true;
      if (!addedIds.has(guest.id)) {
        if (!touched.has(guest.id)) touched.set(guest.id, new Set());
        touched.get(guest.id).add(k);
      }
    }
    if (!changed && !addedIds.has(guest.id)) unchanged += 1;
  });

  const byId = new Map(list.map((g) => [g.id, g]));
  const updated = Array.from(touched.entries()).map(([id, set]) => {
    const after = byId.get(id);
    const before = original.get(id);
    return { id, name: displayName(after), fields: Array.from(set), before, after };
  });
  return {
    contacts: list,
    added: list.filter((g) => addedIds.has(g.id)),
    updated,
    unchanged,
    ambiguous,
    skipped,
  };
}

export function displayName(g) {
  return `${clean(g?.firstName)} ${clean(g?.lastName)}`.trim() || clean(g?.email) || clean(g?.phone) || 'Unnamed';
}

// Reading .vcf files — the format every phone will hand you.
//
// This is the fallback that works everywhere. iOS has no contacts API a web
// page can call, so on an iPhone the route is Contacts -> share -> "Export
// vCard", which lands here. Android's Contact Picker and the native plugin
// (see phoneContacts.js) produce the same row shape, so all three sources feed
// the one import preview the Friends page already has.
//
// Deliberately tolerant: vCard in the wild is 2.1, 3.0 and 4.0 all at once,
// Apple hangs its own X- properties off it, and a parser that rejects a card
// for a malformed line loses a real person out of someone's address book. Any
// property we don't understand is skipped, never fatal.

// vCard escapes , ; and newlines inside values.
function unescapeValue(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// vCard 2.1 encodes anything non-ASCII this way — an accented name arrives as
// "Jos=C3=A9" and would otherwise import literally.
function decodeQuotedPrintable(s) {
  const bytes = [];
  const str = String(s || '').replace(/=\r?\n/g, '');
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(str.slice(i + 1, i + 3))) {
      bytes.push(parseInt(str.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(str.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return str;
  }
}

/* One "NAME;PARAM=X:value" line -> { prop, params, value }.

   The colon split has to skip anything inside double quotes: a parameter is
   allowed to carry one (TYPE="work,voice") and splitting on the first raw
   colon would cut a quoted URI in half. */
function parseLine(line) {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) { colon = i; break; }
  }
  if (colon === -1) return null;

  const rawName = line.slice(0, colon);
  let value = line.slice(colon + 1);

  const parts = [];
  let cur = '';
  let q = false;
  for (const ch of rawName) {
    if (ch === '"') { q = !q; cur += ch; }
    else if (ch === ';' && !q) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);

  // Apple groups related lines as "item1.EMAIL" / "item1.X-ABLabel".
  const nameWithGroup = parts[0];
  const dot = nameWithGroup.indexOf('.');
  const group = dot > -1 ? nameWithGroup.slice(0, dot) : '';
  const prop = (dot > -1 ? nameWithGroup.slice(dot + 1) : nameWithGroup).toUpperCase().trim();

  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    // A bare "HOME" (vCard 2.1 shorthand for TYPE=HOME) has no '='.
    const k = (eq > -1 ? p.slice(0, eq) : 'TYPE').toUpperCase().trim();
    const v = (eq > -1 ? p.slice(eq + 1) : p).replace(/"/g, '').trim();
    if (!v) continue;
    params[k] = params[k] ? `${params[k]},${v}` : v;
  }

  if ((params.ENCODING || '').toUpperCase().includes('QUOTED-PRINTABLE')) {
    value = decodeQuotedPrintable(value);
  }
  return { prop, group, params, value };
}

const typesOf = (params) => (params.TYPE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

/* BDAY, in every shape phones actually write it.

   Apple omits an unknown year by writing the sentinel 1604 (or "--MMDD"), so a
   birthday with no year has to come back as month/day rather than a date in the
   seventeenth century. */
function parseBday(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m;
  // --0730 and --07-30
  if ((m = /^--(\d{2})-?(\d{2})$/.exec(s))) return { year: null, month: +m[1], day: +m[2] };
  // 1985-07-30, 19850730, and 1604-07-30 (Apple's "no year")
  if ((m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s))) {
    const year = +m[1];
    return { year: year === 1604 || year <= 1 ? null : year, month: +m[2], day: +m[3] };
  }
  return null;
}

/* Split one vCard's lines into the flat record the importer wants.

   Where a card carries several of something, the most useful one wins: a
   mobile number over a landline, a personal address over a work one. The rest
   are dropped rather than concatenated — the Friends page has one Phone field,
   and "555-1234 / 555-9876" in it is worse than the wrong-but-single number. */
function cardToContact(lines) {
  const out = {};
  const emails = [];
  const phones = [];
  const addresses = [];
  let fn = '';
  let structuredName = '';
  const labels = {}; // Apple item group -> its X-ABLabel

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { prop, group, params, value } = parsed;
    if (!value.trim() && prop !== 'N') continue;

    if (prop === 'X-ABLABEL' && group) { labels[group] = unescapeValue(value).replace(/^_\$!<|>!\$_$/g, ''); continue; }

    switch (prop) {
      case 'FN':
        fn = unescapeValue(value).trim();
        break;
      case 'N': {
        // Family;Given;Middle;Prefix;Suffix
        const [family, given, middle] = value.split(';').map(v => unescapeValue(v).trim());
        structuredName = [given, middle, family].filter(Boolean).join(' ');
        break;
      }
      case 'EMAIL':
        emails.push({ value: unescapeValue(value).trim().toLowerCase(), types: typesOf(params), group });
        break;
      case 'TEL':
        phones.push({ value: unescapeValue(value).trim(), types: typesOf(params) });
        break;
      case 'ADR': {
        // ;;street;city;region;postal;country
        const p = value.split(';').map(v => unescapeValue(v).trim());
        const text = [p[2], p[3], [p[4], p[5]].filter(Boolean).join(' '), p[6]].filter(Boolean).join(', ');
        if (text) addresses.push({ value: text, types: typesOf(params), group });
        break;
      }
      case 'BDAY': {
        const b = parseBday(value);
        if (b) {
          out.Birthday = `${b.month}/${b.day}`;
          if (b.year) out['Date of Birth'] = `${b.month}/${b.day}/${b.year}`;
        }
        break;
      }
      case 'ORG':
        out.Group = unescapeValue(value.split(';')[0]).trim();
        break;
      case 'NOTE':
        out.Note = unescapeValue(value).trim();
        break;
      case 'X-SOCIALPROFILE':
        if ((params.TYPE || '').toLowerCase().includes('instagram')) {
          out.Instagram = unescapeValue(value).replace(/^.*instagram\.com\//i, '').replace(/\/$/, '').trim();
        }
        break;
      default:
        break;
    }
  }

  out.Name = fn || structuredName;

  const isWork = (e) => e.types.includes('work') || /work|office/i.test(labels[e.group] || '');
  const personal = emails.filter(e => e.value && !isWork(e));
  const work = emails.filter(e => e.value && isWork(e));
  if (personal[0]) out.Email = personal[0].value;
  if (work[0]) out['Work Email'] = work[0].value;
  // Only a work address on the card: better in Email than dropped entirely.
  if (!out.Email && work[0]) { out.Email = work[0].value; delete out['Work Email']; }

  const mobile = phones.find(p => p.types.some(t => ['cell', 'mobile', 'iphone'].includes(t)));
  const chosen = mobile || phones[0];
  if (chosen) out.Phone = chosen.value;

  const home = addresses.find(a => a.types.includes('home')) || addresses[0];
  if (home) out.Address = home.value;

  return out;
}

/* Every contact in a .vcf, as rows the Friends importer can map.

   Keys are human column names ("Work Email", "Date of Birth") because that is
   what the existing auto-detect matches on — the same path a pasted
   spreadsheet takes, so vCards get the same preview and the same dedupe. */
export function parseVCards(text) {
  // Unfold first: a long line is continued on the next one starting with a
  // space or tab, and every property below assumes it is whole.
  const unfolded = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');

  const contacts = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^BEGIN:VCARD$/i.test(line)) { current = []; continue; }
    if (/^END:VCARD$/i.test(line)) {
      if (current) {
        const c = cardToContact(current);
        // A card with neither a name nor an address is not a person.
        if (c.Name || c.Email || c.Phone) contacts.push(c);
      }
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return contacts;
}

// The union of keys present, in a stable, human order — this drives the
// mapping modal's column list.
export const HEADER_ORDER = [
  'Name', 'Email', 'Work Email', 'Phone', 'Address',
  'Birthday', 'Date of Birth', 'Group', 'Instagram', 'Note',
];

export function headersFor(rows) {
  const seen = new Set();
  for (const r of rows || []) for (const k of Object.keys(r)) seen.add(k);
  const ordered = HEADER_ORDER.filter(h => seen.has(h));
  const extra = [...seen].filter(h => !HEADER_ORDER.includes(h)).sort();
  return [...ordered, ...extra];
}

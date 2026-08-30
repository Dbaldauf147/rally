// Turning a phone's contact payload into an import row.
//
// Two shapes arrive here — the native plugin's and the Contact Picker's — and
// both leave as the row shape vcard.js documents, so all three import routes
// meet at the Friends page's one preview.
//
// These live apart from phoneContacts.js on purpose. That module reaches for
// the Capacitor bridge and `window` the moment it loads, so it can only run on
// a device; the native mapper in particular runs nowhere but inside a
// TestFlight build. Kept here as plain functions over plain objects, the part
// that decides which number is the mobile and which address is the work one
// can be tested on any machine.

const firstValue = (v) => (Array.isArray(v) ? v.find(x => x != null && String(x).trim()) : v);

// What kind of number or address this is. Both halves matter: a type of
// "custom" carries the real meaning in the label beside it, and "iPhone" —
// Apple's own default for the number the phone belongs to — arrives exactly
// that way, so reading type alone misses the most common mobile of all.
const kind = (x) => [x?.type, x?.label].filter(Boolean).join(' ').toLowerCase();

/* The Contact Picker API's shape.

   Every field comes back as an array, and `name` is an array of whole display
   names rather than parts. */
export function fromPickerContact(c) {
  const out = {};
  const name = firstValue(c?.name);
  const email = firstValue(c?.email);
  const tel = firstValue(c?.tel);
  if (name) out.Name = String(name).trim();
  if (email) out.Email = String(email).trim().toLowerCase();
  if (tel) out.Phone = String(tel).trim();
  return out;
}

/* The native plugin's shape (@capacitor-community/contacts).

   Its fields are nested and every one is optional — a contact with only a
   phone number is normal — so each is reached defensively. */
export function fromNativeContact(c) {
  const out = {};
  const n = c?.name || {};
  const display = n.display || [n.given, n.middle, n.family].filter(Boolean).join(' ');
  if (display?.trim()) out.Name = display.trim();

  const emails = (c?.emails || []).filter(e => e?.address);
  const isWork = (e) => kind(e).includes('work');
  const personal = emails.filter(e => !isWork(e));
  const work = emails.filter(isWork);
  if (personal[0]) out.Email = String(personal[0].address).trim().toLowerCase();
  if (work[0]) out['Work Email'] = String(work[0].address).trim().toLowerCase();
  // A work-only contact still has an email; promote it rather than import a
  // person with no address at all.
  if (!out.Email && work[0]) { out.Email = out['Work Email']; delete out['Work Email']; }

  const phones = (c?.phones || []).filter(p => p?.number);
  const mobile = phones.find(p => /mobile|cell|iphone/.test(kind(p)));
  const chosen = mobile || phones[0];
  if (chosen) out.Phone = String(chosen.number).trim();

  const addr = (c?.postalAddresses || []).find(a => a?.street || a?.city);
  if (addr) {
    out.Address = [addr.street, addr.city, [addr.region, addr.postcode].filter(Boolean).join(' '), addr.country]
      .filter(Boolean).join(', ');
  }

  // iOS leaves `year` off a birthday recorded without one, the same case the
  // vCard route sees as the 1604 sentinel — month and day are still worth having.
  const b = c?.birthday;
  if (b && b.month && b.day) {
    out.Birthday = `${b.month}/${b.day}`;
    if (b.year) out['Date of Birth'] = `${b.month}/${b.day}/${b.year}`;
  }

  if (c?.organization?.company) out.Group = String(c.organization.company).trim();
  return out;
}

// A row with nothing to identify a person by is not worth importing.
export const hasSomething = (c) => Boolean(c.Name || c.Email || c.Phone);

// Getting contacts off the phone itself.
//
// Three routes, because no single one covers the devices Rally runs on:
//
//   native   iOS shell. Calls the native Contacts plugin over the Capacitor
//            bridge. Needs the plugin compiled into the app — see NOTE below.
//   picker   Android Chrome's Contact Picker API. The user ticks people in an
//            OS sheet; the page never sees the rest of the address book.
//   file     Everywhere else, including iOS Safari and every desktop browser,
//            neither of which exposes contacts to a web page at all. The user
//            exports a .vcf from Contacts and picks the file.
//
// All three return the same row shape (see vcard.js) so the Friends page can
// send any of them through the one import preview it already has.
//
// NOTE ON THE NATIVE ROUTE: this calls the plugin through registerPlugin
// rather than importing @capacitor-community/contacts, so the web build needs
// no new dependency and nothing here breaks when the plugin is absent — the
// call simply rejects and we fall back to the file route. But the iOS shell
// loads its JS from the deployed site (capacitor.config.json `server.url`),
// which means shipping this code does NOT by itself enable the native route:
// the plugin has to be installed, `npx cap sync ios` run, an
// NSContactsUsageDescription added to Info.plist, and the app rebuilt and
// re-released. Until that happens iPhone users get the file route, which
// works today.

import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from '../native';

// Resolves to the native implementation when one is compiled in; every method
// rejects with UNIMPLEMENTED when it isn't.
const NativeContacts = registerPlugin('Contacts');

export const SOURCE = { NATIVE: 'native', PICKER: 'picker', FILE: 'file' };

// What the Contact Picker API can hand back. Kept narrow on purpose: asking
// for less makes the OS prompt less alarming, and Rally has nowhere to put the
// rest.
const PICKER_PROPS = ['name', 'email', 'tel'];

export function hasContactPicker() {
  return typeof navigator !== 'undefined'
    && 'contacts' in navigator
    && typeof navigator.contacts?.select === 'function'
    && 'ContactsManager' in window;
}

/* Which route this device gets.

   Native is only *claimed* here, not proven — proving it means calling the
   plugin, which triggers a permission prompt. pickPhoneContacts falls back on
   its own if the call turns out to be unimplemented. */
export function contactsSource() {
  if (isNativeApp()) return SOURCE.NATIVE;
  if (hasContactPicker()) return SOURCE.PICKER;
  return SOURCE.FILE;
}

export function sourceLabel(source = contactsSource()) {
  if (source === SOURCE.NATIVE) return 'Import from iPhone';
  if (source === SOURCE.PICKER) return 'Import from Phone';
  return 'Import vCard (.vcf)';
}

// Thrown when the device can't do it in-app and the caller should offer the
// file picker instead. Carries a reason so the UI can explain itself.
export class NeedsFileFallback extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'NeedsFileFallback';
  }
}

const firstValue = (v) => (Array.isArray(v) ? v.find(x => x != null && String(x).trim()) : v);

// Contact Picker hands back arrays for every field, and `name` is an array of
// whole display names rather than parts.
function fromPickerContact(c) {
  const out = {};
  const name = firstValue(c.name);
  const email = firstValue(c.email);
  const tel = firstValue(c.tel);
  if (name) out.Name = String(name).trim();
  if (email) out.Email = String(email).trim().toLowerCase();
  if (tel) out.Phone = String(tel).trim();
  return out;
}

/* The native plugin's contact shape (@capacitor-community/contacts).

   Its fields are nested and every one is optional — a contact with only a
   phone number is normal — so each is reached defensively. */
function fromNativeContact(c) {
  const out = {};
  const n = c?.name || {};
  const display = n.display || [n.given, n.middle, n.family].filter(Boolean).join(' ');
  if (display?.trim()) out.Name = display.trim();

  const emails = (c?.emails || []).filter(e => e?.address);
  const isWork = (e) => String(e.type || e.label || '').toLowerCase().includes('work');
  const personal = emails.filter(e => !isWork(e));
  const work = emails.filter(isWork);
  if (personal[0]) out.Email = String(personal[0].address).trim().toLowerCase();
  if (work[0]) out['Work Email'] = String(work[0].address).trim().toLowerCase();
  if (!out.Email && work[0]) { out.Email = out['Work Email']; delete out['Work Email']; }

  const phones = (c?.phones || []).filter(p => p?.number);
  const mobile = phones.find(p => String(p.type || p.label || '').toLowerCase().match(/mobile|cell|iphone/));
  const chosen = mobile || phones[0];
  if (chosen) out.Phone = String(chosen.number).trim();

  const addr = (c?.postalAddresses || []).find(a => a?.street || a?.city);
  if (addr) {
    out.Address = [addr.street, addr.city, [addr.region, addr.postcode].filter(Boolean).join(' '), addr.country]
      .filter(Boolean).join(', ');
  }

  const b = c?.birthday;
  if (b && b.month && b.day) {
    out.Birthday = `${b.month}/${b.day}`;
    if (b.year) out['Date of Birth'] = `${b.month}/${b.day}/${b.year}`;
  }

  if (c?.organization?.company) out.Group = String(c.organization.company).trim();
  return out;
}

/* Pull contacts from whichever route this device supports.

   Returns [] when the user cancels the OS sheet — a cancel is not an error and
   must not surface as one. Throws NeedsFileFallback when the device simply
   can't, so the caller can open a file picker instead. */
export async function pickPhoneContacts() {
  const source = contactsSource();

  if (source === SOURCE.NATIVE) {
    try {
      const perm = await NativeContacts.requestPermissions();
      const granted = perm?.contacts === 'granted' || perm?.contacts === 'limited';
      if (!granted) throw new NeedsFileFallback('Rally doesn’t have permission to read your contacts.');
      const res = await NativeContacts.getContacts({
        projection: { name: true, phones: true, emails: true, postalAddresses: true, birthday: true, organization: true },
      });
      return (res?.contacts || []).map(fromNativeContact).filter(c => c.Name || c.Email || c.Phone);
    } catch (err) {
      if (err instanceof NeedsFileFallback) throw err;
      // UNIMPLEMENTED means the shell predates the plugin — expected until the
      // app is rebuilt, and the file route still works.
      throw new NeedsFileFallback('This version of the app can’t read contacts directly yet.');
    }
  }

  if (source === SOURCE.PICKER) {
    try {
      const picked = await navigator.contacts.select(PICKER_PROPS, { multiple: true });
      return (picked || []).map(fromPickerContact).filter(c => c.Name || c.Email || c.Phone);
    } catch {
      // The API throws on cancel in some builds, and on any non-user-gesture
      // call. Neither is worth an error message.
      return [];
    }
  }

  throw new NeedsFileFallback('Your browser can’t read contacts directly.');
}

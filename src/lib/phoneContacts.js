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
// rather than importing @capacitor-community/contacts, so the web build pulls
// in no plugin code and nothing here breaks when the plugin is absent — the
// call simply rejects and we fall back to the file route. The plugin is now a
// dependency and .github/workflows/ios.yml both syncs it into the regenerated
// iOS project and writes the NSContactsUsageDescription iOS demands before it
// will even show the permission prompt. But the shell loads its JS from the
// deployed site (capacitor.config.json `server.url`), so this route only goes
// live on iPhones running a TestFlight build cut after that workflow ran —
// older installs keep falling back to the file route, which works today.

import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from '../native';
import { fromNativeContact, fromPickerContact, hasSomething } from './contactRows';

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
      return (res?.contacts || []).map(fromNativeContact).filter(hasSomething);
    } catch (err) {
      if (err instanceof NeedsFileFallback) throw err;
      // Two very different failures land here and they must not read alike.
      // UNIMPLEMENTED means the shell was built before the plugin was added, so
      // the fix is a newer app; anything else is a real failure on a shell that
      // does have it. Either way the file route still works.
      const code = err?.code || err?.message || '';
      const missing = /unimplemented|not implemented/i.test(String(code));
      throw new NeedsFileFallback(missing
        ? 'This version of the app can’t read contacts directly yet.'
        : 'Rally couldn’t read your contacts.');
    }
  }

  if (source === SOURCE.PICKER) {
    try {
      const picked = await navigator.contacts.select(PICKER_PROPS, { multiple: true });
      return (picked || []).map(fromPickerContact).filter(hasSomething);
    } catch {
      // The API throws on cancel in some builds, and on any non-user-gesture
      // call. Neither is worth an error message.
      return [];
    }
  }

  throw new NeedsFileFallback('Your browser can’t read contacts directly.');
}

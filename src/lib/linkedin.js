// The LinkedIn field on a contact: whatever was pasted or typed (a profile
// URL, "linkedin.com/in/jane", "in/jane", "@jane" or just "jane") turned into
// the address to open. Pure, so it can be unit-tested.

const clean = (v) => String(v ?? '').trim();

/* The profile URL for a stored LinkedIn value, or '' if there's nothing to
 * open. Only ever an https://…linkedin.com address: the value is user-typed
 * (and can arrive by import), so it's never trusted as a link as written. */
export function linkedinUrl(value) {
  const v = clean(value);
  if (!v) return '';
  if (/linkedin\.com/i.test(v)) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`);
      if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return '';
      return `https://${u.hostname}${u.pathname}${u.search}`;
    } catch {
      return '';
    }
  }
  // A bare handle, with or without the "@" or the "in/" in front.
  const handle = v.replace(/^@/, '').replace(/^\/?in\//i, '').replace(/^\/+|\/+$/g, '');
  if (!handle || /[\s/:?#]/.test(handle)) return '';
  return `https://www.linkedin.com/in/${encodeURIComponent(handle)}`;
}

/* A LinkedIn people search for a contact with no profile saved yet. */
export function linkedinSearchUrl(name, company) {
  const q = [clean(name), clean(company)].filter(Boolean).join(' ');
  return q ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}` : '';
}

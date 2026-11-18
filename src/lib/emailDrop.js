/* What an email dragged onto the Venues page arrives as, turned into what
   the server reads (api/wedding-venues.js, action readEmail).

   A drag hands over whatever the other app put on it, and Gmail puts on
   different things depending on what's dragged:
     · text selected in an open email → its HTML and plain text — the body;
     · a saved message (Gmail ⋮ → Download message) → an .eml file;
     · a link to the email → just the link (and maybe the subject).
   So all of it is gathered and the richest kept: an email file, else the
   text, else the link and subject, which the server looks up in the linked
   inbox. Pure (no DOM), so it's tested on its own. */

// The most text sent to be read (the server cuts there too).
export const MAX_DROPPED_TEXT = 40000;

const entity = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

// HTML as readable text: blocks on lines of their own, tags gone.
export function htmlToText(html) {
  return entity(String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table|blockquote)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── .eml (RFC 822) ── */

function decodeQP(s) {
  const bytes = [];
  const src = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '=' && /^[0-9A-F]{2}$/i.test(src.slice(i + 1, i + 3))) { bytes.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
    else {
      const code = src.charCodeAt(i);
      if (code < 128) bytes.push(code);
      else bytes.push(...new TextEncoder().encode(src[i]));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
function decodeB64(s) {
  try {
    const bin = atob(s.replace(/\s+/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return ''; }
}

// "=?UTF-8?Q?Caf=C3=A9?=" and "=?utf-8?B?…?=" header words, decoded.
function decodeWords(v) {
  return String(v || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, _cs, enc, text) => (
    enc.toLowerCase() === 'b' ? decodeB64(text) : decodeQP(text.replace(/_/g, ' '))
  )).replace(/\?=\s+=\?/g, '');
}

function splitPart(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { headers, body };
}

// The text of one part tree: plain text if any, else the HTML as text.
function partText({ headers, body }, out) {
  const type = (headers['content-type'] || 'text/plain').toLowerCase();
  const boundary = (headers['content-type'] || '').match(/boundary="?([^";]+)"?/i)?.[1];
  if (type.startsWith('multipart/') && boundary) {
    const pieces = body.split(`--${boundary}`).slice(1);
    for (const p of pieces) {
      if (p.startsWith('--')) break;
      partText(splitPart(p.replace(/^\r?\n/, '')), out);
    }
    return;
  }
  if (/attachment/i.test(headers['content-disposition'] || '')) return;
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
  const text = enc === 'base64' ? decodeB64(body) : enc === 'quoted-printable' ? decodeQP(body) : body;
  if (type.startsWith('text/plain')) out.plain.push(text);
  else if (type.startsWith('text/html')) out.html.push(text);
}

/* A saved email file → { subject, from, to, date, text }: the headers that
   say who and when, and the body as text. */
export function parseEml(raw) {
  const part = splitPart(String(raw || ''));
  const out = { plain: [], html: [] };
  partText(part, out);
  const h = (k) => decodeWords(part.headers[k] || '');
  const body = out.plain.length ? out.plain.join('\n').trim() : htmlToText(out.html.join('\n'));
  return { subject: h('subject'), from: h('from'), to: h('to'), date: h('date'), text: body };
}

// The email file as the text the reader gets: its headers, then the body.
export function emlToText(raw) {
  const m = parseEml(raw);
  const head = [m.from && `From: ${m.from}`, m.to && `To: ${m.to}`, m.date && `Date: ${m.date}`, m.subject && `Subject: ${m.subject}`].filter(Boolean);
  return [head.join('\n'), m.text].filter(Boolean).join('\n\n');
}

const isEmailFile = (f) => /\.(eml|txt|mht|mhtml)$/i.test(f?.name || '') || /^(message\/rfc822|text\/plain)$/i.test(f?.type || '');

/* Everything a drop carried → { text, url, subject, skipped }:
     files    [{ name, type, text }] — the dropped files already read as text
     html, plain, uri — the drag's text/html, text/plain, text/uri-list
   `skipped` names files that aren't emails Rally can read (an Outlook .msg,
   a PDF), so the page can say so. */
export function dropPayload({ files = [], html = '', plain = '', uri = '' } = {}) {
  const skipped = [];
  const texts = [];
  let subject = '';
  for (const f of files) {
    if (!isEmailFile(f) || typeof f.text !== 'string') { skipped.push(f?.name || 'a file'); continue; }
    if (/\.txt$/i.test(f.name || '') && !/^[\w-]+:/m.test(f.text.slice(0, 500))) { texts.push(f.text.trim()); continue; }
    const m = parseEml(f.text);
    subject ||= m.subject;
    texts.push(emlToText(f.text));
  }
  const urls = String(uri || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const fromHtml = htmlToText(html);
  const plainText = String(plain || '').trim();
  // The plain text and the HTML usually say the same; keep the fuller one.
  let text = texts.join('\n\n---\n\n');
  if (!text) text = fromHtml.length > plainText.length ? fromHtml : plainText;
  // A dragged link comes as its own text too: that's not an email.
  const url = urls[0] || (/^https?:\/\/\S+$/.test(text) ? text : '');
  if (url && text === url) text = '';
  return { text: text.slice(0, MAX_DROPPED_TEXT), url, subject, skipped };
}

// Whether a drag could be an email: files or some text, not one of the page's own.
export const dragLooksLikeEmail = (types = []) => {
  const t = [...types];
  return t.includes('Files') || t.includes('text/html') || t.includes('text/plain') || t.includes('text/uri-list');
};

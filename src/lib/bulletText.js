/* A textarea that reads as a bullet list: every line shows "• ", Enter
   starts the next bullet. What's saved is the plain lines, without the
   bullets, so the stored text stays clean and a list pasted in with "-",
   "*" or "•" markers comes out the same. Pure, for testing without React. */

export const BULLET = '• ';
const MARKER = /^[ \t]*(?:[•●▪◦‣*-]|\d+[.)])[ \t]?/;

const stripMarker = (line) => line.replace(MARKER, '');

/** The plain lines shown with a bullet on each. Nothing at all stays empty. */
export function bulletDisplay(plain) {
  const s = String(plain ?? '');
  if (!s) return '';
  return s.split('\n').map((l) => BULLET + stripMarker(l)).join('\n');
}

/* What was typed (bullets and all), and where the caret is in it → the plain
   text, and where the caret lands once the bullets are drawn back on. */
export function bulletParse(raw, caret = String(raw ?? '').length) {
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  let pos = 0;
  let caretLine = lines.length - 1;
  let caretCol = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (caret <= pos + lines[i].length) { caretLine = i; caretCol = caret - pos; break; }
    pos += lines[i].length + 1;
  }
  const plainLines = lines.map(stripMarker);
  const plain = plainLines.join('\n');
  // Everything typed on an empty box was the first bullet.
  if (!plain) return { plain: '', caret: 0 };
  const markerLen = lines[caretLine].length - plainLines[caretLine].length;
  let out = 0;
  for (let i = 0; i < caretLine; i += 1) out += BULLET.length + plainLines[i].length + 1;
  out += BULLET.length + Math.max(0, Math.min(plainLines[caretLine].length, caretCol - markerLen));
  return { plain, caret: out };
}

/* Backspace with the caret just after a line's bullet: join the line onto
   the one above (or, on the only line when it's empty, clear the box).
   Returns null when it's an ordinary backspace. */
export function bulletBackspace(plain, caret) {
  const lines = String(plain ?? '').split('\n');
  let pos = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const start = pos + BULLET.length; // where this line's text begins on screen
    if (caret === start) {
      if (i === 0) return lines.length === 1 && !lines[0] ? { plain: '', caret: 0 } : null;
      const merged = [...lines.slice(0, i - 1), lines[i - 1] + lines[i], ...lines.slice(i + 1)];
      let at = 0;
      for (let j = 0; j < i - 1; j += 1) at += BULLET.length + lines[j].length + 1;
      return { plain: merged.join('\n'), caret: at + BULLET.length + lines[i - 1].length };
    }
    pos += BULLET.length + lines[i].length + 1;
  }
  return null;
}

/** For saving: the lines trimmed, markers and blank lines dropped. */
export function cleanBulletText(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').split('\n').map((l) => stripMarker(l).trim()).filter(Boolean).join('\n');
}

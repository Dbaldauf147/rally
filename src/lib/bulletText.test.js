import { describe, it, expect } from 'vitest';
import { BULLET, bulletDisplay, bulletParse, bulletBackspace, cleanBulletText } from './bulletText';

const B = BULLET;

describe('bullet text', () => {
  it('draws a bullet on every line, nothing on an empty box', () => {
    expect(bulletDisplay('')).toBe('');
    expect(bulletDisplay('Wineries\nWater views')).toBe(`${B}Wineries\n${B}Water views`);
    // Markers already in saved text aren't doubled.
    expect(bulletDisplay('- Boats\n* Beach\n• Bay\n1. Barn')).toBe(`${B}Boats\n${B}Beach\n${B}Bay\n${B}Barn`);
  });

  it('first letter typed in an empty box becomes the first bullet', () => {
    expect(bulletParse('W', 1)).toEqual({ plain: 'W', caret: 3 });
    expect(bulletDisplay('W')).toBe(`${B}W`);
  });

  it('Enter starts a new bullet with the caret after it', () => {
    const raw = `${B}Wineries\n`; // the browser inserted the newline at the end
    const r = bulletParse(raw, raw.length);
    expect(r.plain).toBe('Wineries\n');
    expect(bulletDisplay(r.plain)).toBe(`${B}Wineries\n${B}`);
    expect(r.caret).toBe(`${B}Wineries\n${B}`.length);
  });

  it('typing mid-line keeps the caret where it was', () => {
    const raw = `${B}Winex\n${B}Bay`;
    expect(bulletParse(raw, 7)).toEqual({ plain: 'Winex\nBay', caret: 7 });
  });

  it('a pasted list loses its markers', () => {
    const raw = '- Boats\n- Beach';
    expect(bulletParse(raw, raw.length).plain).toBe('Boats\nBeach');
  });

  it('backspace right after a bullet joins the line onto the one above', () => {
    // "• A\n• B" with the caret just after the second bullet (index 6)
    expect(bulletBackspace('A\nB', 6)).toEqual({ plain: 'AB', caret: 3 });
    expect(bulletBackspace('A\n', 6)).toEqual({ plain: 'A', caret: 3 });
    // On the only, empty line it clears the box; elsewhere it's an ordinary backspace.
    expect(bulletBackspace('', 2)).toEqual({ plain: '', caret: 0 });
    expect(bulletBackspace('A', 2)).toBe(null);
    expect(bulletBackspace('AB\nC', 4)).toBe(null);
  });

  it('saves clean lines', () => {
    expect(cleanBulletText('  • Wineries \r\n\n- Water views\n•  \n')).toBe('Wineries\nWater views');
    expect(cleanBulletText(7)).toBe('');
  });
});

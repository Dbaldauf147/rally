import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Rally's Gmail account can mail anyone; Resend's shared sender only reaches
// the account owner. A route that calls Resend itself skips Gmail, which is how
// the automatic poll reminders went months without reaching a single guest.
describe('email routing', () => {
  it('every API route sends through lib/mailer.js, not straight to Resend', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api');
    const direct = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('api.resend.com'));
    expect(direct).toEqual([]);
  });
});

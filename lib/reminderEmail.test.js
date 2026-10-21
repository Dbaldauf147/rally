import { describe, it, expect } from 'vitest';
import { renderReminderEmail, optionLabel } from './reminderEmail.js';

const opt = (startDate, extra = {}) => ({ startDate, endDate: startDate, ...extra });
const base = { name: 'Mike', eventTitle: 'Steak Night', location: 'NYC', pollLink: 'https://x/poll/e?vid=m', reminderNum: 1, totalReminders: 3, fromName: 'Dan' };

describe('optionLabel', () => {
  it('prints a day or a range, without slipping a day across time zones', () => {
    expect(optionLabel(opt('2026-11-05'))).toBe('Thu, Nov 5');
    expect(optionLabel({ startDate: '2026-11-06', endDate: '2026-11-08' })).toBe('Fri, Nov 6 – Sun, Nov 8');
  });
});

describe('renderReminderEmail', () => {
  it('shows each answer so far and marks the missing dates', () => {
    const { subject, html } = renderReminderEmail({ ...base, answers: [
      { option: opt('2026-11-05'), vote: null },
      { option: opt('2026-12-03'), vote: 'yes' },
      { option: opt('2026-11-22'), vote: 'no' },
    ] });
    expect(subject).toBe('Reminder 1/3: 1 date still needs your answer for Steak Night');
    expect(html).toContain('Thanks for answering 2 dates!');
    expect(html).toContain('Thu, Nov 5');
    expect(html.match(/No answer yet/g)).toHaveLength(1);
    expect(html).toContain('✓ Works');
    expect(html).toContain('✗ Can’t');
    expect(html).toContain('Answer the missing date');
  });

  it('reads as a first nudge for someone who hasn’t answered anything', () => {
    const { subject, html } = renderReminderEmail({ ...base, answers: [{ option: opt('2026-11-05'), vote: null }] });
    expect(subject).toBe('Reminder 1/3: Dan is waiting for your vote on Steak Night');
    expect(html).toContain('Vote Now');
  });

  it('says final on the last one and escapes what guests typed', () => {
    const { subject, html } = renderReminderEmail({ ...base, reminderNum: 3, eventTitle: '<b>Party</b>', answers: [{ option: opt('2026-11-05', { note: 'a & b' }), vote: null }] });
    expect(subject).toBe('Final reminder: Dan needs your answer on <b>Party</b>');
    expect(html).toContain('&lt;b&gt;Party&lt;/b&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('final reminder');
  });
});

import { describe, it, expect } from 'vitest';
import { renderReminderEmail, optionLabel, renderEventReminderEmail, eventWhenLabel } from './reminderEmail.js';

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

describe('renderEventReminderEmail', () => {
  it('says when it is and links to the details', () => {
    const when = eventWhenLabel({ date: '2026-11-14T23:00:00Z' });
    expect(when).toBe('Saturday, Nov 14 · 6:00 PM');
    const { subject, html } = renderEventReminderEmail({
      name: 'Mike', eventTitle: 'Steak Night', when, location: 'NYC', daysAway: 1, link: 'https://x/poll/e?vid=m', fromName: 'Dan',
    });
    expect(subject).toBe('Reminder: Steak Night is tomorrow (Saturday, Nov 14 · 6:00 PM)');
    expect(html).toContain('Hey Mike!');
    expect(html).toContain('📍 NYC');
    expect(html).toContain('href="https://x/poll/e?vid=m"');
    expect(html).toContain('you said yes or maybe');
  });

  it('leaves the clock off an all-day event and prints a trip as a range', () => {
    expect(eventWhenLabel({ date: '2026-11-14T05:00:00Z', allDay: true })).toBe('Saturday, Nov 14');
    expect(eventWhenLabel({ date: '2026-11-13T17:00:00Z', endDate: '2026-11-15T17:00:00Z' })).toBe('Fri, Nov 13 – Sun, Nov 15');
  });

  it('reads "today" and "in N days"', () => {
    expect(renderEventReminderEmail({ eventTitle: 'X', daysAway: 0, link: '' }).subject).toBe('Reminder: X is today');
    expect(renderEventReminderEmail({ eventTitle: 'X', daysAway: 7, link: '' }).subject).toBe('Reminder: X is in 7 days');
  });

  it('escapes what guests typed', () => {
    const { html } = renderEventReminderEmail({ eventTitle: '<b>x</b>', daysAway: 1, link: '' });
    expect(html).not.toContain('<b>x</b>');
  });
});

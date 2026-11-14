import { describe, it, expect } from 'vitest';
import { outreachMessage, gmailComposeUrl, AUDIENCES, KINDS, CHANNELS } from './eventOutreach';

const ctx = {
  title: 'Steak Night', location: 'Keens', finalized: false, dateStr: 'Thursday, December 3, 2026',
  pollLink: 'https://x/poll/1', calendarLink: 'https://x/ics', googleCalUrl: 'https://g/cal', hasAnyVotes: false,
};
const msg = (channel, kind, audience, over = {}) => outreachMessage({ channel, kind, audience }, { ...ctx, ...over });

describe('outreachMessage', () => {
  it('has wording for every combination', () => {
    for (const c of CHANNELS) for (const k of KINDS) for (const a of AUDIENCES) {
      const m = msg(c.key, k.key, a.key);
      expect(m.subject).toContain('Steak Night');
      expect(m.body).toContain('Steak Night');
      expect(m.body).not.toMatch(/undefined|null/);
    }
  });
  it('poll: invites everyone, and says so differently once votes are in', () => {
    expect(msg('text', 'poll', 'all').body).toBe("You're invited to Steak Night!\n\nVote here on what dates you can make: https://x/poll/1");
    expect(msg('text', 'poll', 'all', { hasAnyVotes: true }).body).toContain('additional dates');
  });
  it('poll: nudges the people who have not responded', () => {
    const m = msg('email', 'poll', 'missing');
    expect(m.subject).toBe('Still need your vote: Steak Night');
    expect(m.body).toContain("still waiting on your vote");
    expect(m.body).toContain('https://x/poll/1');
  });
  it('poll: a finalized event becomes a reminder with the date and place', () => {
    expect(msg('text', 'poll', 'yesmaybe', { finalized: true }).body)
      .toBe('Hey! Reminder about Steak Night on Thursday, December 3, 2026 at Keens. Hope you can make it!\n\nDetails: https://x/poll/1');
    expect(msg('text', 'poll', 'going', { finalized: true }).body).toContain('See you there!');
  });
  it('calendar: a text carries one link, an email both', () => {
    const t = msg('text', 'calendar', 'yesmaybe').body;
    expect(t).toContain('Add to your calendar: https://x/ics');
    expect(t).not.toContain('https://g/cal');
    const e = msg('email', 'calendar', 'yesmaybe').body;
    expect(e).toContain('https://g/cal');
    expect(e).toContain('https://x/ics');
  });
  it('leaves the place out when there is none', () => {
    expect(msg('text', 'calendar', 'all', { location: '' }).body).toContain('on Thursday, December 3, 2026.');
  });
});

describe('gmailComposeUrl', () => {
  it('encodes recipients, subject and body', () => {
    const url = gmailComposeUrl(['a@x.com', 'b@x.com'], { subject: 'Hi & bye', body: 'line 1\nline 2' });
    expect(url).toContain('to=a%40x.com%2Cb%40x.com');
    expect(url).toContain('su=Hi%20%26%20bye');
    expect(url).toContain('body=line%201%0Aline%202');
  });
});

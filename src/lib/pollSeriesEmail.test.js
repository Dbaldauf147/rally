import { describe, it, expect } from 'vitest';
import { pollRecipients, pollInviteEmail } from './pollSeriesEmail';

const event = {
  title: 'Game <night>', location: 'Dan’s', pollSeries: { everyMonths: 1, round: 2 },
  pollWindow: { from: '2026-10-27', to: '2026-11-26' },
  hiddenFrom: ['surprise@x.com'],
  members: {
    u1: { role: 'owner', name: 'Dan Baldauf', email: 'dan@x.com' },
    g1: { name: 'Sam Smith', email: 'Sam@X.com' },
    g2: { name: 'Sam again', email: 'sam@x.com' },
    g3: { name: 'No email' },
    g4: { name: 'Shh', email: 'surprise@x.com' },
  },
};

describe('pollRecipients', () => {
  it('everyone with an email, once each, never someone it’s hidden from', () => {
    expect(pollRecipients(event).map((r) => r.key)).toEqual(['u1', 'g1']);
  });
});

describe('pollInviteEmail', () => {
  it('names the host and event, the window, and gives their own link', () => {
    const { subject, html, link } = pollInviteEmail({ event, eventId: 'ev9', key: 'g1', member: event.members.g1 });
    expect(subject).toBe('Dan Baldauf is picking a date for Game <night> — suggest dates & vote');
    expect(link).toBe('https://rally-seven-theta.vercel.app/poll/ev9?name=Sam%20Smith&vid=g1');
    expect(html).toContain('Hey Sam!');
    expect(html).toContain('Game &lt;night&gt;');
    expect(html).not.toContain('Game <night>');
    expect(html).toContain('(round 2)');
    expect(html).toContain('Looking at Oct 27 – Nov 26');
    expect(html).toContain('Suggest dates &amp; vote');
  });
});

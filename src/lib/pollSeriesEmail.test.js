import { describe, it, expect } from 'vitest';
import { pollRecipients, pollInviteEmail, ownerPreviewEmail, guestsWithoutEmail } from './pollSeriesEmail';

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
  it('every guest with an email, once each — not the organizer, not someone it’s hidden from', () => {
    expect(pollRecipients(event).map((r) => r.key)).toEqual(['g1']);
    expect(guestsWithoutEmail(event)).toEqual(['No email']);
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

describe('ownerPreviewEmail', () => {
  it('says when, who, who’s missing, the dates, and shows the guests’ email', () => {
    const ev = { ...event, pollSendDate: '2026-10-20' };
    const { subject, html, recipients, missing } = ownerPreviewEmail({
      event: ev, eventId: 'ev9', today: '2026-10-13',
      options: [{ startDate: '2026-10-31', endDate: '2026-10-31' }, { startDate: '2026-10-30', endDate: '2026-11-01' }],
    });
    expect(subject).toBe('Heads up: the Game <night> poll goes to 1 guest on Tue, Oct 20');
    expect(recipients).toBe(1);
    expect(missing).toEqual(['No email']);
    expect(html).toContain('Sam Smith · Sam@X.com');
    expect(html).toContain('No email address, so they won’t get it: No email');
    expect(html.indexOf('Fri, Oct 30 – Sun, Nov 1')).toBeLessThan(html.indexOf('Sat, Oct 31'));
    expect(html).toContain('https://rally-seven-theta.vercel.app/event/ev9');
    expect(html).toContain('What your guests will get');
    expect(html).toContain('Suggest dates &amp; vote');
    expect(html).not.toContain('that’s today');
  });
  it('copes with no guests and no dates yet', () => {
    const { html, recipients } = ownerPreviewEmail({ event: { title: 'X', pollSendDate: '2026-10-20', members: { u1: { role: 'owner' } } }, eventId: 'e', today: '2026-10-20' });
    expect(recipients).toBe(0);
    expect(html).toContain('Nobody yet');
    expect(html).toContain('None yet');
    expect(html).toContain('that’s today');
  });
});

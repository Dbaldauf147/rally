import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUESTIONS, buildTemplate, fillTemplate, firstName, normalizeReplySettings, outreachSubject, prefillDetails, readsAsReply, replySubject, templateOf,
  draftOf, newDraftId, replySettingsToSave, subjectOf,
} from './weddingVenueReply';

describe('venue reply settings', () => {
  it('starts with the usual questions and no template of its own', () => {
    const s = normalizeReplySettings(null);
    expect(s.details.questions).toBe(DEFAULT_QUESTIONS);
    expect(s.details.date).toBe('');
    expect(s.template).toBe('');
  });
  it('keeps cleared questions cleared and drops unknown keys', () => {
    const s = normalizeReplySettings({ details: { questions: '', bogus: 'x', guests: ' 180 ' } });
    expect(s.details.questions).toBe('');
    expect(s.details.guests).toBe('180');
    expect('bogus' in s.details).toBe(false);
  });
  it('fills only blanks from the timeline date and the budget head count', () => {
    const d = prefillDetails({ date: '', guests: '' }, { weddingDate: '2027-09-18', guestCount: 182 });
    expect(d.date).toBe('Saturday, September 18, 2027');
    expect(d.guests).toBe('About 182');
    expect(prefillDetails({ date: 'Fall 2027', guests: '150' }, { weddingDate: '2027-09-18', guestCount: 182 }))
      .toEqual({ date: 'Fall 2027', guests: '150' });
  });
});

describe('the email', () => {
  const details = {
    couple: 'Dan & Jo', date: 'September 18, 2027', flexibility: 'open to Fridays', guests: 'About 180',
    ceremony: 'On site', budget: '', questions: '- Is the date open?\n2) Per person price', phone: '555-0100', signoff: 'Thanks,\nDan',
  };
  it('is built from the details, leaving out what is blank', () => {
    const t = buildTemplate(details);
    expect(t).toContain('Hi {first name},');
    expect(t).toContain('{venue}');
    expect(t).toContain('• Date: September 18, 2027 (open to Fridays)');
    expect(t).toContain('• Guests: About 180');
    expect(t).not.toContain('Budget');
    expect(t).toContain('• Is the date open?\n• Per person price');
    expect(t).toContain('555-0100');
    expect(t.endsWith('Thanks,\nDan')).toBe(true);
  });
  it('uses the edited template once there is one', () => {
    expect(templateOf({ details, template: 'Mine' })).toBe('Mine');
    expect(templateOf({ details, template: '  ' })).toBe(buildTemplate(details));
  });
  it('is filled in per venue', () => {
    expect(fillTemplate('Hi {first name},\nLove {venue}.', { contactName: 'Ms. Trudy Wilson', name: 'The Pridwin' })).toBe('Hi Trudy,\nLove The Pridwin.');
    expect(fillTemplate('Hi {first name},\nLove {venue}.', { name: 'RGNY' })).toBe('Hi there,\nLove RGNY.');
    expect(firstName('')).toBe('');
  });
  it('answers under the thread subject', () => {
    expect(replySubject('Wedding inquiry', 'X')).toBe('Re: Wedding inquiry');
    expect(replySubject('RE: Quote', 'X')).toBe('RE: Quote');
    expect(replySubject('', 'RGNY')).toBe('Wedding inquiry — RGNY');
  });
});

describe('outreach email', () => {
  it('opens as a first email, not a reply', () => {
    const t = buildTemplate({ couple: 'Dan & Jo' });
    expect(t).toMatch(/^Hi \{first name\},\n\nWe \(Dan & Jo\) are planning our wedding and \{venue\} is high on our list/);
    expect(readsAsReply(t)).toBe(false);
  });
  it('spots a saved template still worded as a reply', () => {
    expect(readsAsReply('Hi {first name},\n\nThank you for getting back to us! We are…')).toBe(true);
    expect(readsAsReply('Thanks for your email about dates.')).toBe(true);
    expect(readsAsReply('')).toBe(false);
  });
  it('gives the subject the date when there is one', () => {
    expect(outreachSubject({ date: 'Saturday, September 18, 2027' })).toBe('Wedding inquiry for Saturday, September 18, 2027');
    expect(outreachSubject({})).toBe('Wedding inquiry');
  });
});

describe('several drafts', () => {
  it('reads the one saved email as the first draft', () => {
    const s = normalizeReplySettings({ details: {}, template: 'Mine' });
    expect(s.drafts).toEqual([{ id: 'outreach', name: 'Outreach', template: 'Mine', subject: '' }]);
    expect(s.template).toBe('Mine');
    expect(normalizeReplySettings(null).drafts).toEqual([{ id: 'outreach', name: 'Outreach', template: '', subject: '' }]);
  });

  it('keeps saved drafts, giving each a name and an id of its own', () => {
    const s = normalizeReplySettings({ template: 'old', drafts: [
      { id: 'a', name: ' First ', template: 'One\r\nline' },
      { id: 'a', template: 'Two', subject: ' Hello ' },
      null,
    ] });
    expect(s.drafts).toEqual([
      { id: 'a', name: 'First', template: 'One\nline', subject: '' },
      { id: 'draft-2', name: 'Draft 2', template: 'Two', subject: 'Hello' },
    ]);
    expect(s.template).toBe('One\nline');
    expect(newDraftId(s.drafts)).toBe('draft-3');
  });

  it('picks a draft by id, falling back to the first, with its own template and subject', () => {
    const details = { date: 'June 5' };
    const s = { details, drafts: [{ id: 'a', name: 'A', template: '', subject: '' }, { id: 'b', name: 'B', template: 'Checking in', subject: 'Following up' }] };
    expect(draftOf(s, 'b').name).toBe('B');
    expect(draftOf(s, 'nope').name).toBe('A');
    expect(templateOf(s)).toBe(buildTemplate(details));
    expect(templateOf(s, 'b')).toBe('Checking in');
    expect(subjectOf(s, 'a')).toBe('Wedding inquiry for June 5');
    expect(subjectOf(s, 'b')).toBe('Following up');
  });

  it('saves the first draft under the old name too', () => {
    const drafts = [{ id: 'a', name: 'A', template: 'T', subject: '' }];
    expect(replySettingsToSave({ couple: 'x' }, drafts)).toEqual({ details: { couple: 'x' }, drafts, template: 'T' });
  });
});

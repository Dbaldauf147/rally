import { describe, it, expect } from 'vitest';
import { linkedinUrl, linkedinSearchUrl } from './linkedin';

describe('linkedinUrl', () => {
  it('keeps a full profile URL', () => {
    expect(linkedinUrl('https://www.linkedin.com/in/jane-doe/')).toBe('https://www.linkedin.com/in/jane-doe/');
  });
  it('adds https to a pasted address without it, and upgrades http', () => {
    expect(linkedinUrl('linkedin.com/in/jane')).toBe('https://linkedin.com/in/jane');
    expect(linkedinUrl('http://www.linkedin.com/in/jane')).toBe('https://www.linkedin.com/in/jane');
  });
  it('builds a profile URL from a handle', () => {
    expect(linkedinUrl('jane-doe')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(linkedinUrl('@jane-doe')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(linkedinUrl(' in/jane-doe/ ')).toBe('https://www.linkedin.com/in/jane-doe');
  });
  it('gives nothing for a blank, or for something that is not a profile', () => {
    expect(linkedinUrl('')).toBe('');
    expect(linkedinUrl(undefined)).toBe('');
    expect(linkedinUrl('Jane Doe')).toBe('');
    expect(linkedinUrl('https://example.com/in/jane')).toBe('');
  });
  it('never opens another site or scheme dressed up as LinkedIn', () => {
    expect(linkedinUrl('javascript:alert("linkedin.com")')).toBe('');
    expect(linkedinUrl('https://evil.com/linkedin.com/in/jane')).toBe('');
    expect(linkedinUrl('https://linkedin.com.evil.com/in/jane')).toBe('');
  });
});

describe('linkedinSearchUrl', () => {
  it('searches people by name and company', () => {
    expect(linkedinSearchUrl('Jane Doe', 'Acme')).toBe('https://www.linkedin.com/search/results/people/?keywords=Jane%20Doe%20Acme');
  });
  it('gives nothing without a name or company', () => {
    expect(linkedinSearchUrl('', ' ')).toBe('');
  });
});

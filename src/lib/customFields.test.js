import { describe, it, expect } from 'vitest';
import {
  CUSTOM_FIELD_TYPES, linkHref, coerceCustomValue, formatCustomValue,
  normalizeFieldDefs, parseOptionList, optionListText,
} from './customFields';

describe('linkHref', () => {
  it('takes a full address as it is', () => {
    expect(linkHref('https://www.zocdoc.com/doctor/x')).toBe('https://www.zocdoc.com/doctor/x');
    expect(linkHref('http://example.com')).toBe('http://example.com');
  });

  it('puts https:// on the front of what people actually paste', () => {
    expect(linkHref('zocdoc.com/doctor/x')).toBe('https://zocdoc.com/doctor/x');
    expect(linkHref('www.zocdoc.com')).toBe('https://www.zocdoc.com');
  });

  it('refuses a scheme it did not offer, so a pasted script is never clickable', () => {
    expect(linkHref('javascript:alert(1)')).toBeNull();
    expect(linkHref('data:text/html,<script>')).toBeNull();
    expect(linkHref('file:///etc/passwd')).toBeNull();
  });

  it('refuses text that is not an address at all', () => {
    expect(linkHref('ask at reception')).toBeNull();
    expect(linkHref('')).toBeNull();
    expect(linkHref(null)).toBeNull();
  });

  it('ignores surrounding space', () => {
    expect(linkHref('  zocdoc.com  ')).toBe('https://zocdoc.com');
  });
});

describe('the link field type', () => {
  const field = { id: 'cf_1', label: 'ZocDoc', type: 'link' };

  it('is offered alongside the other types', () => {
    expect(CUSTOM_FIELD_TYPES.map((t) => t.key)).toContain('link');
  });

  it('stores what was typed, trimmed', () => {
    expect(coerceCustomValue(field, '  zocdoc.com/x  ')).toBe('zocdoc.com/x');
  });

  it('stores nothing for nothing', () => {
    expect(coerceCustomValue(field, '')).toBe('');
    expect(coerceCustomValue(field, null)).toBe('');
  });

  it('reads back as its address, which is what search sees', () => {
    expect(formatCustomValue(field, 'zocdoc.com/x')).toBe('zocdoc.com/x');
    expect(formatCustomValue(field, '')).toBe('');
  });

  it('survives a definition round trip', () => {
    expect(normalizeFieldDefs([field])[0].type).toBe('link');
  });
});

describe('the types that were already here', () => {
  it('still coerce as they did', () => {
    expect(coerceCustomValue({ type: 'number' }, '$40')).toBe(40);
    expect(coerceCustomValue({ type: 'number' }, 'nope')).toBe('');
    expect(coerceCustomValue({ type: 'checkbox' }, 'yes')).toBe(true);
    expect(coerceCustomValue({ type: 'date' }, '7/30/1985')).toBe('1985-07-30');
    expect(coerceCustomValue({ type: 'text' }, '  hi  ')).toBe('hi');
  });

  it('an unknown type falls back to text rather than breaking the page', () => {
    expect(normalizeFieldDefs([{ id: 'a', label: 'A', type: 'wat' }])[0].type).toBe('text');
  });

  it('choice lists round trip through the editor', () => {
    expect(parseOptionList('Great, Fine\nNever again')).toEqual(['Great', 'Fine', 'Never again']);
    expect(optionListText(['Great', 'Fine'])).toBe('Great\nFine');
  });
});

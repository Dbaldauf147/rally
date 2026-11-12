import { describe, it, expect } from 'vitest';
import {
  cleanMapsUrl, extractMapsLinks, isGoogleHost, isMapsUrl, isShortMapsUrl, mapsSearchUrl, parseMapsUrl, splitPlaceText, venueFieldsFromPlace,
} from './venueMaps';

describe('recognising Google Maps links', () => {
  it('knows short and full links, and nothing else', () => {
    for (const u of ['https://maps.app.goo.gl/AbC123xyz', 'maps.app.goo.gl/AbC123xyz?g_st=ic', 'https://goo.gl/maps/abc', 'https://www.google.com/maps/place/Oheka+Castle/', 'https://google.com/maps?q=Oheka', 'https://maps.google.com/?q=Oheka', 'https://www.google.co.uk/maps/place/X/']) {
      expect(isMapsUrl(u), u).toBe(true);
    }
    for (const u of ['https://www.google.com/search?q=oheka', 'https://evil.com/maps/place/X', 'https://google.com.evil.com/maps/place/X', 'https://maps.app.goo.gl.evil.com/x', 'oheka castle', '', 'javascript:alert(1)']) {
      expect(isMapsUrl(u), u).toBe(false);
    }
    expect(isShortMapsUrl('https://maps.app.goo.gl/AbC')).toBe(true);
    expect(isShortMapsUrl('https://www.google.com/maps/place/X/')).toBe(false);
    expect([isGoogleHost('www.google.com'), isGoogleHost('consent.google.com'), isGoogleHost('maps.app.goo.gl'), isGoogleHost('google.com.evil.com'), isGoogleHost('169.254.169.254')]).toEqual([true, true, true, false, false]);
  });

  it('finds the links in pasted text, with the name the Share sheet writes above', () => {
    const text = 'Oheka Castle Hotel & Estate\n135 W Gate Dr, Huntington, NY 11743\nhttps://maps.app.goo.gl/AbC123?g_st=ic\n\nCheck this one: https://www.google.com/maps/place/The+Foundry/@40.7,-73.9,17z.\nhttps://maps.app.goo.gl/AbC123?g_st=ic\nnot a link https://example.com/x';
    expect(extractMapsLinks(text)).toEqual([
      { url: 'https://maps.app.goo.gl/AbC123?g_st=ic', hint: 'Oheka Castle Hotel & Estate, 135 W Gate Dr, Huntington, NY 11743' },
      { url: 'https://www.google.com/maps/place/The+Foundry/@40.7,-73.9,17z', hint: 'Check this one:' },
    ]);
    expect(extractMapsLinks('nothing here')).toEqual([]);
  });
});

describe('reading a full link', () => {
  it('a link shared from the app carries the name and the address', () => {
    expect(parseMapsUrl('https://www.google.com/maps/place/Oheka+Castle+Hotel+%26+Estate,+135+W+Gate+Dr,+Huntington,+NY+11743/data=!4m2!3m1!1s0x89e82f1a:0x4b1c?utm_source=mstt_1&entry=gps')).toEqual({
      name: 'Oheka Castle Hotel & Estate', address: '135 W Gate Dr, Huntington, NY 11743', text: 'Oheka Castle Hotel & Estate, 135 W Gate Dr, Huntington, NY 11743', lat: null, lng: null, placeId: '',
    });
  });
  it('a link from the address bar carries the name and the pin', () => {
    const p = parseMapsUrl('https://www.google.com/maps/place/The+Foundry/@40.7505,-73.9512,17z/data=!3m1!4b1!4m6!3m5!1s0x89c2:0x1!8m2!3d40.7501234!4d-73.9498765!16s%2Fg%2F1tf');
    expect(p).toMatchObject({ name: 'The Foundry', address: '', lat: 40.7501234, lng: -73.9498765 });
  });
  it('reads search, ?q= and api=1 links', () => {
    expect(parseMapsUrl('https://maps.google.com/?q=Bourne+Mansion,+Oakdale,+NY&ftid=0x1:0x2')).toMatchObject({ name: 'Bourne Mansion', address: 'Oakdale, NY' });
    expect(parseMapsUrl('https://www.google.com/maps/search/?api=1&query=Dobbin%20St&query_place_id=ChIJabc')).toMatchObject({ name: 'Dobbin St', placeId: 'ChIJabc' });
    expect(parseMapsUrl('https://www.google.com/maps/search/Greenpoint+Loft/@40.72,-73.95,14z')).toMatchObject({ name: 'Greenpoint Loft', lat: 40.72, lng: -73.95 });
  });
  it('a dropped pin is a point with no name; a bare map or another site is nothing', () => {
    expect(parseMapsUrl('https://www.google.com/maps?q=40.8301,-73.4412')).toEqual({ name: '', address: '', text: '', lat: 40.8301, lng: -73.4412, placeId: '' });
    expect(parseMapsUrl('https://www.google.com/maps')).toBeNull();
    expect(parseMapsUrl('https://maps.app.goo.gl/AbC')).toBeNull();
    expect(parseMapsUrl('https://example.com/maps/place/X')).toBeNull();
  });
  it('splits a place text into name and address', () => {
    expect(splitPlaceText('Oheka Castle')).toEqual({ name: 'Oheka Castle', address: '' });
    expect(splitPlaceText('135 W Gate Dr, Huntington, NY 11743')).toEqual({ name: '', address: '135 W Gate Dr, Huntington, NY 11743' });
    expect(splitPlaceText('40.83, -73.44')).toEqual({ name: '', address: '' });
  });
});

describe('a place as a venue', () => {
  it('keeps the pasted link, and falls back to what was written above it', () => {
    expect(venueFieldsFromPlace({ name: 'Oheka Castle', address: '135 W Gate Dr', phone: '(631) 659-1400', website: 'https://oheka.com' }, { url: 'https://maps.app.goo.gl/AbC' }))
      .toEqual({ name: 'Oheka Castle', location: '135 W Gate Dr', phone: '(631) 659-1400', website: 'https://oheka.com', mapsUrl: 'https://maps.app.goo.gl/AbC' });
    expect(venueFieldsFromPlace(null, { url: 'https://maps.app.goo.gl/AbC', hint: 'The Foundry, 42-38 9th St, Queens' }))
      .toMatchObject({ name: 'The Foundry', location: '42-38 9th St, Queens', phone: '' });
  });
  it('tidies a typed link and builds a search for a venue without one', () => {
    expect([cleanMapsUrl('maps.app.goo.gl/AbC'), cleanMapsUrl('not a link'), cleanMapsUrl('')]).toEqual(['https://maps.app.goo.gl/AbC', '', '']);
    expect(mapsSearchUrl({ name: 'Oheka Castle', location: 'Huntington, NY' })).toBe('https://www.google.com/maps/search/?api=1&query=Oheka%20Castle%2C%20Huntington%2C%20NY');
    expect(mapsSearchUrl({})).toBe('');
  });
});

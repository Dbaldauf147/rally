import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from './climate.js';

const ARCHIVE = { daily: { time: ['2024-07-04', '2025-07-04'], temperature_2m_max: [88, 92], temperature_2m_min: [70, 74] } };
const GOOGLE_OK = { status: 'OK', results: [{ formatted_address: '225 W 34th St, New York, NY 10001, USA', geometry: { location: { lat: 40.75, lng: -73.99 } } }] };
const OPEN_METEO_OK = { results: [{ name: 'Newport', admin1: 'Rhode Island', country_code: 'US', latitude: 41.49, longitude: -71.31 }] };

const json = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

function fakeRes() {
  const out = { code: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; },
  };
}

const call = async (location) => { const res = fakeRes(); await handler({ query: { location } }, res); return res.out; };

describe('/api/climate', () => {
  const realFetch = globalThis.fetch;
  const realEnv = globalThis.process.env.GOOGLE_MAPS_SERVER_KEY;
  beforeEach(() => { globalThis.process.env.GOOGLE_MAPS_SERVER_KEY = 'test-key'; });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realEnv === undefined) delete globalThis.process.env.GOOGLE_MAPS_SERVER_KEY;
    else globalThis.process.env.GOOGLE_MAPS_SERVER_KEY = realEnv;
  });

  it('uses Google for a street address', async () => {
    globalThis.fetch = vi.fn((url) => (url.includes('maps.googleapis') ? json(GOOGLE_OK) : json(ARCHIVE)));
    const out = await call('225 West 34th Street, 2nd Floor, New York, NY 10001 ');
    expect(out.code).toBe(200);
    expect(out.body.place.label).toContain('New York');
    expect(out.body.byDay['07-04']).toEqual({ high: 90, low: 72, n: 2 });
  });

  /* The bug this file exists for: the key works for Distance Matrix but is not
     enabled for Geocoding, so every lookup came back REQUEST_DENIED and the
     row said it could not find anywhere at all. Google having no answer — for
     any reason — has to fall through to the geocoder that needs no key. */
  it('falls back to Open-Meteo when Google refuses the key', async () => {
    const seen = [];
    globalThis.fetch = vi.fn((url) => {
      seen.push(url.split('?')[0]);
      if (url.includes('maps.googleapis')) return json({ status: 'REQUEST_DENIED', error_message: 'This API project is not authorized to use this API.' });
      if (url.includes('geocoding-api')) return json(OPEN_METEO_OK);
      return json(ARCHIVE);
    });
    const out = await call('Newport, RI');
    expect(out.code).toBe(200);
    expect(out.body.place.label).toBe('Newport, Rhode Island, US');
    expect(seen.some((u) => u.includes('geocoding-api'))).toBe(true);
  });

  it('says what Google said when nothing matches at all', async () => {
    globalThis.fetch = vi.fn((url) => (url.includes('maps.googleapis')
      ? json({ status: 'REQUEST_DENIED', error_message: 'not authorized' })
      : json({ results: [] })));
    const out = await call('Zzqq Nowhereville, XX');
    expect(out.code).toBe(404);
    expect(out.body.error).toMatch(/Could not find/);
    expect(out.body.detail).toMatch(/REQUEST_DENIED/);
  });

  it('needs a location', async () => {
    const out = await call('   ');
    expect(out.code).toBe(400);
  });
});

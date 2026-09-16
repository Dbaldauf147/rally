import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  windowKeys, archiveSpan, averageByDay, normalFor, cacheKeyFor, fetchClimateNormals, SPREAD,
  locationQueries, resolvePlace, fetchEventClimate,
} from './climate';

// The cache is a browser thing; the tests run in node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  clear: () => store.clear(),
};

describe('windowKeys', () => {
  it('covers the day either side of a single date', () => {
    expect(windowKeys('2026-10-12')).toEqual(['10-09', '10-10', '10-11', '10-12', '10-13', '10-14', '10-15']);
  });

  it('covers every day of a multi-day option, plus the spread', () => {
    const keys = windowKeys('2026-10-12', '2026-10-14');
    expect(keys[0]).toBe('10-09');
    expect(keys[keys.length - 1]).toBe('10-17');
    expect(keys).toHaveLength(9);
  });

  it('crosses a month and a year end', () => {
    expect(windowKeys('2026-03-01', '2026-03-01', 2)).toEqual(['02-27', '02-28', '03-01', '03-02', '03-03']);
    expect(windowKeys('2026-12-31', '2026-12-31', 1)).toEqual(['12-30', '12-31', '01-01']);
  });

  it('caps a very long stay rather than swallowing a season', () => {
    expect(windowKeys('2026-01-01', '2026-06-01').length).toBe(31 + 2 * SPREAD);
  });

  it('gives nothing for a missing or malformed date', () => {
    expect(windowKeys('')).toEqual([]);
    expect(windowKeys('someday')).toEqual([]);
  });
});

describe('archiveSpan', () => {
  it('ends at the last full year and runs ten years back', () => {
    expect(archiveSpan(new Date('2026-09-16T00:00:00Z'))).toEqual({
      start: '2016-01-01', end: '2025-12-31', years: [2016, 2025],
    });
  });
});

describe('averageByDay', () => {
  it('averages each month-day across the years', () => {
    const byDay = averageByDay(
      ['2024-10-12', '2025-10-12', '2025-10-13'],
      [70, 80, 60],
      [50, 60, 40],
    );
    expect(byDay['10-12']).toEqual({ high: 75, low: 55, n: 2 });
    expect(byDay['10-13']).toEqual({ high: 60, low: 40, n: 1 });
  });

  it('skips days the archive has nothing for', () => {
    expect(averageByDay(['2025-10-12'], [null], [null])).toEqual({});
  });
});

describe('normalFor', () => {
  const byDay = {};
  for (let d = 9; d <= 15; d += 1) byDay[`10-${String(d).padStart(2, '0')}`] = { high: 70 + d, low: 50 + d, n: 10 };

  it('averages the window around the date', () => {
    // Highs 79…85 across 9–15 October: mean 82.
    expect(normalFor(byDay, '2026-10-12')).toMatchObject({ high: 82, low: 62, days: 7, readings: 70 });
  });

  it('uses whatever days it has when the window runs past the data', () => {
    expect(normalFor({ '10-12': { high: 60, low: 40, n: 4 } }, '2026-10-12')).toMatchObject({ high: 60, low: 40, days: 1 });
  });

  it('is null when the window lands on nothing, rather than reading as freezing', () => {
    expect(normalFor({}, '2026-10-12')).toBe(null);
    expect(normalFor(byDay, '')).toBe(null);
  });
});

describe('fetchClimateNormals', () => {
  beforeEach(() => localStorage.clear());

  const daily = {
    time: ['2024-07-04', '2025-07-04'],
    temperature_2m_max: [88, 92],
    temperature_2m_min: [70, 74],
  };
  const okFetcher = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ daily }) });

  it('asks the archive for ten full years in Fahrenheit', async () => {
    const fetcher = vi.fn(okFetcher);
    const out = await fetchClimateNormals(41.49, -71.31, { today: new Date('2026-09-16T00:00:00Z'), fetcher });
    const url = fetcher.mock.calls[0][0];
    expect(url).toContain('start_date=2016-01-01');
    expect(url).toContain('end_date=2025-12-31');
    expect(url).toContain('temperature_unit=fahrenheit');
    expect(out.byDay['07-04']).toEqual({ high: 90, low: 72, n: 2 });
    expect(out.years).toEqual([2016, 2025]);
  });

  it('answers a second event at the same place from the cache', async () => {
    const fetcher = vi.fn(okFetcher);
    const opts = { today: new Date('2026-09-16T00:00:00Z'), fetcher };
    await fetchClimateNormals(41.49, -71.31, opts);
    const again = await fetchClimateNormals(41.4912, -71.3122, opts); // same place, finer coordinates
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.cached).toBe(true);
    expect(again.byDay['07-04'].high).toBe(90);
  });

  it('says so when the archive has nothing, rather than showing an empty row', async () => {
    const fetcher = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ daily: { time: [], temperature_2m_max: [], temperature_2m_min: [] } }) });
    await expect(fetchClimateNormals(0, 0, { fetcher })).rejects.toThrow(/No past weather/);
  });

  it('reports a failed request', async () => {
    const fetcher = () => Promise.resolve({ ok: false });
    await expect(fetchClimateNormals(1, 2, { fetcher })).rejects.toThrow(/Could not load/);
  });
});

describe('cacheKeyFor', () => {
  it('rounds to about a kilometre, so near-identical places share one download', () => {
    expect(cacheKeyFor(41.4901, -71.3122)).toBe(cacheKeyFor(41.4899, -71.3078));
  });
});

describe('locationQueries', () => {
  it('drops the street a piece at a time', () => {
    expect(locationQueries('225 West 34th Street, 2nd Floor, New York, NY 10001')).toEqual([
      '225 West 34th Street, 2nd Floor, New York, NY 10001',
      '225 West 34th Street, 2nd Floor, New York, NY',
      '2nd Floor, New York, NY 10001',
      '2nd Floor, New York, NY',
      'New York, NY 10001',
      'New York, NY',
    ]);
  });

  it('drops a trailing ZIP, which a place-name geocoder chokes on', () => {
    expect(locationQueries('Newport, RI 02840')).toEqual(['Newport, RI 02840', 'Newport, RI', 'RI 02840', 'RI']);
  });

  it('skips a fragment that is only a unit or a ZIP', () => {
    expect(locationQueries('10 Main St, Apt 4B')).toEqual(['10 Main St, Apt 4B']);
    expect(locationQueries('10 Main St, 10001')).toEqual(['10 Main St, 10001', '10 Main St']);
  });

  it('keeps a plain place as it is', () => {
    expect(locationQueries('Newport RI')).toEqual(['Newport RI']);
    expect(locationQueries('  ')).toEqual([]);
  });
});

describe('resolvePlace', () => {
  it('falls back to the broader part of an address', async () => {
    const geocoder = vi.fn(async (q) => (q === 'New York, NY 10001' ? [{ label: 'New York, NY, US', lat: 40.7, lng: -74 }] : []));
    const place = await resolvePlace('225 West 34th Street, 2nd Floor, New York, NY 10001', geocoder);
    expect(place).toMatchObject({ label: 'New York, NY, US', query: 'New York, NY 10001' });
    expect(geocoder).toHaveBeenCalledTimes(5); // the fuller forms first, then the town
  });

  it('is null when the map knows none of it', async () => {
    expect(await resolvePlace("Mom's house", async () => [])).toBe(null);
  });

  it('keeps going when a lookup throws', async () => {
    let first = true;
    const geocoder = async () => { if (first) { first = false; throw new Error('offline'); } return [{ label: 'Newport', lat: 41.5, lng: -71.3 }]; };
    expect(await resolvePlace('X, Newport RI', geocoder)).toMatchObject({ label: 'Newport' });
  });
});

describe('fetchEventClimate', () => {
  beforeEach(() => localStorage.clear());
  const body = { place: { label: 'Newport, RI, USA', lat: 41.49, lng: -71.31 }, years: [2016, 2025], byDay: { '07-04': { high: 76, low: 68, n: 10 } } };
  const json = (data, ok = true) => ({ ok, headers: { get: () => 'application/json' }, json: async () => data });

  it('asks the route, and keeps the answer for the next event at that place', async () => {
    const fetcher = vi.fn(async () => json(body));
    const out = await fetchEventClimate('Newport, RI', { fetcher });
    expect(fetcher.mock.calls[0][0]).toBe('/api/climate?location=Newport%2C%20RI');
    expect(out.place.label).toBe('Newport, RI, USA');
    const again = await fetchEventClimate('newport, ri', { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.cached).toBe(true);
  });

  it('passes on what the route says it could not do', async () => {
    const fetcher = async () => json({ error: 'Could not find “Mom’s house” on the map.' }, false);
    await expect(fetchEventClimate("Mom's house", { fetcher })).rejects.toThrow(/Could not find/);
  });

  it('looks it up in the browser when the route is not there (npm run dev)', async () => {
    // The dev server answers /api/* with index.html.
    const fetcher = vi.fn(async (url) => (url.startsWith('/api/')
      ? { ok: true, headers: { get: () => 'text/html' }, json: async () => ({}) }
      : { ok: true, json: async () => ({ daily: { time: ['2025-07-04'], temperature_2m_max: [76], temperature_2m_min: [68] } }) }));
    const geocoder = async () => [{ label: 'Newport', lat: 41.49, lng: -71.31 }];
    const out = await fetchEventClimate('Newport, RI', { fetcher, geocoder });
    expect(out.place).toMatchObject({ label: 'Newport' });
    expect(out.byDay['07-04'].high).toBe(76);
    expect(fetcher.mock.calls[1][0]).toContain('archive-api.open-meteo.com');
  });

  it('says so when there is no location at all', async () => {
    await expect(fetchEventClimate('  ', {})).rejects.toThrow(/no location/);
  });
});

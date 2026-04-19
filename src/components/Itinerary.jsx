import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import styles from './Itinerary.module.css';

const TRAVEL_MODES = [
  { key: 'driving', icon: '🚗', label: 'Drive' },
  { key: 'walking', icon: '🚶', label: 'Walk' },
  { key: 'transit', icon: '🚆', label: 'Transit' },
  { key: 'bicycling', icon: '🚲', label: 'Bike' },
  { key: 'flying', icon: '✈️', label: 'Fly' },
];

function ModeSelector({ value, onChange }) {
  return (
    <div className={styles.modeSelector} onClick={e => e.stopPropagation()}>
      {TRAVEL_MODES.map(m => (
        <button
          key={m.key}
          type="button"
          className={value === m.key ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => onChange(m.key)}
          title={m.label}
          aria-label={m.label}
        >
          <span className={styles.modeIcon}>{m.icon}</span>
          <span className={styles.modeLabelText}>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

function ModeSelectorInline({ value, onChange, disabled }) {
  return (
    <div className={styles.modeSelectorInline} onClick={e => e.stopPropagation()}>
      {TRAVEL_MODES.map(m => (
        <button
          key={m.key}
          type="button"
          className={value === m.key ? styles.modeInlineBtnActive : styles.modeInlineBtn}
          onClick={() => !disabled && onChange(m.key)}
          title={m.label}
          aria-label={m.label}
          disabled={disabled}
        >
          {m.icon}
        </button>
      ))}
    </div>
  );
}

function formatItemDateTime(item) {
  if (!item.date) return '';
  const d = new Date(item.date + 'T' + (item.time || '00:00'));
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = item.time ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  return timeStr ? `${dateStr} · ${timeStr}` : dateStr;
}

// Travel items with "A → B" style locations have a start and end. Other items have a single location.
function extractStartEnd(item) {
  const loc = (item.location || '').trim();
  if (!loc) return { start: '', end: '' };
  if ((item.type || 'activity') === 'travel') {
    const parts = loc.split(/\s*[→➜➡>]\s*|\s+to\s+/i);
    if (parts.length >= 2) {
      return { start: parts[0].trim(), end: parts[parts.length - 1].trim() };
    }
  }
  return { start: loc, end: loc };
}

function inferTravelMode(item) {
  if (item?.travelMode) return item.travelMode;
  const t = ((item?.title || '') + ' ' + (item?.type || '')).toLowerCase();
  if (/flight|fly|plane|airport/.test(t)) return 'flying';
  if (/train|rail/.test(t)) return 'transit';
  if (/walk/.test(t)) return 'walking';
  if (/bike|bicycle/.test(t)) return 'bicycling';
  return 'driving';
}

function buildDirectionsEmbed(mapsKey, origin, destination, waypoints = [], mode = 'driving', zoom = null) {
  const modeParam = mode === 'flying' ? '' : `&mode=${mode}`;
  const wp = waypoints.length > 0
    ? `&waypoints=${waypoints.map(encodeURIComponent).join('|')}`
    : '';
  const zoomParam = typeof zoom === 'number' ? `&zoom=${zoom}` : '';
  return `https://www.google.com/maps/embed/v1/directions?key=${mapsKey}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${modeParam}${wp}${zoomParam}`;
}

function buildDirectionsLink(origin, destination, waypoints = []) {
  const path = [origin, ...waypoints, destination].map(encodeURIComponent).join('/');
  return `https://www.google.com/maps/dir/${path}`;
}

function buildPlaceEmbed(mapsKey, query) {
  return `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${encodeURIComponent(query)}`;
}

// Google Maps JavaScript API loader — loads once per page, shared promise.
let mapsApiPromise = null;
function loadMapsAPI(key) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.maps?.DirectionsService) return Promise.resolve(window.google);
  if (mapsApiPromise) return mapsApiPromise;
  mapsApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      mapsApiPromise = null;
      reject(new Error('Failed to load Google Maps JS'));
    };
    document.head.appendChild(script);
  });
  return mapsApiPromise;
}

const GOOGLE_TRAVEL_MODE = {
  driving: 'DRIVING',
  walking: 'WALKING',
  bicycling: 'BICYCLING',
  transit: 'TRANSIT',
  flying: 'DRIVING',
};

const MODE_COLOR = {
  driving: '#0891b2',
  walking: '#16a34a',
  bicycling: '#d97706',
  transit: '#6366F1',
  flying: '#9333EA',
};

// Overview map showing every leg on one canvas, each in its own mode color.
function TripOverviewMap({ mapsKey, transitions }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const renderersRef = useRef([]);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [polylines, setPolylines] = useState({}); // depKey -> [{polyline, mode}]
  const depKey = transitions.map(t => `${t.from}|${t.to}|${t.mode}`).join('\n');

  useEffect(() => {
    if (!mapsKey) return;
    let mounted = true;
    loadMapsAPI(mapsKey).then(google => {
      if (!mounted || !containerRef.current) return;
      mapRef.current = new google.maps.Map(containerRef.current, {
        zoom: 10,
        center: { lat: 40.7128, lng: -74.006 },
        mapTypeControl: false,
        streetViewControl: false,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      setReady(true);
    }).catch(e => mounted && setError(e.message));
    return () => {
      mounted = false;
      for (const r of renderersRef.current) r.setMap(null);
      renderersRef.current = [];
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
    };
  }, [mapsKey]);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.google?.maps) return;
    const google = window.google;
    // Clear previous renderers + markers
    for (const r of renderersRef.current) r.setMap(null);
    renderersRef.current = [];
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];

    const service = new google.maps.DirectionsService();
    const bounds = new google.maps.LatLngBounds();
    let remaining = transitions.length;
    if (remaining === 0) return;
    const collected = [];

    // Build the ordered list of unique stops so each gets one numbered marker.
    const stopOrder = [];
    const stopIndex = new Map();
    const addStop = (loc, title) => {
      const key = (loc || '').trim().toLowerCase();
      if (!key) return;
      if (stopIndex.has(key)) return;
      stopIndex.set(key, stopOrder.length);
      stopOrder.push({ loc, title });
    };
    for (const t of transitions) {
      addStop(t.from, t.fromTitle);
      addStop(t.to, t.toTitle);
    }
    const stopLatLngs = new Array(stopOrder.length).fill(null);

    const placeMarkersIfReady = () => {
      if (stopLatLngs.some(ll => ll === null)) return;
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
      stopLatLngs.forEach((ll, i) => {
        if (!ll) return;
        const marker = new google.maps.Marker({
          position: ll,
          map: mapRef.current,
          label: { text: String(i + 1), color: '#fff', fontWeight: '700', fontSize: '12px' },
          title: stopOrder[i].title || '',
        });
        markersRef.current.push(marker);
      });
    };

    transitions.forEach((t, tIdx) => {
      const renderer = new google.maps.DirectionsRenderer({
        map: mapRef.current,
        preserveViewport: true,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: MODE_COLOR[t.mode] || MODE_COLOR.driving,
          strokeWeight: 4,
          strokeOpacity: 0.85,
        },
      });
      renderersRef.current.push(renderer);

      service.route({
        origin: t.from,
        destination: t.to,
        travelMode: google.maps.TravelMode[GOOGLE_TRAVEL_MODE[t.mode] || 'DRIVING'],
      }, (result, status) => {
        remaining -= 1;
        if (status === 'OK') {
          renderer.setDirections(result);
          const leg = result.routes[0];
          if (leg?.bounds) bounds.union(leg.bounds);
          const raw = leg?.overview_polyline;
          const encStr = typeof raw === 'string' ? raw : (raw?.points || null);
          if (encStr) collected.push({ polyline: encStr, mode: t.mode });

          // Capture start/end latlng for stop markers (if not already captured).
          const firstLeg = leg?.legs?.[0];
          const lastLeg = leg?.legs?.[leg?.legs?.length - 1];
          const fromKey = (t.from || '').trim().toLowerCase();
          const toKey = (t.to || '').trim().toLowerCase();
          const fromIdx = stopIndex.get(fromKey);
          const toIdx = stopIndex.get(toKey);
          if (firstLeg?.start_location && fromIdx != null && !stopLatLngs[fromIdx]) {
            stopLatLngs[fromIdx] = firstLeg.start_location;
          }
          if (lastLeg?.end_location && toIdx != null && !stopLatLngs[toIdx]) {
            stopLatLngs[toIdx] = lastLeg.end_location;
          }
        } else {
          console.warn('Overview route failed:', status, 'for', t.from, '→', t.to);
        }
        if (remaining === 0) {
          if (!bounds.isEmpty()) {
            mapRef.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
          }
          setPolylines({ [depKey]: collected });
          placeMarkersIfReady();
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, depKey]);

  if (error) return <div className={styles.routeMapError}>Map unavailable: {error}</div>;
  const currentPolylines = polylines[depKey];
  const staticUrl = mapsKey && currentPolylines && currentPolylines.length > 0
    ? buildStaticMapUrl(mapsKey, currentPolylines, '900x500')
    : null;
  return (
    <>
      <div ref={containerRef} className={styles.tripOverviewMap} />
      {staticUrl && (
        <img
          src={staticUrl}
          alt="Trip route overview"
          className={styles.tripOverviewMapPrint}
          onError={() => console.warn('Static overview map failed to load:', staticUrl)}
        />
      )}
    </>
  );
}

// Colors in Static Maps need the 0xRRGGBB form, no leading '#'.
function modeColorHex(mode) {
  return (MODE_COLOR[mode] || MODE_COLOR.driving).replace('#', '0x');
}

function buildStaticMapUrl(mapsKey, paths, size = '640x360') {
  const pathParams = paths.map(p =>
    `path=color:${modeColorHex(p.mode)}|weight:5|enc:${encodeURIComponent(p.polyline)}`
  ).join('&');
  return `https://maps.googleapis.com/maps/api/staticmap?size=${size}&${pathParams}&key=${mapsKey}`;
}

// Interactive route map. Saves zoom + center on user interaction (debounced).
function RouteMap({ mapsKey, origin, destination, mode, savedZoom, savedCenter, onViewChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const rendererRef = useRef(null);
  const saveTimerRef = useRef(null);
  const hasSavedView = typeof savedZoom === 'number' && savedCenter && typeof savedCenter.lat === 'number';
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState(null);
  const [polyline, setPolyline] = useState(null);

  // Initialize map instance once.
  useEffect(() => {
    if (!mapsKey) return;
    let mounted = true;
    loadMapsAPI(mapsKey).then(google => {
      if (!mounted || !containerRef.current) return;
      const map = new google.maps.Map(containerRef.current, {
        zoom: hasSavedView ? savedZoom : 13,
        center: hasSavedView ? savedCenter : { lat: 40.7128, lng: -74.006 },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      mapRef.current = map;
      rendererRef.current = new google.maps.DirectionsRenderer({
        map,
        preserveViewport: hasSavedView,
      });

      const flushSave = () => {
        if (!mapRef.current) return;
        const z = mapRef.current.getZoom();
        const c = mapRef.current.getCenter();
        onViewChange({ zoom: z, center: { lat: c.lat(), lng: c.lng() } });
      };
      const onChange = () => {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(flushSave, 600);
      };
      map.addListener('zoom_changed', onChange);
      map.addListener('dragend', onChange);
      setMapReady(true);
    }).catch(e => {
      if (mounted) setError(e.message);
    });
    return () => {
      mounted = false;
      clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsKey]);

  // Run directions once the map is ready, and re-run whenever route or mode changes.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !rendererRef.current || !window.google?.maps) return;
    const google = window.google;
    const service = new google.maps.DirectionsService();
    const travelMode = GOOGLE_TRAVEL_MODE[mode] || 'DRIVING';
    service.route({
      origin,
      destination,
      travelMode: google.maps.TravelMode[travelMode],
    }, (result, status) => {
      if (status === 'OK') {
        rendererRef.current.setOptions({ preserveViewport: hasSavedView });
        rendererRef.current.setDirections(result);
        const raw = result.routes[0]?.overview_polyline;
        const encStr = typeof raw === 'string' ? raw : (raw?.points || null);
        if (encStr) setPolyline(encStr);
        if (hasSavedView) {
          mapRef.current.setZoom(savedZoom);
          mapRef.current.setCenter(savedCenter);
        }
      } else {
        console.warn('DirectionsService failed:', status, 'for', origin, '→', destination, 'mode:', travelMode);
        if (status !== 'ZERO_RESULTS') setError(status);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, mode, mapReady]);

  if (error) {
    return (
      <div className={styles.routeMapError}>
        <div>Map unavailable</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{error}</div>
      </div>
    );
  }
  const staticUrl = mapsKey && polyline
    ? buildStaticMapUrl(mapsKey, [{ polyline, mode }], '640x360')
    : null;
  return (
    <>
      <div ref={containerRef} className={styles.dayRouteMap} />
      {staticUrl && (
        <img
          src={staticUrl}
          alt={`Route from ${origin} to ${destination}`}
          className={styles.dayRouteMapPrint}
          onError={() => console.warn('Static map failed to load:', staticUrl)}
        />
      )}
    </>
  );
}

// Loosely compare two location strings — apartment numbers, zip codes, and extra
// neighborhood descriptors often differ slightly between activities at the same spot,
// so we strip those before comparing.
function normalizeLocation(loc) {
  if (!loc) return '';
  return loc
    .toLowerCase()
    .replace(/,?\s*(apt\.?|apartment|suite|ste\.?|unit|#)\s*[\w\d-]+/gi, '')
    .replace(/,\s*[a-z]{2}\s*\d{5}(-\d{4})?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function locationsEqual(a, b) {
  const na = normalizeLocation(a);
  const nb = normalizeLocation(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // If one is a prefix of the other (e.g., "305 w 50th st" vs "305 w 50th st, new york"),
  // treat them as the same place.
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  return false;
}

export function Itinerary({ event, onSave, canEdit }) {
  const { user } = useAuth();
  const isAdmin = user?.email === 'baldaufdan@gmail.com';
  const items = Array.isArray(event?.itinerary) ? event.itinerary : [];
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', date: '', time: '', location: '', notes: '', type: 'activity', url: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [suggestForm, setSuggestForm] = useState({ title: '', location: '', notes: '' });
  const [aiError, setAiError] = useState('');
  const [mapModes, setMapModes] = useState({}); // mapId -> mode override
  const [hideLodging, setHideLodging] = useState(true);
  const [travelTimes, setTravelTimes] = useState({}); // key -> { duration, distance, error }
  const travelTimeFetchRef = useRef(new Set()); // keys we've already requested
  const [exportingPdf, setExportingPdf] = useState(false);

  // Expose the latest items via a ref so async callbacks (like the map's debounced
  // zoom-save) don't write back with a stale items array and wipe newer additions.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  function getMapMode(id, defaultMode) {
    return mapModes[id] || defaultMode;
  }
  function setMapMode(id, mode) {
    setMapModes(prev => ({ ...prev, [id]: mode }));
  }

  async function handleAiPrompt() {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError('');
    setAiMessage('');
    try {
      // Convert Firestore Timestamps to YYYY-MM-DD strings for the AI
      const toDateStr = (d) => {
        if (!d) return '';
        const date = d?.toDate ? d.toDate() : new Date(d);
        if (isNaN(date)) return '';
        return date.toISOString().split('T')[0];
      };
      const eventContext = {
        title: event?.title || '',
        startDate: toDateStr(event?.startDate || event?.date),
        endDate: toDateStr(event?.endDate),
        location: event?.location || '',
        description: event?.description || '',
      };
      const resp = await fetch('/api/itinerary-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, itinerary: items, eventContext }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to reach assistant');
      console.log('[itinerary-assistant] response:', data);
      console.log('[itinerary-assistant] items JSON:', JSON.stringify(data.items, null, 2));

      // Apply the action to the itinerary
      const newItems = (data.items || []).map(it => ({
        id: it.id && it.id.trim() ? it.id : crypto.randomUUID(),
        title: it.title || '',
        date: it.date || '',
        time: it.time || '',
        location: it.location || '',
        notes: it.notes || '',
        type: it.type || 'activity',
        url: it.url || '',
        imageQuery: it.imageQuery || '',
      }));

      let next;
      if (data.action === 'replace') {
        next = newItems;
      } else if (data.action === 'merge') {
        const byId = new Map(items.map(i => [i.id, i]));
        for (const it of newItems) byId.set(it.id, { ...byId.get(it.id), ...it });
        next = Array.from(byId.values());
      } else {
        // 'add'
        next = [...items, ...newItems];
      }
      next.sort((a, b) => {
        const ad = (a.date || '') + 'T' + (a.time || '00:00');
        const bd = (b.date || '') + 'T' + (b.time || '00:00');
        return ad.localeCompare(bd);
      });
      const delta = next.length - items.length;
      console.log('[itinerary-assistant] saving items count:', next.length, 'delta:', delta);
      console.log('[itinerary-assistant] saved items:', next.map(i => ({ id: i.id, title: i.title, type: i.type, date: i.date, time: i.time })));
      await onSave({ itinerary: next });
      console.log('[itinerary-assistant] save complete');
      const countLabel = delta > 0
        ? ` (${delta} item${delta === 1 ? '' : 's'} added)`
        : delta < 0
          ? ` (${-delta} item${delta === -1 ? '' : 's'} removed)`
          : newItems.length > 0
            ? ` (${newItems.length} item${newItems.length === 1 ? '' : 's'} updated)`
            : ' — nothing changed. Try rephrasing.';
      setAiMessage((data.message || 'Updated!') + countLabel);
      setAiPrompt('');
    } catch (err) {
      setAiError(err.message || 'Something went wrong');
    } finally {
      setAiLoading(false);
    }
  }

  function startAdd() {
    setForm({ title: '', date: '', time: '', location: '', notes: '', type: 'activity', url: '' });
    setAdding(true);
    setEditingId(null);
  }

  function startEdit(item) {
    setForm({
      title: item.title || '',
      date: item.date || '',
      time: item.time || '',
      location: item.location || '',
      notes: item.notes || '',
      type: item.type || 'activity',
      url: item.url || '',
    });
    setEditingId(item.id);
    setAdding(false);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
  }

  async function saveItem() {
    if (!form.title.trim()) return;
    let next;
    if (adding) {
      const newItem = { ...form, id: crypto.randomUUID() };
      next = [...items, newItem];
    } else {
      next = items.map(i => (i.id === editingId ? { ...i, ...form } : i));
    }
    next.sort((a, b) => {
      const ad = (a.date || '') + 'T' + (a.time || '00:00');
      const bd = (b.date || '') + 'T' + (b.time || '00:00');
      return ad.localeCompare(bd);
    });
    await onSave({ itinerary: next });
    cancel();
  }

  async function deleteItem(id) {
    if (!confirm('Delete this itinerary item?')) return;
    const next = items.filter(i => i.id !== id);
    await onSave({ itinerary: next });
  }

  async function updateItemMode(id, mode) {
    const next = items.map(i => i.id === id ? { ...i, travelMode: mode } : i);
    await onSave({ itinerary: next });
  }

  async function exportPDF() {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      // Build transitions from the latest items
      const sortedDatesLocal = Object.keys(items.reduce((acc, i) => {
        acc[i.date || 'Unscheduled'] = true; return acc;
      }, {})).sort((a, b) => {
        if (a === 'Unscheduled') return 1;
        if (b === 'Unscheduled') return -1;
        return a.localeCompare(b);
      });
      const allT = [];
      for (const dateKey of sortedDatesLocal) {
        const dayItems = items
          .filter(i => (i.date || 'Unscheduled') === dateKey)
          .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        const activities = dayItems.filter(i => (i.type || 'activity') === 'activity');
        for (let i = 0; i < activities.length - 1; i++) {
          const from = activities[i];
          const to = activities[i + 1];
          const fromLoc = (extractStartEnd(from).end || from.location || '').trim();
          const toLoc = (extractStartEnd(to).start || to.location || '').trim();
          if (fromLoc && toLoc && !locationsEqual(fromLoc, toLoc)) {
            allT.push({
              from: fromLoc,
              to: toLoc,
              mode: inferTravelMode(to),
              fromItemId: from.id,
              toItemId: to.id,
              toTitle: to.title,
            });
          }
        }
      }

      // Fetch polyline for each transition via DirectionsService
      let google = window.google;
      if (!google?.maps && mapsKey) {
        google = await loadMapsAPI(mapsKey);
      }

      const polylineByFromId = {};
      const overviewPolylines = [];
      if (google?.maps) {
        const service = new google.maps.DirectionsService();
        await Promise.all(allT.map(t => new Promise(resolve => {
          service.route({
            origin: t.from,
            destination: t.to,
            travelMode: google.maps.TravelMode[GOOGLE_TRAVEL_MODE[t.mode] || 'DRIVING'],
          }, (result, status) => {
            if (status === 'OK') {
              const raw = result.routes[0]?.overview_polyline;
              const encStr = typeof raw === 'string' ? raw : (raw?.points || null);
              if (encStr) {
                polylineByFromId[t.fromItemId] = { polyline: encStr, mode: t.mode, toTitle: t.toTitle };
                overviewPolylines.push({ polyline: encStr, mode: t.mode });
              }
            }
            resolve();
          });
        })));
      }

      // Build static map URLs and attach travel-time text
      const routeMapsByFromId = {};
      for (const t of allT) {
        const p = polylineByFromId[t.fromItemId];
        const url = p && mapsKey ? buildStaticMapUrl(mapsKey, [p], '640x280') : null;
        const tt = travelTimes[travelTimeKey(t.from, t.to, t.mode)];
        routeMapsByFromId[t.fromItemId] = {
          url,
          mode: t.mode,
          toTitle: t.toTitle,
          duration: tt?.duration || null,
        };
      }
      const overviewMapUrl = overviewPolylines.length > 0 && mapsKey
        ? buildStaticMapUrl(mapsKey, overviewPolylines, '900x500')
        : null;

      // Dynamic import so the pdf lib isn't loaded unless the user clicks
      const [{ pdf }, { ItineraryPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./ItineraryPDF'),
      ]);

      const React = await import('react');
      const doc = React.createElement(ItineraryPDF, {
        event,
        items,
        overviewMapUrl,
        routeMapsByFromId,
      });

      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = (event?.title || 'itinerary').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
      a.href = url;
      a.download = `${safeTitle || 'itinerary'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setExportingPdf(false);
    }
  }

  async function updateItemView(id, { zoom, center }) {
    const current = itemsRef.current;
    // Guard: if the item no longer exists (e.g., deleted), skip.
    if (!current.some(i => i.id === id)) return;
    const next = current.map(i => {
      if (i.id !== id) return i;
      const copy = { ...i };
      if (typeof zoom === 'number') copy.travelZoom = Math.max(1, Math.min(20, zoom));
      if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
        copy.travelCenter = { lat: center.lat, lng: center.lng };
      }
      return copy;
    });
    await onSave({ itinerary: next });
  }

  async function resetItemView(id) {
    const current = itemsRef.current;
    if (!current.some(i => i.id === id)) return;
    const next = current.map(i => {
      if (i.id !== id) return i;
      const copy = { ...i };
      delete copy.travelZoom;
      delete copy.travelCenter;
      return copy;
    });
    await onSave({ itinerary: next });
  }

  // Group by date
  const groups = {};
  for (const item of items) {
    const key = item.date || 'Unscheduled';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => {
    if (a === 'Unscheduled') return 1;
    if (b === 'Unscheduled') return -1;
    return a.localeCompare(b);
  });

  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY;

  function travelTimeKey(from, to, mode) {
    return `${from}|${to}|${mode}`;
  }

  // Aligned activity-to-activity transitions (one per consecutive activity pair).
  // Same source the per-day Routes column uses, so the overview stays in sync.
  const allTransitions = [];
  for (const dateKey of sortedDates) {
    const dateItemsSorted = groups[dateKey].slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const activityItems = dateItemsSorted.filter(i => (i.type || 'activity') === 'activity');
    for (let i = 0; i < activityItems.length - 1; i++) {
      const fromItem = activityItems[i];
      const toItem = activityItems[i + 1];
      const fromLoc = (extractStartEnd(fromItem).end || fromItem.location || '').trim();
      const toLoc = (extractStartEnd(toItem).start || toItem.location || '').trim();
      if (fromLoc && toLoc && !locationsEqual(fromLoc, toLoc)) {
        allTransitions.push({
          from: fromLoc,
          to: toLoc,
          fromTitle: fromItem.title,
          toTitle: toItem.title,
          mode: inferTravelMode(toItem),
          fromItemId: fromItem.id,
          toItemId: toItem.id,
          dateKey,
        });
      }
    }
  }

  // Fetch travel time for every transition. Errors don't stick in the ref, so a
  // subsequent render (or mode change) will retry.
  const transitionFetchDep = allTransitions.map(t => travelTimeKey(t.from, t.to, t.mode)).join('\n');
  useEffect(() => {
    function fetchOne(t, isRetry = false) {
      const k = travelTimeKey(t.from, t.to, t.mode);
      if (travelTimeFetchRef.current.has(k)) return;
      travelTimeFetchRef.current.add(k);
      const url = `/api/travel-time?origin=${encodeURIComponent(t.from)}&destination=${encodeURIComponent(t.to)}&mode=${encodeURIComponent(t.mode)}`;
      fetch(url, { cache: 'no-store' })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          setTravelTimes(prev => ({
            ...prev,
            [k]: ok ? body : { error: body?.error || 'Request failed' },
          }));
          if (!ok) {
            // Allow future retries, and auto-retry once after a brief delay
            travelTimeFetchRef.current.delete(k);
            if (!isRetry) setTimeout(() => fetchOne(t, true), 2500);
          }
        })
        .catch(e => {
          setTravelTimes(prev => ({ ...prev, [k]: { error: e.message } }));
          travelTimeFetchRef.current.delete(k);
          if (!isRetry) setTimeout(() => fetchOne(t, true), 2500);
        });
    }
    for (const t of allTransitions) fetchOne(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionFetchDep]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Trip Itinerary</h3>
        <div className={styles.headerActions}>
          <button
            className={styles.lodgingToggleBtn}
            onClick={() => setHideLodging(v => !v)}
            title={hideLodging ? 'Show lodging column' : 'Hide lodging column'}
          >
            {hideLodging ? '🏨 Show lodging' : '🏨 Hide lodging'}
          </button>
          <button
            className={styles.lodgingToggleBtn}
            onClick={exportPDF}
            disabled={exportingPdf}
            title="Export itinerary as a PDF"
          >
            {exportingPdf ? '⏳ Generating…' : '⬇ Download PDF'}
          </button>
          {canEdit && !adding && !editingId && (
            <button className={styles.addBtn} onClick={startAdd}>+ Add Item</button>
          )}
        </div>
      </div>

      {allTransitions.length > 0 && mapsKey && (
        <div className={styles.overviewMapSection}>
          <div className={styles.overviewMapHeader}>
            <span className={styles.overviewMapTitle}>🗺️ Trip Route Overview</span>
            <span className={styles.overviewMapCount}>
              {allTransitions.length} {allTransitions.length === 1 ? 'route' : 'routes'}
            </span>
          </div>
          <TripOverviewMap mapsKey={mapsKey} transitions={allTransitions} />
        </div>
      )}

      {canEdit && isAdmin && (
        <div className={styles.aiBox}>
          <div className={styles.aiLabel}>
            <span className={styles.aiSparkle}>✨</span>
            Ask Claude to plan your trip
          </div>
          <div className={styles.aiRow}>
            <input
              className={styles.aiInput}
              type="text"
              placeholder='e.g., "Plan a day in Rome with 4 activities" or "Move the museum to morning"'
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleAiPrompt(); }}
              disabled={aiLoading}
            />
            <button
              className={styles.aiSendBtn}
              onClick={handleAiPrompt}
              disabled={aiLoading || !aiPrompt.trim()}
            >
              {aiLoading ? '…' : 'Send'}
            </button>
          </div>
          {aiMessage && <div className={styles.aiMessage}>{aiMessage}</div>}
          {aiError && <div className={styles.aiErrorMsg}>{aiError}</div>}
        </div>
      )}

      {(adding || editingId) && (
        <div className={styles.form}>
          <div className={styles.typeRow}>
            {[
              { key: 'activity', label: 'Activity', icon: '🎯' },
              { key: 'travel', label: 'Travel', icon: '✈️' },
              { key: 'lodging', label: 'Lodging', icon: '🏨' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                className={form.type === t.key ? styles.typeBtnActive : styles.typeBtn}
                onClick={() => setForm({ ...form, type: t.key })}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder={form.type === 'travel' ? 'Title (e.g., Flight to Barcelona)' : form.type === 'lodging' ? 'Title (e.g., Hotel Montecarlo)' : 'Title (e.g., Dinner at Le Bernardin)'}
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            autoFocus
          />
          <div className={styles.row}>
            <input
              className={styles.input}
              type="date"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
            />
            <input
              className={styles.input}
              type="time"
              value={form.time}
              onChange={e => setForm({ ...form, time: e.target.value })}
            />
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder="Location (optional)"
            value={form.location}
            onChange={e => setForm({ ...form, location: e.target.value })}
          />
          <input
            className={styles.input}
            type="url"
            placeholder="Link (optional — website or booking URL)"
            value={form.url}
            onChange={e => setForm({ ...form, url: e.target.value })}
          />
          <textarea
            className={styles.textarea}
            placeholder="Notes (optional)"
            rows={3}
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
          />
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={cancel}>Cancel</button>
            <button className={styles.saveBtn} onClick={saveItem} disabled={!form.title.trim()}>
              {adding ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Trip highlights — key activities with images */}
      {(() => {
        const highlights = items
          .filter(i => (i.type || 'activity') === 'activity' && i.title)
          .slice(0, 6);
        const lodgingHighlight = items.find(i => i.type === 'lodging' && i.title);
        if (highlights.length === 0) return null;
        const votingEnabled = !!event?.highlightsVotingEnabled;
        const isMember = !!(user && event?.members?.[user.uid]);
        const canToggle = canEdit;
        const toggleVoting = async () => {
          await onSave({ highlightsVotingEnabled: !votingEnabled });
        };
        const toggleLike = async (itemId) => {
          if (!user || !isMember) return;
          const next = itemsRef.current.map(i => {
            if (i.id !== itemId) return i;
            const likes = { ...(i.likes || {}) };
            if (likes[user.uid]) delete likes[user.uid];
            else likes[user.uid] = true;
            return { ...i, likes };
          });
          await onSave({ itinerary: next });
        };
        const voteCount = (item) => Object.keys(item.likes || {}).length;
        const userLiked = (item) => !!(user && item.likes && item.likes[user.uid]);
        return (
          <div className={styles.highlightsSection}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h4 className={styles.highlightsTitle} style={{ margin: 0 }}>Trip Highlights</h4>
              {canToggle && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={votingEnabled} onChange={toggleVoting} />
                  Let members vote on highlights
                </label>
              )}
            </div>
            <div className={styles.highlightsImages}>
              {highlights.slice(0, 4).map(item => {
                const query = encodeURIComponent(item.imageQuery || item.title);
                const count = voteCount(item);
                const liked = userLiked(item);
                return (
                  <div key={item.id} className={styles.highlightCard} style={{ position: 'relative' }}>
                    <img
                      className={styles.highlightImg}
                      src={`https://image.pollinations.ai/prompt/${query}%20travel%20photo?width=400&height=250&nologo=true&seed=${item.id.slice(0, 8)}`}
                      alt={item.title}
                      loading="lazy"
                      onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                    />
                    <div className={styles.highlightImgFallback} style={{ display: 'none' }}>
                      {(item.type || 'activity') === 'activity' ? '🎯' : item.type === 'lodging' ? '🏨' : '✈️'}
                    </div>
                    <div className={styles.highlightLabel}>{item.title}</div>
                    {votingEnabled && (
                      <button
                        type="button"
                        onClick={() => toggleLike(item.id)}
                        disabled={!isMember}
                        title={isMember ? (liked ? 'Remove your vote' : 'Vote for this highlight') : 'Members only'}
                        style={{
                          position: 'absolute',
                          top: '0.4rem',
                          right: '0.4rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: 'var(--radius-full)',
                          border: 'none',
                          background: liked ? 'rgba(239, 68, 68, 0.95)' : 'rgba(255, 255, 255, 0.9)',
                          color: liked ? '#fff' : '#111',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: isMember ? 'pointer' : 'not-allowed',
                          fontFamily: 'inherit',
                        }}
                      >
                        {liked ? '❤' : '🤍'} {count}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <ul className={styles.highlightsList}>
              {highlights.map(item => {
                const count = voteCount(item);
                const liked = userLiked(item);
                return (
                  <li key={item.id}>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                    ) : item.title}
                    {item.location && <span className={styles.highlightMeta}> — {item.location}</span>}
                    {votingEnabled && (
                      <button
                        type="button"
                        onClick={() => toggleLike(item.id)}
                        disabled={!isMember}
                        title={isMember ? (liked ? 'Remove your vote' : 'Vote for this highlight') : 'Members only'}
                        style={{
                          marginLeft: '0.5rem',
                          padding: '0.1rem 0.45rem',
                          borderRadius: 'var(--radius-full)',
                          border: '1px solid var(--color-border)',
                          background: liked ? 'rgba(239, 68, 68, 0.12)' : 'var(--color-surface)',
                          color: liked ? '#dc2626' : 'var(--color-text-secondary)',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: isMember ? 'pointer' : 'not-allowed',
                          fontFamily: 'inherit',
                        }}
                      >
                        {liked ? '❤' : '🤍'} {count}
                      </button>
                    )}
                  </li>
                );
              })}
              {lodgingHighlight && (
                <li>
                  🏨 {lodgingHighlight.url ? (
                    <a href={lodgingHighlight.url} target="_blank" rel="noopener noreferrer">{lodgingHighlight.title}</a>
                  ) : lodgingHighlight.title}
                  {lodgingHighlight.location && <span className={styles.highlightMeta}> — {lodgingHighlight.location}</span>}
                </li>
              )}
            </ul>

            {(() => {
              const suggestions = Array.isArray(event?.highlightSuggestions) ? event.highlightSuggestions : [];
              const toggleSuggestionLike = async (sid) => {
                if (!user || !isMember) return;
                const next = suggestions.map(s => {
                  if (s.id !== sid) return s;
                  const likes = { ...(s.likes || {}) };
                  if (likes[user.uid]) delete likes[user.uid];
                  else likes[user.uid] = true;
                  return { ...s, likes };
                });
                await onSave({ highlightSuggestions: next });
              };
              const dismissSuggestion = async (sid) => {
                await onSave({ highlightSuggestions: suggestions.filter(s => s.id !== sid) });
              };
              const promoteSuggestion = async (s) => {
                const newItem = {
                  id: crypto.randomUUID(),
                  title: s.title,
                  date: '',
                  time: '',
                  location: s.location || '',
                  notes: s.notes || '',
                  type: 'activity',
                  url: '',
                  imageQuery: '',
                };
                const nextItems = [...itemsRef.current, newItem];
                await onSave({
                  itinerary: nextItems,
                  highlightSuggestions: suggestions.filter(x => x.id !== s.id),
                });
              };
              const submitSuggestion = async () => {
                const title = suggestForm.title.trim();
                if (!title) return;
                const newSuggestion = {
                  id: crypto.randomUUID(),
                  title,
                  location: suggestForm.location.trim(),
                  notes: suggestForm.notes.trim(),
                  suggestedBy: user?.uid || '',
                  suggestedByName: event?.members?.[user?.uid]?.name || user?.displayName || user?.email || 'Member',
                  createdAt: new Date().toISOString(),
                  likes: {},
                };
                await onSave({ highlightSuggestions: [...suggestions, newSuggestion] });
                setSuggestForm({ title: '', location: '', notes: '' });
                setShowSuggestForm(false);
              };
              return (
                <div style={{ marginTop: '0.9rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      Member Suggestions ({suggestions.length})
                    </span>
                    {isMember && !showSuggestForm && (
                      <button
                        type="button"
                        onClick={() => setShowSuggestForm(true)}
                        style={{ padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-accent)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        + Suggest a highlight
                      </button>
                    )}
                  </div>
                  {showSuggestForm && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem', padding: '0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-alt)' }}>
                      <input
                        type="text"
                        placeholder="What should we do / see / try?"
                        value={suggestForm.title}
                        onChange={e => setSuggestForm(p => ({ ...p, title: e.target.value }))}
                        autoFocus
                        style={{ padding: '0.45rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit' }}
                      />
                      <input
                        type="text"
                        placeholder="Location (optional)"
                        value={suggestForm.location}
                        onChange={e => setSuggestForm(p => ({ ...p, location: e.target.value }))}
                        style={{ padding: '0.45rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', fontFamily: 'inherit' }}
                      />
                      <textarea
                        placeholder="Notes (optional)"
                        value={suggestForm.notes}
                        onChange={e => setSuggestForm(p => ({ ...p, notes: e.target.value }))}
                        rows={2}
                        style={{ padding: '0.45rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical' }}
                      />
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => { setShowSuggestForm(false); setSuggestForm({ title: '', location: '', notes: '' }); }}
                          style={{ padding: '0.35rem 0.9rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                        >Cancel</button>
                        <button
                          type="button"
                          onClick={submitSuggestion}
                          disabled={!suggestForm.title.trim()}
                          style={{ padding: '0.35rem 0.9rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: suggestForm.title.trim() ? 'pointer' : 'not-allowed', opacity: suggestForm.title.trim() ? 1 : 0.5, fontFamily: 'inherit' }}
                        >Add suggestion</button>
                      </div>
                    </div>
                  )}
                  {suggestions.length > 0 && (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {suggestions.map(s => {
                        const count = Object.keys(s.likes || {}).length;
                        const liked = !!(user && s.likes && s.likes[user.uid]);
                        return (
                          <li key={s.id} style={{ padding: '0.5rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text)' }}>{s.title}</div>
                              {s.location && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>📍 {s.location}</div>}
                              {s.notes && <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: '0.15rem' }}>{s.notes}</div>}
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                                Suggested by {s.suggestedByName || 'a member'}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                              {votingEnabled && (
                                <button
                                  type="button"
                                  onClick={() => toggleSuggestionLike(s.id)}
                                  disabled={!isMember}
                                  title={isMember ? (liked ? 'Remove your vote' : 'Vote for this suggestion') : 'Members only'}
                                  style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: liked ? 'rgba(239, 68, 68, 0.12)' : 'var(--color-surface)', color: liked ? '#dc2626' : 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600, cursor: isMember ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
                                >{liked ? '❤' : '🤍'} {count}</button>
                              )}
                              {canEdit && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => promoteSuggestion(s)}
                                    title="Add to itinerary"
                                    style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'var(--color-success-light)', color: 'var(--color-success)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                                  >✓ Add</button>
                                  <button
                                    type="button"
                                    onClick={() => dismissSuggestion(s.id)}
                                    title="Dismiss"
                                    style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                                  >✗</button>
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {items.length === 0 && !adding ? (
        <div className={styles.empty}>
          <p>No itinerary items yet.</p>
          {canEdit && <p className={styles.emptyHint}>Click "+ Add Item" to start planning your trip.</p>}
        </div>
      ) : (
        <div className={styles.list}>
          {sortedDates.map(dateKey => {
            const dateItems = groups[dateKey].slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
            const dateLabel = dateKey === 'Unscheduled'
              ? 'Unscheduled'
              : new Date(dateKey + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

            // Activities and lodging columns
            const activityItems = dateItems.filter(i => (i.type || 'activity') === 'activity');
            const lodgingItems = dateItems.filter(i => (i.type || 'activity') === 'lodging');
            const travelItems = dateItems.filter(i => i.type === 'travel');

            // Routes column is computed from consecutive activity pairs so each route
            // card can align from the midpoint of the "from" activity to the midpoint
            // of the "to" activity.
            const alignedTransitions = [];
            for (let i = 0; i < activityItems.length - 1; i++) {
              const fromItem = activityItems[i];
              const toItem = activityItems[i + 1];
              const fromLoc = (extractStartEnd(fromItem).end || fromItem.location || '').trim();
              const toLoc = (extractStartEnd(toItem).start || toItem.location || '').trim();
              if (fromLoc && toLoc && !locationsEqual(fromLoc, toLoc)) {
                alignedTransitions.push({
                  fromIdx: i,
                  toIdx: i + 1,
                  from: fromLoc,
                  to: toLoc,
                  fromTitle: fromItem.title,
                  toTitle: toItem.title,
                  mode: inferTravelMode(toItem),
                  zoom: typeof toItem.travelZoom === 'number' ? toItem.travelZoom : null,
                  center: toItem.travelCenter && typeof toItem.travelCenter.lat === 'number'
                    ? { lat: toItem.travelCenter.lat, lng: toItem.travelCenter.lng }
                    : null,
                  fromItemId: fromItem.id,
                  toItemId: toItem.id,
                  mapId: `aligned-route-${dateKey}-${i}`,
                });
              }
            }

            // Map each activity's id to its outbound transition (if any), so we can
            // display "travel time leaving this activity" on the card.
            const outboundByItemId = {};
            for (const t of alignedTransitions) {
              outboundByItemId[t.fromItemId] = t;
            }

            // Renders a single activity/lodging card's inner content.
            const renderItemCard = (item, color) => {
              const loc = item.location || '';
              const outbound = outboundByItemId[item.id];
              const outboundTT = outbound
                ? travelTimes[travelTimeKey(outbound.from, outbound.to, outbound.mode)]
                : null;
              const modeIconFor = (m) => (TRAVEL_MODES.find(x => x.key === m) || TRAVEL_MODES[0]).icon;
              return (
                <div className={styles.scheduleItem} style={{ borderLeftColor: color, height: '100%' }}>
                  <div className={styles.itemContent}>
                    <div className={styles.itemHeader}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.itemTitleLink}>{item.title}</a>
                      ) : (
                        <span className={styles.itemTitle}>{item.title}</span>
                      )}
                      {canEdit && (
                        <div className={styles.itemActions}>
                          <button className={styles.iconBtn} onClick={() => startEdit(item)} title="Edit">✎</button>
                          <button className={styles.iconBtn} onClick={() => deleteItem(item.id)} title="Delete">×</button>
                        </div>
                      )}
                    </div>
                    {item.time && <div className={styles.itemTime}>{new Date('2000-01-01T' + item.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>}
                    {loc && <div className={styles.itemLocation}>📍 {loc}</div>}
                    {item.notes && <div className={styles.itemNotes}>{item.notes}</div>}
                    {item.url && <div className={styles.itemUrl}><a href={item.url} target="_blank" rel="noopener noreferrer">🔗 View details</a></div>}
                    {outbound && (
                      <div className={styles.itemLeavingFooter}>
                        <span className={styles.itemLeavingIcon}>{modeIconFor(outbound.mode)}</span>
                        <span className={styles.itemLeavingText}>
                          {outboundTT?.duration
                            ? `${outboundTT.duration} to ${outbound.toTitle}`
                            : outboundTT?.error
                              ? `→ ${outbound.toTitle}`
                              : `… to ${outbound.toTitle}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            };

            // If the day has no activities or lodging, collapse to a compact
            // list of travel items instead of an empty schedule grid.
            if (activityItems.length === 0 && lodgingItems.length === 0) {
              return (
                <div key={dateKey} className={styles.dateGroup}>
                  <div className={styles.dateLabel}>{dateLabel}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {travelItems.map(item => (
                      <div key={item.id}>
                        {renderItemCard(item, '#6b7280')}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            const renderRouteCard = (t, routeIdx) => {
              const mode = t.mode;
              const hasSavedView = typeof t.zoom === 'number' && t.center;
              const ttKey = travelTimeKey(t.from, t.to, mode);
              const tt = travelTimes[ttKey];
              const ttText = tt?.duration
                ? (tt.distance ? `${tt.duration} · ${tt.distance}` : tt.duration)
                : (tt?.error ? null : '…');
              const fromNum = routeIdx * 2 + 1;
              const toNum = routeIdx * 2 + 2;
              return (
                <div className={styles.dayRoute} style={{ height: '100%' }}>
                  <div className={styles.dayRouteTravelTime}>
                    {ttText || '—'}
                  </div>
                  <div className={styles.dayRouteHeader}>
                    <span className={styles.dayRouteHeaderText} title={t.fromTitle}>{fromNum}</span>
                    <span className={styles.dayRouteArrow}>-</span>
                    <span className={styles.dayRouteHeaderText} title={t.toTitle}>{toNum}</span>
                  </div>
                  <div className={styles.modeSelectorBarCompact}>
                    <ModeSelector value={mode} onChange={m => updateItemMode(t.toItemId, m)} />
                    {hasSavedView && (
                      <button
                        type="button"
                        className={styles.zoomResetBtn}
                        onClick={() => resetItemView(t.toItemId)}
                        title="Reset map to auto-fit route"
                        aria-label="Reset map view"
                      >⟲</button>
                    )}
                  </div>
                  <div className={styles.dayRouteMapWrap} style={{ flex: '1 1 auto', height: 'auto' }}>
                    <RouteMap
                      mapsKey={mapsKey}
                      origin={t.from}
                      destination={t.to}
                      mode={mode}
                      savedZoom={t.zoom}
                      savedCenter={t.center}
                      onViewChange={view => updateItemView(t.toItemId, view)}
                    />
                  </div>
                </div>
              );
            };

            // Grid row sizing: header is auto; body rows are fixed half-row heights
            // so an activity (2 half-rows) = 2 * HALF_ROW, and a route spans 2 half-rows
            // offset by 1, giving the "start at midpoint → end at midpoint" effect.
            const HALF_ROW = 160;
            const activityCount = Math.max(activityItems.length, 1);
            const bodyRows = activityCount * 2; // activities take 2 half-rows each; routes fit between
            const gridTemplateColumns = hideLodging
              ? 'minmax(0, 1fr) minmax(0, 1.2fr)'
              : 'minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 0.9fr)';

            // Sum route durations for this day (skip routes still loading or errored).
            let totalSeconds = 0;
            let hasAnySeconds = false;
            let pending = 0;
            for (const t of alignedTransitions) {
              const tt = travelTimes[travelTimeKey(t.from, t.to, t.mode)];
              if (tt?.durationSeconds) {
                totalSeconds += tt.durationSeconds;
                hasAnySeconds = true;
              } else if (!tt?.error) {
                pending += 1;
              }
            }
            const formatTotal = (secs) => {
              const mins = Math.round(secs / 60);
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              if (h === 0) return `${m} min`;
              if (m === 0) return `${h} hr`;
              return `${h} hr ${m} min`;
            };
            const totalLabel = hasAnySeconds
              ? `${formatTotal(totalSeconds)} travel${pending > 0 ? ' (+ pending)' : ''}`
              : (alignedTransitions.length > 0 ? '… calculating travel' : null);

            return (
              <div key={dateKey} className={styles.dateGroup}>
                <div className={styles.dateLabel}>
                  {dateLabel}
                  {totalLabel && (
                    <span style={{ marginLeft: '0.6rem', fontSize: '0.72rem', fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'none', letterSpacing: 'normal' }}>
                      🚗 {totalLabel}
                    </span>
                  )}
                </div>
                <div
                  className={styles.scheduleGrid}
                  style={{
                    gridTemplateColumns,
                    gridTemplateRows: `auto repeat(${bodyRows}, ${HALF_ROW}px)`,
                  }}
                >
                  {/* Column headers */}
                  <div className={styles.scheduleColHeader} style={{ gridColumn: 1, gridRow: 1, borderBottomColor: '#6366F1', color: '#6366F1' }}>
                    <span>🎯</span> Activities
                  </div>
                  <div className={styles.scheduleColHeader} style={{ gridColumn: 2, gridRow: 1, borderBottomColor: '#0891b2', color: '#0891b2' }}>
                    <span>🚗</span> Routes
                  </div>
                  {!hideLodging && (
                    <div className={styles.scheduleColHeader} style={{ gridColumn: 3, gridRow: 1, borderBottomColor: '#d97706', color: '#d97706' }}>
                      <span>🏨</span> Lodging
                    </div>
                  )}

                  {/* Activities */}
                  {activityItems.length === 0 ? (
                    <div className={styles.scheduleEmpty} style={{ gridColumn: 1, gridRow: '2 / span 2' }}>—</div>
                  ) : (
                    activityItems.map((item, i) => (
                      <div key={item.id} style={{ gridColumn: 1, gridRow: `${2 + 2 * i} / span 2`, minHeight: 0 }}>
                        {renderItemCard(item, '#6366F1')}
                      </div>
                    ))
                  )}

                  {/* Routes (offset half-row down, aligning to midpoints of activities) */}
                  {!mapsKey ? (
                    <div className={styles.scheduleEmpty} style={{ gridColumn: 2, gridRow: '2 / span 2' }}>—</div>
                  ) : alignedTransitions.length === 0 ? (
                    <div className={styles.scheduleEmpty} style={{ gridColumn: 2, gridRow: '2 / span 2' }}>—</div>
                  ) : (
                    alignedTransitions.map((t, idx) => (
                      <div key={t.mapId} style={{ gridColumn: 2, gridRow: `${3 + 2 * t.fromIdx} / span 2`, minHeight: 0 }}>
                        {renderRouteCard(t, idx)}
                      </div>
                    ))
                  )}

                  {/* Lodging (stacked) */}
                  {!hideLodging && (
                    lodgingItems.length === 0 ? (
                      <div className={styles.scheduleEmpty} style={{ gridColumn: 3, gridRow: '2 / span 2' }}>—</div>
                    ) : (
                      lodgingItems.map((item, i) => (
                        <div key={item.id} style={{ gridColumn: 3, gridRow: `${2 + 2 * i} / span 2`, minHeight: 0 }}>
                          {renderItemCard(item, '#d97706')}
                        </div>
                      ))
                    )
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

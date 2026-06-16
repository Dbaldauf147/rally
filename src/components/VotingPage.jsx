import { useState, useMemo, useEffect, useRef } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, addMonths, isSameMonth, isSameDay, parseISO, isBefore,
} from 'date-fns';
import styles from './VotingPage.module.css';

const STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

const PARTIES = ['Democratic', 'Republican', 'Independent / Unaffiliated', 'Libertarian', 'Green', 'Other'];

// Type → display metadata for calendar/list entries.
const TYPES = {
  general:      { label: 'General election', icon: '🗳️', color: '#2563eb' },
  primary:      { label: 'Primary election', icon: '🗳️', color: '#7c3aed' },
  registration: { label: 'Registration deadline', icon: '⏰', color: '#dc2626' },
  early:        { label: 'Early voting', icon: '🕑', color: '#0891b2' },
  ballot:       { label: 'Mail ballot due', icon: '✉️', color: '#d97706' },
  local:        { label: 'Local / special election', icon: '🏛️', color: '#16a34a' },
  other:        { label: 'Other', icon: '📌', color: '#6b7280' },
};

// Dates fixed by federal law (first Tuesday after the first Monday in
// November). These are reliable nationwide; everything else (primaries,
// registration deadlines, early voting) varies by state and is user-added.
const NATIONAL_EVENTS = [
  { id: 'nat-2026', date: '2026-11-03', label: 'General Election — U.S. Midterms', type: 'general', national: true },
  { id: 'nat-2028', date: '2028-11-07', label: 'General Election — Presidential', type: 'general', national: true },
];

const LS = {
  state: 'rally.voting.state',
  party: 'rally.voting.party',
  custom: 'rally.voting.customDates',
};

function loadCustom() {
  try {
    const v = JSON.parse(localStorage.getItem(LS.custom) || '[]');
    return Array.isArray(v) ? v.filter(x => x && x.date) : [];
  } catch { return []; }
}

export function VotingPage() {
  const { user } = useAuth();
  // Seed from localStorage for a fast first paint; Firestore overrides once loaded.
  const [stateCode, setStateCode] = useState(() => localStorage.getItem(LS.state) || '');
  const [party, setParty] = useState(() => localStorage.getItem(LS.party) || '');
  const [custom, setCustom] = useState(loadCustom);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [draft, setDraft] = useState({ date: '', label: '', type: 'primary' });
  const [official, setOfficial] = useState([]);   // pulled from /api/election-info
  const [officialNote, setOfficialNote] = useState('');
  const loadedFromCloud = useRef(false);

  const stateName = (STATES.find(s => s[0] === stateCode) || [])[1] || '';

  // --- Sync with the user's account (users/{uid}.voting) ---
  // Persist a full snapshot so the three fields stay consistent.
  function persist(nextState, nextParty, nextCustom) {
    localStorage.setItem(LS.state, nextState);
    localStorage.setItem(LS.party, nextParty);
    localStorage.setItem(LS.custom, JSON.stringify(nextCustom));
    if (user?.uid) {
      setDoc(doc(db, 'users', user.uid), {
        voting: { state: nextState, party: nextParty, customDates: nextCustom },
      }, { merge: true }).catch(err => console.error('Failed to save voting prefs:', err));
    }
  }

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const v = snap.exists() ? snap.data().voting : null;
      if (v && typeof v === 'object') {
        loadedFromCloud.current = true;
        setStateCode(v.state || '');
        setParty(v.party || '');
        setCustom(Array.isArray(v.customDates) ? v.customDates.filter(x => x && x.date) : []);
      } else if (!loadedFromCloud.current) {
        // First time on this account — migrate anything saved locally up.
        loadedFromCloud.current = true;
        const ls = { state: localStorage.getItem(LS.state) || '', party: localStorage.getItem(LS.party) || '', customDates: loadCustom() };
        if (ls.state || ls.party || ls.customDates.length) {
          setDoc(doc(db, 'users', user.uid), { voting: ls }, { merge: true }).catch(() => {});
        }
      }
    });
    return unsub;
  }, [user]);

  const setStateAndSave = (v) => { setStateCode(v); persist(v, party, custom); };
  const setPartyAndSave = (v) => { setParty(v); persist(stateCode, v, custom); };

  function addCustom() {
    const date = (draft.date || '').trim();
    const label = (draft.label || '').trim();
    if (!date) return;
    const next = [...custom, { id: crypto.randomUUID(), date, label: label || TYPES[draft.type].label, type: draft.type }];
    setCustom(next);
    persist(stateCode, party, next);
    setDraft({ date: '', label: '', type: draft.type });
  }
  function removeCustom(id) {
    const next = custom.filter(c => c.id !== id);
    setCustom(next);
    persist(stateCode, party, next);
  }

  // --- Pull official elections for the selected state ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/election-info?state=${encodeURIComponent(stateCode)}`);
        const data = await res.json();
        if (cancelled) return;
        setOfficial(Array.isArray(data.elections) ? data.elections : []);
        setOfficialNote(data.needsKey ? 'needsKey' : (data.error ? 'error' : ''));
      } catch {
        if (!cancelled) { setOfficial([]); setOfficialNote('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [stateCode]);

  // All events: built-in national + official feed (deduped) + user custom.
  const events = useMemo(() => {
    const base = [...NATIONAL_EVENTS, ...official];
    const seen = new Set();
    const deduped = [];
    for (const e of base) {
      const k = `${e.date}|${e.type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(e);
    }
    return [...deduped, ...custom]
      .map(e => ({ ...e, dateObj: parseISO(e.date) }))
      .sort((a, b) => a.dateObj - b.dateObj);
  }, [official, custom]);

  const eventsByDay = useMemo(() => {
    const map = {};
    for (const e of events) {
      (map[e.date] = map[e.date] || []).push(e);
    }
    return map;
  }, [events]);

  const today = new Date();
  const upcoming = events.filter(e => !isBefore(e.dateObj, new Date(today.getFullYear(), today.getMonth(), today.getDate())));

  // Calendar grid for the current cursor month (Sunday-anchored).
  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>🗳️ Voting Calendar</h1>
          <p className={styles.subtitle}>
            Election dates{stateName ? ` for ${stateName}` : ''}{party ? ` · ${party} voter` : ''}
          </p>
        </div>
        <div className={styles.pickers}>
          <select className={styles.select} value={stateCode} onChange={e => setStateAndSave(e.target.value)}>
            <option value="">Choose your state…</option>
            {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <select className={styles.select} value={party} onChange={e => setPartyAndSave(e.target.value)}>
            <option value="">Party (optional)…</option>
            {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Official resources + party/location guidance */}
      <div className={styles.infoCard}>
        <div className={styles.infoRow}>
          <strong>Official, up-to-date info:</strong>
          <a className={styles.link} href="https://vote.gov" target="_blank" rel="noopener noreferrer">vote.gov</a>
          <span className={styles.dot}>·</span>
          <a className={styles.link} href="https://www.usa.gov/state-election-office" target="_blank" rel="noopener noreferrer">Your state's election office</a>
          {official.length > 0 && (
            <span className={styles.feedBadge}>✓ {official.length} auto-filled from official feed</span>
          )}
          {officialNote === 'needsKey' && (
            <span className={styles.feedNote}>Auto-fill of official dates is not configured yet</span>
          )}
        </div>
        {party && party.startsWith('Independent') ? (
          <p className={styles.infoNote}>
            Heads up: some states have <strong>closed primaries</strong> where unaffiliated voters can't vote in a party primary. Check your state's rules.
          </p>
        ) : party ? (
          <p className={styles.infoNote}>
            As a <strong>{party}</strong> voter{stateName ? ` in ${stateName}` : ''}, you'll typically vote in the {party} primary. Primary dates vary by state — add yours below.
          </p>
        ) : (
          <p className={styles.infoNote}>
            Pick your state and party above. The General Election date is fixed nationwide; primary, registration, and early-voting dates vary by state — add yours below.
          </p>
        )}
      </div>

      <div className={styles.layout}>
        {/* Calendar */}
        <div className={styles.calendarWrap}>
          <div className={styles.calNav}>
            <button className={styles.navBtn} onClick={() => setCursor(c => addMonths(c, -1))} aria-label="Previous month">‹</button>
            <span className={styles.calMonth}>{format(cursor, 'MMMM yyyy')}</span>
            <button className={styles.navBtn} onClick={() => setCursor(c => addMonths(c, 1))} aria-label="Next month">›</button>
            <button className={styles.todayBtn} onClick={() => setCursor(startOfMonth(new Date()))}>Today</button>
          </div>
          <div className={styles.calGrid}>
            {weekdayLabels.map(d => <div key={d} className={styles.calWeekday}>{d}</div>)}
            {gridDays.map(day => {
              const ds = format(day, 'yyyy-MM-dd');
              const evs = eventsByDay[ds] || [];
              const inMonth = isSameMonth(day, cursor);
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={ds}
                  className={`${styles.calCell}${inMonth ? '' : ` ${styles.calCellOut}`}${isToday ? ` ${styles.calCellToday}` : ''}`}
                >
                  <div className={styles.calDateNum}>{format(day, 'd')}</div>
                  {evs.map(e => (
                    <div
                      key={e.id}
                      className={styles.calChip}
                      style={{ background: `${TYPES[e.type].color}1a`, color: TYPES[e.type].color, borderColor: `${TYPES[e.type].color}55` }}
                      title={e.label}
                    >
                      <span>{TYPES[e.type].icon}</span>
                      <span className={styles.calChipText}>{e.label}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Upcoming + add */}
        <div className={styles.side}>
          <div className={styles.sideCard}>
            <div className={styles.sideTitle}>Upcoming</div>
            {upcoming.length === 0 ? (
              <div className={styles.empty}>No upcoming dates. Add your state's dates below.</div>
            ) : (
              <ul className={styles.upcomingList}>
                {upcoming.slice(0, 8).map(e => (
                  <li key={e.id} className={styles.upcomingItem}>
                    <span className={styles.upDot} style={{ background: TYPES[e.type].color }} />
                    <div className={styles.upBody}>
                      <div className={styles.upLabel}>{TYPES[e.type].icon} {e.label}</div>
                      <div className={styles.upMeta}>
                        {format(e.dateObj, 'EEE, MMM d, yyyy')}
                        {!e.national && !e.official && (
                          <button className={styles.removeBtn} onClick={() => removeCustom(e.id)} title="Remove">×</button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.sideCard}>
            <div className={styles.sideTitle}>Add a voting date</div>
            <div className={styles.addForm}>
              <input className={styles.input} type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} />
              <select className={styles.input} value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}>
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
              <input className={styles.input} type="text" placeholder="Label (optional)" value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
              <button className={styles.addBtn} onClick={addCustom} disabled={!draft.date}>+ Add date</button>
            </div>
            <p className={styles.disclaimer}>
              Dates you add are saved on this device. Always confirm with your official state election office.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

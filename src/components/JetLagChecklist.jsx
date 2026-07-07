import { useMemo, useState, useEffect } from 'react';
import styles from './JetLagChecklist.module.css';

// A jet-lag prep checklist that lives on the Travel List page. The core idea is
// that you're re-timing your body clock, and the advice for light and melatonin
// FLIPS with travel direction — so two controls at the top tailor what shows.
//
// Item.dir: 'east' | 'west' | null (null applies to both directions).
// Phase.optionalWhenShort: dim the phase when the trip is short (1–3 days).
const PHASES = [
  {
    id: 'p00',
    name: 'Decide your strategy',
    items: [
      { id: 'j-strat-direction', label: 'Note your direction and count the time zones crossed.', note: 'East = advance your clock, harder. West = delay it, easier. Expect ~1 zone of adjustment per day.' },
      { id: 'j-strat-length', label: 'Weigh the trip length.', note: 'Short 1–3 day trips — consider staying on home time. 4+ days — commit to shifting fully.' },
      { id: 'j-strat-app', label: 'Optional: set up a jet-lag app for a personalized schedule.', note: 'e.g. Timeshifter.' },
    ],
  },
  {
    id: 'p01',
    name: '2–3 days before you fly',
    optionalWhenShort: true,
    items: [
      { id: 'j-pre-shift-east', dir: 'east', label: 'Shift bedtime & wake time 30–60 min earlier each day.' },
      { id: 'j-pre-shift-west', dir: 'west', label: 'Shift bedtime & wake time 30–60 min later each day.' },
      { id: 'j-pre-light-east', dir: 'east', label: 'Get bright light immediately on waking.' },
      { id: 'j-pre-light-west', dir: 'west', label: 'Seek bright light in the late afternoon / evening.' },
      { id: 'j-pre-rested', label: "Arrive rested — don't board carrying a sleep debt.", note: 'The classic mistake is staying up late packing, then starting the trip already deprived.' },
      { id: 'j-pre-kit', label: 'Pack the kit: low-dose melatonin (0.5–3 mg), eye mask, ear plugs, sunglasses.' },
    ],
  },
  {
    id: 'p02',
    name: 'On the plane',
    items: [
      { id: 'j-plane-watch', label: 'Set your watch to destination time the moment you board — then live by it.' },
      { id: 'j-plane-sleep-east', dir: 'east', label: "If it's night at your destination: sleep. Eye mask, ear plugs, no screens, skip the meal." },
      { id: 'j-plane-awake-west', dir: 'west', label: "If it's day at your destination: stay awake, keep light on, move around." },
      { id: 'j-plane-alcohol', label: 'No alcohol.', note: 'It fragments sleep, suppresses REM and dehydrates you.' },
      { id: 'j-plane-caffeine', label: 'Use caffeine strategically, not by habit.', note: '~5–6 hr half-life — a 4pm coffee is still half-strength at 10pm.' },
      { id: 'j-plane-hydrate', label: 'Hydrate aggressively — cabin air is very dry.' },
    ],
  },
  {
    id: 'p03',
    name: 'On arrival, day one',
    items: [
      { id: 'j-arr-light-east', dir: 'east', label: 'Get outside into bright light from mid-morning on.', note: 'After a big jump on little sleep, wear sunglasses the first 1–2 hrs, then seek light.' },
      { id: 'j-arr-light-west', dir: 'west', label: 'Seek bright light in the late afternoon / evening.' },
      { id: 'j-arr-meals', label: 'Eat meals on the local schedule, starting today.' },
      { id: 'j-arr-exercise', label: 'Get morning outdoor exercise if you can — light plus movement resets two clocks at once.' },
      { id: 'j-arr-nap', label: 'Nap only if truly needed: 20–25 min, before 2–3 pm, with an alarm.', note: 'Longer or later drains the sleep pressure you need tonight.' },
      { id: 'j-arr-melatonin-east', dir: 'east', label: 'Take 0.5–1 mg melatonin about 30 min–2 hr before target bedtime.' },
      { id: 'j-arr-bedtime', label: 'Push through to a reasonable local bedtime (~9–10 pm) — don’t collapse at 6 pm.' },
      { id: 'j-arr-cool', label: 'Sleep cool (~65°F / 18°C) and dark; a warm shower beforehand helps you cool down.' },
    ],
  },
  {
    id: 'p04',
    name: 'The following days',
    optionalWhenShort: true,
    items: [
      { id: 'j-days-repeat-east', dir: 'east', label: 'Repeat the pattern daily: morning light, evening melatonin.' },
      { id: 'j-days-repeat-west', dir: 'west', label: 'Repeat the pattern daily: afternoon/evening light, morning light avoided.' },
      { id: 'j-days-meals', label: 'Keep meal times consistent with local time.' },
      { id: 'j-days-taper', label: 'Taper off melatonin after 3–5 nights.' },
      { id: 'j-days-adjust', label: 'Expect full adjustment at roughly one time zone per day.' },
    ],
  },
];

const DIRECTIONS = [
  { key: 'east', label: 'Eastbound' },
  { key: 'west', label: 'Westbound' },
  { key: 'both', label: 'Show both' },
];
const STAYS = [
  { key: 'short', label: 'Short (1–3 days)' },
  { key: 'longer', label: 'Longer (4+ days)' },
];

const STORE_KEY = 'rally.jetLag.v1';

// An item is visible for the current direction filter unless it's tagged for the
// other direction. Untagged items always show.
function itemVisible(item, direction) {
  if (direction === 'both' || !item.dir) return true;
  return item.dir === direction;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        checked: s && typeof s.checked === 'object' && s.checked ? s.checked : {},
        direction: DIRECTIONS.some((d) => d.key === s?.direction) ? s.direction : 'both',
        stay: STAYS.some((v) => v.key === s?.stay) ? s.stay : 'longer',
      };
    }
  } catch { /* ignore */ }
  return { checked: {}, direction: 'both', stay: 'longer' };
}

export function JetLagChecklist() {
  const [checked, setChecked] = useState(() => loadState().checked);
  const [direction, setDirection] = useState(() => loadState().direction);
  const [stay, setStay] = useState(() => loadState().stay);

  // Persist checked items + both control values so progress survives reloads.
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ checked, direction, stay })); } catch { /* ignore */ }
  }, [checked, direction, stay]);

  const toggle = (id) => setChecked((c) => ({ ...c, [id]: !c[id] }));
  const reset = () => setChecked({});

  // Progress reflects only the currently VISIBLE items (respect direction filter).
  const { total, done } = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const phase of PHASES) {
      for (const item of phase.items) {
        if (!itemVisible(item, direction)) continue;
        total++;
        if (checked[item.id]) done++;
      }
    }
    return { total, done };
  }, [checked, direction]);

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isShort = stay === 'short';

  return (
    <section className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>Jet Lag</h2>
        <div className={styles.count}>{done} / {total} done</div>
      </div>
      <p className={styles.subtitle}>
        Re-time your body clock. Light and melatonin timing flips with your travel
        direction, so set the two controls below to tailor the plan.
      </p>

      <div className={styles.controls}>
        <div className={styles.control}>
          <span className={styles.controlLabel}>Direction</span>
          <div className={styles.seg} role="group" aria-label="Travel direction">
            {DIRECTIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                className={`${styles.segBtn} ${direction === d.key ? styles.segBtnActive : ''}`}
                aria-pressed={direction === d.key}
                onClick={() => setDirection(d.key)}
              >{d.label}</button>
            ))}
          </div>
        </div>
        <div className={styles.control}>
          <span className={styles.controlLabel}>Length of stay</span>
          <div className={styles.seg} role="group" aria-label="Length of stay">
            {STAYS.map((v) => (
              <button
                key={v.key}
                type="button"
                className={`${styles.segBtn} ${stay === v.key ? styles.segBtnActive : ''}`}
                aria-pressed={stay === v.key}
                onClick={() => setStay(v.key)}
              >{v.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.progressRow}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.progressText}>{pct}%</span>
        <button type="button" className={styles.resetBtn} onClick={reset}>Reset</button>
      </div>

      {isShort && (
        <div className={styles.callout}>
          <strong>Short trip strategy — consider not adjusting at all.</strong>{' '}
          For 1–3 days across several zones, fully shifting and re-shifting on return
          doubles the cost. Where you can, stay on home time and schedule important
          things for when you'd naturally be alert.
        </div>
      )}

      {PHASES.map((phase) => {
        const dim = isShort && phase.optionalWhenShort;
        const visibleItems = phase.items.filter((it) => itemVisible(it, direction));
        if (visibleItems.length === 0) return null;
        return (
          <div key={phase.id} className={`${styles.phase} ${dim ? styles.phaseDim : ''}`}>
            <div className={styles.phaseHead}>
              <span className={styles.phaseName}>{phase.name}</span>
              {dim && <span className={styles.optionalTag}>optional</span>}
            </div>
            {visibleItems.map((item) => (
              <label key={item.id} className={styles.item}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={!!checked[item.id]}
                  onChange={() => toggle(item.id)}
                />
                <div className={styles.itemBody}>
                  <div className={`${styles.itemLabel} ${checked[item.id] ? styles.itemLabelChecked : ''}`}>
                    {item.label}
                    {item.dir === 'east' && <span className={styles.dirBadge}>East ↗</span>}
                    {item.dir === 'west' && <span className={styles.dirBadge}>West ↘</span>}
                  </div>
                  {item.note && <div className={styles.itemNote}>{item.note}</div>}
                </div>
              </label>
            ))}
          </div>
        );
      })}

      <div className={styles.refCard}>
        <div className={styles.refCol}>
          <div className={styles.refHead}>Eastbound ↗ <span className={styles.refSub}>(advance clock, harder)</span></div>
          <ul className={styles.refList}>
            <li>Morning light, avoid evening light</li>
            <li>Sunglasses first 1–2 hrs after a big jump</li>
            <li>Melatonin in the evening</li>
            <li>Pre-adjust earlier</li>
          </ul>
        </div>
        <div className={styles.refCol}>
          <div className={styles.refHead}>Westbound ↘ <span className={styles.refSub}>(delay clock, easier)</span></div>
          <ul className={styles.refList}>
            <li>Afternoon/evening light, avoid early-morning light</li>
            <li>Push to stay up</li>
            <li>Less melatonin needed</li>
            <li>Pre-adjust later</li>
          </ul>
        </div>
      </div>

      <p className={styles.disclaimer}>
        Practical guidance, not medical advice. Melatonin and light timing can interact
        with some conditions and medications — check with a clinician if that applies to you.
      </p>
    </section>
  );
}

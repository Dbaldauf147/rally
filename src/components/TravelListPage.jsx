import { useMemo, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './TravelListPage.module.css';

const SECTIONS = [
  {
    name: 'All travel',
    items: [
      { label: 'Empty coffee filter', defaultChecked: true },
      { label: 'Charge phone', defaultChecked: true },
      { label: 'Charge phone backup battery charger', defaultChecked: true },
      { label: 'Take out trash', defaultChecked: true },
      { label: 'Do the dishes', defaultChecked: true },
      { label: 'Turn off AC', defaultChecked: true },
      { label: 'Check fridge for things that will go bad - put fruit or veggies in the fridge', defaultChecked: true },
      { label: 'Rent is due?', note: 'no', defaultChecked: true },
      { label: 'Water plants if needed', defaultChecked: true },
      { label: 'Put PTO away message on email - Schedule to auto turn off', defaultChecked: true },
      { label: 'Check morning meetings for the day you get back', defaultChecked: true },
      { label: 'Kill work alarm', defaultChecked: true },
      { label: 'Take Hunterspoint train if you are traveling on a weekday', defaultChecked: true },
      { label: 'Stretch', defaultChecked: true },
      { label: 'Weigh yourself', defaultChecked: true },
      { label: 'Make sure no fruit is left out', defaultChecked: true },
      { label: 'Leave the windows open', defaultChecked: true },
      { label: 'Leave time? / Change wake up alarm', note: 'Leave at', defaultChecked: true },
    ],
  },
  {
    name: 'Suitcase',
    items: [
      { label: 'Check weather', defaultChecked: true },
      {
        label: 'Pack clothes in bag',
        isGroup: true,
        children: [
          { label: '2 pairs of underwear', note: '7 for a long trip?', defaultChecked: true },
          { label: '2 socks', note: '7 for a long trip?', defaultChecked: true },
          { label: '2 shirts', note: '7 for a long trip?', defaultChecked: false },
          { label: '0.5 sweaters', note: '2 for a long trip?', defaultChecked: false },
          { label: 'Winter hat', defaultChecked: true },
          { label: 'Shorts / Pants', note: '2 for a long trip?', defaultChecked: true },
          { label: 'Workout clothes / shoes for hotel', defaultChecked: false },
          { label: 'Button down work / going out', defaultChecked: false },
          { label: 'Going out shoes', defaultChecked: true },
          { label: 'Sandals', defaultChecked: true },
          { label: 'Dirty clothes bag', defaultChecked: true },
          { label: 'Tiny leg pillow for sleeping', defaultChecked: true },
          { label: 'Bathing suit(s)', defaultChecked: true },
          { label: 'PT stuff', defaultChecked: true },
        ],
      },
      {
        label: 'Toiletry bag (toothbrush, floss, toothpaste, deodorant)',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Nail clippers, clip nails', defaultChecked: true },
          { label: 'Sunscreen', defaultChecked: false },
          { label: 'Clip toe nails', defaultChecked: true },
          { label: 'Smooth moves tea', defaultChecked: true },
          { label: 'Monoxidil', defaultChecked: true },
          { label: 'Mouth guard', defaultChecked: false },
          { label: 'Hair gel', defaultChecked: true },
          { label: 'Use ear cream', defaultChecked: true },
          { label: 'Trim beard, beard trimmer', defaultChecked: true },
          { label: 'Buzzer — empty before you leave', defaultChecked: true },
          { label: 'Medications / things to treat your pain', defaultChecked: true },
          { label: 'Anti-bug stuff', defaultChecked: true },
          { label: 'Travel bidet (charge ahead of time)', defaultChecked: true },
        ],
      },
      {
        label: 'Weed, shrooms, candy',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Plastic bag for drugs', defaultChecked: true },
        ],
      },
      {
        label: 'Gift(s) for the person you are visiting',
        isGroup: true,
        children: [
          { label: 'Katies ring package', defaultChecked: false },
        ],
      },
      { label: 'Plan a surprise', defaultChecked: true },
      { label: 'Things to bring home for the people you will be seeing', defaultChecked: true },
    ],
  },
  {
    name: 'Backpack',
    items: [
      {
        label: 'Front zipper',
        isGroup: true,
        children: [
          { label: 'Tide pen', defaultChecked: true },
          { label: 'Travel tissues', defaultChecked: true },
          { label: 'Creotine', defaultChecked: true },
        ],
      },
      {
        label: 'Front pocket',
        isGroup: true,
        children: [
          { label: 'Protein bar', defaultChecked: true },
          { label: 'Sunglasses', defaultChecked: true },
          { label: 'Phone charger', defaultChecked: true },
          { label: 'Ear plugs?', defaultChecked: true },
          { label: 'Work phone', defaultChecked: true },
          { label: 'Portable battery charger', defaultChecked: true },
          { label: 'Wireless headphones for work calls', defaultChecked: true },
          { label: 'Vitamins and fiber pills', defaultChecked: true },
          { label: 'Pack snacks', note: 'Nuts, seeds', defaultChecked: true },
        ],
      },
      {
        label: 'Middle pocket',
        isGroup: true,
        children: [
          { label: 'Hand sanitizer', defaultChecked: true },
          { label: 'Gum', defaultChecked: true },
          { label: 'Deodorant', defaultChecked: true },
          { label: 'Noise cancelling headphones', defaultChecked: true },
          { label: 'Aurora ring charger', defaultChecked: true },
        ],
      },
      {
        label: 'Largest pocket',
        isGroup: true,
        children: [
          { label: 'Laptop', defaultChecked: true },
          { label: 'Book(s)', defaultChecked: true },
          { label: 'Laptop charger', defaultChecked: false },
          { label: 'Mouse', defaultChecked: false },
          { label: 'Mouse USB', defaultChecked: false },
          { label: 'Work notepad', defaultChecked: false },
        ],
      },
      { label: 'Empty travel water bottle — fill it up in the airport', defaultChecked: true },
    ],
  },
  {
    name: 'General',
    items: [
      { label: 'Check take-home reminders in phone', defaultChecked: false },
      { label: 'Phone', defaultChecked: false },
    ],
  },
  {
    name: 'Formal Event',
    items: [
      { label: 'Watch', defaultChecked: false },
      { label: 'Belt', defaultChecked: false },
      { label: 'Tie', defaultChecked: false },
      { label: 'Jacket', defaultChecked: false },
      { label: 'Dress shirts', defaultChecked: false },
      { label: 'Dress pants', defaultChecked: false },
      { label: 'Dress shoes', defaultChecked: false },
    ],
  },
  {
    name: 'Boat only',
    items: [
      { label: 'Backpack', defaultChecked: false },
      { label: 'Sunscreen', defaultChecked: false },
      { label: 'Rain coat?', defaultChecked: false },
      { label: 'Lip balm', defaultChecked: false },
      { label: 'Sunglasses', defaultChecked: false },
      { label: 'Fan for sleeping', defaultChecked: false },
      { label: 'Drugs', defaultChecked: false },
      { label: 'Speaker', defaultChecked: false },
      { label: 'Check bring-on-the-boat reminder', defaultChecked: false },
    ],
  },
  {
    name: 'Flying only',
    items: [
      { label: 'Passport', note: 'Expires on 8/29/2026 (you can only renew online if it’s within one year)', defaultChecked: false },
      { label: 'Validate travel visa requirements, confirm yours is approved and up to date', defaultChecked: false },
      { label: 'Check into the app of your airline', defaultChecked: false },
      { label: 'International day pass for your phone?', note: 'Look it up. I think it’s $10 per day.', defaultChecked: false },
      { label: 'Bring charger adapter for international', defaultChecked: false },
      { label: 'Non-sweat shirt?', defaultChecked: false },
      { label: 'Download languages', defaultChecked: false },
      { label: 'Download maps', defaultChecked: false },
      { label: 'Add TSA pre-check', defaultChecked: false },
      { label: 'Length of the flight', defaultChecked: false },
      { label: 'Light sweater for the airplane', defaultChecked: false },
      { label: 'Download sheets offline to work on for work', defaultChecked: false },
      { label: 'Confirm no drugs are in your bag / jackets', defaultChecked: false },
      { label: 'iPad', defaultChecked: false },
      { label: 'Deck of cards?', defaultChecked: false },
      { label: 'Rolling carryon', defaultChecked: false },
      { label: 'Check the rental car leg room', defaultChecked: true },
      { label: 'Speakers', defaultChecked: true },
      { label: 'Eye mask — add to backpack', defaultChecked: true },
      { label: 'Reading light', defaultChecked: true },
      { label: 'Benadryl for red-eye flights', defaultChecked: true },
      { label: 'Cord that plugs into the seat TVs so you can watch shows/movies', defaultChecked: true },
      {
        label: 'Download episodes of a show you want to watch or work videos / content you need to review',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Trip there', defaultChecked: true },
          { label: 'Trip back', defaultChecked: true },
        ],
      },
      {
        label: 'Download podcasts',
        isGroup: true,
        defaultChecked: true,
        children: [
          { label: 'Trip there', defaultChecked: true },
          { label: 'Trip back', defaultChecked: true },
        ],
      },
      { label: 'Download sudoku', defaultChecked: true },
    ],
  },
];

function buildKey(sectionName, path) {
  return `${sectionName}::${path.join('>')}`;
}

function flattenItems(section) {
  const out = [];
  section.items.forEach((item, i) => {
    out.push({ key: buildKey(section.name, [i]), item, path: [i] });
    if (item.children) {
      item.children.forEach((child, j) => {
        out.push({ key: buildKey(section.name, [i, j]), item: child, path: [i, j], isChild: true });
      });
    }
  });
  return out;
}

function defaultChecked() {
  const state = {};
  SECTIONS.forEach((section) => {
    flattenItems(section).forEach(({ key, item }) => {
      state[key] = !!item.defaultChecked;
    });
  });
  return state;
}

const STORAGE_KEY = 'rally.travelList.v1';
const META_KEY = 'rally.travelList.meta.v1';
const OPEN_KEY = 'rally.travelList.open.v1';

function loadStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function TravelListPage() {
  const { user } = useAuth();

  const initial = useMemo(() => defaultChecked(), []);
  const [checked, setChecked] = useState(() => loadStored(STORAGE_KEY, initial));
  const [meta, setMeta] = useState(() => loadStored(META_KEY, { leaveDate: '', returnDate: '', days: '' }));
  const [open, setOpen] = useState(() => {
    const defaults = Object.fromEntries(SECTIONS.map((s) => [s.name, true]));
    return loadStored(OPEN_KEY, defaults);
  });

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(checked)); }, [checked]);
  useEffect(() => { localStorage.setItem(META_KEY, JSON.stringify(meta)); }, [meta]);
  useEffect(() => { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); }, [open]);

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  const allFlat = SECTIONS.flatMap(flattenItems);
  const totalItems = allFlat.filter(({ item }) => !item.children).length;
  const checkedItems = allFlat.filter(({ key, item }) => !item.children && checked[key]).length;

  const toggle = (key) => setChecked((s) => ({ ...s, [key]: !s[key] }));
  const setSectionOpen = (name) => setOpen((o) => ({ ...o, [name]: !o[name] }));

  const checkAll = () => {
    const next = {};
    allFlat.forEach(({ key, item }) => { if (!item.children) next[key] = true; });
    setChecked((prev) => ({ ...prev, ...next }));
  };
  const uncheckAll = () => {
    const next = {};
    allFlat.forEach(({ key, item }) => { if (!item.children) next[key] = false; });
    setChecked((prev) => ({ ...prev, ...next }));
  };
  const resetDefaults = () => {
    if (!confirm('Reset all checks to defaults?')) return;
    setChecked(defaultChecked());
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Travel List</h1>
        <div className={styles.progress}>{checkedItems} / {totalItems} packed</div>
      </div>
      <p className={styles.subtitle}>Your master packing & pre-trip checklist.</p>

      <div className={styles.meta}>
        <label className={styles.metaField}>
          <span className={styles.metaLabel}>Leave date</span>
          <input
            className={styles.metaInput}
            type="date"
            value={meta.leaveDate}
            onChange={(e) => setMeta((m) => ({ ...m, leaveDate: e.target.value }))}
          />
        </label>
        <label className={styles.metaField}>
          <span className={styles.metaLabel}>Return date</span>
          <input
            className={styles.metaInput}
            type="date"
            value={meta.returnDate}
            onChange={(e) => setMeta((m) => ({ ...m, returnDate: e.target.value }))}
          />
        </label>
        <label className={styles.metaField}>
          <span className={styles.metaLabel}>Days</span>
          <input
            className={styles.metaInput}
            type="number"
            min="0"
            value={meta.days}
            onChange={(e) => setMeta((m) => ({ ...m, days: e.target.value }))}
          />
        </label>
      </div>

      <div className={styles.toolbar}>
        <button className={styles.btn} onClick={checkAll}>Check all</button>
        <button className={styles.btn} onClick={uncheckAll}>Uncheck all</button>
        <button className={`${styles.btn} ${styles.btnDanger}`} onClick={resetDefaults}>Reset to defaults</button>
      </div>

      {SECTIONS.map((section) => {
        const flat = flattenItems(section);
        const leafTotal = flat.filter(({ item }) => !item.children).length;
        const leafDone = flat.filter(({ key, item }) => !item.children && checked[key]).length;
        const isOpen = open[section.name];
        return (
          <div key={section.name} className={styles.section}>
            <div className={styles.sectionHeader} onClick={() => setSectionOpen(section.name)}>
              <div className={styles.sectionTitle}>
                <span className={`${styles.caret} ${isOpen ? styles.caretOpen : ''}`}>▶</span>
                {section.name}
              </div>
              <span className={styles.sectionCount}>{leafDone} / {leafTotal}</span>
            </div>
            {isOpen && (
              <div className={styles.sectionBody}>
                {section.items.map((item, i) => {
                  const key = buildKey(section.name, [i]);
                  const hasChildren = !!item.children;
                  return (
                    <div key={key}>
                      <label className={`${styles.item} ${item.isGroup ? styles.itemGroup : ''}`}>
                        {!hasChildren && (
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={!!checked[key]}
                            onChange={() => toggle(key)}
                          />
                        )}
                        {hasChildren && <span className={styles.checkbox} style={{ background: 'transparent' }} />}
                        <div className={styles.itemBody}>
                          <div className={`${styles.itemLabel} ${!hasChildren && checked[key] ? styles.itemLabelChecked : ''}`}>
                            {item.label}
                          </div>
                          {item.note && <div className={styles.itemNote}>{item.note}</div>}
                        </div>
                      </label>
                      {hasChildren && item.children.map((child, j) => {
                        const childKey = buildKey(section.name, [i, j]);
                        return (
                          <label key={childKey} className={`${styles.item} ${styles.itemChild}`}>
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={!!checked[childKey]}
                              onChange={() => toggle(childKey)}
                            />
                            <div className={styles.itemBody}>
                              <div className={`${styles.itemLabel} ${checked[childKey] ? styles.itemLabelChecked : ''}`}>
                                {child.label}
                              </div>
                              {child.note && <div className={styles.itemNote}>{child.note}</div>}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

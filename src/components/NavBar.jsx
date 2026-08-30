import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getPinnedTrips, subscribePins, togglePin } from '../pinnedTrips';
import { usePagePrivacy } from '../lib/pagePrivacyContext';
import { pageKey } from '../lib/pagePrivacy';
import styles from './NavBar.module.css';

const OWNER_EMAIL = 'baldaufdan@gmail.com';

// Owner-only tools tucked behind the gear menu rather than the main links.
// The menu shows whenever at least one of its items does, so opening any of
// these up later is a matter of dropping its ownerOnly flag.
const GEAR_ITEMS = [
  { to: '/recurring', label: 'Repeating', ownerOnly: true },
  { to: '/holidays', label: 'Holidays', ownerOnly: true },
  { to: '/admin', label: 'Admin', ownerOnly: true },
];

// The main sidebar links, as data so the owner-only and hidden-page filters
// can both apply without repeating a condition per link.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/calendar', label: 'Rally Calendar' },
  { to: '/plans', label: 'Plans' },
  { to: '/voting', label: 'Voting' },
  { to: '/friends', label: 'Friends' },
  { to: '/expenses', label: 'Trip Expenses' },
  { to: '/reachout', label: 'Reach Out', ownerOnly: true },
  { to: '/sports', label: 'Sports', ownerOnly: true },
  { to: '/wedding', label: 'Wedding', ownerOnly: true },
  { to: '/travel-list', label: 'Travel List', ownerOnly: true },
  { to: '/pto', label: 'PTO', ownerOnly: true },
];

export function NavBar() {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);
  const [pinnedTrips, setPinnedTrips] = useState(getPinnedTrips);
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef(null);
  const isOwner = user?.email === OWNER_EMAIL;
  const privatePages = usePagePrivacy();
  // The owner keeps every link, hidden pages included — otherwise there'd be
  // no way back to a page to turn it visible again.
  const hidden = isOwner || !privatePages ? {} : privatePages;
  const allowed = (it) => (!it.ownerOnly || isOwner) && !hidden[pageKey(it.to)];
  const gearItems = GEAR_ITEMS.filter(allowed);
  const navItems = NAV_ITEMS.filter(allowed);

  useEffect(() => subscribePins(user?.uid, setPinnedTrips), [user]);

  // The sidebar is fixed, so page content needs padding to clear it. Only
  // applies above the phone breakpoint — see index.css.
  useEffect(() => {
    document.body.classList.add('has-sidebar');
    return () => document.body.classList.remove('has-sidebar');
  }, []);

  // Close the gear menu on outside click or Escape.
  useEffect(() => {
    if (!gearOpen) return;
    const onDown = (e) => { if (gearRef.current && !gearRef.current.contains(e.target)) setGearOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setGearOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [gearOpen]);

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.logo}>Rally</NavLink>
        <div className={styles.links}>
          {navItems.map(it => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) => isActive ? styles.linkActive : styles.link}
            >{it.label}</NavLink>
          ))}
          {pinnedTrips.map(t => (
            <span key={t.id} className={styles.pinnedWrap}>
              <NavLink
                to={`/event/${t.id}`}
                className={({ isActive }) => isActive ? styles.linkActive : styles.link}
                title={t.title}
              >
                📌 {t.title}
              </NavLink>
              <button
                type="button"
                className={styles.pinnedUnpin}
                title="Unpin from menu"
                aria-label={`Unpin ${t.title}`}
                onClick={() => togglePin(user?.uid, t)}
              >×</button>
            </span>
          ))}
        </div>
        <div className={styles.right}>
          {gearItems.length > 0 && (
            <div className={styles.gearWrap} ref={gearRef}>
              <button
                type="button"
                className={styles.gearBtn}
                onClick={() => setGearOpen(v => !v)}
                aria-haspopup="menu"
                aria-expanded={gearOpen}
                aria-label="Settings"
                title="Settings"
              >⚙️</button>
              {gearOpen && (
                <div className={styles.gearMenu} role="menu">
                  {gearItems.map(it => (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      role="menuitem"
                      onClick={() => setGearOpen(false)}
                      className={({ isActive }) => isActive ? styles.gearItemActive : styles.gearItem}
                    >{it.label}</NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className={styles.userName}
            onClick={() => setShowEmail(v => !v)}
            title={showEmail ? 'Hide email' : 'Show email'}
          >
            {showEmail ? (user?.email || '—') : (user?.displayName || user?.email)}
          </button>
          <button className={styles.logoutBtn} onClick={async () => { await logOut(); navigate('/login'); }}>Sign out</button>
        </div>
      </div>
    </nav>
  );
}

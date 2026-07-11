import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getPinnedTrips, subscribePins, togglePin } from '../pinnedTrips';
import styles from './NavBar.module.css';

const OWNER_EMAIL = 'baldaufdan@gmail.com';

// Owner-only tools tucked behind the gear menu.
const GEAR_ITEMS = [
  { to: '/holidays', label: 'Holidays' },
  { to: '/admin', label: 'Admin' },
];

export function NavBar() {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);
  const [pinnedTrips, setPinnedTrips] = useState(getPinnedTrips);
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef(null);
  const isOwner = user?.email === OWNER_EMAIL;

  useEffect(() => subscribePins(user?.uid, setPinnedTrips), [user]);

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
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Dashboard</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Rally Calendar</NavLink>
          <NavLink to="/plans" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Plans</NavLink>
          <NavLink to="/voting" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Voting</NavLink>
          <NavLink to="/friends" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Friends</NavLink>
          {isOwner && (
            <NavLink to="/reachout" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Reach Out</NavLink>
          )}
          {isOwner && (
            <NavLink to="/wedding" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Wedding</NavLink>
          )}
          {isOwner && (
            <NavLink to="/travel-list" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Travel List</NavLink>
          )}
          {isOwner && (
            <NavLink to="/pto" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>PTO</NavLink>
          )}
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
          {isOwner && (
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
                  {GEAR_ITEMS.map(it => (
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

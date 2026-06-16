import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getPinnedTrips, subscribePins, togglePin } from '../pinnedTrips';
import styles from './NavBar.module.css';

export function NavBar() {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);
  const [pinnedTrips, setPinnedTrips] = useState(getPinnedTrips);

  useEffect(() => subscribePins(setPinnedTrips), []);

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.logo}>Rally</NavLink>
        <div className={styles.links}>
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Dashboard</NavLink>
          <NavLink to="/today" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Today</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Calendar</NavLink>
          <NavLink to="/plans" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Plans</NavLink>
          <NavLink to="/voting" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Voting</NavLink>
          <NavLink to="/friends" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Friends</NavLink>
          {user?.email === 'baldaufdan@gmail.com' && (
            <NavLink to="/wedding" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Wedding</NavLink>
          )}
          {user?.email === 'baldaufdan@gmail.com' && (
            <NavLink to="/travel-list" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Travel List</NavLink>
          )}
          {user?.email === 'baldaufdan@gmail.com' && (
            <NavLink to="/holidays" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Holidays</NavLink>
          )}
          {user?.email === 'baldaufdan@gmail.com' && (
            <NavLink to="/pto" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>PTO</NavLink>
          )}
          {user?.email === 'baldaufdan@gmail.com' && (
            <NavLink to="/admin" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Admin</NavLink>
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
                onClick={() => togglePin(t)}
              >×</button>
            </span>
          ))}
        </div>
        <div className={styles.right}>
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

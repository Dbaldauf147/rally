import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './NavBar.module.css';

export function NavBar() {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.logo}>Rally</NavLink>
        <div className={styles.links}>
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Dashboard</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Calendar</NavLink>
          <NavLink to="/plans" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Plans</NavLink>
          <NavLink to="/friends" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Friends</NavLink>
          {user?.email === 'baldaufdan@gmail.com' && (
            <NavLink to="/wedding" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Wedding</NavLink>
          )}
          {user?.email === 'baldaufdan@gmail.com' && (
            <NavLink to="/travel-list" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Travel List</NavLink>
          )}
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

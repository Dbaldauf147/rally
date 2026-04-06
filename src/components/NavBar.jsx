import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './NavBar.module.css';

export function NavBar() {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.logo}>Rally</NavLink>
        <div className={styles.links}>
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Dashboard</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Calendar</NavLink>
          <NavLink to="/friends" className={({ isActive }) => isActive ? styles.linkActive : styles.link}>Friends</NavLink>
        </div>
        <div className={styles.right}>
          <span className={styles.userName}>{user?.displayName || user?.email}</span>
          <button className={styles.logoutBtn} onClick={async () => { await logOut(); navigate('/login'); }}>Sign out</button>
        </div>
      </div>
    </nav>
  );
}

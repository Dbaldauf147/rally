import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './BottomTabBar.module.css';

const OWNER_EMAIL = 'baldaufdan@gmail.com';

// Inline stroke icons (no icon dependency). 24x24, currentColor.
const svg = (children) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const icons = {
  home: svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /></>),
  today: svg(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" /></>),
  calendar: svg(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>),
  plans: svg(<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></>),
  more: svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  friends: svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-3-4.9" /></>),
  wedding: svg(<path d="M12 21s-7-4.6-9.3-9C1.2 9 2.6 5.5 6 5.5c2 0 3.2 1.2 4 2.4.8-1.2 2-2.4 4-2.4 3.4 0 4.8 3.5 3.3 6.5C19 16.4 12 21 12 21z" />),
  travel: svg(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M12 11v5" /></>),
  holidays: svg(<><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13M12 8S9 3 6.5 4.5 9 8 12 8zM12 8s3-5 5.5-3.5S15 8 12 8z" /></>),
  pto: svg(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></>),
  admin: svg(<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
};

export function BottomTabBar() {
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const isOwner = user?.email === OWNER_EMAIL;

  useEffect(() => {
    document.body.classList.add('has-tabbar');
    return () => document.body.classList.remove('has-tabbar');
  }, []);

  const primary = [
    { to: '/', label: 'Home', icon: icons.home, end: true },
    { to: '/today', label: 'Today', icon: icons.today },
    { to: '/calendar', label: 'Calendar', icon: icons.calendar },
    { to: '/plans', label: 'Plans', icon: icons.plans },
  ];
  const moreItems = [
    { to: '/friends', label: 'Friends', icon: icons.friends },
    ...(isOwner ? [
      { to: '/wedding', label: 'Wedding', icon: icons.wedding },
      { to: '/travel-list', label: 'Travel List', icon: icons.travel },
      { to: '/pto', label: 'PTO', icon: icons.pto },
    ] : []),
  ];
  // Owner-only tools live behind the gear/Settings section of the sheet.
  const settingsItems = isOwner ? [
    { to: '/holidays', label: 'Holidays', icon: icons.holidays },
    { to: '/admin', label: 'Admin', icon: icons.admin },
  ] : [];
  const moreRoutes = [...moreItems, ...settingsItems].map(i => i.to);
  const moreActive = moreOpen || moreRoutes.includes(location.pathname);

  async function handleSignOut() {
    setMoreOpen(false);
    await logOut();
    navigate('/login');
  }

  return (
    <>
      {moreOpen && <div className={styles.scrim} onClick={() => setMoreOpen(false)} />}
      {moreOpen && (
        <div className={styles.sheet} role="dialog" aria-label="More">
          <div className={styles.sheetHandle} />
          <div className={styles.sheetGrid}>
            {moreItems.map(it => (
              <NavLink
                key={it.to}
                to={it.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) => isActive ? styles.sheetItemActive : styles.sheetItem}
              >
                <span className={styles.sheetIcon}>{it.icon}</span>
                {it.label}
              </NavLink>
            ))}
          </div>
          {settingsItems.length > 0 && (
            <div className={styles.sheetSection}>
              <div className={styles.sheetSectionLabel}>
                <span className={styles.sheetSectionIcon}>{icons.gear}</span> Settings
              </div>
              <div className={styles.sheetGrid}>
                {settingsItems.map(it => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) => isActive ? styles.sheetItemActive : styles.sheetItem}
                  >
                    <span className={styles.sheetIcon}>{it.icon}</span>
                    {it.label}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
          <div className={styles.sheetAccount}>
            <span className={styles.sheetEmail}>{user?.email}</span>
            <button type="button" className={styles.signOut} onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
      )}

      <nav className={styles.tabbar} aria-label="Primary">
        {primary.map(it => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) => isActive ? styles.tabActive : styles.tab}
          >
            <span className={styles.tabIcon}>{it.icon}</span>
            <span className={styles.tabLabel}>{it.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={moreActive ? styles.tabActive : styles.tab}
          onClick={() => setMoreOpen(v => !v)}
          aria-expanded={moreOpen}
        >
          <span className={styles.tabIcon}>{icons.more}</span>
          <span className={styles.tabLabel}>More</span>
        </button>
      </nav>
    </>
  );
}

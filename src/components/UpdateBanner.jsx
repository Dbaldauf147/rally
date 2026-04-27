import { useState, useEffect } from 'react';
import styles from './UpdateBanner.module.css';

const BUILD_ID = document.getElementById('root')?.dataset?.build || '0';
const CHECK_INTERVAL = 20000; // check every 20 seconds

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch('/?_t=' + Date.now(), { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(/data-build="([^"]+)"/);
        if (cancelled) return;
        if (match && match[1] !== BUILD_ID && BUILD_ID !== '0') {
          setUpdateAvailable(true);
        }
      } catch {}
    }

    const interval = setInterval(check, CHECK_INTERVAL);
    // First check after 2 seconds — quick enough to catch a fresh deploy.
    const timeout = setTimeout(check, 2000);
    // Also recheck whenever the user comes back to the tab.
    const onFocus = () => check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className={styles.banner}>
      <span className={styles.text}>A new version of Rally is available</span>
      <button className={styles.btn} onClick={() => window.location.reload()}>Update Now</button>
      <button className={styles.dismiss} onClick={() => setUpdateAvailable(false)}>&times;</button>
    </div>
  );
}

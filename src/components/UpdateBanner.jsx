import { useState, useEffect } from 'react';
import styles from './UpdateBanner.module.css';

const BUILD_ID = document.getElementById('root')?.dataset?.build || '0';
const CHECK_INTERVAL = 60000; // check every 60 seconds

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/?_t=' + Date.now(), { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(/data-build="([^"]+)"/);
        if (match && match[1] !== BUILD_ID && BUILD_ID !== '0') {
          setUpdateAvailable(true);
        }
      } catch {}
    }

    const interval = setInterval(check, CHECK_INTERVAL);
    // First check after 10 seconds
    const timeout = setTimeout(check, 10000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
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

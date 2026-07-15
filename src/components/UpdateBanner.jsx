import { useState, useEffect, useRef } from 'react';
import styles from './UpdateBanner.module.css';

const BUILD_ID = document.getElementById('root')?.dataset?.build || '0';
const CHECK_INTERVAL = 20000; // fallback HTML poll, every 20 seconds

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const regRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    // Primary: reliable service-worker signal. main.jsx dispatches this once a
    // new worker has installed and is waiting to take over.
    const onReady = (e) => {
      regRef.current = e.detail || window.__swReg || null;
      if (!cancelled) setUpdateAvailable(true);
    };
    window.addEventListener('sw-update-ready', onReady);
    // Catch the case where a worker was already waiting before we mounted.
    if (window.__swReg?.waiting && navigator.serviceWorker?.controller) {
      regRef.current = window.__swReg;
      setUpdateAvailable(true);
    }

    // Fallback: compare the deployed HTML's build id (covers browsers without
    // SW support, or a deploy the SW update check hasn't picked up yet).
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
    const timeout = setTimeout(check, 2000);
    const onFocus = () => check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener('sw-update-ready', onReady);
      clearInterval(interval);
      clearTimeout(timeout);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  function applyUpdate() {
    const reg = regRef.current || window.__swReg;
    // Preferred path: tell the waiting worker to activate. main.jsx's
    // controllerchange listener then reloads the page with the new version.
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      // Safety net in case controllerchange doesn't fire promptly.
      setTimeout(() => window.location.reload(), 2000);
      return;
    }
    // No waiting worker (HTML-poll fallback, or non-SW browser): reload. The
    // SW serves navigations network-first, so this pulls the fresh build.
    window.location.reload();
  }

  if (!updateAvailable) return null;

  return (
    <div className={styles.banner}>
      <span className={styles.text}>A new version of Rally is available</span>
      <button className={styles.btn} onClick={applyUpdate}>Update Now</button>
      <button className={styles.dismiss} onClick={() => setUpdateAvailable(false)}>&times;</button>
    </div>
  );
}

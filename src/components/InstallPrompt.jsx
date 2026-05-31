import { useEffect, useMemo, useState } from 'react';
import styles from './InstallPrompt.module.css';

const DISMISS_KEY = 'rally.installDismissed.v1';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [hasBIP, setHasBIP] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  // iOS Safari never fires beforeinstallprompt — detect it synchronously so we
  // can show a manual "Add to Home Screen" hint instead.
  const iosSafari = useMemo(() => {
    if (isStandalone()) return false;
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
    return isIos && isSafari;
  }, []);

  useEffect(() => {
    const onBIP = (e) => {
      e.preventDefault();
      setDeferred(e);
      setHasBIP(true);
    };
    const onInstalled = () => setDismissed(true);
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    setDeferred(null);
    setDismissed(true);
  };

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const iosHint = iosSafari && !hasBIP;
  const visible = !dismissed && !isStandalone() && (hasBIP || iosHint);
  if (!visible) return null;

  return (
    <div className={styles.banner} role="dialog" aria-label="Install Rally">
      <img src="/icon-192.png" alt="" className={styles.icon} />
      <div className={styles.body}>
        <div className={styles.title}>Install Rally</div>
        {iosHint ? (
          <div className={styles.text}>Tap the Share icon, then <strong>Add to Home Screen</strong>.</div>
        ) : (
          <div className={styles.text}>Add it to your home screen for a full-screen, app-like experience.</div>
        )}
      </div>
      <div className={styles.actions}>
        {!iosHint && <button className={styles.installBtn} onClick={install}>Install</button>}
        <button className={styles.dismissBtn} onClick={dismiss} aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}

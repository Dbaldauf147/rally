import { useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { isNativeApp } from '../native';

// The daily Reach Out goal is to contact at least one family member and one
// friend each day. The app-icon badge shows how many of those two are still
// outstanding today: 0 (both done), 1, or 2.
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function unmetCount(reachOuts) {
  const list = Array.isArray(reachOuts) ? reachOuts : [];
  const todayK = todayKey();
  const reachedToday = (match) => list.some(c => c.lastReachOut === todayK && match(c.category || ''));
  const family = reachedToday(cat => cat === 'Family');
  const friend = reachedToday(cat => /friend/i.test(cat));
  return (family ? 0 : 1) + (friend ? 0 : 1);
}

// Keeps the iOS app-icon badge in sync with the outstanding daily reach-outs.
// Native only — recomputes whenever the reach-out list changes and whenever the
// app returns to the foreground (the date may have rolled over while away).
//
// Limitation: with no push backend, the badge only refreshes while the app is
// open or on resume; a fully-closed app keeps its last value until next launch.
export function useReachOutBadge() {
  const { user } = useAuth();
  const latest = useRef(null); // last-seen reachOuts array

  useEffect(() => {
    if (!isNativeApp() || !user?.uid) return;

    let cancelled = false;
    let Badge = null;
    let appListener = null;

    async function apply() {
      if (cancelled || !Badge || latest.current == null) return;
      try {
        const count = unmetCount(latest.current);
        if (count > 0) await Badge.set({ count });
        else await Badge.clear();
      } catch (err) {
        console.warn('Reach Out badge update failed:', err);
      }
    }

    (async () => {
      try {
        const mod = await import('@capawesome/capacitor-badge');
        if (cancelled) return;
        Badge = mod.Badge;
        try {
          const perm = await Badge.checkPermissions();
          if (perm?.display !== 'granted') await Badge.requestPermissions();
        } catch { /* permission flow unavailable — set() will simply no-op */ }
        await apply();
      } catch (err) {
        console.warn('Badge plugin unavailable:', err);
      }

      try {
        const { App } = await import('@capacitor/app');
        if (cancelled) return;
        appListener = await App.addListener('resume', apply);
      } catch { /* no app plugin — skip resume refresh */ }
    })();

    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      latest.current = snap.exists() ? (snap.data().reachOuts || []) : [];
      apply();
    }, () => { latest.current = []; apply(); });

    return () => {
      cancelled = true;
      unsub();
      if (appListener) appListener.remove();
    };
  }, [user?.uid]);
}

// Render-only wrapper so App.jsx can mount the hook at the root.
export function ReachOutBadgeRunner() {
  useReachOutBadge();
  return null;
}

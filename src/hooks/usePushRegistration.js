import { useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { isNativeApp } from '../native';

// Registers the native app for push notifications and stores the device's APNs
// token on the user doc (users/{uid}.pushTokens, keyed by token so re-registers
// dedupe). The daily /api/reachout-badge cron reads those tokens to update the
// app-icon badge even when the app is closed. Native only; a no-op on web.
export function usePushRegistration() {
  const { user } = useAuth();

  useEffect(() => {
    if (!isNativeApp() || !user?.uid) return;

    let cancelled = false;
    let regListener = null;
    let errListener = null;

    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
          perm = await PushNotifications.requestPermissions();
        }
        if (cancelled || perm.receive !== 'granted') return;

        regListener = await PushNotifications.addListener('registration', async (token) => {
          if (cancelled || !token?.value) return;
          try {
            await setDoc(
              doc(db, 'users', user.uid),
              { pushTokens: { [token.value]: { platform: 'ios', updatedAt: new Date().toISOString() } } },
              { merge: true },
            );
          } catch (err) {
            console.warn('Push token save failed:', err);
          }
        });

        errListener = await PushNotifications.addListener('registrationError', (err) => {
          console.warn('Push registration error:', err);
        });

        await PushNotifications.register();
      } catch (err) {
        console.warn('Push registration unavailable:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (regListener) regListener.remove();
      if (errListener) errListener.remove();
    };
  }, [user?.uid]);
}

// Render-only wrapper so App.jsx can mount the hook at the root.
export function PushRegistrationRunner() {
  usePushRegistration();
  return null;
}

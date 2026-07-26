import { useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { isNativeApp } from '../native';

// How long to wait for APNs after register() before assuming nothing is coming.
// register() resolves as soon as the request is handed to iOS; the token (or an
// error) arrives later on a listener, so silence is its own failure mode.
const APNS_TIMEOUT_MS = 15000;

// Every outcome is written to users/{uid}.pushStatus so a failure is visible in
// the app (ReachOutPage shows a banner) instead of dying in a console nobody can
// read on a TestFlight build. The states map to the things that actually go
// wrong, all of them native-side setup rather than code — see PUSH_SETUP.md.
export const PUSH_STATUS_TEXT = {
  denied: 'notifications are turned off for Rally in iOS Settings',
  unavailable: "the push plugin isn't in this build (npx cap sync ios)",
  error: 'iOS refused to register this device for push',
  'no-response': 'iOS never returned a device token (check the AppDelegate hooks)',
};

function pushStatus(state, message) {
  return {
    pushStatus: {
      state,
      ...(message ? { message: String(message).slice(0, 300) } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
}

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
    let timer = null;

    const ref = doc(db, 'users', user.uid);
    function record(patch) {
      if (cancelled) return;
      setDoc(ref, patch, { merge: true }).catch((err) => {
        console.warn('Push status save failed:', err);
      });
    }
    // First outcome wins: whichever of token / error / timeout lands first is the
    // one worth reporting, and it cancels the timeout.
    let settled = false;
    function settle(patch) {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      record(patch);
    }

    (async () => {
      let PushNotifications;
      try {
        ({ PushNotifications } = await import('@capacitor/push-notifications'));
      } catch (err) {
        // The plugin isn't compiled into the native project — `npx cap sync ios`
        // hasn't been run since it was added to package.json.
        settle(pushStatus('unavailable', err?.message || 'Push plugin not installed'));
        return;
      }
      if (cancelled) return;

      try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
          perm = await PushNotifications.requestPermissions();
        }
        if (cancelled) return;
        if (perm.receive !== 'granted') {
          settle(pushStatus('denied', `Permission: ${perm.receive}`));
          return;
        }

        regListener = await PushNotifications.addListener('registration', (token) => {
          if (cancelled || !token?.value) return;
          settle({
            pushTokens: { [token.value]: { platform: 'ios', updatedAt: new Date().toISOString() } },
            ...pushStatus('registered', `token …${token.value.slice(-6)}`),
          });
        });

        errListener = await PushNotifications.addListener('registrationError', (err) => {
          // Typically "no valid 'aps-environment' entitlement string found for
          // application" — the Push Notifications capability is missing in Xcode.
          settle(pushStatus('error', err?.error || err?.message || 'APNs registration failed'));
        });

        await PushNotifications.register();

        // Neither listener firing means the AppDelegate isn't forwarding the APNs
        // callbacks to Capacitor, so the token never reaches JS.
        timer = setTimeout(() => {
          timer = null;
          settle(pushStatus('no-response', `No APNs response within ${APNS_TIMEOUT_MS / 1000}s — see PUSH_SETUP.md step 3.`));
        }, APNS_TIMEOUT_MS);
      } catch (err) {
        settle(pushStatus('unavailable', err?.message || 'Push registration failed'));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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

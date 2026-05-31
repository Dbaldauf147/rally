import { Capacitor } from '@capacitor/core';

// True when running inside the Capacitor native shell (iOS app), false on web/PWA.
export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

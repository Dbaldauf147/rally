import { Capacitor } from '@capacitor/core';

// True when running inside the Capacitor native shell (iOS app), false on web/PWA.
export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// The native app loads from a bundled origin (capacitor://localhost), so relative
// "/api/..." calls can't reach the deployed serverless functions. Point them at
// the production deployment. On web this stays empty so calls remain same-origin.
export const API_BASE = isNativeApp() ? 'https://rally-seven-theta.vercel.app' : '';

// Canonical web origin for user-facing links (poll/invite/calendar URLs). In the
// native shell window.location.origin is "capacitor://localhost", which is broken
// when shared with others — fall back to the production deployment there.
export const WEB_ORIGIN = isNativeApp() ? 'https://rally-seven-theta.vercel.app' : window.location.origin;

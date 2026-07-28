import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isNativeApp } from '../native';

const OWNER_EMAIL = 'baldaufdan@gmail.com';

// In the native app the thing worth seeing first is the day's reach-outs, so a
// cold launch lands on Reach Out rather than the dashboard. Web and PWA are
// untouched: "/" is the shared entry point there, and people arrive on it by
// following a link rather than by opening an app.
//
// Once per launch — tapping Home afterwards goes to the dashboard as normal.
// Owner-gated to match the tab, which only the owner sees; sending anyone else
// to a page with no tab back would strand them.
export function useNativeLanding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const settled = useRef(false);

  useEffect(() => {
    if (settled.current) return;
    if (!isNativeApp() || !user) return;
    settled.current = true;
    if (user.email !== OWNER_EMAIL) return;
    // Any path other than the bare entry point is a deliberate destination —
    // a share deep link, a notification tap — and mustn't be hijacked.
    if (location.pathname === '/') navigate('/reachout', { replace: true });
  }, [user, navigate, location.pathname]);
}

// Render-only wrapper so App.jsx can mount the hook at the root.
export function NativeLandingRunner() {
  useNativeLanding();
  return null;
}

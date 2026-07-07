import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Listens for deep links opened from the native iOS Share Extension and routes
// them to the in-app /share page. The Share Extension hands off the shared
// Instagram link by opening:  rally://share?url=<encoded>&title=<encoded>
//
// On the web/PWA build there is no Capacitor runtime, so @capacitor/app is
// imported dynamically and the listener simply never attaches — the existing
// PWA share_target (manifest.webmanifest -> /share) covers that path instead.
export function useShareDeepLink() {
  const navigate = useNavigate();

  useEffect(() => {
    let remove = null;
    let cancelled = false;

    (async () => {
      let CapApp;
      try {
        ({ App: CapApp } = await import('@capacitor/app'));
      } catch {
        return; // Plugin not available (web build) — nothing to do.
      }
      if (cancelled || !CapApp?.addListener) return;

      const handleUrl = (incoming) => {
        if (!incoming) return;
        let parsed;
        try {
          parsed = new URL(incoming);
        } catch {
          return;
        }
        // Google Calendar OAuth return: rally://google-auth?accessToken=…
        // Re-broadcast as the same window message the web popup flow uses, so
        // Plans' existing listener stores the tokens and flips to connected.
        if (parsed.host === 'google-auth') {
          const at = parsed.searchParams.get('accessToken');
          const rt = parsed.searchParams.get('refreshToken') || '';
          const exp = Number(parsed.searchParams.get('expiresIn')) || 3600;
          const err = parsed.searchParams.get('error');
          if (at) window.postMessage({ type: 'google-auth-success', accessToken: at, refreshToken: rt, expiresIn: exp }, '*');
          else if (err) window.postMessage({ type: 'google-auth-error', error: err }, '*');
          import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => {});
          return;
        }
        // Accept rally://share?... (custom scheme) and https://…/share?...
        // (universal link), both produced by the Share Extension.
        if (parsed.host !== 'share' && parsed.pathname !== '/share') return;
        const qs = parsed.search || '';
        navigate(`/share${qs}`);
      };

      // Cold start: the app may have been launched by the deep link.
      try {
        const launch = await CapApp.getLaunchUrl();
        if (launch?.url) handleUrl(launch.url);
      } catch { /* no launch url */ }

      // Warm: app already running when the link fires.
      const sub = await CapApp.addListener('appUrlOpen', (data) => handleUrl(data?.url));
      remove = () => sub.remove();
    })();

    return () => {
      cancelled = true;
      if (remove) remove();
    };
  }, [navigate]);
}

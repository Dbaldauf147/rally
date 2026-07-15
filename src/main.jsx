import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import { isNativeApp } from './native';
import './index.css';

// Tag the root so CSS can apply native-shell-only behavior (touch feel, no
// text selection, no overscroll bounce) without affecting the web/PWA.
if (isNativeApp()) document.documentElement.classList.add('native');

class GlobalErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '600px', margin: '2rem auto' }}>
          <h2 style={{ color: '#dc2626' }}>Rally crashed</h2>
          <pre style={{ fontSize: '0.75rem', color: '#666', whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
            {this.state.error.message}{'\n'}{this.state.error.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      window.__swReg = reg;

      // Whether an old worker was already controlling this page at load. Only
      // then does a controller change mean "a NEW version just took over" — on
      // the very first install the initial claim shouldn't trigger a reload.
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        window.location.reload();
      });

      // Tell the app a new version has finished installing and is waiting.
      const announceReady = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent('sw-update-ready', { detail: reg }));
        }
      };
      announceReady(); // in case one was already waiting
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed') announceReady();
        });
      });

      // Proactively poll for a new build so we don't wait for a full navigation.
      const check = () => reg.update().catch(() => {});
      setInterval(check, 60 * 1000);
      window.addEventListener('focus', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    }).catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </GlobalErrorBoundary>
  </StrictMode>
);

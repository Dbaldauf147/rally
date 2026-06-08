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
    navigator.serviceWorker.register('/sw.js').catch(err => {
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

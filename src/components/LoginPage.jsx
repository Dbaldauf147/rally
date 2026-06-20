import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './LoginPage.module.css';

// Turn a Firebase Auth error into something a person can act on. The code lives
// on err.code (e.g. 'auth/invalid-credential'); fall back to scraping it from
// the message. Previously we stripped the code out and were left with "Error .".
function friendlyAuthError(err) {
  const code = err?.code || (err?.message || '').match(/auth\/[\w-]+/)?.[0] || '';
  const map = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'No account found for that email. Try signing up.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/email-already-in-use': 'An account already exists for that email. Try signing in.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/missing-password': 'Please enter your password.',
    'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
  };
  if (map[code]) return map[code];
  // Unknown Firebase error — show the cleaned message rather than a bare "Error".
  const cleaned = (err?.message || '').replace('Firebase: ', '').replace(/\s*\(auth\/[\w-]+\)\.?/, '').trim();
  return cleaned || 'Something went wrong signing in. Please try again.';
}

export function LoginPage() {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/';
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    // Surface a hung sign-in (e.g. a flaky native web view) as an error
    // instead of leaving the button spinning forever.
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sign-in timed out. Check your connection and try again.')), 20000)
      ),
    ]);
    try {
      if (mode === 'signup') {
        await withTimeout(signUpWithEmail(email, password, name));
      } else {
        await withTimeout(signInWithEmail(email, password));
      }
      navigate(redirectTo);
    } catch (err) {
      setError(friendlyAuthError(err));
    }
    setLoading(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.logo}>Rally</h1>
        <p className={styles.tagline}>Plan events and trips with friends & family</p>

        <p className={styles.emailPreferred}>Email sign-in is preferred for this site.</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {mode === 'signup' && (
            <input className={styles.input} type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required />
          )}
          <input className={styles.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className={styles.input} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? '...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className={styles.switch}>
          {mode === 'login' ? (
            <>No account? <button className={styles.switchBtn} onClick={() => { setMode('signup'); setError(''); }}>Sign up</button></>
          ) : (
            <>Have an account? <button className={styles.switchBtn} onClick={() => { setMode('login'); setError(''); }}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  );
}

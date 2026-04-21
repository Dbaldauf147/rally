import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './LoginPage.module.css';

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
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
      navigate(redirectTo);
    } catch (err) {
      setError(err.message.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
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

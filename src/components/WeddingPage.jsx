import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function WeddingPage() {
  const { user } = useAuth();
  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ marginTop: 0 }}>Wedding</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Wedding planning lives here.
      </p>
    </div>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './components/LoginPage';
import { DashboardPage } from './components/DashboardPage';
import { EventDetail } from './components/EventDetail';
import { TripDetail } from './components/TripDetail';
import { CalendarView } from './components/CalendarView';
import { InvitePage } from './components/InvitePage';
import { PollPage } from './components/PollPage';
import { FriendsPage } from './components/FriendsPage';
import { SharePage } from './components/SharePage';
import { NavBar } from './components/NavBar';
import { UpdateBanner } from './components/UpdateBanner';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--color-text-muted)' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--color-text-muted)', gap: '1rem' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-accent)' }}>Rally</div>
        <div>Loading...</div>
        <button onClick={() => window.location.href = '/login'} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem' }}>
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <>
      {user && <NavBar />}
      <UpdateBanner />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/poll/:eventId" element={<PollPage />} />
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/calendar" element={<ProtectedRoute><CalendarView /></ProtectedRoute>} />
        <Route path="/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
        <Route path="/share" element={<SharePage />} />
        <Route path="/event/:eventId" element={<ProtectedRoute><EventDetail /></ProtectedRoute>} />
        <Route path="/trip/:tripId" element={<ProtectedRoute><TripDetail /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

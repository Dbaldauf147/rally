import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './components/LoginPage';
import { DashboardPage } from './components/DashboardPage';
import { EventDetail } from './components/EventDetail';
import { TripDetail } from './components/TripDetail';
import { CalendarView } from './components/CalendarView';
import { Plans } from './components/Plans';
import { InvitePage } from './components/InvitePage';
import { PollPage } from './components/PollPage';
import { FriendsPage } from './components/FriendsPage';
import { SharePage } from './components/SharePage';
import { WeddingPage } from './components/WeddingPage';
import { TravelListPage } from './components/TravelListPage';
import { HolidaysPage } from './components/HolidaysPage';
import { PTOPage } from './components/PTOPage';
import { VotingPage } from './components/VotingPage';
import { AdminPage } from './components/AdminPage';
import { ReachOutPage } from './components/ReachOutPage';
import { SportsPage } from './components/SportsPage';
// Today is now a subtab of Plans; keep its old URL working via redirect below.
import { NavBar } from './components/NavBar';
import { BottomTabBar } from './components/BottomTabBar';
import { InstallPrompt } from './components/InstallPrompt';
import { UpdateBanner } from './components/UpdateBanner';
import { GoogleCalendarAutoSyncRunner } from './hooks/useGoogleCalendarAutoSync';
import { ReachOutBadgeRunner } from './hooks/useReachOutBadge';
import { useShareDeepLink } from './hooks/useShareDeepLink';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--color-text-muted)' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  useShareDeepLink();

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
      {user && <BottomTabBar />}
      {user && <GoogleCalendarAutoSyncRunner />}
      {user && <ReachOutBadgeRunner />}
      {user && <InstallPrompt />}
      <UpdateBanner />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/poll/:eventId" element={<PollPage />} />
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/today" element={<Navigate to="/plans?view=today" replace />} />
        <Route path="/calendar" element={<ProtectedRoute><CalendarView /></ProtectedRoute>} />
        <Route path="/plans" element={<ProtectedRoute><Plans /></ProtectedRoute>} />
        <Route path="/voting" element={<ProtectedRoute><VotingPage /></ProtectedRoute>} />
        <Route path="/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
        <Route path="/wedding" element={<ProtectedRoute><WeddingPage /></ProtectedRoute>} />
        <Route path="/travel-list" element={<ProtectedRoute><TravelListPage /></ProtectedRoute>} />
        <Route path="/holidays" element={<ProtectedRoute><HolidaysPage /></ProtectedRoute>} />
        <Route path="/pto" element={<ProtectedRoute><PTOPage /></ProtectedRoute>} />
        <Route path="/reachout" element={<ProtectedRoute><ReachOutPage /></ProtectedRoute>} />
        <Route path="/sports" element={<ProtectedRoute><SportsPage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        <Route path="/share" element={<SharePage />} />
        <Route path="/event/:eventId" element={<ProtectedRoute><EventDetail /></ProtectedRoute>} />
        <Route path="/trip/:tripId" element={<ProtectedRoute><TripDetail /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

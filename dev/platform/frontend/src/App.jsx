import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import ReportsPage from './pages/ReportsPage';
import RankingsPage from './pages/RankingsPage';
import ClientSEOPage from './pages/ClientSEOPage';
import ClientAdsPage from './pages/ClientAdsPage';
import ClientSalesTrafficPage from './pages/ClientSalesTrafficPage';
import ClientSocialPage from './pages/ClientSocialPage';
import ClientAudiencesPage from './pages/ClientAudiencesPage';
import ClientAIVisibilityPage from './pages/ClientAIVisibilityPage';
import ClientBrandPage from './pages/ClientBrandPage';
import ClientVisualisePage from './pages/ClientVisualisePage';
import ApprovePage from './pages/ApprovePage';
import SetPasswordPage from './pages/SetPasswordPage';
import GuidePage from './pages/GuidePage';
import LeadsPage from './pages/LeadsPage';
import SnapshotStudioPage from './pages/SnapshotStudioPage';
import SettingsPage from './pages/SettingsPage';
import ClientPRPage from './pages/ClientPRPage';
import JournalistProfilePage from './pages/JournalistProfilePage';
import OutletProfilePage from './pages/OutletProfilePage';
import ContactCleanupPage from './pages/ContactCleanupPage';
import PublicCoveragePage from './pages/PublicCoveragePage';
import PressReviewPage from './pages/PressReviewPage';
import WatchPage from './pages/WatchPage';
import ClientVideoTab from './pages/ClientVideoTab';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px', color: 'var(--text-muted)' }}>Loading…</div>;
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function HomeRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <HomePage />;
}

// Edit folded into the client Video tab; keep the old URL working.
function EditRedirect() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/video?tab=edit`} replace />;
}

// Email/Outreach moved into Owned → Email; keep the old URL working.
function OutreachRedirect() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/seo?tab=email`} replace />;
}

// AI Data Analyst moved into Data → AI Analyst; keep the old URL working.
function ChatRedirect() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/sales-traffic?tab=analyst`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/approve/:token" element={<ApprovePage />} />
          <Route path="/coverage/:token" element={<PublicCoveragePage />} />
          <Route path="/press-release/:token" element={<PressReviewPage />} />
          {/* /share is the Loom-parity public link; /watch kept as an alias. */}
          <Route path="/share/:token" element={<WatchPage />} />
          <Route path="/watch/:token" element={<WatchPage />} />
          <Route path="/set-password/:token" element={<SetPasswordPage />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:id" element={<ClientDetailPage />} />
            <Route path="clients/:id/seo" element={<ClientSEOPage />} />
            <Route path="clients/:id/chat" element={<ChatRedirect />} />
            <Route path="clients/:id/ads" element={<ClientAdsPage />} />
            <Route path="clients/:id/outreach" element={<OutreachRedirect />} />
            <Route path="clients/:id/sales-traffic" element={<ClientSalesTrafficPage />} />
            <Route path="clients/:id/social" element={<ClientSocialPage />} />
            <Route path="clients/:id/video" element={<ClientVideoTab />} />
            <Route path="clients/:id/audiences" element={<ClientAudiencesPage />} />
            <Route path="clients/:id/ai-visibility" element={<ClientAIVisibilityPage />} />
            <Route path="clients/:id/brand" element={<ClientBrandPage />} />
            <Route path="clients/:id/visualise" element={<ClientVisualisePage />} />
            <Route path="clients/:id/edit" element={<EditRedirect />} />
            <Route path="clients/:id/pr" element={<ClientPRPage />} />
            <Route path="media" element={<Navigate to="/settings?tab=publications" replace />} />
            <Route path="media/journalist/:id" element={<JournalistProfilePage />} />
            <Route path="media/outlet/:id" element={<OutletProfilePage />} />
            {/* Video is client-scoped now (Workspace → Video); the old global
                page is gone. Bounce any stale links to the dashboard. */}
            <Route path="video" element={<Navigate to="/dashboard" replace />} />
            <Route path="recordings" element={<Navigate to="/dashboard" replace />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="rankings" element={<RankingsPage />} />
            <Route path="leads" element={<LeadsPage />} />
            <Route path="leads/:id" element={<SnapshotStudioPage />} />
            <Route path="guide" element={<GuidePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="contacts/cleanup" element={<ContactCleanupPage />} />
            {/* Manage and Integrations were separate top-level pages; now both
                live as Settings tabs. Keep the old URLs working so bookmarks
                redirect cleanly. */}
            <Route path="manage" element={<Navigate to="/settings?tab=users" replace />} />
            <Route path="integrations" element={<Navigate to="/settings?tab=integrations" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

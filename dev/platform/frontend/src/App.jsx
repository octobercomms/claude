import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import RankingsPage from './pages/RankingsPage';
import ClientSEOPage from './pages/ClientSEOPage';
import ClientAdsPage from './pages/ClientAdsPage';
import ClientSalesTrafficPage from './pages/ClientSalesTrafficPage';
import ClientSocialPage from './pages/ClientSocialPage';
import ClientAudiencesPage from './pages/ClientAudiencesPage';
import ClientAIVisibilityPage from './pages/ClientAIVisibilityPage';
import ClientBrandPage from './pages/ClientBrandPage';
import ApprovePage from './pages/ApprovePage';
import SetPasswordPage from './pages/SetPasswordPage';
import GuidePage from './pages/GuidePage';
// Temporary: the checker calibration bench. Goes when the thresholds are set.
import SnapshotStudioPage from './pages/SnapshotStudioPage';
import TenderWorkspacePage from './pages/TenderWorkspacePage';
import SettingsPage from './pages/SettingsPage';
import ClientPRPage from './pages/ClientPRPage';
import JournalistProfilePage from './pages/JournalistProfilePage';
import OutletProfilePage from './pages/OutletProfilePage';
import ContactCleanupPage from './pages/ContactCleanupPage';
import PublicCoveragePage from './pages/PublicCoveragePage';
import PressReviewPage from './pages/PressReviewPage';
import WatchPage from './pages/WatchPage';
import ProposalPublicPage from './pages/ProposalPublicPage';
import BookingManagePage from './pages/BookingManagePage';
import ProposalEditorPage from './pages/ProposalEditorPage';
import ProposalSamplePage from './pages/ProposalSamplePage';
import ClientVideoTab from './pages/ClientVideoTab';
import DesignSystemPage from './pages/DesignSystemPage';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s10)', color: 'var(--text-muted)' }}>Loading…</div>;
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

// Carries the incoming query string across, so /reports?status=x lands on
// /settings?tab=reports&status=x rather than dropping the filter.
function SettingsTabRedirect({ tab }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', tab);
  return <Navigate to={`/settings?${params.toString()}`} replace />;
}

function HomeRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  return isAuthenticated ? <Navigate to="/clients" replace /> : <HomePage />;
}

// Edit + Visualise folded into the client Produce suite; keep old URLs working.
function EditRedirect() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/video?tab=edit`} replace />;
}
function VisualiseRedirect() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/video?tab=visualise`} replace />;
}

// Email/Outreach moved into Owned → Email; keep the old URL working.
function OutreachRedirect() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/seo?tab=email`} replace />;
}

// The analyst is a panel on every page now, not a tab. The old URL opens the
// Dashboard with the panel already open rather than landing on a tab that no
// longer exists.
function ChatRedirect() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}?tab=measure&analyst=1`} replace />;
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
          <Route path="/p/:token" element={<ProposalPublicPage />} />
          <Route path="/b/:token" element={<BookingManagePage />} />
          <Route path="/set-password/:token" element={<SetPasswordPage />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            {/* The agency landing is the client list. /dashboard is kept as a redirect
                for bookmarks and old links; the Dashboard name is being reused for
                the per-client section. */}
            <Route path="dashboard" element={<Navigate to="/clients" replace />} />
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
            <Route path="clients/:id/visualise" element={<VisualiseRedirect />} />
            <Route path="clients/:id/edit" element={<EditRedirect />} />
            <Route path="clients/:id/pr" element={<ClientPRPage />} />
            <Route path="media" element={<Navigate to="/settings?tab=publications" replace />} />
            <Route path="media/journalist/:id" element={<JournalistProfilePage />} />
            <Route path="media/outlet/:id" element={<OutletProfilePage />} />
            {/* Video is client-scoped now (Workspace → Video); the old global
                page is gone. Bounce any stale links to the client list. */}
            <Route path="video" element={<Navigate to="/clients" replace />} />
            <Route path="recordings" element={<Navigate to="/clients" replace />} />
            {/* Reports and the checker bench are Settings tabs. Both routes
                are kept so existing links, and the Clients report tile, keep
                working; the query string rides along. */}
            <Route path="reports" element={<SettingsTabRedirect tab="reports" />} />
            <Route path="rankings" element={<RankingsPage />} />
            {/* Leads folded into Settings → Workspace → Leads; keep old links working. */}
            <Route path="leads" element={<Navigate to="/settings?tab=leads" replace />} />
            <Route path="tenders" element={<Navigate to="/settings?tab=tenders" replace />} />
            <Route path="tenders/:id" element={<TenderWorkspacePage />} />
            <Route path="leads/:id" element={<SnapshotStudioPage />} />
            <Route path="proposals" element={<Navigate to="/settings?tab=proposals" replace />} />
            {/* A whole proposal with dummy content, rendered through the real
                component, for designing and printing against. Static segment,
                so it never collides with a proposal id. */}
            <Route path="proposals/sample" element={<ProposalSamplePage />} />
            <Route path="proposals/:id" element={<ProposalEditorPage />} />
            <Route path="guide" element={<GuidePage />} />
            <Route path="lab/checker" element={<SettingsTabRedirect tab="checker" />} />
            <Route path="design" element={<DesignSystemPage />} />
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

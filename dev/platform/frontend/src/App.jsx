import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import RankingsPage from './pages/RankingsPage';
import ClientSEOPage from './pages/ClientSEOPage';
import ClientConvertPage from './pages/ClientConvertPage';
import ClientAdsPage from './pages/ClientAdsPage';
import ClientSalesTrafficPage from './pages/ClientSalesTrafficPage';
import ClientSocialPage from './pages/ClientSocialPage';
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

// The public front door: the marketing page when signed out, the client list
// when signed in.
function HomeRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  return isAuthenticated ? <Navigate to="/clients" replace /> : <HomePage />;
}

// A bare /clients/:id has no screen of its own: it is the Dashboard. One URL
// per screen, so there is never a second address for the same thing.
function ClientHome() {
  const { id } = useParams();
  return <Navigate to={`/clients/${id}/dashboard`} replace />;
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
            <Route path="clients" element={<ClientsPage />} />

            {/* Every screen is a path segment. The eight sections below each
                take an optional :screen, which nav/sections.js validates; an
                unknown one falls back to that section's default rather than
                rendering a blank page.

                Nothing that used to redirect survives. This is an internal
                tool with one user and nothing external links into it — the
                only outward-facing URLs are the /coverage and /watch token
                pages below, which are unchanged. Carrying 21 legacy aliases
                and 11 redirect routes to protect bookmarks nobody holds was
                keeping two URL schemes alive at once. */}
            <Route path="clients/:id" element={<ClientHome />} />
            <Route path="clients/:id/dashboard/:screen?" element={<ClientDetailPage />} />
            <Route path="clients/:id/ads/:screen?" element={<ClientAdsPage />} />
            <Route path="clients/:id/pr/:screen?" element={<ClientPRPage />} />
            <Route path="clients/:id/social/:screen?" element={<ClientSocialPage />} />
            <Route path="clients/:id/seo/:screen?" element={<ClientSEOPage />} />
            {/* Convert takes a third segment: its Email screen embeds the whole
                Outreach suite, so /convert/email/campaigns names a real
                screen rather than hiding it behind a second query param. */}
            <Route path="clients/:id/convert/:screen?/:sub?" element={<ClientConvertPage />} />
            <Route path="clients/:id/produce/:screen?" element={<ClientVideoTab />} />
            <Route path="settings/:screen?" element={<SettingsPage />} />

            {/* Client screens outside the panel. `data` is the read-only
                numbers page a client login lands on; `brand` is the brand kit,
                reached from the cog. */}
            <Route path="clients/:id/data" element={<ClientSalesTrafficPage />} />
            <Route path="clients/:id/brand" element={<ClientBrandPage />} />

            <Route path="media/journalist/:id" element={<JournalistProfilePage />} />
            <Route path="media/outlet/:id" element={<OutletProfilePage />} />
            <Route path="rankings" element={<RankingsPage />} />
            <Route path="tenders/:id" element={<TenderWorkspacePage />} />
            <Route path="leads/:id" element={<SnapshotStudioPage />} />
            {/* A whole proposal with dummy content, rendered through the real
                component, for designing and printing against. Static segment,
                so it never collides with a proposal id. */}
            <Route path="proposals/sample" element={<ProposalSamplePage />} />
            <Route path="proposals/:id" element={<ProposalEditorPage />} />
            <Route path="guide" element={<GuidePage />} />
            <Route path="design" element={<DesignSystemPage />} />
            <Route path="contacts/cleanup" element={<ContactCleanupPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

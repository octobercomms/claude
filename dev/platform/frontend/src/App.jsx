import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { FeatureCostProvider } from './components/FeatureCost';
// Three pages load with the app itself, because they are how someone arrives:
// the signed-out marketing page, the login form, and the public player behind a
// share link. Everything else is a separate chunk.
//
// The split is for the share link's sake. WatchPage sat in the main bundle with
// the whole admin app, so a client clicking a video link downloaded 2.7MB of
// JavaScript (718KB gzipped) covering every OMI screen, and parsed it, before
// the <video> element existed. None of that code runs on that page.
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import WatchPage from './pages/WatchPage';

const Layout = lazy(() => import('./components/Layout'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage'));
const RankingsPage = lazy(() => import('./pages/RankingsPage'));
const ClientSEOPage = lazy(() => import('./pages/ClientSEOPage'));
const ClientConvertPage = lazy(() => import('./pages/ClientConvertPage'));
const ClientAdsPage = lazy(() => import('./pages/ClientAdsPage'));
const ClientSalesTrafficPage = lazy(() => import('./pages/ClientSalesTrafficPage'));
const ClientSocialPage = lazy(() => import('./pages/ClientSocialPage'));
const ApprovePage = lazy(() => import('./pages/ApprovePage'));
const SetPasswordPage = lazy(() => import('./pages/SetPasswordPage'));
const GuidePage = lazy(() => import('./pages/GuidePage'));
// Temporary: the checker calibration bench. Goes when the thresholds are set.
const SnapshotStudioPage = lazy(() => import('./pages/SnapshotStudioPage'));
const TenderWorkspacePage = lazy(() => import('./pages/TenderWorkspacePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ClientPRPage = lazy(() => import('./pages/ClientPRPage'));
const JournalistProfilePage = lazy(() => import('./pages/JournalistProfilePage'));
const OutletProfilePage = lazy(() => import('./pages/OutletProfilePage'));
const ContactCleanupPage = lazy(() => import('./pages/ContactCleanupPage'));
const PublicCoveragePage = lazy(() => import('./pages/PublicCoveragePage'));
const PressReviewPage = lazy(() => import('./pages/PressReviewPage'));
const ProposalPublicPage = lazy(() => import('./pages/ProposalPublicPage'));
const BookingManagePage = lazy(() => import('./pages/BookingManagePage'));
const ProposalEditorPage = lazy(() => import('./pages/ProposalEditorPage'));
const ProposalSamplePage = lazy(() => import('./pages/ProposalSamplePage'));
const ClientVideoTab = lazy(() => import('./pages/ClientVideoTab'));
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage'));

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
        {/* One fetch of what each AI feature costs, shared by every button
            that spends. Inside ToastProvider so a failure can be silent. */}
        <FeatureCostProvider>
      <BrowserRouter>
        {/* One boundary for every lazy page. The fallback is deliberately
            plain: it shows for the length of one chunk fetch, and anything
            with layout in it flashes a shape that is about to be replaced. */}
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s10)', color: 'var(--text-muted)' }}>Loading…</div>}>
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
            {/* Database and Biz dev are their own sections now, not groups
                inside Settings. Same component: SettingsPage reads which
                section it is in from the path, so the screens it already
                rendered keep working at their new addresses. */}
            <Route path="database/:screen?" element={<SettingsPage />} />
            <Route path="biz-dev/:screen?" element={<SettingsPage />} />

            {/* Client screens outside the panel. `data` is the read-only
                numbers page a client login lands on.

                There is no standalone `brand` route any more. The brand kit
                renders inside Setup (ClientDetailPage, tab 'details'), and the
                separate route was a second copy of the same component reached
                by a button sitting a few hundred pixels above the real one.
                Two doors to one thing read as two different things. */}
            <Route path="clients/:id/data" element={<ClientSalesTrafficPage />} />

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
        </Suspense>
      </BrowserRouter>
        </FeatureCostProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

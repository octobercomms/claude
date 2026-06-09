import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import ClientChatPage from './pages/ClientChatPage';
import ClientAdsPage from './pages/ClientAdsPage';
import ClientOutreachPage from './pages/ClientOutreachPage';
import ClientSalesTrafficPage from './pages/ClientSalesTrafficPage';
import ClientSocialPage from './pages/ClientSocialPage';
import ClientAudiencesPage from './pages/ClientAudiencesPage';
import ClientAIVisibilityPage from './pages/ClientAIVisibilityPage';
import ClientBrandPage from './pages/ClientBrandPage';
import ApprovePage from './pages/ApprovePage';
import GuidePage from './pages/GuidePage';
import SettingsPage from './pages/SettingsPage';
import ClientPRPage from './pages/ClientPRPage';
import MediaPage from './pages/MediaPage';
import JournalistProfilePage from './pages/JournalistProfilePage';
import OutletProfilePage from './pages/OutletProfilePage';

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

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/approve/:token" element={<ApprovePage />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:id" element={<ClientDetailPage />} />
            <Route path="clients/:id/seo" element={<ClientSEOPage />} />
            <Route path="clients/:id/chat" element={<ClientChatPage />} />
            <Route path="clients/:id/ads" element={<ClientAdsPage />} />
            <Route path="clients/:id/outreach" element={<ClientOutreachPage />} />
            <Route path="clients/:id/sales-traffic" element={<ClientSalesTrafficPage />} />
            <Route path="clients/:id/social" element={<ClientSocialPage />} />
            <Route path="clients/:id/audiences" element={<ClientAudiencesPage />} />
            <Route path="clients/:id/ai-visibility" element={<ClientAIVisibilityPage />} />
            <Route path="clients/:id/brand" element={<ClientBrandPage />} />
            <Route path="clients/:id/pr" element={<ClientPRPage />} />
            <Route path="media" element={<MediaPage />} />
            <Route path="media/journalist/:id" element={<JournalistProfilePage />} />
            <Route path="media/outlet/:id" element={<OutletProfilePage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="rankings" element={<RankingsPage />} />
            <Route path="guide" element={<GuidePage />} />
            <Route path="settings" element={<SettingsPage />} />
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

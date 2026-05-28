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
import SettingsPage from './pages/SettingsPage';
import ManageUsersPage from './pages/ManageUsersPage';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px', color: '#666' }}>Loading…</div>;
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
            <Route path="reports" element={<ReportsPage />} />
            <Route path="rankings" element={<RankingsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="manage" element={<ManageUsersPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

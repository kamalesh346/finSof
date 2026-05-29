import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './utils/AuthContext';
import LoginPage from './pages/LoginPage';
import AgentDashboard from './pages/AgentDashboard';
import AdminDashboard from './pages/AdminDashboard';
import { Toaster } from 'react-hot-toast';
import './App.css';

function AppInner() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;
  if (user.role === 'AGENT') return <AgentDashboard />;
  return <AdminDashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
      <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
    </AuthProvider>
  );
}

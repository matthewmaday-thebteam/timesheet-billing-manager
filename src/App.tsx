import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { MainHeader } from './components/MainHeader';
import { SubNavbar, type NavRoute } from './components/SubNavbar';
import { Dashboard } from './components/Dashboard';
import { HolidaysPage } from './components/pages/HolidaysPage';
import { EmployeesPage } from './components/pages/EmployeesPage';
import { RatesPage } from './components/pages/RatesPage';
import { EOMReportsPage } from './components/pages/EOMReportsPage';
import { UsersPage } from './components/pages/UsersPage';
import { LoginPage } from './components/pages/LoginPage';
import { ForgotPasswordPage } from './components/pages/ForgotPasswordPage';
import { ResetPasswordPage } from './components/pages/ResetPasswordPage';

type AuthView = 'login' | 'forgot-password' | 'reset-password';

function AuthenticatedApp() {
  const [activeRoute, setActiveRoute] = useState<NavRoute>('home');

  const renderPage = () => {
    switch (activeRoute) {
      case 'home':
        return <Dashboard />;
      case 'holidays':
        return <HolidaysPage />;
      case 'employees':
        return <EmployeesPage />;
      case 'rates':
        return <RatesPage />;
      case 'eom-reports':
        return <EOMReportsPage />;
      case 'users':
        return <UsersPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <MainHeader />
      <SubNavbar activeRoute={activeRoute} onRouteChange={setActiveRoute} />
      {renderPage()}
    </div>
  );
}

function UnauthenticatedApp() {
  const { isRecoverySession } = useAuth();
  const [authView, setAuthView] = useState<AuthView>('login');

  // Detect recovery session from Supabase auth event
  useEffect(() => {
    if (isRecoverySession) {
      setAuthView('reset-password');
    }
  }, [isRecoverySession]);

  // Also check URL path on mount for direct navigation
  useEffect(() => {
    if (window.location.pathname === '/reset-password') {
      setAuthView('reset-password');
    }
  }, []);

  const handleResetComplete = () => {
    // Clear the URL path
    window.history.replaceState({}, '', '/');
    setAuthView('login');
  };

  if (authView === 'reset-password') {
    return <ResetPasswordPage onComplete={handleResetComplete} />;
  }

  if (authView === 'forgot-password') {
    return <ForgotPasswordPage onBackToLogin={() => setAuthView('login')} />;
  }

  return <LoginPage onForgotPassword={() => setAuthView('forgot-password')} />;
}

function AppContent() {
  const { user, loading, isRecoverySession } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#EAEAEA] border-t-[#000000]" />
          <span className="text-sm text-[#666666]">Loading...</span>
        </div>
      </div>
    );
  }

  // Show reset password page if in recovery session, even if user is logged in
  if (isRecoverySession || window.location.pathname === '/reset-password') {
    return <UnauthenticatedApp />;
  }

  if (!user) {
    return <UnauthenticatedApp />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;

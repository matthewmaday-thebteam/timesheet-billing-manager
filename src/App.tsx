import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BillingSourceProvider } from './contexts/BillingSourceContext';
import { DateFilterProvider } from './contexts/DateFilterContext';
import { MainHeader, type NavRoute } from './components/MainHeader';
import { Footer } from './components/Footer';
import { Dashboard } from './components/Dashboard';
import { Spinner } from './components/Spinner';
import { HolidaysPage } from './components/pages/HolidaysPage';
import { EmployeesPage } from './components/pages/EmployeesPage';
import { EmployeeManagementPage } from './components/pages/EmployeeManagementPage';
import { RatesPage } from './components/pages/RatesPage';
import { ProjectsPage } from './components/pages/ProjectsPage';
import { ProjectManagementPage } from './components/pages/ProjectManagementPage';
import { CompaniesPage } from './components/pages/CompaniesPage';
import { RevenuePage } from './components/pages/RevenuePage';
import { BillingsPage } from './components/pages/BillingsPage';
import { EOMReportsPage } from './components/pages/EOMReportsPage';
import { UsersPage } from './components/pages/UsersPage';
import { DiagnosticsPage } from './components/pages/DiagnosticsPage';
import { FormulasPage } from './components/pages/FormulasPage';
import { InvestorDashboardPage } from './components/pages/InvestorDashboardPage';
import { LegalPage } from './components/pages/LegalPage';
import { BurnPage } from './components/pages/BurnPage';
import { LoginPage } from './components/pages/LoginPage';
import { ForgotPasswordPage } from './components/pages/ForgotPasswordPage';
import { ResetPasswordPage } from './components/pages/ResetPasswordPage';
import { StyleReviewPage } from './design-system/style-review/StyleReviewPage';

type AuthView = 'login' | 'forgot-password' | 'reset-password';

type DocsSection = 'tokens' | 'typography' | 'atoms' | 'molecules' | 'patterns';

// Compute initial style review state from URL params
function getInitialStyleReviewState(): { show: boolean; section: DocsSection } {
  const params = new URLSearchParams(window.location.search);
  if (params.get('style-review') === 'true') {
    const section = params.get('section') as DocsSection | null;
    const validSections: DocsSection[] = ['tokens', 'typography', 'atoms', 'molecules', 'patterns'];
    return {
      show: true,
      section: section && validSections.includes(section) ? section : 'tokens',
    };
  }
  return { show: false, section: 'tokens' };
}

function AuthenticatedApp() {
  const [activeRoute, setActiveRoute] = useState<NavRoute>('home');
  const [styleReviewState, setStyleReviewState] = useState(getInitialStyleReviewState);

  const handleOpenDocs = (section: DocsSection) => {
    setStyleReviewState({ show: true, section });
  };

  // Style Review Surface (accessible in production)
  if (styleReviewState.show) {
    return (
      <StyleReviewPage
        initialSection={styleReviewState.section}
        onClose={() => {
          setStyleReviewState({ show: false, section: 'tokens' });
          window.history.replaceState({}, '', window.location.pathname);
        }}
      />
    );
  }

  const renderPage = () => {
    switch (activeRoute) {
      case 'home':
        return <Dashboard />;
      case 'holidays':
        return <HolidaysPage />;
      case 'employees':
        return <EmployeesPage />;
      case 'burn':
        return <BurnPage />;
      case 'projects':
        return <ProjectsPage />;
      case 'companies':
        return <CompaniesPage />;
      case 'rates':
        return <RatesPage />;
      case 'revenue':
        return <RevenuePage />;
      case 'billings':
        return <BillingsPage />;
      case 'eom-reports':
        return <EOMReportsPage />;
      case 'users':
        return <UsersPage />;
      case 'employee-management':
        return <EmployeeManagementPage />;
      case 'project-management':
        return <ProjectManagementPage />;
      case 'diagnostics':
        return <DiagnosticsPage />;
      case 'formulas':
        return <FormulasPage />;
      case 'investor-dashboard':
        return <InvestorDashboardPage />;
      case 'legal':
        return <LegalPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <BillingSourceProvider>
      <DateFilterProvider>
        <div className="min-h-screen bg-vercel-gray-50 flex flex-col">
          <MainHeader
            activeRoute={activeRoute}
            onRouteChange={setActiveRoute}
            onOpenDocs={handleOpenDocs}
          />
          <main className="flex-1">
            {renderPage()}
          </main>
          <Footer onNavigate={setActiveRoute} />
        </div>
      </DateFilterProvider>
    </BillingSourceProvider>
  );
}

// Compute initial auth view from URL path
function getInitialAuthView(): AuthView {
  if (window.location.pathname === '/reset-password') {
    return 'reset-password';
  }
  return 'login';
}

interface UnauthenticatedAppProps {
  authError?: string | null;
}

function UnauthenticatedApp({ authError }: UnauthenticatedAppProps = {}) {
  const { isRecoverySession, clearRecoverySession } = useAuth();
  const [authView, setAuthView] = useState<AuthView>(getInitialAuthView);

  const handleResetComplete = () => {
    // Clear recovery state so we don't loop back to reset-password
    clearRecoverySession();
    // Clear the URL path
    window.history.replaceState({}, '', '/');
    setAuthView('login');
  };

  // Derive effective view - recovery session takes precedence
  const effectiveView = isRecoverySession ? 'reset-password' : authView;

  if (effectiveView === 'reset-password') {
    return <ResetPasswordPage onComplete={handleResetComplete} />;
  }

  if (effectiveView === 'forgot-password') {
    return <ForgotPasswordPage onBackToLogin={() => setAuthView('login')} />;
  }

  return <LoginPage onForgotPassword={() => setAuthView('forgot-password')} authError={authError} />;
}

function AppContent() {
  const { user, loading, isRecoverySession, authError } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-vercel-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Spinner size="md" />
          <span className="text-sm text-vercel-gray-400">Loading...</span>
        </div>
      </div>
    );
  }

  // Show reset password page if in recovery session, even if user is logged in
  if (isRecoverySession || window.location.pathname === '/reset-password') {
    return <UnauthenticatedApp />;
  }

  // Show login page with error when an auth link failed (e.g. expired invite)
  if (authError) {
    return <UnauthenticatedApp authError={authError} />;
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

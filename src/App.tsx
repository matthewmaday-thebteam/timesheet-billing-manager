import { useState } from 'react';
import { MainHeader } from './components/MainHeader';
import { SubNavbar, type NavRoute } from './components/SubNavbar';
import { Dashboard } from './components/Dashboard';
import { HolidaysPage } from './components/pages/HolidaysPage';
import { EmployeesPage } from './components/pages/EmployeesPage';
import { EOMReportsPage } from './components/pages/EOMReportsPage';

function App() {
  const [activeRoute, setActiveRoute] = useState<NavRoute>('home');

  const renderPage = () => {
    switch (activeRoute) {
      case 'home':
        return <Dashboard />;
      case 'holidays':
        return <HolidaysPage />;
      case 'employees':
        return <EmployeesPage />;
      case 'eom-reports':
        return <EOMReportsPage />;
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

export default App;

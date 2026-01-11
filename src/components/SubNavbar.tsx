import { NavItem } from './NavItem';

export type NavRoute = 'home' | 'holidays' | 'employees' | 'rates' | 'eom-reports' | 'users';

interface SubNavbarProps {
  activeRoute: NavRoute;
  onRouteChange: (route: NavRoute) => void;
}

interface NavItemConfig {
  id: NavRoute;
  label: string;
}

const navItems: NavItemConfig[] = [
  { id: 'home', label: 'Home' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'employees', label: 'Employees' },
  { id: 'rates', label: 'Rates' },
  { id: 'eom-reports', label: 'EOM Reports' },
  { id: 'users', label: 'Users' },
];

export function SubNavbar({ activeRoute, onRouteChange }: SubNavbarProps) {
  return (
    <nav className="h-12 bg-[#FFFFFF] border-b border-[#EAEAEA]">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center">
        <div className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavItem
              key={item.id}
              label={item.label}
              isActive={activeRoute === item.id}
              onClick={() => onRouteChange(item.id)}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

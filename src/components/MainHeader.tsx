import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from './Avatar';
import { ProfileEditorModal } from './ProfileEditorModal';
import { NavItem } from './NavItem';
import { AIChatWindow } from './chat';

type DocsSection = 'tokens' | 'typography' | 'atoms' | 'molecules' | 'patterns';

export type NavRoute = 'home' | 'holidays' | 'employees' | 'burn' | 'projects' | 'companies' | 'rates' | 'revenue' | 'billings' | 'eom-reports' | 'users' | 'employee-management' | 'project-management' | 'investor-dashboard' | 'diagnostics' | 'formulas' | 'legal';

interface NavItemConfig {
  id: NavRoute;
  label: string;
}

const navItems: NavItemConfig[] = [
  { id: 'home', label: 'Home' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'employees', label: 'Employees' },
  { id: 'burn', label: 'Burn' },
  { id: 'projects', label: 'Projects' },
  { id: 'rates', label: 'Rates' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'billings', label: 'Fixed Billing' },
  { id: 'eom-reports', label: 'EOM Reports' },
];

interface MainHeaderProps {
  activeRoute: NavRoute;
  onRouteChange: (route: NavRoute) => void;
  onOpenDocs?: (section: DocsSection) => void;
}

export function MainHeader({ activeRoute, onRouteChange, onOpenDocs }: MainHeaderProps) {
  const { user, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleSignOut = async () => {
    setIsMenuOpen(false);
    await signOut();
  };

  const handleOpenProfile = () => {
    setIsMenuOpen(false);
    setIsProfileModalOpen(true);
  };

  // Get display name from user metadata or email
  const firstName = user?.user_metadata?.first_name || '';
  const lastName = user?.user_metadata?.last_name || '';
  const avatarUrl = user?.user_metadata?.avatar_url || null;

  let formattedName: string;
  if (firstName || lastName) {
    formattedName = [firstName, lastName].filter(Boolean).join(' ');
  } else {
    // Fallback to email-based name
    const displayName = user?.email?.split('@')[0] || 'User';
    formattedName = displayName
      .split(/[._-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return (
    <header className="h-14 bg-white border-b border-vercel-gray-100 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
        {/* Left: Navigation Items */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavItem
              key={item.id}
              label={item.label}
              isActive={activeRoute === item.id}
              onClick={() => onRouteChange(item.id)}
            />
          ))}
        </nav>

        {/* Right: Links and Avatar */}
        <div className="flex items-center gap-4">
          {/* Ask the Accountant - AI Chat */}
          <button
            onClick={() => setIsChatOpen(true)}
            className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-black rounded px-2 py-1 flex items-center gap-1.5"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            Ask the Accountant
          </button>

          {/* Separator */}
          <div className="w-px h-6 bg-vercel-gray-100" />

          {/* User Avatar with Dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="focus:outline-none focus:ring-1 focus:ring-black rounded-full"
            >
              <Avatar name={formattedName} size={32} src={avatarUrl} />
            </button>

            {isMenuOpen && (
              <div
                className="absolute right-0 mt-2 w-56 bg-white rounded-lg border border-vercel-gray-100 overflow-hidden z-50"
                style={{
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05)',
                }}
              >
                {/* User Info */}
                <div className="px-4 py-3 border-b border-vercel-gray-100">
                  <p className="text-sm font-medium text-vercel-gray-600">{formattedName}</p>
                  <p className="text-xs text-vercel-gray-400 truncate">{user?.email}</p>
                </div>

                {/* Menu Items */}
                <div className="py-1">
                  <button
                    onClick={handleOpenProfile}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Profile
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('users');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    User Management
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('employee-management');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Employee Management
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('project-management');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Project Management
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('companies');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    Company Management
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('investor-dashboard');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Investor Dashboard
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenDocs?.('tokens');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                    Site Style
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('diagnostics');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Diagnostics
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('formulas');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Formulas
                  </button>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onRouteChange('legal');
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Legal
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Profile Editor Modal */}
      <ProfileEditorModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* AI Chat Window */}
      <AIChatWindow
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />
    </header>
  );
}

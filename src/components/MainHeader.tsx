import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from './Avatar';
import { ProfileEditorModal } from './ProfileEditorModal';
import { NavItem } from './NavItem';

type DocsSection = 'tokens' | 'typography' | 'atoms' | 'molecules' | 'patterns';

export type NavRoute = 'home' | 'holidays' | 'employees' | 'rates' | 'eom-reports' | 'users';

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

interface MainHeaderProps {
  activeRoute: NavRoute;
  onRouteChange: (route: NavRoute) => void;
  onOpenDocs?: (section: DocsSection) => void;
}

export function MainHeader({ activeRoute, onRouteChange, onOpenDocs }: MainHeaderProps) {
  const { user, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDocsMenuOpen, setIsDocsMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const docsMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (docsMenuRef.current && !docsMenuRef.current.contains(event.target as Node)) {
        setIsDocsMenuOpen(false);
      }
    };

    if (isMenuOpen || isDocsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, isDocsMenuOpen]);

  const handleDocsClick = (section: DocsSection) => {
    setIsDocsMenuOpen(false);
    onOpenDocs?.(section);
  };

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
    <header className="h-14 bg-white border-b border-vercel-gray-100">
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
          {/* Feedback Link */}
          <button className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-black rounded px-2 py-1">
            Feedback
          </button>

          {/* Docs Dropdown */}
          <div className="relative" ref={docsMenuRef}>
            <button
              onClick={() => setIsDocsMenuOpen(!isDocsMenuOpen)}
              className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-black rounded px-2 py-1 flex items-center gap-1"
            >
              Docs
              <svg
                className={`w-3 h-3 transition-transform ${isDocsMenuOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isDocsMenuOpen && (
              <div
                className="absolute right-0 mt-2 w-48 bg-white rounded-lg border border-vercel-gray-100 overflow-hidden z-50"
                style={{
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05)',
                }}
              >
                <div className="py-1">
                  <button
                    onClick={() => handleDocsClick('atoms')}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    Components
                  </button>
                  <button
                    onClick={() => handleDocsClick('tokens')}
                    className="w-full px-4 py-2 text-left text-sm text-vercel-gray-600 hover:bg-vercel-gray-50 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                    Styles
                  </button>
                </div>
              </div>
            )}
          </div>

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
    </header>
  );
}

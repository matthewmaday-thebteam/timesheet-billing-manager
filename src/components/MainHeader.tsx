import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from './Avatar';

export function MainHeader() {
  const { user, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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

  // Get display name from email
  const displayName = user?.email?.split('@')[0] || 'User';
  const formattedName = displayName
    .split(/[._-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return (
    <header className="h-14 bg-white border-b border-vercel-gray-100">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
        {/* Left: Breadcrumb / Project Switcher */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-vercel-gray-400">{formattedName}'s projects</span>
          <span className="text-vercel-gray-100">/</span>
          <span className="text-sm font-semibold text-vercel-gray-600">timesheet-billing-manager</span>
        </div>

        {/* Right: Links and Avatar */}
        <div className="flex items-center gap-4">
          {/* Feedback Link */}
          <button className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-black rounded px-2 py-1">
            Feedback
          </button>

          {/* Docs Link */}
          <button className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors focus:outline-none focus:ring-1 focus:ring-black rounded px-2 py-1">
            Docs
          </button>

          {/* Separator */}
          <div className="w-px h-6 bg-vercel-gray-100" />

          {/* User Avatar with Dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="focus:outline-none focus:ring-1 focus:ring-black rounded-full"
            >
              <Avatar name={formattedName} size={32} />
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
    </header>
  );
}

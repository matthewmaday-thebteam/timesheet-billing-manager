/**
 * Footer - Site footer component
 *
 * Displays site navigation, copyright, and legal information.
 *
 * @official 2026-01-28
 * @category Molecule
 *
 * Token Usage:
 * - Background: bg-white
 * - Border: border-vercel-gray-100
 * - Text: text-vercel-gray-400, text-vercel-gray-600
 * - Brand: text-bteam-brand
 */

import { useState } from 'react';
import type { NavRoute } from './MainHeader';
import { LegalModal } from './LegalModal';
import { useActiveLegalDocuments } from '../hooks/useLegalDocuments';

interface FooterProps {
  onNavigate?: (route: NavRoute) => void;
}

const siteHierarchy = {
  'Time & Resources': [
    { label: 'Home', route: 'home' as NavRoute },
    { label: 'Employees', route: 'employees' as NavRoute },
    { label: 'Holidays', route: 'holidays' as NavRoute },
  ],
  'Billing': [
    { label: 'Rates', route: 'rates' as NavRoute },
    { label: 'Revenue', route: 'revenue' as NavRoute },
    { label: 'Fixed Billing', route: 'billings' as NavRoute },
    { label: 'EOM Reports', route: 'eom-reports' as NavRoute },
  ],
  'Management': [
    { label: 'Projects', route: 'projects' as NavRoute },
    { label: 'Companies', route: 'companies' as NavRoute },
    { label: 'Investor Dashboard', route: 'investor-dashboard' as NavRoute },
  ],
};

export function Footer({ onNavigate }: FooterProps) {
  const currentYear = new Date().getFullYear();
  const { privacyPolicy, termsOfService } = useActiveLegalDocuments();
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  return (
    <>
      <footer className="bg-white border-t border-vercel-gray-100 mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Site Navigation */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            {Object.entries(siteHierarchy).map(([section, links]) => (
              <div key={section}>
                <h4 className="text-sm font-semibold text-vercel-gray-600 mb-3">
                  {section}
                </h4>
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link.route}>
                      <button
                        onClick={() => onNavigate?.(link.route)}
                        className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors"
                      >
                        {link.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Legal Section */}
            <div>
              <h4 className="text-sm font-semibold text-vercel-gray-600 mb-3">
                Legal
              </h4>
              <ul className="space-y-2">
                <li>
                  <button
                    onClick={() => setShowTermsModal(true)}
                    className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors"
                  >
                    Terms of Service
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setShowPrivacyModal(true)}
                    className="text-sm text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors"
                  >
                    Privacy Policy
                  </button>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="pt-6 border-t border-vercel-gray-100">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
              {/* Copyright */}
              <p className="text-sm text-vercel-gray-400">
                &copy; {currentYear}{' '}
                <span className="text-bteam-brand font-medium">The B Team</span>
                . All rights reserved.
              </p>

              {/* Version / Build info */}
              <p className="text-xs text-vercel-gray-300 font-mono">
                Manifest v1.0
              </p>
            </div>
          </div>
        </div>
      </footer>

      {/* Privacy Policy Modal */}
      {privacyPolicy && (
        <LegalModal
          isOpen={showPrivacyModal}
          onClose={() => setShowPrivacyModal(false)}
          title="Privacy Policy"
          content={privacyPolicy.content}
          version={privacyPolicy.version}
          lastUpdated={privacyPolicy.published_at || privacyPolicy.created_at}
        />
      )}

      {/* Terms of Service Modal */}
      {termsOfService && (
        <LegalModal
          isOpen={showTermsModal}
          onClose={() => setShowTermsModal(false)}
          title="Terms of Service"
          content={termsOfService.content}
          version={termsOfService.version}
          lastUpdated={termsOfService.published_at || termsOfService.created_at}
        />
      )}
    </>
  );
}

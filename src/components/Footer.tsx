/**
 * Footer - Site footer component
 *
 * Displays copyright and branding information at the bottom of all pages.
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

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-white border-t border-vercel-gray-100 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-4">
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
    </footer>
  );
}

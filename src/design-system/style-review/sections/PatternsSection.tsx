/**
 * PatternsSection - Global Patterns Reference
 *
 * Displays approved global patterns like MeshGradientBackground
 * with interactive preview toggle. Extracted verbatim from StyleReviewPage.tsx.
 */

import { Button } from '../../../components/Button';

interface PatternsSectionProps {
  showBackground: boolean;
  setShowBackground: (show: boolean) => void;
}

export function PatternsSection({ showBackground, setShowBackground }: PatternsSectionProps) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-6">Approved Global Patterns</h2>

        {/* Mesh Gradient Background */}
        <div className="p-6 border border-vercel-gray-100 rounded-lg">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-vercel-gray-600">MeshGradientBackground</h3>
              <p className="text-xs text-vercel-gray-400 mt-1">
                Full-screen animated background with organic mesh gradient.
              </p>
              <p className="text-2xs text-vercel-gray-200 mt-2 font-mono">
                src/design-system/patterns/MeshGradientBackground.tsx
              </p>
            </div>
            <Button
              variant={showBackground ? 'primary' : 'secondary'}
              onClick={() => setShowBackground(!showBackground)}
            >
              {showBackground ? 'Hide Preview' : 'Show Preview'}
            </Button>
          </div>

          <div className="bg-vercel-gray-50 rounded-lg p-4 mt-4">
            <p className="text-xs font-medium text-vercel-gray-600 mb-2">Properties:</p>
            <ul className="text-xs text-vercel-gray-400 space-y-1">
              <li><span className="font-mono text-brand-indigo">duration</span>: Animation duration in seconds (default: 20)</li>
              <li><span className="font-mono text-brand-indigo">blur</span>: Blur intensity in pixels (default: 80)</li>
              <li><span className="font-mono text-brand-indigo">opacity</span>: Opacity 0-1 (default: 0.6)</li>
            </ul>
          </div>

          <div className="bg-error-light rounded-lg p-4 mt-4">
            <p className="text-xs font-medium text-vercel-gray-600 mb-2">Usage Notes:</p>
            <ul className="text-xs text-vercel-gray-400 space-y-1">
              <li>Place as first child of layout container</li>
              <li>Content above should have position: relative and z-index</li>
              <li>Respects prefers-reduced-motion</li>
              <li>Do NOT override colors with raw hex values</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

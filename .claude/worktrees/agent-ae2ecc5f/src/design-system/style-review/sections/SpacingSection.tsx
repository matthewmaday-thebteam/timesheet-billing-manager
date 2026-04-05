/**
 * SpacingSection - Spacing System Reference
 *
 * Displays horizontal, vertical, and combined spacing values
 * with visual indicators. Extracted verbatim from StyleReviewPage.tsx.
 */

import { horizontalSpacing, verticalSpacing, combinedSpacing } from '../../registry/spacing';

export function SpacingSection() {
  const spacingGroups = [
    { label: 'Horizontal Spacing', description: 'Padding, gaps, and margins on the horizontal axis.', items: horizontalSpacing },
    { label: 'Vertical Spacing', description: 'Section gaps, element gaps, and internal padding on the vertical axis.', items: verticalSpacing },
    { label: 'Combined Spacing', description: 'Padding applied equally on both axes.', items: combinedSpacing },
  ];

  return (
    <div className="space-y-12">
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-2">Spacing System</h2>
        <p className="text-sm text-vercel-gray-400 mb-6">
          Single source of truth for all allowed spacing values. Any spacing not listed here should not be introduced without updating the registry.
        </p>

        {spacingGroups.map((group) => (
          <div key={group.label} className="mb-10">
            <h3 className="text-sm font-semibold text-vercel-gray-600 mb-1">{group.label}</h3>
            <p className="text-xs text-vercel-gray-400 mb-4">{group.description}</p>

            <div className="border border-vercel-gray-100 rounded-lg overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_80px_120px_1fr] gap-4 px-4 py-3 bg-vercel-gray-50 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                <span>Name</span>
                <span>Value</span>
                <span>Class</span>
                <span>Usage</span>
              </div>
              {/* Table rows */}
              {group.items.map((s) => (
                <div
                  key={s.name}
                  className="grid grid-cols-[1fr_80px_120px_1fr] gap-4 px-4 py-3 border-t border-vercel-gray-100 items-start"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="bg-brand-indigo rounded shrink-0"
                      style={{ width: parseInt(s.value), height: parseInt(s.value), maxWidth: 48, maxHeight: 48 }}
                    />
                    <span className="text-sm font-medium text-vercel-gray-600">{s.name}</span>
                  </div>
                  <span className="text-sm font-mono text-vercel-gray-400">{s.value}</span>
                  <span className="text-xs font-mono text-brand-indigo">{s.tailwindClass}</span>
                  <span className="text-xs text-vercel-gray-400">{s.usage}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

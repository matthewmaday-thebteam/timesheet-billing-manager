/**
 * DesignPatternsSection - Design Pattern Rules Reference
 *
 * Displays pattern categories (typography, spacing, color, layout)
 * with their rules and tokens. Extracted verbatim from StyleReviewPage.tsx.
 */

import { patterns } from '../../registry/patterns';
import type { PatternCategory } from '../../types';

export function DesignPatternsSection() {
  const categories: { id: PatternCategory; label: string; description: string }[] = [
    { id: 'typography', label: 'Typography', description: 'Font weight, size, and color conventions for text hierarchy.' },
    { id: 'spacing', label: 'Spacing', description: 'Consistent gaps between headings, sections, cards, and form elements.' },
    { id: 'color', label: 'Color', description: 'Status colors, interactive states, borders, and text hierarchy.' },
    { id: 'layout', label: 'Layout', description: 'Page headers, responsive grids, tables, and modals.' },
  ];

  return (
    <div className="space-y-12">
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-2">Design Patterns</h2>
        <p className="text-sm text-vercel-gray-400 mb-6">
          Rules and conventions that dictate how elements are composed visually. These are not components — they are the standards components must follow.
          {' '}<span className="font-mono text-xs">{patterns.length} registered</span>
        </p>

        {categories.map((cat) => {
          const categoryPatterns = patterns.filter((p) => p.category === cat.id);
          return (
            <div key={cat.id} className="mb-10">
              <h3 className="text-sm font-semibold text-vercel-gray-600 mb-1">{cat.label}</h3>
              <p className="text-xs text-vercel-gray-400 mb-4">{cat.description}</p>

              <div className="grid gap-4">
                {categoryPatterns.map((pattern) => (
                  <div key={pattern.name} className="p-6 border border-vercel-gray-100 rounded-lg">
                    <h4 className="text-sm font-medium text-vercel-gray-600 mb-1">{pattern.name}</h4>
                    <p className="text-xs text-vercel-gray-400 mb-4">{pattern.description}</p>

                    <div className="mb-4">
                      <p className="text-2xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">Rules</p>
                      <ul className="space-y-1">
                        {pattern.rules.map((rule, i) => (
                          <li key={i} className="text-xs text-vercel-gray-400 flex gap-2">
                            <span className="text-vercel-gray-200 shrink-0">&bull;</span>
                            {rule}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="text-2xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">Tokens</p>
                      <div className="flex flex-wrap gap-1.5">
                        {pattern.tokens.map((token) => (
                          <span
                            key={token}
                            className="text-2xs font-mono px-2 py-0.5 bg-vercel-gray-50 text-brand-indigo rounded"
                          >
                            {token}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

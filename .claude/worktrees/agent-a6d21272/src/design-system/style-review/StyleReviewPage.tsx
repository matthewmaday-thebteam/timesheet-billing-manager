/**
 * Style Review Surface - Design System Documentation
 *
 * Shell component that provides header, tab navigation, and content routing
 * to individual section components. Accessible via the Docs dropdown.
 */

import { useState } from 'react';
import { MeshGradientBackground } from '../patterns/MeshGradientBackground';
import { TypographyPreview } from '../Typography';
import { Button } from '../../components/Button';
import { TokensSection } from './sections/TokensSection';
import { AtomsSection } from './sections/AtomsSection';
import { MoleculesSection } from './sections/MoleculesSection';
import { OrganismsSection } from './sections/OrganismsSection';
import { AnimationsSection } from './sections/AnimationsSection';
import { DesignPatternsSection } from './sections/DesignPatternsSection';
import { SpacingSection } from './sections/SpacingSection';
import { PatternsSection } from './sections/PatternsSection';

type Section = 'tokens' | 'typography' | 'atoms' | 'molecules' | 'organisms' | 'animations' | 'designPatterns' | 'spacing' | 'patterns';

interface StyleReviewPageProps {
  onClose: () => void;
  initialSection?: Section;
}

export function StyleReviewPage({ onClose, initialSection = 'tokens' }: StyleReviewPageProps) {
  const [activeSection, setActiveSection] = useState<Section>(initialSection);
  const [showBackground, setShowBackground] = useState(false);

  const sections: { id: Section; label: string }[] = [
    { id: 'tokens', label: 'Design Tokens' },
    { id: 'typography', label: 'Typography' },
    { id: 'atoms', label: 'Atoms' },
    { id: 'molecules', label: 'Molecules' },
    { id: 'organisms', label: 'Organisms' },
    { id: 'animations', label: 'Animations' },
    { id: 'designPatterns', label: 'Design Patterns' },
    { id: 'spacing', label: 'Spacing' },
    { id: 'patterns', label: 'Global Patterns' },
  ];

  return (
    <div className={`min-h-screen ${showBackground ? 'bg-transparent' : 'bg-white'}`}>
      {/* Background preview overlay - rendered first so it's behind content */}
      {showBackground && <MeshGradientBackground />}

      {/* Header */}
      <div className={`sticky top-0 z-50 border-b border-vercel-gray-100 ${showBackground ? 'bg-white/90 backdrop-blur-sm' : 'bg-white'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-vercel-gray-600">
                Design System
              </h1>
              <p className="text-sm text-vercel-gray-400">
                Components and style tokens reference
              </p>
            </div>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 mt-4">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`relative px-3 py-2 text-sm font-medium rounded-md transition-all duration-200 ease-out hover:bg-vercel-gray-100 focus:outline-none ${
                  activeSection === section.id
                    ? 'text-vercel-gray-600'
                    : 'text-vercel-gray-400 hover:text-vercel-gray-600'
                }`}
              >
                {section.label}
                {/* Active indicator - sits on the header border */}
                <span
                  className={`absolute left-0 right-0 -bottom-[17px] h-[2px] bg-vercel-gray-600 transition-all duration-200 ease-out ${
                    activeSection === section.id ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
                  }`}
                  style={{ borderRadius: '1px 1px 0 0' }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`max-w-7xl mx-auto px-6 py-8 ${showBackground ? 'relative z-10' : ''}`}>
        {activeSection === 'tokens' && <TokensSection />}
        {activeSection === 'typography' && <TypographyPreview showAll />}
        {activeSection === 'atoms' && <AtomsSection />}
        {activeSection === 'molecules' && <MoleculesSection />}
        {activeSection === 'organisms' && <OrganismsSection />}
        {activeSection === 'animations' && <AnimationsSection />}
        {activeSection === 'designPatterns' && <DesignPatternsSection />}
        {activeSection === 'spacing' && <SpacingSection />}
        {activeSection === 'patterns' && (
          <PatternsSection showBackground={showBackground} setShowBackground={setShowBackground} />
        )}
      </div>
    </div>
  );
}

export default StyleReviewPage;

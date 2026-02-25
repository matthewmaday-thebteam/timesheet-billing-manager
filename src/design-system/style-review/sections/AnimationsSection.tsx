/**
 * AnimationsSection - Animation & Transition Visual Demos
 *
 * 8 keyframe animation demos + 8 transition pattern demos.
 * Each animation gets a live visual demo instead of just an info card.
 */

import { useState } from 'react';
import { Spinner } from '../../../components/Spinner';
import { TypingIndicator } from '../../../components/TypingIndicator';
import { ChevronIcon } from '../../../components/ChevronIcon';
import { Checkbox } from '../../../components/Checkbox';
import { NavItem } from '../../../components/NavItem';
import { animations } from '../../registry/animations';

export function AnimationsSection() {
  const keyframeAnims = animations.filter((a) => a.keyframes);
  const transitionAnims = animations.filter((a) => !a.keyframes);

  const [typingKey, setTypingKey] = useState(0);
  const [chevronExpanded, setChevronExpanded] = useState(false);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [opacityVisible, setOpacityVisible] = useState(true);

  return (
    <div className="space-y-12">
      {/* Keyframe Animations */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-2">Keyframe Animations</h2>
        <p className="text-sm text-vercel-gray-400 mb-6">
          Named keyframe animations used for loading states, indicators, and backgrounds.
        </p>
        <div className="grid gap-4">

          {/* spinner-spin */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">spinner-spin</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">1s</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">linear</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Continuous 360-degree rotation for loading spinners.</p>
            <div className="flex gap-4 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">animate-spin</span>
            </div>
          </div>

          {/* skeleton-pulse */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">skeleton-pulse</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">2s</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease-in-out</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Pulsing opacity animation for skeleton loading placeholders.</p>
            <div className="p-4 bg-vercel-gray-50 rounded-lg space-y-3">
              <div className="animate-pulse h-4 w-48 bg-vercel-gray-100 rounded" />
              <div className="animate-pulse h-3 w-64 bg-vercel-gray-100 rounded" />
              <div className="animate-pulse h-3 w-40 bg-vercel-gray-100 rounded" />
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">animate-pulse</span>
            </div>
          </div>

          {/* typing-bounce */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">typing-bounce</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">1.2s</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease-in-out</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Bouncing dots animation for AI typing indicator with staggered delays.</p>
            <div className="flex items-center gap-4 p-4 bg-vercel-gray-50 rounded-lg">
              <TypingIndicator />
              <span className="text-sm text-vercel-gray-400">AI is thinking...</span>
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">css:</span>{' '}
              <span className="text-brand-indigo">typing-bounce</span>
              {' | '}
              <span className="text-vercel-gray-200">keyframes:</span>{' '}
              <span className="text-brand-purple">typing-bounce</span>
            </div>
          </div>

          {/* typing-enter */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">typing-enter</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">200ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease-out</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Slide-up with fade-in for typing indicator container appearance.</p>
            <div className="flex items-center gap-4 p-4 bg-vercel-gray-50 rounded-lg">
              <div key={typingKey} className="bg-vercel-gray-100 rounded-lg px-3 py-2 animate-typing-enter">
                <TypingIndicator />
              </div>
              <button
                onClick={() => setTypingKey((k) => k + 1)}
                className="text-xs text-brand-indigo hover:underline"
              >
                Re-trigger
              </button>
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">css:</span>{' '}
              <span className="text-brand-indigo">animate-typing-enter</span>
              {' | '}
              <span className="text-vercel-gray-200">keyframes:</span>{' '}
              <span className="text-brand-purple">typing-enter</span>
            </div>
          </div>

          {/* mesh-blob-1 through mesh-blob-4 */}
          {keyframeAnims
            .filter((a) => a.name.startsWith('mesh-blob'))
            .map((anim) => (
              <div key={anim.name} className="p-6 border border-vercel-gray-100 rounded-lg">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-medium text-vercel-gray-600">{anim.name}</h3>
                  <div className="flex gap-2">
                    <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">{anim.duration}</span>
                    <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">{anim.easing}</span>
                  </div>
                </div>
                <p className="text-xs text-vercel-gray-400 mb-3">{anim.description}</p>
                <div className="p-3 bg-vercel-gray-50 rounded-lg">
                  <p className="text-xs text-vercel-gray-400">
                    See the <span className="font-medium">Global Patterns</span> tab to preview MeshGradientBackground with all 4 blob animations running together.
                  </p>
                </div>
                <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
                  <span className="text-vercel-gray-200">keyframes:</span>{' '}
                  <span className="text-brand-purple">{anim.keyframes}</span>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Transition Patterns */}
      <div>
        <h2 className="text-lg font-semibold text-vercel-gray-600 mb-2">Transition Patterns</h2>
        <p className="text-sm text-vercel-gray-400 mb-6">
          CSS transition utilities for smooth state changes (hover, focus, toggle).
        </p>
        <div className="grid gap-4">

          {/* color-transition */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">color-transition</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">150ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Smooth background/text/border color change on hover and focus states.</p>
            <div className="flex gap-4 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <div className="w-16 h-16 bg-vercel-gray-100 hover:bg-brand-indigo transition-colors rounded-lg cursor-pointer flex items-center justify-center">
                <span className="text-2xs text-vercel-gray-400 hover:text-white">Hover</span>
              </div>
              <div className="w-16 h-16 bg-vercel-gray-100 hover:bg-bteam-brand transition-colors rounded-lg cursor-pointer flex items-center justify-center">
                <span className="text-2xs text-vercel-gray-400">Hover</span>
              </div>
              <div className="w-16 h-16 border-2 border-vercel-gray-100 hover:border-vercel-gray-600 transition-colors rounded-lg cursor-pointer flex items-center justify-center">
                <span className="text-2xs text-vercel-gray-400">Hover</span>
              </div>
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-colors</span>
              {' | '}
              <span className="text-vercel-gray-200">used in:</span> {transitionAnims.find((a) => a.name === 'color-transition')?.usedIn.length} components
            </div>
          </div>

          {/* color-transition-200 */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">color-transition-200</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">200ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease-out</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Slightly slower color transition for more deliberate visual feedback.</p>
            <div className="flex gap-4 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <div className="w-16 h-16 bg-vercel-gray-100 hover:bg-success transition-colors duration-200 ease-out rounded-lg cursor-pointer flex items-center justify-center">
                <span className="text-2xs text-vercel-gray-400">200ms</span>
              </div>
              <div className="w-16 h-16 bg-vercel-gray-100 hover:bg-warning transition-colors duration-200 ease-out rounded-lg cursor-pointer flex items-center justify-center">
                <span className="text-2xs text-vercel-gray-400">200ms</span>
              </div>
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-colors duration-200 ease-out</span>
            </div>
          </div>

          {/* transform-transition */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">transform-transition</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">150ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Smooth rotation/scale transitions for chevron icons and toggle switches.</p>
            <div className="flex gap-6 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <button
                onClick={() => setChevronExpanded(!chevronExpanded)}
                className="flex items-center gap-2 text-sm text-vercel-gray-600"
              >
                <ChevronIcon direction="right" expanded={chevronExpanded} />
                <span>{chevronExpanded ? 'Collapse' : 'Expand'}</span>
              </button>
              <div className="flex gap-3">
                <ChevronIcon direction="right" expanded={chevronExpanded} size="xs" />
                <ChevronIcon direction="right" expanded={chevronExpanded} size="sm" />
                <ChevronIcon direction="right" expanded={chevronExpanded} size="md" />
                <ChevronIcon direction="right" expanded={chevronExpanded} size="lg" />
              </div>
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-transform</span>
            </div>
          </div>

          {/* transform-transition-200 */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">transform-transition-200</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">200ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Smooth rotation for dropdown chevrons with 200ms duration.</p>
            <div className="flex gap-4 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <div className="w-12 h-12 bg-white border border-vercel-gray-100 rounded-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform duration-200">
                <ChevronIcon direction="down" size="md" />
              </div>
              <span className="text-xs text-vercel-gray-400">Hover to scale</span>
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-transform duration-200</span>
            </div>
          </div>

          {/* opacity-transition */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">opacity-transition</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">150ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Fade in/out for overlays and hover states.</p>
            <div className="flex gap-4 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <div className="relative w-20 h-20 bg-brand-indigo rounded-lg cursor-pointer group">
                <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-2xs">Overlay</span>
                </div>
              </div>
              <span className="text-xs text-vercel-gray-400">Hover to see overlay fade</span>
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-opacity</span>
            </div>
          </div>

          {/* opacity-transition-200 */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">opacity-transition-200</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">200ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease-out</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Modal backdrop and tooltip fade with 200ms duration.</p>
            <div className="flex gap-4 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <button
                onClick={() => setOpacityVisible(!opacityVisible)}
                className="text-xs text-brand-indigo hover:underline"
              >
                Toggle visibility
              </button>
              <div className={`w-16 h-16 bg-brand-purple rounded-lg transition-opacity duration-200 ease-out ${opacityVisible ? 'opacity-100' : 'opacity-0'}`} />
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-opacity duration-200 ease-out</span>
            </div>
          </div>

          {/* all-transition */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">all-transition</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">200ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease-out</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Transition all animatable properties. Used for nav items and chat button.</p>
            <div className="flex gap-1 items-center p-4 bg-vercel-gray-50 rounded-lg border-b border-vercel-gray-100">
              <NavItem label="Home" isActive={activeNav === 'home'} onClick={() => setActiveNav('home')} />
              <NavItem label="About" isActive={activeNav === 'about'} onClick={() => setActiveNav('about')} />
              <NavItem label="Contact" isActive={activeNav === 'contact'} onClick={() => setActiveNav('contact')} />
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-all duration-200 ease-out</span>
            </div>
          </div>

          {/* checkbox-transition */}
          <div className="p-6 border border-vercel-gray-100 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-medium text-vercel-gray-600">checkbox-transition</h3>
              <div className="flex gap-2">
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">150ms</span>
                <span className="text-2xs font-mono text-vercel-gray-200 bg-vercel-gray-50 px-2 py-0.5 rounded">ease-out</span>
              </div>
            </div>
            <p className="text-xs text-vercel-gray-400 mb-3">Background-color and border-color transition for checkbox state changes.</p>
            <div className="flex gap-4 items-center p-4 bg-vercel-gray-50 rounded-lg">
              <Checkbox checked={checkboxChecked} onChange={setCheckboxChecked} label="Click to toggle" />
            </div>
            <div className="mt-3 text-2xs font-mono text-vercel-gray-400">
              <span className="text-vercel-gray-200">class:</span>{' '}
              <span className="text-brand-indigo">transition-[background-color,border-color] duration-150 ease-out</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

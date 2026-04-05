/**
 * Design System Registry Types
 *
 * Defines the type interfaces for the multi-tier design system:
 * Atoms -> Molecules -> Organisms, plus Animations, Patterns, and Spacing.
 */

// ---------------------------------------------------------------------------
// Component tiers
// ---------------------------------------------------------------------------

export type ComponentTier = 'atom' | 'molecule' | 'organism';

export interface DesignSystemEntry {
  /** Display name of the component */
  name: string;
  /** One-line description of what the component does */
  description: string;
  /** Classification tier */
  tier: ComponentTier;
  /** Relative path from project root to the component file */
  filePath: string;
  /** Names of lower-tier components this component composes */
  composedOf?: string[];
  /** Names of higher-tier components or pages that consume this component */
  usedIn?: string[];
  /** Task that introduced or promoted this component */
  introducedIn?: string;
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

export interface AnimationEntry {
  /** Unique name for this animation */
  name: string;
  /** What the animation does visually */
  description: string;
  /** Tailwind utility class that triggers this animation (e.g. "animate-spin") */
  tailwindClass?: string;
  /** Custom CSS class if not a Tailwind built-in */
  cssClass?: string;
  /** Keyframe name reference (e.g. "typing-bounce") */
  keyframes?: string;
  /** Duration (e.g. "200ms", "1.2s", "20s") */
  duration: string;
  /** Easing function (e.g. "ease-out", "ease-in-out", "linear") */
  easing: string;
  /** Where this animation is used */
  usedIn: string[];
}

// ---------------------------------------------------------------------------
// Design Patterns
// ---------------------------------------------------------------------------

export type PatternCategory = 'typography' | 'spacing' | 'color' | 'layout';

export interface PatternEntry {
  /** Unique name for this pattern */
  name: string;
  /** Which category this pattern belongs to */
  category: PatternCategory;
  /** What this pattern governs */
  description: string;
  /** Human-readable rules to follow */
  rules: string[];
  /** Associated Tailwind / design token classes */
  tokens: string[];
}

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export type SpacingAxis = 'horizontal' | 'vertical' | 'both';

export interface SpacingValue {
  /** Semantic name (e.g. "section-gap", "card-padding") */
  name: string;
  /** Raw CSS value (e.g. "24px", "1.5rem") */
  value: string;
  /** Tailwind utility class (e.g. "gap-6", "p-6", "space-y-6") */
  tailwindClass: string;
  /** Axis this spacing applies to */
  axis: SpacingAxis;
  /** Description of when to use this spacing */
  usage: string;
}

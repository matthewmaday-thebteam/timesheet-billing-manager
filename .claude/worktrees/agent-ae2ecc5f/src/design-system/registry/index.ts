/**
 * Design System Registry — Barrel Export
 *
 * Central access point for all registry data. Import from here
 * rather than individual registry files.
 */

// Types
export type {
  DesignSystemEntry,
  ComponentTier,
  AnimationEntry,
  PatternEntry,
  PatternCategory,
  SpacingValue,
  SpacingAxis,
} from '../types';

// Component registries
export { atoms } from './atoms';
export { molecules } from './molecules';
export { organisms } from './organisms';

// Supporting registries
export { animations } from './animations';
export { patterns } from './patterns';
export { horizontalSpacing, verticalSpacing, combinedSpacing, allSpacing } from './spacing';

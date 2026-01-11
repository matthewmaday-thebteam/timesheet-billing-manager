/**
 * MeshGradientBackground - Approved Global Pattern
 *
 * A full-screen animated background with organic mesh gradient.
 * Uses Pure CSS for optimal performance.
 *
 * @approved 2026-01-11
 * @category Global Pattern
 *
 * Usage:
 *   <MeshGradientBackground />
 *   // Place as first child of layout, siblings should have relative positioning
 *
 * DO:
 *   - Use as a global background behind all content
 *   - Ensure content above has `position: relative` and appropriate z-index
 *   - Use the default brand colors from tokens
 *
 * DON'T:
 *   - Override colors with raw hex values
 *   - Use inside scrollable containers
 *   - Nest multiple instances
 */

import './MeshGradientBackground.css';

interface MeshGradientBackgroundProps {
  /** Optional className for additional styling */
  className?: string;
  /** Animation duration in seconds (default: 20) */
  duration?: number;
  /** Blur intensity in pixels (default: 80) */
  blur?: number;
  /** Opacity of the gradient (0-1, default: 0.6) */
  opacity?: number;
}

export function MeshGradientBackground({
  className = '',
  duration = 20,
  blur = 80,
  opacity = 0.6,
}: MeshGradientBackgroundProps) {
  const style = {
    '--mesh-duration': `${duration}s`,
    '--mesh-blur': `${blur}px`,
    '--mesh-opacity': opacity,
  } as React.CSSProperties;

  return (
    <div
      className={`mesh-gradient-background ${className}`}
      style={style}
      aria-hidden="true"
    >
      <div className="mesh-gradient-blob mesh-gradient-blob-1" />
      <div className="mesh-gradient-blob mesh-gradient-blob-2" />
      <div className="mesh-gradient-blob mesh-gradient-blob-3" />
      <div className="mesh-gradient-blob mesh-gradient-blob-4" />
    </div>
  );
}

export default MeshGradientBackground;

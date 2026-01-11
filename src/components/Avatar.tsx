/**
 * Avatar - Official Design System Atom
 *
 * Displays a user avatar with image or initials fallback.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Gradient: brand-indigo, brand-purple
 * - Border: vercel-gray-100
 * - Text: white
 */

import { useState } from 'react';

interface AvatarProps {
  /** User's name for generating initials */
  name?: string;
  /** Avatar size in pixels */
  size?: number;
  /** Optional image URL - falls back to initials if not provided or fails to load */
  src?: string | null;
}

export function Avatar({ name = 'User', size = 32, src }: AvatarProps) {
  const [imageError, setImageError] = useState(false);

  // Get initials from name
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const showImage = src && !imageError;

  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-medium border border-vercel-gray-100 overflow-hidden"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: showImage ? 'transparent' : 'linear-gradient(135deg, var(--color-brand-indigo) 0%, var(--color-brand-purple) 100%)',
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        initials
      )}
    </div>
  );
}

export default Avatar;

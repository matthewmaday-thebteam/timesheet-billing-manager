/**
 * AvatarUpload - Official Design System Atom
 *
 * Avatar with upload and crop functionality for profile photo editing.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50
 * - Border: vercel-gray-100
 * - Text: vercel-gray-400, vercel-gray-600
 */

import { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Modal } from './Modal';

interface AvatarUploadProps {
  /** Current avatar image URL */
  currentImageUrl?: string | null;
  /** User's name for initials fallback */
  name: string;
  /** Callback when a cropped image is ready */
  onImageCropped: (croppedBlob: Blob, previewUrl: string) => void;
  /** Avatar display size */
  size?: number;
  /** Whether upload is disabled */
  disabled?: boolean;
}

// Helper to create cropped image from canvas
async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => {
    image.onload = resolve;
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  // Set canvas size to desired output size (256x256 for avatar)
  const outputSize = 256;
  canvas.width = outputSize;
  canvas.height = outputSize;

  // Draw the cropped image
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob failed'));
        }
      },
      'image/jpeg',
      0.9
    );
  });
}

export function AvatarUpload({
  currentImageUrl,
  name,
  onImageCropped,
  size = 96,
  disabled = false,
}: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be less than 10MB');
      return;
    }

    // Read file and open crop modal
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setIsCropModalOpen(true);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleCropSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      const newPreviewUrl = URL.createObjectURL(croppedBlob);

      // Revoke old preview URL to prevent memory leaks
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(newPreviewUrl);
      onImageCropped(croppedBlob, newPreviewUrl);
      setIsCropModalOpen(false);
      setImageSrc(null);
    } catch (error) {
      console.error('Error cropping image:', error);
      alert('Failed to crop image. Please try again.');
    }
  };

  const handleCropCancel = () => {
    setIsCropModalOpen(false);
    setImageSrc(null);
  };

  const handleAvatarClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  // Display URL: preview (pending upload) > current > null
  const displayUrl = previewUrl || currentImageUrl;

  const cropModalFooter = (
    <>
      <Button variant="secondary" onClick={handleCropCancel}>
        Cancel
      </Button>
      <Button variant="primary" onClick={handleCropSave}>
        Apply
      </Button>
    </>
  );

  return (
    <>
      <div className="flex flex-col items-center gap-3">
        {/* Clickable Avatar */}
        <button
          type="button"
          onClick={handleAvatarClick}
          disabled={disabled}
          className="relative group focus:outline-none focus:ring-2 focus:ring-brand-indigo focus:ring-offset-2 rounded-full disabled:cursor-not-allowed"
        >
          <Avatar name={name} size={size} src={displayUrl} />

          {/* Hover overlay */}
          {!disabled && (
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
          )}
        </button>

        {/* Helper text */}
        <p className="text-xs font-mono text-vercel-gray-400">
          Click to {displayUrl ? 'change' : 'upload'} photo
        </p>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Crop Modal */}
      <Modal
        isOpen={isCropModalOpen}
        onClose={handleCropCancel}
        title="Crop Photo"
        maxWidth="md"
        centerTitle
        footer={cropModalFooter}
      >
        <div className="space-y-4">
          {/* Crop area */}
          <div className="relative h-80 bg-vercel-gray-50 rounded-lg overflow-hidden">
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
              />
            )}
          </div>

          {/* Zoom slider */}
          <div className="flex items-center gap-4">
            <label className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
              Zoom
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 h-2 bg-vercel-gray-100 rounded-lg appearance-none cursor-pointer accent-brand-indigo"
            />
          </div>

          {/* Instructions */}
          <p className="text-xs text-vercel-gray-300 text-center">
            Drag to reposition. Use slider to zoom in or out.
          </p>
        </div>
      </Modal>
    </>
  );
}

export default AvatarUpload;

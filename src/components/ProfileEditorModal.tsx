import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Spinner } from './Spinner';
import { AvatarUpload } from './AvatarUpload';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface ProfileEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
}

interface FormErrors {
  email?: string;
}

export function ProfileEditorModal({ isOpen, onClose }: ProfileEditorModalProps) {
  const { user, updateProfile, updateEmail } = useAuth();

  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    lastName: '',
    email: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAvatarBlob, setPendingAvatarBlob] = useState<Blob | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Get current values from user metadata
  const currentFirstName = user?.user_metadata?.first_name || '';
  const currentLastName = user?.user_metadata?.last_name || '';
  const currentEmail = user?.email || '';
  const currentAvatarUrl = user?.user_metadata?.avatar_url || null;

  // Reset form when modal opens
  const resetKey = `${user?.id}-${isOpen}`;
  useEffect(() => {
    if (resetKey !== lastResetKey) {
      setLastResetKey(resetKey);
      setFormData({
        firstName: currentFirstName,
        lastName: currentLastName,
        email: currentEmail,
      });
      setErrors({});
      setPendingAvatarBlob(null);
      setAvatarPreviewUrl(null);
      setErrorMessage(null);
    }
  }, [resetKey, lastResetKey, currentFirstName, currentLastName, currentEmail]);

  const validateEmail = (email: string): boolean => {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    setErrorMessage(null);
  };

  const handleImageCropped = (blob: Blob, previewUrl: string) => {
    setPendingAvatarBlob(blob);
    setAvatarPreviewUrl(previewUrl);
    setErrorMessage(null);
  };

  const uploadAvatar = async (blob: Blob): Promise<string> => {
    if (!user) throw new Error('User not authenticated');

    const fileExt = 'jpg';
    const filePath = `${user.id}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, blob, {
        upsert: true,
        contentType: 'image/jpeg',
      });

    if (uploadError) {
      console.error('Avatar upload error:', uploadError);
      throw new Error(`Failed to upload avatar: ${uploadError.message}`);
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
    // Add cache buster to force refresh
    return `${data.publicUrl}?t=${Date.now()}`;
  };

  const handleSubmit = async () => {
    if (!validateForm() || !user) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      let avatarUrl = currentAvatarUrl;

      // Upload avatar if changed
      if (pendingAvatarBlob) {
        avatarUrl = await uploadAvatar(pendingAvatarBlob);
      }

      // Update profile (name and avatar)
      const profileChanged =
        formData.firstName !== currentFirstName ||
        formData.lastName !== currentLastName ||
        avatarUrl !== currentAvatarUrl;

      if (profileChanged) {
        const { error } = await updateProfile({
          firstName: formData.firstName,
          lastName: formData.lastName,
          avatarUrl,
        });
        if (error) throw error;
      }

      // Update email if changed
      const emailChanged = formData.email !== currentEmail;

      if (emailChanged) {
        const { error } = await updateEmail(formData.email);
        if (error) throw error;
      }

      // Clear pending avatar and close modal
      setPendingAvatarBlob(null);
      onClose();
    } catch (error) {
      console.error('Profile update error:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to update profile. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const displayName = [currentFirstName, currentLastName].filter(Boolean).join(' ') || 'User';

  const footerContent = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={isSaving}>
        Cancel
      </Button>
      <Button variant="primary" onClick={handleSubmit} disabled={isSaving}>
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" color="white" />
            Saving...
          </span>
        ) : (
          'Save Changes'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Profile"
      maxWidth="sm"
      footer={footerContent}
    >
      <div className="space-y-6">
        {/* Error Message */}
        {errorMessage && (
          <div className="p-3 bg-error-light border border-error rounded-lg">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-error"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm text-error">{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Avatar Upload */}
        <div className="flex justify-center">
          <AvatarUpload
            currentImageUrl={avatarPreviewUrl || currentAvatarUrl}
            name={displayName}
            onImageCropped={handleImageCropped}
            size={96}
            disabled={isSaving}
          />
        </div>

        {/* First Name */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            First Name
          </label>
          <Input
            type="text"
            value={formData.firstName}
            onChange={(e) => handleInputChange('firstName', e.target.value)}
            placeholder="Enter first name"
            disabled={isSaving}
          />
        </div>

        {/* Last Name */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Last Name
          </label>
          <Input
            type="text"
            value={formData.lastName}
            onChange={(e) => handleInputChange('lastName', e.target.value)}
            placeholder="Enter last name"
            disabled={isSaving}
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Email Address
          </label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            placeholder="email@example.com"
            error={errors.email}
            disabled={isSaving}
          />
          <p className="mt-1 text-xs font-mono text-vercel-gray-400">
            Changing your email will require confirmation via the new address.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default ProfileEditorModal;

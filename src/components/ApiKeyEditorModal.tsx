import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Spinner } from './Spinner';
import type { CreateApiKeyParams } from '../types';

interface ApiKeyEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: CreateApiKeyParams) => Promise<void>;
  isSaving: boolean;
  apiError?: string | null;
  onClearApiError?: () => void;
}

interface FormData {
  name: string;
  description: string;
}

const EMPTY_FORM: FormData = { name: '', description: '' };

export function ApiKeyEditorModal({
  isOpen,
  onClose,
  onSave,
  isSaving,
  apiError,
  onClearApiError,
}: ApiKeyEditorModalProps) {
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Reset form when modal opens (React-recommended pattern, mirrors UserEditorModal)
  const resetKey = `new-${isOpen}`;
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setFormData(EMPTY_FORM);
    setErrors({});
    onClearApiError?.();
  }

  const validateForm = (): boolean => {
    const newErrors: { name?: string } = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validateForm()) return;

    try {
      await onSave({
        name: formData.name.trim(),
        description: formData.description.trim() || null,
      });
      onClose();
    } catch {
      // Error surfaced through apiError
    }
  };

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === 'name') {
      setErrors((prev) => ({ ...prev, name: undefined }));
    }
    onClearApiError?.();
  };

  const footerContent = (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="button"
        variant="primary"
        onClick={() => handleSubmit()}
        disabled={isSaving}
      >
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" color="white" />
            Creating...
          </span>
        ) : (
          'Create Key'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create API Key"
      maxWidth="md"
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Input
          label="Name"
          type="text"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          placeholder="e.g. Butler – production"
          error={errors.name}
          required
        />

        <div>
          <label
            htmlFor="api-key-description"
            className="block text-sm font-medium text-vercel-gray-600 mb-1"
          >
            Description
          </label>
          <textarea
            id="api-key-description"
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            placeholder="What is this key used for? (optional)"
            rows={3}
            className="w-full !bg-white rounded-md border border-vercel-gray-200 focus:border-vercel-gray-400 focus:ring-1 focus:ring-vercel-gray-400 focus:outline-none transition-colors text-sm text-vercel-gray-600 placeholder:text-vercel-gray-200 px-3 py-2 resize-none"
          />
        </div>

        {apiError && (
          <div className="p-3 bg-error-light border border-error rounded-md">
            <p className="text-sm text-error">{apiError}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}

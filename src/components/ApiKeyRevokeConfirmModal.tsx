import { Modal } from './Modal';
import { Button } from './Button';
import type { ApiKey } from '../types';

interface ApiKeyRevokeConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: ApiKey | null;
  onConfirm: () => Promise<void> | void;
  isOperating: boolean;
}

export function ApiKeyRevokeConfirmModal({
  isOpen,
  onClose,
  apiKey,
  onConfirm,
  isOperating,
}: ApiKeyRevokeConfirmModalProps) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Revoke API Key"
      maxWidth="sm"
      centerTitle
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={isOperating}
          >
            {isOperating ? 'Revoking...' : 'Revoke Key'}
          </Button>
        </>
      }
    >
      <div className="text-center py-4">
        <svg
          className="mx-auto h-12 w-12 text-error mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-sm text-vercel-gray-600">
          Are you sure you want to revoke{' '}
          <span className="font-semibold">'{apiKey?.name ?? ''}'</span>?
        </p>
        <p className="text-xs text-vercel-gray-400 mt-2">
          This action cannot be undone. Any service using this key will immediately lose access.
        </p>
      </div>
    </Modal>
  );
}

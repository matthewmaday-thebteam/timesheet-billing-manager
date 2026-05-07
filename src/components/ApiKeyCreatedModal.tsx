import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';

interface ApiKeyCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  plaintext: string;
}

/**
 * One-shot modal that displays a newly created API key in plaintext.
 *
 * The plaintext is shown ONCE — once this modal is closed, the secret is
 * gone. To prevent users from dismissing without saving, the "Done" button
 * is disabled until the user has clicked "Copy" (success path) at least once.
 */
export function ApiKeyCreatedModal({
  isOpen,
  onClose,
  plaintext,
}: ApiKeyCreatedModalProps) {
  const [hasCopied, setHasCopied] = useState<boolean>(false);
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Reset hasCopied each time the modal is opened (React-recommended pattern)
  const resetKey = `${isOpen}-${plaintext}`;
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setHasCopied(false);
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plaintext);
      setHasCopied(true);
    } catch (e) {
      // Clipboard API can fail in insecure contexts — log but keep modal open
      console.error('Failed to copy API key to clipboard:', e);
    }
  };

  const footerContent = (
    <Button
      type="button"
      variant="primary"
      onClick={onClose}
      disabled={!hasCopied}
    >
      Done
    </Button>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="API Key Created"
      maxWidth="md"
      centerTitle
      footer={footerContent}
    >
      <div className="space-y-4">
        <p className="text-sm text-vercel-gray-600">
          Copy this key now. For security, it will not be shown again.
        </p>

        <div>
          <div className="flex gap-2 items-stretch">
            <Input readOnly size="sm" value={plaintext} />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCopy}
              className="shrink-0"
            >
              {hasCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-vercel-gray-400 mt-2">
            Store this key somewhere safe — closing this dialog removes it permanently.
          </p>
        </div>
      </div>
    </Modal>
  );
}

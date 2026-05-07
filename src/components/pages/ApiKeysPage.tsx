import { useState } from 'react';
import { useAdminApiKeys } from '../../hooks/useAdminApiKeys';
import { ApiKeysTable } from '../ApiKeysTable';
import { ApiKeyEditorModal } from '../ApiKeyEditorModal';
import { ApiKeyCreatedModal } from '../ApiKeyCreatedModal';
import { ApiKeyRevokeConfirmModal } from '../ApiKeyRevokeConfirmModal';
import { MetricCard } from '../MetricCard';
import { Button } from '../Button';
import type { ApiKey, CreateApiKeyParams } from '../../types';

export function ApiKeysPage() {
  const {
    apiKeys,
    loading,
    error,
    activeCount,
    revokedCount,
    createApiKey,
    revokeApiKey,
    clearError,
    isOperating,
  } = useAdminApiKeys();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
  const [isRevokeConfirmOpen, setIsRevokeConfirmOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleAddClick = () => {
    clearError();
    setIsEditorOpen(true);
  };

  const handleSaveApiKey = async (params: CreateApiKeyParams) => {
    const result = await createApiKey(params);
    setCreatedPlaintext(result.plaintext);
    setSuccessMessage(`API key "${params.name}" has been created`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCloseCreatedModal = () => {
    setCreatedPlaintext(null);
  };

  const handleRevokeClick = (apiKey: ApiKey) => {
    setKeyToRevoke(apiKey);
    setIsRevokeConfirmOpen(true);
  };

  const handleConfirmRevoke = async () => {
    if (!keyToRevoke) return;
    try {
      await revokeApiKey(keyToRevoke.id);
      setSuccessMessage(`API key "${keyToRevoke.name}" has been revoked`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch {
      // Error handled by hook
    }
    setIsRevokeConfirmOpen(false);
    setKeyToRevoke(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">API Keys</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Issue and revoke API keys for programmatic access via Manifest MCP
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={handleAddClick}>
            Create API Key
          </Button>
        </div>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="p-3 bg-success-light border border-success rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-success">{successMessage}</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-error">{error}</span>
            </div>
            <button
              onClick={clearError}
              aria-label="Dismiss error"
              className="text-error hover:opacity-80 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard title="Total Keys" value={apiKeys.length} loading={loading} />
        <MetricCard title="Active" value={activeCount} loading={loading} />
        <MetricCard title="Revoked" value={revokedCount} loading={loading} />
      </div>

      {/* API Keys Table */}
      <ApiKeysTable
        apiKeys={apiKeys}
        loading={loading}
        onRevoke={handleRevokeClick}
      />

      {/* Editor Modal (Create) */}
      <ApiKeyEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveApiKey}
        isSaving={isOperating}
        apiError={error}
        onClearApiError={clearError}
      />

      {/* Created Modal (one-shot plaintext) */}
      <ApiKeyCreatedModal
        isOpen={createdPlaintext !== null}
        onClose={handleCloseCreatedModal}
        plaintext={createdPlaintext ?? ''}
      />

      {/* Revoke Confirmation Modal */}
      <ApiKeyRevokeConfirmModal
        isOpen={isRevokeConfirmOpen}
        onClose={() => {
          setIsRevokeConfirmOpen(false);
          setKeyToRevoke(null);
        }}
        apiKey={keyToRevoke}
        onConfirm={handleConfirmRevoke}
        isOperating={isOperating}
      />
    </div>
  );
}

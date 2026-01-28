import { useState, useMemo } from 'react';
import { useLegalDocuments, type LegalDocumentType, type LegalDocument } from '../../hooks/useLegalDocuments';
import { Card } from '../Card';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { LegalModal } from '../LegalModal';

type TabType = 'privacy_policy' | 'terms_of_service';

export function LegalPage() {
  const {
    documents,
    activePrivacyPolicy,
    activeTermsOfService,
    isLoading,
    error,
    createVersion,
    publishVersion,
    refetch,
  } = useLegalDocuments();

  const [activeTab, setActiveTab] = useState<TabType>('privacy_policy');
  const [editContent, setEditContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<LegalDocument | null>(null);

  // Filter documents by type
  const privacyPolicyVersions = useMemo(
    () => documents.filter(d => d.document_type === 'privacy_policy'),
    [documents]
  );

  const termsOfServiceVersions = useMemo(
    () => documents.filter(d => d.document_type === 'terms_of_service'),
    [documents]
  );

  const currentVersions = activeTab === 'privacy_policy' ? privacyPolicyVersions : termsOfServiceVersions;
  const activeDocument = activeTab === 'privacy_policy' ? activePrivacyPolicy : activeTermsOfService;

  const handleStartEdit = () => {
    setEditContent(activeDocument?.content || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent('');
  };

  const handleSaveNewVersion = async () => {
    if (!editContent.trim()) return;

    setIsSaving(true);
    const result = await createVersion(activeTab as LegalDocumentType, editContent);
    setIsSaving(false);

    if (result) {
      setIsEditing(false);
      setEditContent('');
    }
  };

  const handlePublish = async (id: string) => {
    setIsPublishing(id);
    await publishVersion(id);
    setIsPublishing(null);
  };

  const getDocumentTitle = (type: string) => {
    return type === 'privacy_policy' ? 'Privacy Policy' : 'Terms of Service';
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Legal Documents</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage Privacy Policy and Terms of Service with version control
          </p>
        </div>
        <Button variant="secondary" onClick={refetch}>
          Refresh
        </Button>
      </div>

      {/* Error Alert */}
      {error && <Alert message={error} variant="error" />}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-vercel-gray-100">
        <button
          onClick={() => setActiveTab('privacy_policy')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'privacy_policy'
              ? 'text-bteam-brand border-bteam-brand'
              : 'text-vercel-gray-400 border-transparent hover:text-vercel-gray-600'
          }`}
        >
          Privacy Policy
          {activePrivacyPolicy && (
            <span className="ml-2 text-xs text-vercel-gray-300">v{activePrivacyPolicy.version}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('terms_of_service')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'terms_of_service'
              ? 'text-bteam-brand border-bteam-brand'
              : 'text-vercel-gray-400 border-transparent hover:text-vercel-gray-600'
          }`}
        >
          Terms of Service
          {activeTermsOfService && (
            <span className="ml-2 text-xs text-vercel-gray-300">v{activeTermsOfService.version}</span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading documents...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Editor / Current Content */}
          <div className="lg:col-span-2">
            <Card variant="default" padding="lg">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-vercel-gray-600">
                  {isEditing ? 'Create New Version' : 'Current Version'}
                </h2>
                {!isEditing && (
                  <Button variant="secondary" size="sm" onClick={handleStartEdit}>
                    Create New Version
                  </Button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-4">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-96 p-4 border border-vercel-gray-200 rounded-lg text-sm font-mono text-vercel-gray-600 focus:outline-none focus:ring-1 focus:ring-vercel-gray-400 focus:border-vercel-gray-400 resize-none"
                    placeholder="Enter document content (supports markdown headings: # ## ###)"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleSaveNewVersion}
                      disabled={isSaving || !editContent.trim()}
                    >
                      {isSaving ? (
                        <span className="flex items-center gap-2">
                          <Spinner size="sm" color="white" />
                          Saving...
                        </span>
                      ) : (
                        'Save as New Version'
                      )}
                    </Button>
                  </div>
                </div>
              ) : activeDocument ? (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-vercel-gray-400 font-mono bg-vercel-gray-50 p-4 rounded-lg overflow-auto max-h-96">
                    {activeDocument.content}
                  </pre>
                  <p className="text-xs text-vercel-gray-300 mt-4">
                    Published: {new Date(activeDocument.published_at || activeDocument.created_at).toLocaleDateString()}
                  </p>
                </div>
              ) : (
                <p className="text-vercel-gray-400 text-sm">
                  No document found. Create a new version to get started.
                </p>
              )}
            </Card>
          </div>

          {/* Version History */}
          <div>
            <Card variant="default" padding="lg">
              <h2 className="text-lg font-semibold text-vercel-gray-600 mb-4">
                Version History
              </h2>

              {currentVersions.length === 0 ? (
                <p className="text-vercel-gray-400 text-sm">No versions yet</p>
              ) : (
                <div className="space-y-3">
                  {currentVersions.map((doc) => (
                    <div
                      key={doc.id}
                      className={`p-3 rounded-lg border ${
                        doc.is_active
                          ? 'border-bteam-brand bg-bteam-brand-light'
                          : 'border-vercel-gray-100 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-vercel-gray-600">
                          Version {doc.version}
                        </span>
                        {doc.is_active && (
                          <span className="text-xs font-medium text-bteam-brand px-2 py-0.5 bg-white rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-vercel-gray-300 mb-2">
                        Created: {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewDoc(doc)}
                        >
                          Preview
                        </Button>
                        {!doc.is_active && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handlePublish(doc.id)}
                            disabled={isPublishing === doc.id}
                          >
                            {isPublishing === doc.id ? (
                              <span className="flex items-center gap-1">
                                <Spinner size="sm" />
                                Publishing...
                              </span>
                            ) : (
                              'Publish'
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewDoc && (
        <LegalModal
          isOpen={true}
          onClose={() => setPreviewDoc(null)}
          title={getDocumentTitle(previewDoc.document_type)}
          content={previewDoc.content}
          version={previewDoc.version}
          lastUpdated={previewDoc.published_at || previewDoc.created_at}
        />
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type LegalDocumentType = 'privacy_policy' | 'terms_of_service';

export interface LegalDocument {
  id: string;
  document_type: LegalDocumentType;
  version: number;
  content: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  published_at: string | null;
}

interface UseLegalDocumentsReturn {
  documents: LegalDocument[];
  activePrivacyPolicy: LegalDocument | null;
  activeTermsOfService: LegalDocument | null;
  isLoading: boolean;
  error: string | null;
  createVersion: (type: LegalDocumentType, content: string) => Promise<LegalDocument | null>;
  publishVersion: (id: string) => Promise<boolean>;
  refetch: () => void;
}

/**
 * Hook to manage legal documents (Privacy Policy and Terms of Service)
 */
export function useLegalDocuments(): UseLegalDocumentsReturn {
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Fetch all documents
  useEffect(() => {
    async function fetchDocuments() {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await supabase
          .from('legal_documents')
          .select('*')
          .order('document_type')
          .order('version', { ascending: false });

        if (fetchError) throw fetchError;
        setDocuments(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch legal documents');
        setDocuments([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchDocuments();
  }, [refetchTrigger]);

  // Get active documents
  const activePrivacyPolicy = documents.find(
    d => d.document_type === 'privacy_policy' && d.is_active
  ) || null;

  const activeTermsOfService = documents.find(
    d => d.document_type === 'terms_of_service' && d.is_active
  ) || null;

  // Create a new version
  const createVersion = useCallback(async (
    type: LegalDocumentType,
    content: string
  ): Promise<LegalDocument | null> => {
    try {
      // Get next version number
      const { data: versionData } = await supabase
        .rpc('get_next_legal_version', { p_document_type: type });

      const nextVersion = versionData || 1;

      // Insert new document
      const { data, error: insertError } = await supabase
        .from('legal_documents')
        .insert({
          document_type: type,
          version: nextVersion,
          content,
          is_active: false,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setRefetchTrigger(prev => prev + 1);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create document version');
      return null;
    }
  }, []);

  // Publish a version (make it active)
  const publishVersion = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: publishError } = await supabase
        .rpc('publish_legal_document', { p_id: id });

      if (publishError) throw publishError;

      setRefetchTrigger(prev => prev + 1);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish document');
      return false;
    }
  }, []);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  return {
    documents,
    activePrivacyPolicy,
    activeTermsOfService,
    isLoading,
    error,
    createVersion,
    publishVersion,
    refetch,
  };
}

/**
 * Hook to fetch only active legal documents (for public display)
 */
export function useActiveLegalDocuments() {
  const [privacyPolicy, setPrivacyPolicy] = useState<LegalDocument | null>(null);
  const [termsOfService, setTermsOfService] = useState<LegalDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchActiveDocuments() {
      setIsLoading(true);

      try {
        const { data } = await supabase
          .from('legal_documents')
          .select('*')
          .eq('is_active', true);

        if (data) {
          setPrivacyPolicy(data.find(d => d.document_type === 'privacy_policy') || null);
          setTermsOfService(data.find(d => d.document_type === 'terms_of_service') || null);
        }
      } catch {
        // Silent fail for public display
      } finally {
        setIsLoading(false);
      }
    }

    fetchActiveDocuments();
  }, []);

  return { privacyPolicy, termsOfService, isLoading };
}

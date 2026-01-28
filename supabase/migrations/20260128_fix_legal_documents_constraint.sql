-- Fix the unique constraint on legal_documents
-- The original constraint prevented multiple inactive versions per document type
-- This migration replaces it with a partial unique index that only enforces
-- uniqueness on active documents

-- Drop the problematic constraint
ALTER TABLE legal_documents DROP CONSTRAINT IF EXISTS unique_active_document;

-- Create a partial unique index that only enforces one active document per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_documents_unique_active
  ON legal_documents(document_type)
  WHERE is_active = true;

-- Legal Documents table with versioning
-- Stores Privacy Policy and Terms of Service with version history

CREATE TABLE IF NOT EXISTS legal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type IN ('privacy_policy', 'terms_of_service')),
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  published_at TIMESTAMPTZ,

  -- Note: unique active constraint handled by partial index below
  CONSTRAINT legal_documents_type_version_unique UNIQUE (document_type, version)
);

-- Index for quick lookup of active documents
CREATE INDEX idx_legal_documents_active ON legal_documents(document_type, is_active) WHERE is_active = true;

-- Index for version history
CREATE INDEX idx_legal_documents_type_version ON legal_documents(document_type, version DESC);

-- Partial unique index: only one active document per type
CREATE UNIQUE INDEX idx_legal_documents_unique_active ON legal_documents(document_type) WHERE is_active = true;

-- Function to get the next version number for a document type
CREATE OR REPLACE FUNCTION get_next_legal_version(p_document_type TEXT)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM legal_documents
  WHERE document_type = p_document_type;
$$ LANGUAGE SQL;

-- Function to publish a legal document (makes it active and deactivates others)
CREATE OR REPLACE FUNCTION publish_legal_document(p_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Deactivate current active document of the same type
  UPDATE legal_documents
  SET is_active = false
  WHERE document_type = (SELECT document_type FROM legal_documents WHERE id = p_id)
    AND is_active = true
    AND id != p_id;

  -- Activate the specified document
  UPDATE legal_documents
  SET is_active = true, published_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- RLS policies
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;

-- Anyone can read active documents (for displaying in modals)
CREATE POLICY "Active legal documents are publicly readable"
  ON legal_documents FOR SELECT
  USING (is_active = true);

-- Authenticated users can read all versions (for admin page)
CREATE POLICY "Authenticated users can read all legal documents"
  ON legal_documents FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert new versions
CREATE POLICY "Authenticated users can create legal documents"
  ON legal_documents FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update legal documents
CREATE POLICY "Authenticated users can update legal documents"
  ON legal_documents FOR UPDATE
  TO authenticated
  USING (true);

-- Insert default placeholder documents
INSERT INTO legal_documents (document_type, version, content, is_active, published_at)
VALUES
  ('privacy_policy', 1, '# Privacy Policy

## Introduction
This Privacy Policy describes how The B Team ("we", "us", or "our") collects, uses, and shares information about you when you use our services.

## Information We Collect
We collect information you provide directly to us, such as when you create an account, use our services, or contact us for support.

## How We Use Your Information
We use the information we collect to provide, maintain, and improve our services.

## Contact Us
If you have any questions about this Privacy Policy, please contact us at info@yourbteam.com.

*Last updated: January 2026*', true, now()),

  ('terms_of_service', 1, '# Terms of Service

## Acceptance of Terms
By accessing or using our services, you agree to be bound by these Terms of Service.

## Use of Services
You may use our services only as permitted by these terms and applicable law.

## User Accounts
You are responsible for maintaining the confidentiality of your account credentials.

## Termination
We may terminate or suspend your access to our services at any time.

## Contact Us
If you have any questions about these Terms of Service, please contact us at info@yourbteam.com.

*Last updated: January 2026*', true, now());

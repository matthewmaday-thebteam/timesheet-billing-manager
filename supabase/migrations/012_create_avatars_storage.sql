-- Create avatars storage bucket
-- This bucket stores user profile avatars

-- Create the avatars bucket (public for read access)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy: Allow authenticated users to upload their own avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
  OR name = auth.uid()::text || '.jpg'
  OR name = auth.uid()::text || '.png'
  OR name = auth.uid()::text || '.gif'
  OR name = auth.uid()::text || '.webp'
);

-- Policy: Allow authenticated users to update their own avatar
CREATE POLICY "Users can update own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR name = auth.uid()::text || '.jpg'
    OR name = auth.uid()::text || '.png'
    OR name = auth.uid()::text || '.gif'
    OR name = auth.uid()::text || '.webp'
  )
);

-- Policy: Allow authenticated users to delete their own avatar
CREATE POLICY "Users can delete own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR name = auth.uid()::text || '.jpg'
    OR name = auth.uid()::text || '.png'
    OR name = auth.uid()::text || '.gif'
    OR name = auth.uid()::text || '.webp'
  )
);

-- Policy: Allow public read access to all avatars (since bucket is public)
CREATE POLICY "Public read access for avatars"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

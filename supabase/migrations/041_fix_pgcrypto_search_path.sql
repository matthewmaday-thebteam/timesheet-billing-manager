-- ============================================================================
-- 041: Fix pgcrypto search path in admin_create_user
--
-- Problem: gen_salt() and crypt() from pgcrypto live in the "extensions" schema
-- on Supabase, but admin_create_user's search_path only includes public, auth.
-- ============================================================================

BEGIN;

-- Ensure pgcrypto extension exists
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- Recreate admin_create_user with extensions in search_path
CREATE OR REPLACE FUNCTION admin_create_user(
    p_email TEXT,
    p_password TEXT DEFAULT NULL,
    p_display_name TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'user',
    p_send_invite BOOLEAN DEFAULT true
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_result JSON;
BEGIN
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;

    -- Validate role
    IF p_role NOT IN ('admin', 'user') THEN
        RAISE EXCEPTION 'Invalid role: must be "admin" or "user"';
    END IF;

    -- Validate email format
    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'Invalid email format';
    END IF;

    -- Check if email already exists
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = LOWER(p_email)) THEN
        RAISE EXCEPTION 'A user with this email already exists';
    END IF;

    -- Generate user ID
    v_user_id := gen_random_uuid();

    -- Insert into auth.users
    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        aud,
        role,
        created_at,
        updated_at,
        confirmation_token,
        confirmation_sent_at
    ) VALUES (
        v_user_id,
        '00000000-0000-0000-0000-000000000000',
        LOWER(p_email),
        CASE
            WHEN p_password IS NOT NULL AND p_password != ''
            THEN crypt(p_password, gen_salt('bf'))
            ELSE ''
        END,
        CASE
            WHEN p_password IS NOT NULL AND p_password != ''
            THEN NOW()
            ELSE NULL
        END,
        jsonb_build_object('provider', 'email', 'role', p_role),
        jsonb_build_object('display_name', COALESCE(p_display_name, split_part(p_email, '@', 1))),
        'authenticated',
        'authenticated',
        NOW(),
        NOW(),
        CASE
            WHEN p_password IS NULL OR p_password = ''
            THEN encode(gen_random_bytes(32), 'hex')
            ELSE NULL
        END,
        CASE
            WHEN p_password IS NULL OR p_password = ''
            THEN NOW()
            ELSE NULL
        END
    );

    -- Create corresponding user_profiles entry
    INSERT INTO user_profiles (id, display_name, created_by)
    VALUES (
        v_user_id,
        COALESCE(p_display_name, split_part(p_email, '@', 1)),
        auth.uid()
    );

    -- Build result
    v_result := json_build_object(
        'success', true,
        'user_id', v_user_id,
        'email', LOWER(p_email),
        'role', p_role,
        'is_verified', (p_password IS NOT NULL AND p_password != ''),
        'requires_invite', (p_password IS NULL OR p_password = '')
    );

    RETURN v_result;
END;
$$;

-- Re-grant permissions (CREATE OR REPLACE preserves grants, but be explicit)
GRANT EXECUTE ON FUNCTION admin_create_user(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

DO $$
BEGIN
    RAISE NOTICE '041 Fix pgcrypto search path: admin_create_user now includes extensions schema';
END $$;

COMMIT;

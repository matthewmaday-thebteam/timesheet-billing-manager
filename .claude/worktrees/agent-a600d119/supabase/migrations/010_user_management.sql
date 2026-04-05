-- ============================================================================
-- 010: User Management System
--
-- Architecture Philosophy:
-- - auth.users is the SINGLE SOURCE OF TRUTH for user identity
-- - user_profiles extends auth.users with app-specific metadata
-- - Roles stored in auth.users.raw_app_meta_data for JWT access
-- - RLS policies enforce security at the database level
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create user_profiles table (extends auth.users)
-- ============================================================================
-- This table stores application-specific user data that doesn't belong in auth.users
-- We intentionally keep this minimal - auth.users handles the heavy lifting

CREATE TABLE IF NOT EXISTS user_profiles (
    -- PK is the auth.users.id - ensures 1:1 relationship
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Display information (cached from auth.users for query convenience)
    display_name TEXT,

    -- Application-specific fields
    created_by UUID REFERENCES auth.users(id),

    -- Audit timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_created_at ON user_profiles(created_at DESC);

-- ============================================================================
-- STEP 2: Create updated_at trigger for user_profiles
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profiles_updated_at();

-- ============================================================================
-- STEP 3: Create view for admin user management
-- ============================================================================
-- This view joins auth.users with user_profiles for admin operations
-- SECURITY DEFINER ensures it runs with elevated privileges

CREATE OR REPLACE VIEW admin_users_view AS
SELECT
    au.id,
    au.email,
    au.email_confirmed_at,
    au.created_at,
    au.last_sign_in_at,
    au.raw_app_meta_data->>'role' AS role,
    COALESCE(up.display_name, au.raw_user_meta_data->>'display_name', split_part(au.email, '@', 1)) AS display_name,
    up.created_by,
    -- Computed fields for UI
    CASE WHEN au.email_confirmed_at IS NOT NULL THEN true ELSE false END AS is_verified
FROM auth.users au
LEFT JOIN user_profiles up ON up.id = au.id;

-- ============================================================================
-- STEP 4: Helper function to check if user is admin
-- ============================================================================

CREATE OR REPLACE FUNCTION is_admin(user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = user_id
        AND raw_app_meta_data->>'role' = 'admin'
    );
$$;

-- ============================================================================
-- STEP 5: Helper function to count admins
-- ============================================================================

CREATE OR REPLACE FUNCTION count_admins()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT COUNT(*)::INTEGER
    FROM auth.users
    WHERE raw_app_meta_data->>'role' = 'admin';
$$;

-- ============================================================================
-- STEP 6: Create user with role (Admin only)
-- ============================================================================
-- Creates a user in auth.users with specified role
-- Returns the new user's ID or raises an error

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
SET search_path = public, auth
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
    -- Note: This creates an unverified user. They will need to set password via invite/reset flow.
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
        -- If password provided, hash it; otherwise leave empty for invite flow
        CASE
            WHEN p_password IS NOT NULL AND p_password != ''
            THEN crypt(p_password, gen_salt('bf'))
            ELSE ''
        END,
        -- Only confirm email if password is provided (direct creation vs invite)
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
        -- Generate confirmation token if no password (invite flow)
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

-- ============================================================================
-- STEP 7: Update user role (Admin only, with last-admin protection)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_update_user_role(
    p_user_id UUID,
    p_new_role TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;

    -- Validate role
    IF p_new_role NOT IN ('admin', 'user') THEN
        RAISE EXCEPTION 'Invalid role: must be "admin" or "user"';
    END IF;

    -- Get current role
    SELECT raw_app_meta_data->>'role' INTO v_current_role
    FROM auth.users WHERE id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    -- If demoting from admin, check if this is the last admin
    IF v_current_role = 'admin' AND p_new_role = 'user' THEN
        v_admin_count := count_admins();
        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot demote the last admin. Promote another user to admin first.';
        END IF;
    END IF;

    -- Update the role
    UPDATE auth.users
    SET
        raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', p_new_role),
        updated_at = NOW()
    WHERE id = p_user_id;

    RETURN json_build_object(
        'success', true,
        'user_id', p_user_id,
        'previous_role', v_current_role,
        'new_role', p_new_role
    );
END;
$$;

-- ============================================================================
-- STEP 8: Delete user (Admin only, with last-admin protection)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_delete_user(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_role TEXT;
    v_user_email TEXT;
    v_admin_count INTEGER;
BEGIN
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;

    -- Prevent self-deletion
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot delete your own account';
    END IF;

    -- Get user info
    SELECT raw_app_meta_data->>'role', email
    INTO v_user_role, v_user_email
    FROM auth.users WHERE id = p_user_id;

    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    -- If deleting an admin, check if this is the last admin
    IF v_user_role = 'admin' THEN
        v_admin_count := count_admins();
        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot delete the last admin. Promote another user to admin first.';
        END IF;
    END IF;

    -- Delete from auth.users (CASCADE will handle user_profiles)
    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN json_build_object(
        'success', true,
        'deleted_user_id', p_user_id,
        'deleted_email', v_user_email
    );
END;
$$;

-- ============================================================================
-- STEP 9: List users (Admin only)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE (
    id UUID,
    email TEXT,
    display_name TEXT,
    role TEXT,
    is_verified BOOLEAN,
    created_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
BEGIN
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;

    RETURN QUERY
    SELECT
        v.id,
        v.email,
        v.display_name,
        v.role,
        v.is_verified,
        v.created_at,
        v.last_sign_in_at
    FROM admin_users_view v
    ORDER BY v.created_at DESC;
END;
$$;

-- ============================================================================
-- STEP 10: Get single user details (Admin only)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_user(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;

    SELECT json_build_object(
        'id', v.id,
        'email', v.email,
        'display_name', v.display_name,
        'role', v.role,
        'is_verified', v.is_verified,
        'created_at', v.created_at,
        'last_sign_in_at', v.last_sign_in_at,
        'created_by', v.created_by
    ) INTO v_result
    FROM admin_users_view v
    WHERE v.id = p_user_id;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    RETURN v_result;
END;
$$;

-- ============================================================================
-- STEP 11: Update user display name (Admin or self)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_display_name(
    p_user_id UUID,
    p_display_name TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Security check: must be admin or the user themselves
    IF NOT is_admin() AND auth.uid() != p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Validate display name
    IF p_display_name IS NULL OR LENGTH(TRIM(p_display_name)) < 1 THEN
        RAISE EXCEPTION 'Display name cannot be empty';
    END IF;

    -- Update user_profiles
    INSERT INTO user_profiles (id, display_name)
    VALUES (p_user_id, TRIM(p_display_name))
    ON CONFLICT (id) DO UPDATE
    SET display_name = TRIM(p_display_name);

    -- Also update auth.users metadata for consistency
    UPDATE auth.users
    SET
        raw_user_meta_data = raw_user_meta_data || jsonb_build_object('display_name', TRIM(p_display_name)),
        updated_at = NOW()
    WHERE id = p_user_id;

    RETURN json_build_object(
        'success', true,
        'user_id', p_user_id,
        'display_name', TRIM(p_display_name)
    );
END;
$$;

-- ============================================================================
-- STEP 12: Trigger password reset email (Admin only)
-- ============================================================================
-- Note: This function generates a reset token. The actual email sending
-- must be handled by the application layer using Supabase Auth API.

CREATE OR REPLACE FUNCTION admin_generate_password_reset(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_email TEXT;
    v_reset_token TEXT;
BEGIN
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;

    -- Get user email
    SELECT email INTO v_user_email
    FROM auth.users WHERE id = p_user_id;

    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    -- Generate reset token
    v_reset_token := encode(gen_random_bytes(32), 'hex');

    -- Update user with reset token
    UPDATE auth.users
    SET
        recovery_token = v_reset_token,
        recovery_sent_at = NOW(),
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Return info needed by application to send email
    RETURN json_build_object(
        'success', true,
        'user_id', p_user_id,
        'email', v_user_email,
        'message', 'Use Supabase Admin API to send password reset email'
    );
END;
$$;

-- ============================================================================
-- STEP 13: RLS Policies for user_profiles
-- ============================================================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Admins can see all profiles
CREATE POLICY "Admins can view all profiles"
    ON user_profiles FOR SELECT
    TO authenticated
    USING (is_admin());

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
    ON user_profiles FOR SELECT
    TO authenticated
    USING (id = auth.uid());

-- Admins can insert profiles (for user creation)
CREATE POLICY "Admins can insert profiles"
    ON user_profiles FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

-- Admins can update any profile
CREATE POLICY "Admins can update any profile"
    ON user_profiles FOR UPDATE
    TO authenticated
    USING (is_admin());

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
    ON user_profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid());

-- Admins can delete profiles
CREATE POLICY "Admins can delete profiles"
    ON user_profiles FOR DELETE
    TO authenticated
    USING (is_admin());

-- ============================================================================
-- STEP 14: Grant permissions
-- ============================================================================

-- Grant access to the view
GRANT SELECT ON admin_users_view TO authenticated;

-- Grant execute on helper functions
GRANT EXECUTE ON FUNCTION is_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION count_admins() TO authenticated;

-- Grant execute on admin functions (RLS enforced inside functions)
GRANT EXECUTE ON FUNCTION admin_create_user(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_display_name(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_generate_password_reset(UUID) TO authenticated;

-- ============================================================================
-- STEP 15: Create initial admin user setup function
-- ============================================================================
-- This is a one-time setup function to promote an existing user to admin
-- CRITICAL: Run this manually for the first admin, then consider dropping it

CREATE OR REPLACE FUNCTION setup_initial_admin(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID;
    v_admin_count INTEGER;
BEGIN
    -- Check if any admins already exist
    v_admin_count := count_admins();
    IF v_admin_count > 0 THEN
        RAISE EXCEPTION 'Admin already exists. Use admin_create_user or admin_update_user_role instead.';
    END IF;

    -- Find the user
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = LOWER(p_email);

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User with email % not found', p_email;
    END IF;

    -- Promote to admin
    UPDATE auth.users
    SET
        raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'admin'),
        updated_at = NOW()
    WHERE id = v_user_id;

    -- Create user_profiles entry if not exists
    INSERT INTO user_profiles (id, display_name)
    VALUES (v_user_id, split_part(p_email, '@', 1))
    ON CONFLICT (id) DO NOTHING;

    RETURN json_build_object(
        'success', true,
        'message', 'Initial admin created successfully',
        'admin_email', p_email,
        'admin_id', v_user_id
    );
END;
$$;

-- Only service_role can run initial setup
GRANT EXECUTE ON FUNCTION setup_initial_admin(TEXT) TO service_role;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '010 User Management migration complete:';
    RAISE NOTICE '  - user_profiles table created';
    RAISE NOTICE '  - admin_users_view created';
    RAISE NOTICE '  - Admin CRUD functions created with last-admin protection';
    RAISE NOTICE '  - RLS policies applied';
    RAISE NOTICE '';
    RAISE NOTICE 'NEXT STEPS:';
    RAISE NOTICE '  1. Run setup_initial_admin(your_email) via service_role to create first admin';
    RAISE NOTICE '  2. Configure Supabase Auth redirect URLs in dashboard';
    RAISE NOTICE '  3. Implement client-side password reset flow';
END $$;

COMMIT;

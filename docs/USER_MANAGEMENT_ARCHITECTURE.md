# User Management Database Architecture

## Overview

This document describes the database architecture for user management in the Timesheet Billing Manager application. The design prioritizes **security**, **simplicity**, and **proper integration with Supabase Auth**.

## Design Philosophy

### auth.users as Single Source of Truth

We leverage Supabase's `auth.users` table as the primary user store rather than creating a parallel user table. This approach:

1. **Avoids data duplication** - Email, password, verification status live in one place
2. **Leverages Supabase Auth features** - Password reset, email verification, session management
3. **Simplifies security** - No risk of auth/user data getting out of sync
4. **Enables JWT claims** - Role stored in `raw_app_meta_data` is included in JWT

### Minimal Extension via user_profiles

The `user_profiles` table extends `auth.users` with application-specific data only:

```
auth.users (Supabase managed)      user_profiles (our extension)
+------------------+               +------------------+
| id (UUID PK)     | <------------ | id (UUID PK/FK)  |
| email            |               | display_name     |
| encrypted_pass   |               | created_by       |
| email_confirmed  |               | created_at       |
| raw_app_meta_data|               | updated_at       |
| raw_user_meta_data|              +------------------+
| created_at       |
| last_sign_in_at  |
+------------------+
```

## Schema Details

### user_profiles Table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key, references auth.users(id) with CASCADE delete |
| display_name | TEXT | User's display name for UI |
| created_by | UUID | Admin who created this user (audit trail) |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Auto-updated on changes |

### Role Storage

Roles are stored in `auth.users.raw_app_meta_data.role`:

```json
{
  "provider": "email",
  "role": "admin"  // or "user"
}
```

This ensures the role is included in the JWT token, enabling client-side role checks without database queries.

## Security Model

### Row Level Security (RLS)

All operations go through RLS-protected paths:

| Operation | Admin | Regular User |
|-----------|-------|--------------|
| View all users | Yes | No |
| View own profile | Yes | Yes |
| Create users | Yes | No |
| Update any user | Yes | No |
| Update own profile | Yes | Yes |
| Delete users | Yes | No |
| Delete self | No | No |

### Last Admin Protection

The system prevents removing the last admin through multiple safeguards:

1. **admin_update_user_role()** - Checks admin count before demoting
2. **admin_delete_user()** - Checks admin count before deleting an admin
3. **Self-deletion blocked** - Admins cannot delete themselves

```sql
-- Example protection logic
IF v_current_role = 'admin' AND p_new_role = 'user' THEN
    v_admin_count := count_admins();
    IF v_admin_count <= 1 THEN
        RAISE EXCEPTION 'Cannot demote the last admin.';
    END IF;
END IF;
```

### SECURITY DEFINER Functions

All admin functions use `SECURITY DEFINER` to execute with elevated privileges while enforcing access control internally:

```sql
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs with function owner's privileges
STABLE
SET search_path = public, auth  -- Prevents search path injection
AS $$
BEGIN
    -- First thing: verify caller is admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;
    -- ... rest of function
END;
$$;
```

## API Functions

### Admin Operations

| Function | Purpose | Returns |
|----------|---------|---------|
| `admin_create_user(email, password, display_name, role, send_invite)` | Create new user | JSON with user_id, status |
| `admin_update_user_role(user_id, new_role)` | Change user role | JSON with old/new role |
| `admin_delete_user(user_id)` | Remove user | JSON confirmation |
| `admin_list_users()` | Get all users | Table of user data |
| `admin_get_user(user_id)` | Get single user details | JSON with user data |
| `admin_generate_password_reset(user_id)` | Trigger password reset | JSON with status |

### User Operations

| Function | Purpose | Returns |
|----------|---------|---------|
| `update_user_display_name(user_id, display_name)` | Update display name | JSON confirmation |
| `is_admin(user_id)` | Check admin status | BOOLEAN |
| `count_admins()` | Count admin users | INTEGER |

### Initial Setup

| Function | Purpose | Access |
|----------|---------|--------|
| `setup_initial_admin(email)` | Promote first admin | service_role only |

## User Creation Flows

### Flow 1: Verified User (With Password)

```
Admin calls admin_create_user(email, password, name, 'user', false)
    |
    v
User created in auth.users with:
  - encrypted_password set
  - email_confirmed_at = NOW()
    |
    v
User can immediately sign in
```

**Client code:**
```typescript
const { data, error } = await supabase.rpc('admin_create_user', {
  p_email: 'user@example.com',
  p_password: 'SecurePassword123!',
  p_display_name: 'John Doe',
  p_role: 'user',
  p_send_invite: false
});
```

### Flow 2: Unverified User (Invite Flow)

```
Admin calls admin_create_user(email, null, name, 'user', true)
    |
    v
User created in auth.users with:
  - encrypted_password empty
  - email_confirmed_at = NULL
  - confirmation_token generated
    |
    v
Application sends invite email with magic link
    |
    v
User clicks link, sets password, account verified
```

**Client code:**
```typescript
// Create unverified user
const { data, error } = await supabase.rpc('admin_create_user', {
  p_email: 'user@example.com',
  p_password: null,
  p_display_name: 'John Doe',
  p_role: 'user',
  p_send_invite: true
});

// Then trigger invite email via Supabase Admin API
await supabaseAdmin.auth.admin.inviteUserByEmail('user@example.com', {
  redirectTo: 'https://yourapp.com/set-password'
});
```

## Password Reset Flow

### Step 1: User Requests Reset

```typescript
// Using AuthContext (already implemented)
const { error } = await resetPassword(email);

// This calls:
supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/reset-password`,
});
```

### Step 2: User Clicks Email Link

User is redirected to `/reset-password` with tokens in URL fragment.

### Step 3: Application Updates Password

```typescript
// In your ResetPassword component
const { data, error } = await supabase.auth.updateUser({
  password: newPassword
});
```

### Supabase Dashboard Configuration

**CRITICAL:** Configure redirect URLs in Supabase Dashboard:

1. Go to Authentication > URL Configuration
2. Add to "Redirect URLs":
   - `https://yourdomain.com/reset-password`
   - `https://yourdomain.com/set-password` (for invites)
   - `http://localhost:5173/reset-password` (for local dev)

## Client-Side Implementation

### TypeScript Types

```typescript
// src/types/user.ts
export interface AppUser {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'user';
  is_verified: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface CreateUserParams {
  email: string;
  password?: string;
  display_name?: string;
  role?: 'admin' | 'user';
  send_invite?: boolean;
}
```

### Admin Hook Example

```typescript
// src/hooks/useAdminUsers.ts
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { AppUser } from '../types/user';

export function useAdminUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc('admin_list_users');
      if (error) throw error;
      setUsers(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, []);

  const createUser = async (params: CreateUserParams) => {
    const { data, error } = await supabase.rpc('admin_create_user', {
      p_email: params.email,
      p_password: params.password || null,
      p_display_name: params.display_name || null,
      p_role: params.role || 'user',
      p_send_invite: params.send_invite ?? true
    });
    if (error) throw error;
    await fetchUsers(); // Refresh list
    return data;
  };

  const updateUserRole = async (userId: string, role: 'admin' | 'user') => {
    const { data, error } = await supabase.rpc('admin_update_user_role', {
      p_user_id: userId,
      p_new_role: role
    });
    if (error) throw error;
    await fetchUsers();
    return data;
  };

  const deleteUser = async (userId: string) => {
    const { data, error } = await supabase.rpc('admin_delete_user', {
      p_user_id: userId
    });
    if (error) throw error;
    await fetchUsers();
    return data;
  };

  return {
    users,
    loading,
    error,
    fetchUsers,
    createUser,
    updateUserRole,
    deleteUser
  };
}
```

### Role Check in Components

```typescript
// Check role from JWT (fast, no DB query)
import { useAuth } from '../contexts/AuthContext';

function AdminPanel() {
  const { user } = useAuth();
  const isAdmin = user?.app_metadata?.role === 'admin';

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <AdminContent />;
}
```

## Migration Path

### Step 1: Run Migration

```bash
# Via Supabase CLI
supabase db push

# Or run SQL directly in Supabase SQL Editor
```

### Step 2: Create Initial Admin

Run this in Supabase SQL Editor or via service_role:

```sql
SELECT setup_initial_admin('your-admin-email@example.com');
```

### Step 3: Verify Setup

```sql
-- Check admin exists
SELECT * FROM admin_users_view WHERE role = 'admin';

-- Verify admin count function works
SELECT count_admins();
```

### Step 4: Configure Supabase Dashboard

1. **Redirect URLs:** Add your production and local URLs
2. **Email Templates:** Customize invite and reset emails if desired
3. **Rate Limiting:** Configure auth rate limits appropriately

## Setup & Troubleshooting

### Environment Configuration

**CRITICAL:** The frontend must use the **anon (public) key**, NOT the service role key.

```env
# .env file
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_KEY=eyJhbG...  # This must be the ANON key, not service_role
```

The anon key JWT payload contains `"role": "anon"`. The service_role key contains `"role": "service_role"`.

### Supabase Dashboard Configuration

1. **Authentication > URL Configuration:**
   - Site URL: `https://your-production-domain.com`
   - Redirect URLs:
     - `https://your-production-domain.com/reset-password`
     - `https://your-production-domain.com/**`
     - `http://localhost:5173/reset-password` (for dev)

### Common Issues

#### "Access denied: admin privileges required"
1. Verify the user has admin role: Check `auth.users.raw_app_meta_data->>'role'` equals `'admin'`
2. Ensure using anon key (not service_role) in frontend
3. User must log out and back in after being promoted to admin to get fresh JWT

#### "structure of query does not match function result type"
The `admin_list_users()` function return type doesn't match the query. Fix by running:
```sql
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
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required';
    END IF;

    RETURN QUERY
    SELECT
        au.id,
        au.email::TEXT,
        COALESCE(up.display_name, au.raw_user_meta_data->>'display_name', split_part(au.email, '@', 1))::TEXT,
        (au.raw_app_meta_data->>'role')::TEXT,
        (au.email_confirmed_at IS NOT NULL),
        au.created_at,
        au.last_sign_in_at
    FROM auth.users au
    LEFT JOIN user_profiles up ON up.id = au.id
    ORDER BY au.created_at DESC;
END;
$$;
```

### Vercel Deployment

Environment variables in Vercel override `.env` files. Update via:
1. Vercel Dashboard > Project > Settings > Environment Variables
2. Or CLI: `vercel env add VITE_SUPABASE_KEY production`

After changing environment variables, redeploy: `vercel --prod`

---

## Testing Checklist

- [x] Create user with password (verified)
- [x] Create user without password (invite flow)
- [x] Update user role to admin
- [x] Attempt to demote last admin (should fail)
- [x] Attempt to delete last admin (should fail)
- [x] Self-deletion blocked
- [x] Password reset email sends
- [x] Password reset redirect works
- [x] Non-admin cannot access admin functions
- [x] User can update own display name

## Security Audit Checklist

- [x] All admin functions check `is_admin()` first
- [x] SECURITY DEFINER with explicit search_path
- [x] Input validation (email format, role values)
- [x] SQL injection prevented (parameterized queries)
- [x] Last admin protection on role change AND delete
- [x] Self-deletion prevented
- [x] RLS enabled on user_profiles
- [x] Minimal data exposure in views
- [x] Password never returned or logged
- [x] CASCADE delete ensures no orphaned profiles

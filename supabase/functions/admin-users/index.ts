import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // --- Authenticate caller ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // Verify the caller's JWT with anon client
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Verify caller is admin via RPC
    const { data: isAdmin, error: adminCheckError } = await supabaseAuth.rpc('is_admin');
    if (adminCheckError || !isAdmin) {
      return jsonResponse({ error: 'Forbidden: admin access required' }, 403);
    }

    // --- Parse request body ---
    const { email, password, display_name, role, send_invite, redirect_to } = await req.json();

    if (!email || typeof email !== 'string') {
      return jsonResponse({ error: 'email is required' }, 400);
    }

    const userRole = role || 'admin';
    const shouldInvite = send_invite ?? true;

    // --- Service-role client for admin operations ---
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // --- Create the auth user ---
    let newUserId: string;
    let isVerified: boolean;

    if (shouldInvite) {
      // Send invite email — user sets their own password
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { display_name: display_name || email, role: userRole, needs_password_setup: true },
        redirectTo: redirect_to || undefined,
      });

      if (inviteError) {
        return jsonResponse({ error: inviteError.message }, 400);
      }

      newUserId = inviteData.user.id;
      isVerified = false; // invite not yet accepted
    } else {
      // Create user directly with password, mark email as confirmed
      if (!password) {
        return jsonResponse({ error: 'password is required when send_invite is false' }, 400);
      }

      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: display_name || email, role: userRole },
      });

      if (createError) {
        return jsonResponse({ error: createError.message }, 400);
      }

      newUserId = createData.user.id;
      isVerified = true;
    }

    // --- Set role in raw_app_meta_data ---
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(newUserId, {
      app_metadata: { role: userRole },
    });

    if (updateError) {
      console.error('Failed to set app_metadata role:', updateError.message);
      // Non-fatal: user exists but role may not be in app_metadata yet
    }

    // --- Create user_profiles row ---
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .insert({
        id: newUserId,
        display_name: display_name || email,
      });

    if (profileError) {
      console.error('Failed to create user_profiles row:', profileError.message);
      // Non-fatal: the user exists in auth, profile can be retried
    }

    // --- Return result matching CreateUserResult shape ---
    return jsonResponse({
      success: true,
      user_id: newUserId,
      email,
      role: userRole,
      is_verified: isVerified,
      requires_invite: shouldInvite,
    });
  } catch (error) {
    console.error('admin-users error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

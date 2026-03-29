import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: qbo-auth-start
// =============================================================================
// Initiates the QuickBooks Online OAuth 2.0 authorization flow.
//
// POST (authenticated — requires valid Supabase session)
//
// Returns JSON with the Intuit authorization URL that the frontend should
// redirect to. A cryptographic CSRF state token is generated and stored in
// qbo_oauth_state for verification during the callback.
// =============================================================================

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
  // --- CORS preflight ---
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

    // --- Read QBO configuration from secrets ---
    const clientId = Deno.env.get('QUICKBOOKS_DEV_CLIENTID');
    const redirectUri = Deno.env.get('QUICKBOOKS_DEV_REDIRECT');

    if (!clientId || !redirectUri) {
      console.error('Missing QBO configuration secrets');
      return jsonResponse({ error: 'QuickBooks integration is not configured' }, 500);
    }

    // --- Service-role client for state storage ---
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // --- Clean up expired states (older than 10 minutes) ---
    await supabaseAdmin.rpc('cleanup_expired_qbo_oauth_states');

    // --- Generate cryptographic CSRF state ---
    const state = crypto.randomUUID();

    const { error: stateError } = await supabaseAdmin
      .from('qbo_oauth_state')
      .insert({ state });

    if (stateError) {
      console.error('Failed to store OAuth state:', stateError.message);
      return jsonResponse({ error: 'Failed to initiate authorization flow' }, 500);
    }

    // --- Build Intuit authorization URL ---
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state,
    });

    const authorizationUrl = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;

    return jsonResponse({
      success: true,
      authorization_url: authorizationUrl,
    });
  } catch (error) {
    console.error('qbo-auth-start error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

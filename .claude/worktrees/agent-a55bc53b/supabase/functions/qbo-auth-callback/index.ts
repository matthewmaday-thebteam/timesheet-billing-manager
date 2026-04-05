import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: qbo-auth-callback
// =============================================================================
// Handles the OAuth 2.0 callback redirect from Intuit after the user
// authorizes the QuickBooks Online connection.
//
// GET (browser redirect — no auth header)
//
// Query parameters from Intuit:
//   - code: authorization code to exchange for tokens
//   - state: CSRF state token to verify against qbo_oauth_state
//   - realmId: the QBO Company ID
//
// On success: redirects browser to APP_BASE_URL/?qbo_connected=true
// On error: redirects browser to APP_BASE_URL/?qbo_error=<code>
//   Error codes: invalid_request, invalid_state, expired_state,
//                token_exchange_failed, token_exchange_invalid, storage_failed
// =============================================================================

const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://manifest.yourbteam.com';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function redirectResponse(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { 'Location': url },
  });
}

serve(async (req) => {
  // This endpoint handles a browser GET redirect — no CORS preflight needed.
  // However, we still handle OPTIONS gracefully in case of unexpected calls.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  if (req.method !== 'GET') {
    return redirectResponse(`${APP_BASE_URL}/?qbo_error=invalid_request`);
  }

  try {
    // --- Extract query parameters ---
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const realmId = url.searchParams.get('realmId');

    if (!code || !state || !realmId) {
      console.error('Missing required query parameters:', { code: !!code, state: !!state, realmId: !!realmId });
      return redirectResponse(`${APP_BASE_URL}/?qbo_error=invalid_request`);
    }

    // --- Service-role Supabase client (no user auth available on redirect) ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // --- Verify CSRF state ---
    const { data: stateRow, error: stateError } = await supabaseAdmin
      .from('qbo_oauth_state')
      .select('id, created_at')
      .eq('state', state)
      .single();

    if (stateError || !stateRow) {
      console.error('Invalid or expired OAuth state:', state);
      return redirectResponse(`${APP_BASE_URL}/?qbo_error=invalid_state`);
    }

    // Check if the state is older than 10 minutes
    const stateAge = Date.now() - new Date(stateRow.created_at).getTime();
    if (stateAge > 10 * 60 * 1000) {
      console.error('OAuth state expired (older than 10 minutes):', state);
      // Clean up the expired state
      await supabaseAdmin.from('qbo_oauth_state').delete().eq('id', stateRow.id);
      return redirectResponse(`${APP_BASE_URL}/?qbo_error=expired_state`);
    }

    // Delete the state row (one-time use)
    await supabaseAdmin.from('qbo_oauth_state').delete().eq('id', stateRow.id);

    // --- Exchange authorization code for tokens ---
    const clientId = Deno.env.get('QUICKBOOKS_DEV_CLIENTID');
    const clientSecret = Deno.env.get('QUICKBOOKS_DEV_SECRET');
    const redirectUri = Deno.env.get('QUICKBOOKS_DEV_REDIRECT');

    if (!clientId || !clientSecret || !redirectUri) {
      console.error('Missing QBO configuration secrets');
      return redirectResponse(`${APP_BASE_URL}/?qbo_error=token_exchange_failed`);
    }

    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    const tokenResponse = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error('Intuit token exchange failed:', tokenResponse.status, errorBody);
      return redirectResponse(`${APP_BASE_URL}/?qbo_error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();

    if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
      console.error('Intuit token exchange returned unexpected shape:', Object.keys(tokens));
      return redirectResponse(`${APP_BASE_URL}/?qbo_error=token_exchange_invalid`);
    }

    // --- Calculate expiry timestamps ---
    const now = Date.now();
    const expiresAt = new Date(now + tokens.expires_in * 1000).toISOString();
    const refreshExpiresAt = tokens.x_refresh_token_expires_in
      ? new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString()
      : null;

    // --- Upsert tokens in qbo_oauth_tokens (keyed on realm_id) ---
    const { error: upsertError } = await supabaseAdmin
      .from('qbo_oauth_tokens')
      .upsert(
        {
          realm_id: realmId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type || 'bearer',
          expires_at: expiresAt,
          refresh_expires_at: refreshExpiresAt,
        },
        { onConflict: 'realm_id' },
      );

    if (upsertError) {
      console.error('Failed to store QBO tokens:', upsertError.message);
      return redirectResponse(`${APP_BASE_URL}/?qbo_error=storage_failed`);
    }

    // --- Success — redirect back to the app ---
    return redirectResponse(`${APP_BASE_URL}/?qbo_connected=true`);
  } catch (error) {
    console.error('qbo-auth-callback error:', error);
    return redirectResponse(`${APP_BASE_URL}/?qbo_error=token_exchange_failed`);
  }
});

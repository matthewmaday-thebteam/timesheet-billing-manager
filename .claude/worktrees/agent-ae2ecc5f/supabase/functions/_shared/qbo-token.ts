// =============================================================================
// Shared Module: QBO Token Management
// =============================================================================
// Provides a single function `getValidToken()` that returns a valid QBO
// access token, automatically refreshing it if expired or near-expiry.
//
// Usage from any Edge Function:
//   import { getValidToken } from '../_shared/qbo-token.ts';
//   const { access_token, realm_id } = await getValidToken(supabaseServiceClient);
// =============================================================================

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Returned by getValidToken on success. */
export interface QBOTokenResult {
  access_token: string;
  realm_id: string;
}

/** Minimum buffer before expiry that triggers a proactive refresh (5 minutes). */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Intuit OAuth 2.0 token endpoint. */
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

/**
 * Retrieves a valid QBO access token. If the current token is expired or
 * within 5 minutes of expiry, it is automatically refreshed via the Intuit
 * token endpoint and the database is updated with the new credentials.
 *
 * @param supabase - A Supabase client initialized with the service_role key.
 *                   Required because qbo_oauth_tokens is service_role-only.
 * @returns An object containing `access_token` and `realm_id`.
 * @throws Error if no QBO connection exists or the refresh fails.
 */
export async function getValidToken(supabase: SupabaseClient): Promise<QBOTokenResult> {
  // -------------------------------------------------------------------------
  // 1. Fetch the current token row (there should be exactly one)
  // -------------------------------------------------------------------------
  const { data: tokenRow, error: fetchError } = await supabase
    .from('qbo_oauth_tokens')
    .select('*')
    .limit(1)
    .single();

  if (fetchError || !tokenRow) {
    throw new Error(
      'No QuickBooks Online connection found. Please connect via Settings.',
    );
  }

  // -------------------------------------------------------------------------
  // 2. Check if the access token is still valid (with 5-minute buffer)
  // -------------------------------------------------------------------------
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  const now = Date.now();

  if (expiresAt - now > EXPIRY_BUFFER_MS) {
    // Token is still fresh — return as-is
    return {
      access_token: tokenRow.access_token,
      realm_id: tokenRow.realm_id,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Token is expired or near-expiry — refresh it
  // -------------------------------------------------------------------------
  const clientId = Deno.env.get('QUICKBOOKS_DEV_CLIENTID');
  const clientSecret = Deno.env.get('QUICKBOOKS_DEV_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error(
      'QBO client credentials are not configured. Ensure QUICKBOOKS_DEV_CLIENTID '
      + 'and QUICKBOOKS_DEV_SECRET are set as Supabase secrets.',
    );
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const refreshResponse = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
    }),
  });

  if (!refreshResponse.ok) {
    const errorBody = await refreshResponse.text();
    console.error('QBO token refresh failed:', refreshResponse.status, errorBody);
    throw new Error(
      `QBO token refresh failed (${refreshResponse.status}). The connection may need to be re-established.`,
    );
  }

  const tokens = await refreshResponse.json();

  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    console.error('QBO token refresh returned unexpected shape:', Object.keys(tokens));
    throw new Error('QBO token refresh returned an invalid response. The connection may need to be re-established.');
  }

  // -------------------------------------------------------------------------
  // 4. Calculate new expiry timestamps
  // -------------------------------------------------------------------------
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const newRefreshExpiresAt = tokens.x_refresh_token_expires_in
    ? new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString()
    : tokenRow.refresh_expires_at;

  // -------------------------------------------------------------------------
  // 5. Persist refreshed tokens to the database
  // -------------------------------------------------------------------------
  const { error: updateError } = await supabase
    .from('qbo_oauth_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || 'bearer',
      expires_at: newExpiresAt,
      refresh_expires_at: newRefreshExpiresAt,
    })
    .eq('id', tokenRow.id);

  if (updateError) {
    console.error('Failed to persist refreshed QBO tokens:', updateError.message);
    // Still return the new token — it's valid even if the DB write failed.
    // The next call will attempt the refresh again.
  }

  return {
    access_token: tokens.access_token,
    realm_id: tokenRow.realm_id,
  };
}

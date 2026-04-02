import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: qbo-customers
// =============================================================================
// Fetches the list of active customers from the connected QuickBooks Online
// company. Used by the customer mapping UI to let admins link Manifest
// companies to QBO customers.
//
// POST (authenticated, admin-only)
//
// Returns JSON: { customers: [{ id, displayName, companyName, email }] }
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

/** QBO API base URL for production. */
const QBO_API_BASE = Deno.env.get('QBO_API_BASE') || 'https://sandbox-quickbooks.api.intuit.com/v3/company';

/** QBO API minor version for all requests. */
const QBO_MINOR_VERSION = '73';

// =============================================================================
// Inline: QBO Token Management (from _shared/qbo-token.ts)
// Supabase Edge Functions don't resolve _shared imports during remote bundling,
// so the token utility is inlined here.
// =============================================================================

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

async function getValidToken(supabase: SupabaseClient): Promise<{ access_token: string; realm_id: string }> {
  const { data: tokenRow, error: fetchError } = await supabase
    .from('qbo_oauth_tokens')
    .select('*')
    .limit(1)
    .single();

  if (fetchError || !tokenRow) {
    throw new Error('No QuickBooks Online connection found. Please connect via Settings.');
  }

  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
    return { access_token: tokenRow.access_token, realm_id: tokenRow.realm_id };
  }

  const clientId = Deno.env.get('QUICKBOOKS_PROD_CLIENTID') || Deno.env.get('QUICKBOOKS_DEV_CLIENTID');
  const clientSecret = Deno.env.get('QUICKBOOKS_PROD_SECRET') || Deno.env.get('QUICKBOOKS_DEV_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('QBO client credentials are not configured.');
  }

  const refreshResponse = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
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
    throw new Error(`QBO token refresh failed (${refreshResponse.status}). The connection may need to be re-established.`);
  }

  const tokens = await refreshResponse.json();
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    console.error('QBO token refresh returned unexpected shape:', Object.keys(tokens));
    throw new Error('QBO token refresh returned an invalid response. The connection may need to be re-established.');
  }

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const newRefreshExpiresAt = tokens.x_refresh_token_expires_in
    ? new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString()
    : tokenRow.refresh_expires_at;

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
  }

  return { access_token: tokens.access_token, realm_id: tokenRow.realm_id };
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

    // --- Service-role client for token retrieval ---
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // --- Get a valid QBO access token (auto-refreshes if needed) ---
    const { access_token, realm_id } = await getValidToken(supabaseAdmin);

    // --- Query QBO for active customers (paginated — QBO returns max 1000 per request) ---
    // deno-lint-ignore no-explicit-any
    let rawCustomers: any[] = [];
    let startPosition = 1;
    const pageSize = 1000;

    while (true) {
      const query = `SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
      const qboUrl = `${QBO_API_BASE}/${realm_id}/query?query=${encodeURIComponent(query)}&minorversion=${QBO_MINOR_VERSION}`;

      const qboResponse = await fetch(qboUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
      });

      if (!qboResponse.ok) {
        const errorBody = await qboResponse.text();
        console.error('QBO customer query failed:', qboResponse.status, errorBody);

        if (qboResponse.status === 401) {
          return jsonResponse(
            { error: 'QuickBooks connection has expired. Please reconnect via Settings.' },
            401,
          );
        }

        return jsonResponse(
          { error: `Failed to fetch customers from QuickBooks (${qboResponse.status})` },
          502,
        );
      }

      const qboData = await qboResponse.json();
      const pageCustomers = qboData?.QueryResponse?.Customer ?? [];
      rawCustomers = rawCustomers.concat(pageCustomers);

      // If we got fewer than pageSize, we've reached the end
      if (pageCustomers.length < pageSize) break;
      startPosition += pageSize;
    }

    const customers = rawCustomers.map((c: Record<string, unknown>) => ({
      id: String(c.Id),
      displayName: c.DisplayName ?? '',
      companyName: c.CompanyName ?? '',
      email: (c.PrimaryEmailAddr as Record<string, unknown> | undefined)?.Address ?? null,
    }));

    return jsonResponse({
      success: true,
      customers,
    });
  } catch (error) {
    console.error('qbo-customers error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getValidToken } from '../_shared/qbo-token.ts';

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
const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';

/** QBO API minor version for all requests. */
const QBO_MINOR_VERSION = '73';

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

    // --- Query QBO for active customers ---
    const query = 'SELECT * FROM Customer WHERE Active = true';
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

      // Provide a user-friendly message for common failure modes
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

    // --- Transform QBO response into a clean shape ---
    // QueryResponse.Customer may be undefined if no customers exist
    const rawCustomers = qboData?.QueryResponse?.Customer ?? [];

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

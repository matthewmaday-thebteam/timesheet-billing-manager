// =============================================================================
// admin-api-keys
//
// Admin-gated CRUD on mcp_api.api_keys via three SECURITY DEFINER RPCs:
//   - mcp_api.admin_list_api_keys()
//   - mcp_api.admin_create_api_key(name, description, prefix, key_hash)
//   - mcp_api.admin_revoke_api_key(key_id)
//
// Plaintext bearer tokens are minted IN THIS FUNCTION (never in Postgres) and
// returned to the admin UI exactly once. Only the prefix and the SHA-256 of
// the plaintext are persisted.
//
// Auth strategy:
//   - Caller's Supabase JWT is verified with the anon client via getUser().
//   - is_admin() is checked twice: first as a defensive client-side gate
//     (so we don't even reach the service-role client for non-admins), and
//     again inside each mcp_api.admin_* RPC. Defense in depth.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// -----------------------------------------------------------------------------
// Plaintext key generation
// -----------------------------------------------------------------------------
// The plaintext is `mfst_live_` + 32 url-safe random chars. We use crypto
// .getRandomValues to produce 24 random bytes (192 bits of entropy), then
// base64url-encode and trim to 32 chars. The first 12 chars of the prefix
// are persisted as `prefix` for display purposes.

const KEY_PREFIX = 'mfst_live_';
const RANDOM_BYTES = 24;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePlaintextKey(): { plaintext: string; prefix: string } {
  const buf = new Uint8Array(RANDOM_BYTES);
  crypto.getRandomValues(buf);
  const random = base64url(buf).slice(0, 32);
  const plaintext = `${KEY_PREFIX}${random}`;
  return { plaintext, prefix: plaintext.slice(0, 12) };
}

async function sha256Hex(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// -----------------------------------------------------------------------------
// Request shape
// -----------------------------------------------------------------------------

type Action = 'list' | 'create' | 'revoke';

interface CreateBody {
  action: 'create';
  name: string;
  description?: string | null;
}
interface RevokeBody {
  action: 'revoke';
  key_id: string;
}
interface ListBody {
  action: 'list';
}
type RequestBody = CreateBody | RevokeBody | ListBody;

function isAction(s: string): s is Action {
  return s === 'list' || s === 'create' || s === 'revoke';
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    // 1. Verify caller's JWT.
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !userData?.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // 2. Defense-in-depth admin gate (the RPC re-checks).
    const { data: isAdmin, error: adminCheckError } = await supabaseAuth.rpc('is_admin');
    if (adminCheckError || !isAdmin) {
      return jsonResponse({ error: 'Forbidden: admin access required' }, 403);
    }

    // 3. Parse body.
    let body: RequestBody;
    try {
      const raw = await req.json();
      if (!raw || typeof raw.action !== 'string' || !isAction(raw.action)) {
        return jsonResponse({ error: 'action must be "list" | "create" | "revoke"' }, 400);
      }
      body = raw as RequestBody;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    // 4. Service-role client used to invoke the mcp_api.admin_* RPCs. We use
    //    the caller's JWT (auth header above) so auth.uid() resolves to the
    //    admin inside the RPC. We do NOT use service_role for the call.
    const supabaseAsCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      db: { schema: 'mcp_api' },
    });

    if (body.action === 'list') {
      const { data, error } = await supabaseAsCaller.rpc('admin_list_api_keys');
      if (error) return jsonResponse({ error: error.message }, 500);
      // RPC returns SETOF JSONB; the client surfaces this as an array of objects.
      return jsonResponse({ success: true, keys: Array.isArray(data) ? data : [] });
    }

    if (body.action === 'create') {
      const name = (body.name ?? '').trim();
      if (!name) return jsonResponse({ error: 'name is required' }, 400);

      const description =
        body.description == null ? null : String(body.description).trim() || null;

      const { plaintext, prefix } = generatePlaintextKey();
      const keyHash = await sha256Hex(plaintext);

      const { data, error } = await supabaseAsCaller.rpc('admin_create_api_key', {
        p_name: name,
        p_description: description,
        p_prefix: prefix,
        p_key_hash: keyHash,
      });
      if (error) return jsonResponse({ error: error.message }, 500);

      return jsonResponse({
        success: true,
        api_key: data,
        plaintext,
      });
    }

    // revoke
    const keyId = (body.key_id ?? '').trim();
    if (!keyId) return jsonResponse({ error: 'key_id is required' }, 400);

    const { data, error } = await supabaseAsCaller.rpc('admin_revoke_api_key', {
      p_key_id: keyId,
    });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse(data ?? { success: true });
  } catch (err) {
    console.error('admin-api-keys error:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Internal error' },
      500,
    );
  }
});

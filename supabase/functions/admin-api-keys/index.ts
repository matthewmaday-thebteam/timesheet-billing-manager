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

// -----------------------------------------------------------------------------
// CORS allow-list (Fix M1 — defense-in-depth)
// -----------------------------------------------------------------------------
// This Edge Function is admin-only and is invoked from the Manifest browser
// app with a Supabase JWT. There is NO third-party / cross-origin caller, so
// `Access-Control-Allow-Origin: *` is unnecessarily broad. We pin to a
// configured allow-list and echo only the matching origin back (or the
// fallback) per CORS best practice.
//
// Configure via Supabase secrets:
//   supabase secrets set ADMIN_API_KEYS_ALLOWED_ORIGINS=\
//     "https://timesheet-billing-manager.vercel.app,https://<custom>.vercel.app"
//
// If the env var is missing we fall back to the production Vercel URL
// (the project's documented prod surface — see /docs/CONNECTION_GUIDE.md).
// Operators MUST set the secret before deploy when adding preview origins
// or a custom domain; failure to do so causes the browser to block the
// XHR with a CORS error (which is the safe failure mode).

const FALLBACK_ALLOWED_ORIGIN = 'https://timesheet-billing-manager.vercel.app';

function parseAllowedOrigins(): string[] {
  const raw = (Deno.env.get('ADMIN_API_KEYS_ALLOWED_ORIGINS') ?? '').trim();
  if (!raw) return [FALLBACK_ALLOWED_ORIGIN];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

function pickAllowedOrigin(req: Request): string {
  const origin = req.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  // Default to the first configured origin so OPTIONS/echo behavior is stable
  // (the browser will reject mismatches client-side anyway).
  return ALLOWED_ORIGINS[0];
}

function corsHeadersFor(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': pickAllowedOrigin(req),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' },
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
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse(req, { error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse(req, { error: 'Missing authorization header' }, 401);
    }

    // 1. Verify caller's JWT.
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !userData?.user) {
      return jsonResponse(req, { error: 'Unauthorized' }, 401);
    }

    // 2. Defense-in-depth admin gate (the RPC re-checks).
    const { data: isAdmin, error: adminCheckError } = await supabaseAuth.rpc('is_admin');
    if (adminCheckError || !isAdmin) {
      return jsonResponse(req, { error: 'Forbidden: admin access required' }, 403);
    }

    // 3. Parse body.
    let body: RequestBody;
    try {
      const raw = await req.json();
      if (!raw || typeof raw.action !== 'string' || !isAction(raw.action)) {
        return jsonResponse(
          req,
          { error: 'action must be "list" | "create" | "revoke"' },
          400,
        );
      }
      body = raw as RequestBody;
    } catch {
      return jsonResponse(req, { error: 'Invalid JSON body' }, 400);
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
      if (error) return jsonResponse(req, { error: error.message }, 500);
      // RPC returns SETOF JSONB; the client surfaces this as an array of objects.
      return jsonResponse(req, {
        success: true,
        keys: Array.isArray(data) ? data : [],
      });
    }

    if (body.action === 'create') {
      const name = (body.name ?? '').trim();
      if (!name) return jsonResponse(req, { error: 'name is required' }, 400);

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
      if (error) return jsonResponse(req, { error: error.message }, 500);

      return jsonResponse(req, {
        success: true,
        api_key: data,
        plaintext,
      });
    }

    // revoke
    const keyId = (body.key_id ?? '').trim();
    if (!keyId) return jsonResponse(req, { error: 'key_id is required' }, 400);

    const { data, error } = await supabaseAsCaller.rpc('admin_revoke_api_key', {
      p_key_id: keyId,
    });
    if (error) return jsonResponse(req, { error: error.message }, 500);
    return jsonResponse(req, (data as Record<string, unknown> | null) ?? { success: true });
  } catch (err) {
    console.error('admin-api-keys error:', err);
    return jsonResponse(
      req,
      { error: err instanceof Error ? err.message : 'Internal error' },
      500,
    );
  }
});

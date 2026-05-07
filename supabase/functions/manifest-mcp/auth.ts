// =============================================================================
// manifest-mcp / auth.ts
//
// Bearer-token authentication, rate limiting, and audit logging for the
// Manifest MCP Edge Function.
//
// Key design points (locked):
//   - This module NEVER references the privileged Supabase service identity.
//     The CI grep guard mcp-grep-guards.sh enforces this.
//   - All database access flows through the `mcp_reader` Postgres role,
//     which has EXECUTE-only on the curated mcp_api.api_* functions.
//   - We connect to Postgres directly with `deno-postgres` and call those
//     functions as SQL. Function bodies are SECURITY DEFINER, so the
//     mcp_reader role only needs EXECUTE on the function — it never gets
//     SELECT on any table.
//   - Bearer parse -> sha256 -> mcp_api.api_authenticate_key(hash)
//                 -> mcp_api.api_consume_rate_limit(key_id, kind, limit)
//                 -> mcp_api.api_log_request(...)
// =============================================================================

import { Pool } from 'https://deno.land/x/postgres@v0.19.3/mod.ts';

// -----------------------------------------------------------------------------
// Connection pool
// -----------------------------------------------------------------------------
// We expect MANIFEST_MCP_DB_URL to be a Postgres connection string scoped to
// the `mcp_reader` role. The string is provisioned in Supabase secrets and
// rotated independently of the rest of the system. Pool size is intentionally
// modest because Edge Function workers reuse a single instance per cold start.

const DB_URL = Deno.env.get('MANIFEST_MCP_DB_URL') ?? '';
if (!DB_URL) {
  // We log to stderr but defer the throw until the first request — Edge
  // Functions cold-start a single instance, and a synchronous throw at
  // import time produces unhelpful 500s with no body.
  console.error('[manifest-mcp] MANIFEST_MCP_DB_URL is not configured.');
}

const pool = new Pool(DB_URL || undefined, 4, true);

// -----------------------------------------------------------------------------
// Rate-limit policy
// -----------------------------------------------------------------------------
// The two-window policy shape is intentionally simple: a per-minute burst
// guard and a per-hour sustained guard. Buckets are pruned by the daily
// cleanup cron (see migration 107).

export const RATE_LIMITS = {
  perMinute: 60,
  perHour: 1200,
} as const;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Lowercase-hex SHA-256 of `plaintext`. */
export async function sha256Hex(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Stable sha256 of a JSON value, used for audit-log response hashing. */
export async function sha256OfJson(value: unknown): Promise<string> {
  // canonicalize: keys sorted alphabetically at every object level
  const canonical = canonicalize(value);
  return await sha256Hex(JSON.stringify(canonical));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Parse `Authorization: Bearer <token>` and return the raw token, or null. */
export function parseBearer(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!m) return null;
  const tok = m[1].trim();
  return tok.length > 0 ? tok : null;
}

// -----------------------------------------------------------------------------
// Auth result
// -----------------------------------------------------------------------------

export type AuthError =
  | { kind: 'unauthorized'; message: string }
  | {
      kind: 'rate_limited';
      message: string;
      retryAfterMs: number | null;
    };

export interface AuthOk {
  kind: 'ok';
  apiKeyId: string;
  prefix: string;
  name: string;
}

export type AuthResult = AuthOk | AuthError;

interface KeyRow {
  api_key_id: string;
  status: 'active' | 'revoked';
  prefix: string;
  name: string;
}

/**
 * Authenticate the bearer token and consume both rate-limit windows.
 *
 * On success returns the resolved key context.
 * On failure returns a structured AuthError suitable for surfacing to the
 * client. The caller is expected to log via `logRequest` afterwards.
 */
export async function authenticateAndRateLimit(
  authorizationHeader: string | null,
): Promise<AuthResult> {
  const token = parseBearer(authorizationHeader);
  if (!token) {
    return { kind: 'unauthorized', message: 'Missing or malformed bearer token.' };
  }

  const tokenHash = await sha256Hex(token);

  const client = await pool.connect();
  try {
    // 1. Resolve the key.
    const lookup = await client.queryObject<KeyRow>({
      text: `SELECT api_key_id, status, prefix, name
               FROM mcp_api.api_authenticate_key($1)`,
      args: [tokenHash],
    });

    if (lookup.rows.length === 0) {
      return { kind: 'unauthorized', message: 'Invalid API key.' };
    }
    const row = lookup.rows[0];
    if (row.status !== 'active') {
      return { kind: 'unauthorized', message: 'API key has been revoked.' };
    }

    // 2. Consume rate-limit windows. Per-minute first so the most
    //    eager abuser fails fastest.
    for (const [kind, limit] of [
      ['minute', RATE_LIMITS.perMinute] as const,
      ['hour', RATE_LIMITS.perHour] as const,
    ]) {
      const consume = await client.queryObject<{
        allowed: boolean;
        retry_after_ms: number | null;
      }>({
        text: `SELECT
                 (r->>'allowed')::boolean       AS allowed,
                 (r->>'retry_after_ms')::int    AS retry_after_ms
               FROM mcp_api.api_consume_rate_limit($1, $2, $3) AS r`,
        args: [row.api_key_id, kind, limit],
      });
      const r = consume.rows[0];
      if (!r?.allowed) {
        return {
          kind: 'rate_limited',
          message: `Rate limit exceeded for window=${kind}.`,
          retryAfterMs: r?.retry_after_ms ?? null,
        };
      }
    }

    return {
      kind: 'ok',
      apiKeyId: row.api_key_id,
      prefix: row.prefix,
      name: row.name,
    };
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// Audit logging
// -----------------------------------------------------------------------------

export interface LogRequestInput {
  apiKeyId: string | null;
  method: string;
  toolName: string | null;
  params: Record<string, unknown>;
  responsePayloadSha256: string | null;
  statusCode: number;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Insert one audit-log row. Failures are swallowed — never let logging fail a
 * successful request. We log to stderr instead so operators can spot
 * persistent logging outages.
 */
export async function logRequest(input: LogRequestInput): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.queryArray({
        text: `SELECT mcp_api.api_log_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        args: [
          input.apiKeyId,
          input.method,
          input.toolName,
          JSON.stringify(input.params ?? {}),
          input.responsePayloadSha256,
          input.statusCode,
          input.errorCode,
          input.errorMessage,
          input.durationMs,
          input.ipAddress,
          input.userAgent,
        ],
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[manifest-mcp] audit log insert failed:', err);
  }
}

// -----------------------------------------------------------------------------
// Tool dispatch
// -----------------------------------------------------------------------------

/**
 * Run a SECURITY DEFINER api_* function and return its JSONB envelope.
 * The Postgres side guarantees the envelope shape; we just unwrap.
 */
export async function callApiFunction(
  sqlSnippet: string,
  args: unknown[],
): Promise<unknown> {
  const client = await pool.connect();
  try {
    const rs = await client.queryObject<{ envelope: unknown }>({
      text: `SELECT (${sqlSnippet}) AS envelope`,
      args,
    });
    return rs.rows[0]?.envelope ?? null;
  } finally {
    client.release();
  }
}

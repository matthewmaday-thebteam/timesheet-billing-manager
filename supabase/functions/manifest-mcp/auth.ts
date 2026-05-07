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
//   - Bearer parse -> sha256 -> mcp_api._authenticate_and_consume(hash, mins, hours)
//                 -> mcp_api.api_log_request(...)
//
// Race-safety note (Fix H2):
//   Auth and rate-limit consumption are wrapped in a single SQL helper
//   (`mcp_api._authenticate_and_consume`) so a key revocation cannot race
//   between the lookup and the bucket increment. The whole helper runs in
//   one implicit transaction on the connection. This is preferred over the
//   alternative of bracketing two separate calls with `BEGIN`/`COMMIT`
//   because it keeps the wire round-trip count to one and the SQL atomicity
//   contract is on the Postgres side rather than the Deno client.
//
// Wire-message uniformity note (Fix H1):
//   The public response collapses every auth failure (missing/malformed
//   token, hash-not-found, revoked, inactive) to a single
//   "Invalid API key." message. The internal `error_code` written to
//   `api_audit_log` retains the distinction (NOT_FOUND vs REVOKED) for
//   incident response. The wire MUST NOT let an attacker confirm whether
//   a specific token has ever existed or has just been revoked.
//
// Connection-hygiene note (Fix H3):
//   The Deno postgres `Pool` reuses connections. A request that aborted
//   mid-statement could leave behind `SET LOCAL` overrides, advisory
//   locks, or aborted-transaction state. We wrap every checkout in
//   `withClient` which always issues `DISCARD ALL` before releasing —
//   this is cheap (single round-trip) and gives every request a clean
//   session.
// =============================================================================

import { Pool, PoolClient } from 'https://deno.land/x/postgres@v0.19.3/mod.ts';

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
// withClient — connection-hygiene wrapper (Fix H3)
// -----------------------------------------------------------------------------
// Every checkout from the Pool MUST go through this helper. We always run
// `DISCARD ALL` before release, so the next request that picks up the
// connection sees a vanilla session: no lingering `SET LOCAL`, no advisory
// locks, no aborted-tx state. Discard failures are swallowed (logged) so we
// don't surface infrastructure noise to the caller — but the connection is
// still released to the pool either way.
async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.queryArray('DISCARD ALL');
    } catch (err) {
      console.error('[manifest-mcp] DISCARD ALL failed:', err);
    }
    client.release();
  }
}

// Public auth-failure message (Fix H1). The wire response MUST be byte-for-
// byte identical for every auth failure mode (missing/malformed token,
// hash-not-found, revoked, inactive). Any divergence becomes a side channel
// an attacker can probe to confirm token existence or revocation status.
const PUBLIC_AUTH_ERROR_MESSAGE = 'Invalid API key.';

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
  | {
      kind: 'unauthorized';
      // Wire-level message — always the same constant per Fix H1.
      message: string;
      // Internal code captured by api_log_request for incident response.
      // The wire response NEVER surfaces this field.
      internalErrorCode: 'MISSING_BEARER' | 'NOT_FOUND' | 'REVOKED';
    }
  | {
      kind: 'rate_limited';
      message: string;
      retryAfterMs: number | null;
      windowKind: 'minute' | 'hour';
    };

export interface AuthOk {
  kind: 'ok';
  apiKeyId: string;
  prefix: string;
  name: string;
}

export type AuthResult = AuthOk | AuthError;

interface AuthAndConsumeRow {
  envelope: {
    ok: boolean;
    reason?: 'invalid' | 'revoked' | 'rate_limited';
    api_key_id?: string;
    prefix?: string;
    name?: string;
    window_kind?: 'minute' | 'hour';
    retry_after_ms?: number | null;
  } | null;
}

/**
 * Authenticate the bearer token and consume both rate-limit windows.
 *
 * On success returns the resolved key context.
 * On failure returns a structured AuthError suitable for surfacing to the
 * client. The caller is expected to log via `logRequest` afterwards.
 *
 * Implementation: a single SQL round-trip into `mcp_api._authenticate_and_consume`
 * which performs auth + per-minute + per-hour consumption inside one
 * function-call transaction (Fix H2). The connection is checked out via
 * `withClient` so the session is `DISCARD ALL`-cleaned on release (Fix H3).
 */
export async function authenticateAndRateLimit(
  authorizationHeader: string | null,
): Promise<AuthResult> {
  const token = parseBearer(authorizationHeader);
  if (!token) {
    return {
      kind: 'unauthorized',
      message: PUBLIC_AUTH_ERROR_MESSAGE,
      internalErrorCode: 'MISSING_BEARER',
    };
  }

  const tokenHash = await sha256Hex(token);

  return await withClient(async (client) => {
    const rs = await client.queryObject<AuthAndConsumeRow>({
      text: `SELECT mcp_api._authenticate_and_consume($1, $2, $3) AS envelope`,
      args: [tokenHash, RATE_LIMITS.perMinute, RATE_LIMITS.perHour],
    });

    const env = rs.rows[0]?.envelope ?? null;
    if (!env || env.ok !== true) {
      // Distinguish *internally* between not-found and revoked so the audit
      // log can capture the truth. The wire-level `message` stays uniform.
      if (env?.reason === 'rate_limited') {
        return {
          kind: 'rate_limited',
          message: `Rate limit exceeded for window=${env.window_kind ?? 'minute'}.`,
          retryAfterMs: env.retry_after_ms ?? null,
          windowKind: (env.window_kind ?? 'minute') as 'minute' | 'hour',
        };
      }
      return {
        kind: 'unauthorized',
        message: PUBLIC_AUTH_ERROR_MESSAGE,
        internalErrorCode: env?.reason === 'revoked' ? 'REVOKED' : 'NOT_FOUND',
      };
    }

    return {
      kind: 'ok',
      apiKeyId: env.api_key_id!,
      prefix: env.prefix!,
      name: env.name!,
    };
  });
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
    await withClient(async (client) => {
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
    });
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
  return await withClient(async (client) => {
    const rs = await client.queryObject<{ envelope: unknown }>({
      text: `SELECT (${sqlSnippet}) AS envelope`,
      args,
    });
    return rs.rows[0]?.envelope ?? null;
  });
}

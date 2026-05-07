// =============================================================================
// manifest-mcp / index.ts
//
// JSON-RPC 2.0 over HTTP server for the Manifest MCP. One request body, one
// response. Methods exposed:
//
//   - "initialize"       MCP handshake; returns server info and tool list.
//   - "tools/list"       Returns the registered tools (name + description +
//                        inputSchema) for client-side tool discovery.
//   - "tools/call"       Invokes a tool by name with structured params.
//
// Auth + rate limit + audit are applied to every call regardless of method.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

import {
  authenticateAndRateLimit,
  logRequest,
  sha256OfJson,
} from './auth.ts';
import { TOOLS, TOOL_INDEX } from './tools.ts';
import {
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  MCP_RATE_LIMITED,
  MCP_TOOL_ERROR,
  MCP_UNAUTHORIZED,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcSuccess,
} from './types.ts';

// -----------------------------------------------------------------------------
// HTTP plumbing
// -----------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(
  body: JsonRpcSuccess<unknown> | JsonRpcError,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function errorEnvelope(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function successEnvelope<T>(id: JsonRpcId, result: T): JsonRpcSuccess<T> {
  return { jsonrpc: '2.0', id, result };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip');
}

function userAgent(req: Request): string | null {
  return req.headers.get('user-agent');
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.jsonrpc === '2.0' && typeof v.method === 'string';
}

function paramsToObject(p: JsonRpcRequest['params']): Record<string, unknown> {
  if (p == null) return {};
  if (Array.isArray(p)) return {};
  if (typeof p === 'object') return p as Record<string, unknown>;
  return {};
}

interface DispatchOutcome {
  body: JsonRpcSuccess<unknown> | JsonRpcError;
  statusCode: number;
  errorCode: string | null;
  errorMessage: string | null;
  toolName: string | null;
  responseHash: string | null;
  extraHeaders: Record<string, string>;
  apiKeyId: string | null;
}

// -----------------------------------------------------------------------------
// Method handlers
// -----------------------------------------------------------------------------

interface ServerInfo {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
}

const SERVER_INFO: ServerInfo = {
  protocolVersion: '2024-11-05',
  serverInfo: { name: 'manifest-mcp', version: '1.0.0' },
  capabilities: { tools: {} },
};

async function handleInitialize(): Promise<unknown> {
  return SERVER_INFO;
}

async function handleToolsList(): Promise<unknown> {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

async function handleToolsCall(
  params: Record<string, unknown>,
): Promise<{
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
  toolName: string | null;
}> {
  const name = typeof params.name === 'string' ? params.name : null;
  const args = (params.arguments && typeof params.arguments === 'object'
    ? params.arguments
    : {}) as Record<string, unknown>;

  if (!name) {
    return {
      errorCode: 'INVALID_DATE',
      errorMessage: '`name` is required in tools/call params.',
      toolName: null,
    };
  }

  const tool = TOOL_INDEX.get(name);
  if (!tool) {
    return {
      errorCode: 'NOT_FOUND',
      errorMessage: `Unknown tool: ${name}`,
      toolName: name,
    };
  }

  const env = await tool.invoke(args);
  return { result: env, toolName: name };
}

// -----------------------------------------------------------------------------
// Top-level dispatch
// -----------------------------------------------------------------------------

async function dispatch(
  req: Request,
  body: unknown,
): Promise<DispatchOutcome> {
  // 1. Validate JSON-RPC envelope shape.
  if (!isJsonRpcRequest(body)) {
    return {
      body: errorEnvelope(null, JSONRPC_INVALID_REQUEST, 'Invalid JSON-RPC request.'),
      statusCode: 400,
      errorCode: 'INVALID',
      errorMessage: 'Invalid JSON-RPC request.',
      toolName: null,
      responseHash: null,
      extraHeaders: {},
      apiKeyId: null,
    };
  }

  const rpc = body;
  const id = rpc.id ?? null;
  const params = paramsToObject(rpc.params);

  // 2. Auth + rate limit (every method, including initialize).
  const auth = await authenticateAndRateLimit(req.headers.get('Authorization'));
  if (auth.kind !== 'ok') {
    if (auth.kind === 'unauthorized') {
      return {
        body: errorEnvelope(id, MCP_UNAUTHORIZED, auth.message),
        statusCode: 401,
        errorCode: 'UNAUTHORIZED',
        errorMessage: auth.message,
        toolName: null,
        responseHash: null,
        extraHeaders: {},
        apiKeyId: null,
      };
    }
    const headers: Record<string, string> = {};
    if (auth.retryAfterMs != null) {
      headers['Retry-After'] = String(Math.ceil(auth.retryAfterMs / 1000));
    }
    return {
      body: errorEnvelope(id, MCP_RATE_LIMITED, auth.message, {
        retry_after_ms: auth.retryAfterMs,
      }),
      statusCode: 429,
      errorCode: 'RATE_LIMITED',
      errorMessage: auth.message,
      toolName: null,
      responseHash: null,
      extraHeaders: headers,
      apiKeyId: null,
    };
  }

  // 3. Method routing.
  let result: unknown = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let toolName: string | null = null;

  try {
    switch (rpc.method) {
      case 'initialize':
        result = await handleInitialize();
        break;
      case 'tools/list':
        result = await handleToolsList();
        break;
      case 'tools/call': {
        const r = await handleToolsCall(params);
        toolName = r.toolName;
        if (r.errorCode) {
          errorCode = r.errorCode;
          errorMessage = r.errorMessage ?? 'Tool error.';
        } else {
          result = r.result;
        }
        break;
      }
      default:
        return finalizeError(
          id,
          auth.apiKeyId,
          toolName,
          JSONRPC_METHOD_NOT_FOUND,
          'METHOD_NOT_FOUND',
          `Unknown method: ${rpc.method}`,
          404,
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error.';
    return finalizeError(
      id,
      auth.apiKeyId,
      toolName,
      MCP_TOOL_ERROR,
      'INTERNAL',
      msg,
      500,
    );
  }

  if (errorCode) {
    return finalizeError(
      id,
      auth.apiKeyId,
      toolName,
      MCP_TOOL_ERROR,
      errorCode,
      errorMessage ?? 'Tool error.',
      400,
    );
  }

  // 4. Success envelope + response hash for the audit log.
  const success = successEnvelope(id, result);
  const responseHash = await sha256OfJson(success);
  return {
    body: success,
    statusCode: 200,
    errorCode: null,
    errorMessage: null,
    toolName,
    responseHash,
    extraHeaders: {},
    apiKeyId: auth.apiKeyId,
  };
}

async function finalizeError(
  id: JsonRpcId,
  apiKeyId: string | null,
  toolName: string | null,
  jsonRpcCode: number,
  domainCode: string,
  message: string,
  statusCode: number,
): Promise<DispatchOutcome> {
  const body = errorEnvelope(id, jsonRpcCode, message);
  const responseHash = await sha256OfJson(body);
  return {
    body,
    statusCode,
    errorCode: domainCode,
    errorMessage: message,
    toolName,
    responseHash,
    extraHeaders: {},
    apiKeyId,
  };
}

// -----------------------------------------------------------------------------
// HTTP entry point
// -----------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(
      errorEnvelope(null, JSONRPC_INVALID_REQUEST, 'Method not allowed.'),
      405,
    );
  }

  const startedAt = performance.now();
  const ip = clientIp(req);
  const ua = userAgent(req);

  let parsed: unknown = null;
  let parseFailed = false;
  try {
    parsed = await req.json();
  } catch {
    parseFailed = true;
  }

  let outcome: DispatchOutcome;
  if (parseFailed) {
    const body = errorEnvelope(null, JSONRPC_PARSE_ERROR, 'Invalid JSON.');
    const responseHash = await sha256OfJson(body);
    outcome = {
      body,
      statusCode: 400,
      errorCode: 'PARSE_ERROR',
      errorMessage: 'Invalid JSON.',
      toolName: null,
      responseHash,
      extraHeaders: {},
      apiKeyId: null,
    };
  } else {
    try {
      outcome = await dispatch(req, parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error.';
      const body = errorEnvelope(null, JSONRPC_INVALID_PARAMS, msg);
      const responseHash = await sha256OfJson(body);
      outcome = {
        body,
        statusCode: 500,
        errorCode: 'INTERNAL',
        errorMessage: msg,
        toolName: null,
        responseHash,
        extraHeaders: {},
        apiKeyId: null,
      };
    }
  }

  const durationMs = Math.round(performance.now() - startedAt);

  const rpcMethod =
    typeof (parsed as JsonRpcRequest | null)?.method === 'string'
      ? (parsed as JsonRpcRequest).method
      : 'unknown';

  await logRequest({
    apiKeyId: outcome.apiKeyId,
    method: rpcMethod,
    toolName: outcome.toolName,
    params: paramsToObject((parsed as JsonRpcRequest | null)?.params ?? {}),
    responsePayloadSha256: outcome.responseHash,
    statusCode: outcome.statusCode,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
    durationMs,
    ipAddress: ip,
    userAgent: ua,
  });

  return jsonResponse(outcome.body, outcome.statusCode, outcome.extraHeaders);
});

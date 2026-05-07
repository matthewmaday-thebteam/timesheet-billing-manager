// =============================================================================
// manifest-mcp / types.ts
// Strongly typed I/O for every tool plus the JSON-RPC envelope and the
// Postgres-side response shapes.
// =============================================================================

// -----------------------------------------------------------------------------
// JSON-RPC 2.0
// -----------------------------------------------------------------------------

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: T;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// JSON-RPC reserved error codes
// (https://www.jsonrpc.org/specification#error_object)
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

// MCP-domain extensions live in the application range (-32000..-32099).
export const MCP_UNAUTHORIZED = -32001;
export const MCP_RATE_LIMITED = -32002;
export const MCP_TOOL_ERROR = -32010;

// -----------------------------------------------------------------------------
// Tool envelope (mirrors the SECURITY DEFINER function return shape)
// -----------------------------------------------------------------------------

export interface Provenance {
  source: string;
  computed_at: string;
  row_count: number;
  truncated: boolean;
  canonical_employee_id?: string;
  period_start?: string;
  period_end?: string;
}

export type ToolErrorCode =
  | 'AMBIGUOUS'
  | 'NOT_FOUND'
  | 'INVALID_DATE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INTERNAL';

export interface ToolErrorEnvelope {
  ok: false;
  error: {
    code: ToolErrorCode;
    message: string;
    candidates?: unknown;
  };
}

export interface ToolSuccessEnvelope<T> {
  ok: true;
  data: T;
  provenance: Provenance;
}

export type ToolEnvelope<T> = ToolSuccessEnvelope<T> | ToolErrorEnvelope;

// -----------------------------------------------------------------------------
// Tool inputs and outputs
// -----------------------------------------------------------------------------

// Empty params for the three list_* tools.
export type EmptyParams = Record<string, never>;

export interface EmployeeRow {
  canonical_employee_id: string;
  display_name: string;
  employment_type: string | null;
}
export interface ProjectRow {
  canonical_project_id: string;
  project_name: string;
  canonical_company_id: string | null;
  company_display_name: string | null;
}
export interface CompanyRow {
  canonical_company_id: string;
  display_name: string;
}

// Resolvers
export interface ResolveEmployeeParams { query: string; }
export interface ResolveEmployeeData {
  canonical_employee_id: string;
  display_name: string;
}

export interface ResolveProjectParams { query: string; client_hint?: string | null; }
export type ResolveProjectData = ProjectRow;

export interface ResolveDateRangeParams {
  phrase: string;
  reference_date?: string | null;
}
export interface ResolveDateRangeData {
  start_date: string;
  end_date: string;
  label: string;
  reference_date: string;
}

// Hours
export type HoursGranularity = 'day' | 'week' | 'month' | 'total';

export interface GetEmployeeHoursParams {
  canonical_employee_id: string;
  start_date: string;
  end_date: string;
  granularity: HoursGranularity;
}
export interface HoursBucket {
  period_start: string;
  period_end: string;
  hours: number;
}
export interface GetEmployeeHoursData {
  granularity: HoursGranularity;
  total_hours: number;
  buckets: HoursBucket[];
}

export interface GetEmployeeWeekSummaryParams {
  canonical_employee_id: string;
  week_start_date: string;
}
export interface GetEmployeeWeekSummaryData {
  week_start: string;
  week_end: string;
  total_hours: number;
  per_day: HoursBucket[];
}

export interface GetEmployeeProjectsParams {
  canonical_employee_id: string;
  start_date: string;
  end_date: string;
}
export interface EmployeeProjectsRow {
  canonical_company_id: string | null;
  company_display_name: string | null;
  hours: number;
}

export interface GetEmployeeTimeOffParams {
  canonical_employee_id: string;
  start_date: string;
  end_date: string;
}
export interface TimeOffRow {
  start_date: string;
  end_date: string;
  total_days: number;
  time_off_type: string;
}

export interface VerifyEmployeeWeekParams {
  canonical_employee_id: string;
  week_start_date: string;
  expected_hours: number;
}
export interface VerifyEmployeeWeekData {
  week_start: string;
  week_end: string;
  expected_hours: number;
  actual_hours: number;
  delta: number;
  tolerance: number;
  matches: boolean;
}

// -----------------------------------------------------------------------------
// Auth context
// -----------------------------------------------------------------------------

export interface AuthContext {
  apiKeyId: string;
  prefix: string;
  name: string;
  ipAddress: string | null;
  userAgent: string | null;
}

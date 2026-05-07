// =============================================================================
// manifest-mcp / tools.ts
// Tool registry: descriptions, JSON Schemas, and dispatchers that call the
// matching mcp_api.api_* SECURITY DEFINER function.
// =============================================================================

import { callApiFunction } from './auth.ts';
import type { ToolEnvelope } from './types.ts';

// -----------------------------------------------------------------------------
// JSON Schema fragments
// -----------------------------------------------------------------------------

const uuidSchema = {
  type: 'string',
  format: 'uuid',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
} as const;

const dateSchema = {
  type: 'string',
  format: 'date',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
} as const;

const granularitySchema = {
  type: 'string',
  enum: ['day', 'week', 'month', 'total'],
} as const;

// -----------------------------------------------------------------------------
// Tool definitions
// -----------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  invoke: (params: Record<string, unknown>) => Promise<ToolEnvelope<unknown>>;
}

// Helper: a tool that calls a single SQL function and unwraps the envelope.
function makeTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  buildCall: (params: Record<string, unknown>) => {
    sql: string;
    args: unknown[];
  },
): ToolDefinition {
  return {
    name,
    description,
    inputSchema,
    invoke: async (params) => {
      const { sql, args } = buildCall(params);
      const env = await callApiFunction(sql, args);
      return env as ToolEnvelope<unknown>;
    },
  };
}

// Each `sql` snippet ends with a single function call. callApiFunction wraps
// it as `SELECT (<sql>) AS envelope` so the function's JSONB return is the
// row payload.
export const TOOLS: ToolDefinition[] = [
  makeTool(
    'list_employees',
    'List every canonical employee. Returns display_name, employment_type, ' +
      'and the canonical_employee_id used by all other tools.',
    {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    () => ({ sql: `mcp_api.api_list_employees()`, args: [] }),
  ),

  makeTool(
    'list_projects',
    'List every canonical project plus the canonical company it rolls up to.',
    {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    () => ({ sql: `mcp_api.api_list_projects()`, args: [] }),
  ),

  makeTool(
    'list_companies',
    'List every canonical company.',
    {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    () => ({ sql: `mcp_api.api_list_companies()`, args: [] }),
  ),

  makeTool(
    'resolve_employee',
    'Resolve a free-text query (e.g. "Kalin", "Kalin Stoyanov") to a ' +
      'canonical_employee_id. Returns AMBIGUOUS with up to 5 candidates if ' +
      'multiple match, NOT_FOUND if none.',
    {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_resolve_employee($1)`,
      args: [String(p.query ?? '')],
    }),
  ),

  makeTool(
    'resolve_project',
    'Resolve a project name to a canonical_project_id, optionally narrowed ' +
      'by a client/company hint. Returns AMBIGUOUS with candidates when ' +
      'ambiguous.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        client_hint: { type: ['string', 'null'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_resolve_project($1, $2)`,
      args: [
        String(p.query ?? ''),
        p.client_hint == null ? null : String(p.client_hint),
      ],
    }),
  ),

  makeTool(
    'resolve_date_range',
    'Resolve a natural-language phrase (e.g. "last week", "month to date") ' +
      'to a {start_date, end_date} pair. reference_date defaults to today.',
    {
      type: 'object',
      properties: {
        phrase: { type: 'string', minLength: 1 },
        reference_date: { ...dateSchema, nullable: true } as unknown as Record<string, unknown>,
      },
      required: ['phrase'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_resolve_date_range($1, $2)`,
      args: [
        String(p.phrase ?? ''),
        p.reference_date == null ? null : String(p.reference_date),
      ],
    }),
  ),

  makeTool(
    'get_employee_hours',
    'Aggregated hours for a canonical employee over [start_date, end_date], ' +
      'grouped by day | week | month | total. Hours only.',
    {
      type: 'object',
      properties: {
        canonical_employee_id: uuidSchema,
        start_date: dateSchema,
        end_date: dateSchema,
        granularity: granularitySchema,
      },
      required: ['canonical_employee_id', 'start_date', 'end_date', 'granularity'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_get_employee_hours($1, $2, $3, $4)`,
      args: [
        String(p.canonical_employee_id ?? ''),
        String(p.start_date ?? ''),
        String(p.end_date ?? ''),
        String(p.granularity ?? 'total'),
      ],
    }),
  ),

  makeTool(
    'get_employee_week_summary',
    'Per-day hours plus the weekly total for one canonical employee. ' +
      'week_start_date is snapped to ISO Monday.',
    {
      type: 'object',
      properties: {
        canonical_employee_id: uuidSchema,
        week_start_date: dateSchema,
      },
      required: ['canonical_employee_id', 'week_start_date'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_get_employee_week_summary($1, $2)`,
      args: [
        String(p.canonical_employee_id ?? ''),
        String(p.week_start_date ?? ''),
      ],
    }),
  ),

  makeTool(
    'get_employee_projects',
    'Canonical projects the employee touched in [start_date, end_date], ' +
      'with hours per project. Returns canonical_project_id, project_name, ' +
      'canonical_company_id, company_name, and hours for each project.',
    {
      type: 'object',
      properties: {
        canonical_employee_id: uuidSchema,
        start_date: dateSchema,
        end_date: dateSchema,
      },
      required: ['canonical_employee_id', 'start_date', 'end_date'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_get_employee_projects($1, $2, $3)`,
      args: [
        String(p.canonical_employee_id ?? ''),
        String(p.start_date ?? ''),
        String(p.end_date ?? ''),
      ],
    }),
  ),

  makeTool(
    'get_employee_time_off',
    'Approved time-off events overlapping [start_date, end_date] for a ' +
      'canonical employee. Excludes Bamboo source ids and notes.',
    {
      type: 'object',
      properties: {
        canonical_employee_id: uuidSchema,
        start_date: dateSchema,
        end_date: dateSchema,
      },
      required: ['canonical_employee_id', 'start_date', 'end_date'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_get_employee_time_off($1, $2, $3)`,
      args: [
        String(p.canonical_employee_id ?? ''),
        String(p.start_date ?? ''),
        String(p.end_date ?? ''),
      ],
    }),
  ),

  makeTool(
    'verify_employee_week',
    'Compare expected_hours (caller-supplied) to actual rounded hours for a ' +
      'canonical employee in a week. Tolerance is 0.5h. NEVER reads the ' +
      'employee directory for the expected value.',
    {
      type: 'object',
      properties: {
        canonical_employee_id: uuidSchema,
        week_start_date: dateSchema,
        expected_hours: { type: 'number', minimum: 0 },
      },
      required: ['canonical_employee_id', 'week_start_date', 'expected_hours'],
      additionalProperties: false,
    },
    (p) => ({
      sql: `mcp_api.api_verify_employee_week($1, $2, $3)`,
      args: [
        String(p.canonical_employee_id ?? ''),
        String(p.week_start_date ?? ''),
        Number(p.expected_hours ?? 0),
      ],
    }),
  ),
];

// Index for O(1) lookup at dispatch time.
export const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map((t) => [t.name, t]),
);

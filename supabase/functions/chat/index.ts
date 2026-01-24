import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Get current date for context
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const currentDate = now.toISOString().split('T')[0];

// Database schema for the AI
const DATABASE_SCHEMA = `
## Database Schema

### v_timesheet_entries (View - use this for timesheet queries)
Main view for querying timesheet data. Filters entries with total_minutes > 0.
- id UUID
- work_date DATE
- project_id TEXT, project_name TEXT
- user_id TEXT, user_name TEXT (employee identifier)
- task_id TEXT, task_name TEXT
- total_minutes INTEGER
- client_id TEXT, client_name TEXT (company)
- synced_at TIMESTAMPTZ

### resources (Employees)
- id UUID
- external_label TEXT (matches user_name in timesheets)
- first_name TEXT, last_name TEXT
- email TEXT
- employment_type_id UUID (FK to employment_types)
- billing_mode TEXT ('monthly' or 'hourly')
- expected_hours DECIMAL (monthly expected hours)
- hourly_rate DECIMAL
- created_at, updated_at TIMESTAMPTZ

### employment_types
- id UUID
- name TEXT ('Full-time', 'Part-time', 'Contractor')

### projects
- id UUID
- project_id TEXT (external ID)
- project_name TEXT
- client_id TEXT, client_name TEXT
- company_id UUID (FK to companies)
- first_seen_month DATE
- rate NUMERIC (legacy - use get_all_project_rates_for_month instead)

### companies
- id UUID
- client_id TEXT (external ID)
- client_name TEXT
- display_name TEXT (user-friendly name, use COALESCE(display_name, client_name))

## Key Relationships
- v_timesheet_entries.user_name = resources.external_label
- v_timesheet_entries.project_name = projects.project_name
- v_timesheet_entries.client_name = companies.client_name
- projects.company_id -> companies.id

## CRITICAL: Revenue Calculation RPC Function

### get_all_project_rates_for_month(p_month DATE)
This is THE function to use for revenue calculations. It returns ALL billing configuration:
- project_id, project_name, client_name
- effective_rate NUMERIC (hourly rate)
- effective_rounding INTEGER (0, 5, 15, or 30 minutes - round up each task)
- minimum_hours NUMERIC (retainer - bill at least this many hours if is_active=true)
- maximum_hours NUMERIC (cap - never bill more than this)
- is_active BOOLEAN (if false, minimum_hours does NOT apply)
- carryover_hours_in NUMERIC (hours carried from previous month)

Example: SELECT * FROM get_all_project_rates_for_month('2026-01-01'::DATE)

## CRITICAL: How to Calculate Revenue

Revenue calculation MUST follow this order:
1. Get actual hours per project from v_timesheet_entries: SUM(total_minutes)/60.0
2. Apply rounding: Round UP each task to the rounding increment (e.g., 15 min -> 0.25h increments)
3. Add carryover_hours_in to get adjusted_hours
4. Apply MINIMUM: If is_active=true AND adjusted_hours < minimum_hours, bill minimum_hours instead
5. Apply MAXIMUM: If adjusted_hours > maximum_hours, bill maximum_hours instead
6. Revenue = billed_hours * effective_rate

IMPORTANT: Many projects have minimum_hours set (retainer billing). If you ignore this, your revenue will be WRONG.

Example Revenue Query:
\`\`\`sql
WITH project_hours AS (
  SELECT
    t.project_name,
    SUM(t.total_minutes) / 60.0 as actual_hours
  FROM v_timesheet_entries t
  WHERE t.work_date >= '2026-01-01' AND t.work_date < '2026-02-01'
  GROUP BY t.project_name
),
billing_config AS (
  SELECT * FROM get_all_project_rates_for_month('2026-01-01'::DATE)
)
SELECT
  bc.project_name,
  COALESCE(ph.actual_hours, 0) as actual_hours,
  bc.minimum_hours,
  bc.is_active,
  bc.effective_rate,
  -- Calculate billed hours with minimum/maximum
  CASE
    WHEN bc.is_active AND bc.minimum_hours IS NOT NULL
         AND COALESCE(ph.actual_hours, 0) < bc.minimum_hours
    THEN bc.minimum_hours
    WHEN bc.maximum_hours IS NOT NULL
         AND COALESCE(ph.actual_hours, 0) > bc.maximum_hours
    THEN bc.maximum_hours
    ELSE COALESCE(ph.actual_hours, 0)
  END as billed_hours,
  -- Calculate revenue
  CASE
    WHEN bc.is_active AND bc.minimum_hours IS NOT NULL
         AND COALESCE(ph.actual_hours, 0) < bc.minimum_hours
    THEN bc.minimum_hours * bc.effective_rate
    WHEN bc.maximum_hours IS NOT NULL
         AND COALESCE(ph.actual_hours, 0) > bc.maximum_hours
    THEN bc.maximum_hours * bc.effective_rate
    ELSE COALESCE(ph.actual_hours, 0) * bc.effective_rate
  END as revenue
FROM billing_config bc
LEFT JOIN project_hours ph ON ph.project_name = bc.project_name
WHERE bc.is_active = true OR COALESCE(ph.actual_hours, 0) > 0
\`\`\`
`;

// System prompt for the AI
const SYSTEM_PROMPT = `You are a friendly accountant assistant. Answer questions about business data naturally and conversationally.

Today is ${currentDate}. Current month: ${currentMonth}/${currentYear}.
"This month" = ${currentMonth}/${currentYear}. "Last month" = ${currentMonth === 1 ? 12 : currentMonth - 1}/${currentMonth === 1 ? currentYear - 1 : currentYear}.

${DATABASE_SCHEMA}

## How to Answer Questions

1. Write a SQL query using the execute_sql tool to get the data you need
2. Interpret the results and answer in plain English
3. Keep answers SHORT and conversational - like a colleague would respond
4. Round numbers appropriately (hours to 1 decimal, money to 2 decimals with $)
5. Don't explain your SQL or methodology unless asked

## SQL Guidelines

- Use SELECT only (read-only access)
- For employee names: JOIN resources ON v_timesheet_entries.user_name = resources.external_label, then use COALESCE(first_name || ' ' || last_name, external_label) as display_name
- For company names: use COALESCE(display_name, client_name)
- For hours: total_minutes / 60.0
- For date ranges: use work_date with >= and < for months
- For current month: work_date >= '${currentYear}-${String(currentMonth).padStart(2, '0')}-01' AND work_date < '${currentMonth === 12 ? currentYear + 1 : currentYear}-${String(currentMonth === 12 ? 1 : currentMonth + 1).padStart(2, '0')}-01'
- Limit results when listing (e.g., LIMIT 10 for top lists)
- ALWAYS use get_all_project_rates_for_month() for ANY revenue calculation - it has minimum_hours that MUST be applied

## Example Queries

Count employees: SELECT COUNT(*) FROM resources
Count projects: SELECT COUNT(*) FROM projects
Total hours this month: SELECT SUM(total_minutes) / 60.0 as hours FROM v_timesheet_entries WHERE work_date >= '${currentYear}-${String(currentMonth).padStart(2, '0')}-01'
Top employees by hours: SELECT COALESCE(r.first_name || ' ' || r.last_name, t.user_name) as name, SUM(t.total_minutes) / 60.0 as hours FROM v_timesheet_entries t LEFT JOIN resources r ON t.user_name = r.external_label WHERE work_date >= 'YYYY-MM-01' GROUP BY name ORDER BY hours DESC LIMIT 5

## Revenue Calculation (IMPORTANT)
NEVER calculate revenue as just hours * rate. You MUST:
1. Use get_all_project_rates_for_month() to get billing config including minimum_hours
2. Apply minimum_hours when is_active=true (retainer billing)
3. Apply maximum_hours caps if set
See the "How to Calculate Revenue" section above for the correct query pattern.`;

// Single tool: execute SQL
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'execute_sql',
    description: 'Execute a read-only SQL query against the database. Only SELECT queries are allowed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The SQL SELECT query to execute',
        },
        explanation: {
          type: 'string',
          description: 'Brief explanation of what this query does (for logging)',
        },
      },
      required: ['query'],
    },
  },
];

interface ToolInput {
  query: string;
  explanation?: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

// Execute SQL query (read-only)
async function executeSQL(
  input: ToolInput,
  supabase: SupabaseClient
): Promise<unknown> {
  const { query, explanation } = input;

  // Security: Only allow SELECT queries
  const trimmedQuery = query.trim().toUpperCase();
  if (!trimmedQuery.startsWith('SELECT')) {
    return { error: 'Only SELECT queries are allowed' };
  }

  // Block dangerous keywords
  const dangerous = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE'];
  for (const keyword of dangerous) {
    if (trimmedQuery.includes(keyword)) {
      return { error: `Query contains forbidden keyword: ${keyword}` };
    }
  }

  console.log('Executing SQL:', explanation || query.substring(0, 100));

  try {
    const { data, error } = await supabase.rpc('execute_readonly_sql', {
      sql_query: query
    });

    if (error) {
      // If RPC doesn't exist, try direct query (less safe but works)
      const result = await supabase.from('v_timesheet_entries').select('*').limit(0);
      if (result.error) {
        return { error: error.message };
      }

      // Fallback: use raw SQL via postgrest
      // This won't work for complex queries, but handles simple cases
      return { error: `Query execution failed: ${error.message}. Try a simpler query.` };
    }

    return {
      rowCount: Array.isArray(data) ? data.length : 0,
      data: data,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Query execution failed' };
  }
}

// Rate limiting
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimits.get(userId);
  if (!userLimit || now > userLimit.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (userLimit.count >= RATE_LIMIT) {
    return false;
  }
  userLimit.count++;
  return true;
}

// Main handler
serve(async (req) => {
  console.log('Chat function invoked:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // Create client with user auth for verification
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      console.log('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log('User authenticated:', user.id);

    if (!checkRateLimit(user.id)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please wait a minute.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create service role client for SQL execution (has more permissions)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: messages array required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: 'Anthropic API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    console.log('Calling Claude API...');

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools: TOOLS,
    });

    // Handle tool use loop
    let iterations = 0;
    const MAX_ITERATIONS = 8;
    let allMessages: Anthropic.MessageParam[] = messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    while (response.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`Tool use iteration ${iterations}`);

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === 'execute_sql') {
          const output = await executeSQL(toolUse.input as ToolInput, supabase);
          console.log('SQL result rows:', (output as { rowCount?: number }).rowCount ?? 'error');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(output),
          });
        }
      }

      // Update message history
      allMessages = [
        ...allMessages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: toolResults },
      ];

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: allMessages,
        tools: TOOLS,
      });
    }

    // If we hit the iteration limit but Claude still wants to use tools,
    // make one final call without tools to force a summary
    if (response.stop_reason === 'tool_use') {
      console.log('Hit iteration limit, forcing summary response');
      allMessages = [
        ...allMessages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: 'Please summarize what you found based on the queries you\'ve run so far.' },
      ];

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: allMessages,
        // No tools - force text response
      });
    }

    const textContent = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );

    return new Response(
      JSON.stringify({
        content: textContent?.text || 'I was unable to generate a response.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Chat function error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

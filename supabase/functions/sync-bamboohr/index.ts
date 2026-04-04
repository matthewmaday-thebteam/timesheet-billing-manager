import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: sync-bamboohr
// =============================================================================
// Syncs employee directory and approved time-off requests from BambooHR into
// Supabase tables `bamboo_employees` and `employee_time_off`.
//
// Replaces the 4-node n8n workflow:
//   Node 1: Date range (full calendar year)
//   Node 2: Fetch employee directory + time-off requests from BambooHR API
//   Node 3: Upsert employees to bamboo_employees
//   Node 4: Upsert time-off to employee_time_off + delete stale records
//
// Modes:
//   POST with no body or {}  — Automated (cron): syncs full current calendar year
//   POST with { rangeStartDate, rangeEndDate } — Manual: custom date range
//
// Auth: service-role JWT or authenticated user session
// Schedule: every 2 hours via pg_cron
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

serve(async (req) => {
  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // =========================================================================
    // AUTH — same pattern as other Edge Functions
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // If the token IS the service role key, it's a cron/server call — trusted.
    // Otherwise, validate as a user session via getUser().
    if (token !== supabaseServiceKey) {
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authError } = await anonClient.auth.getUser();
      if (authError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
    }

    // =========================================================================
    // NODE 1: Date range — full calendar year (or manual override)
    // =========================================================================
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is valid (automated cron trigger)
    }

    let rangeStartDate: string;
    let rangeEndDate: string;

    if (body.rangeStartDate && body.rangeEndDate) {
      rangeStartDate = body.rangeStartDate as string;
      rangeEndDate = body.rangeEndDate as string;
    } else {
      const now = new Date();
      const year = now.getUTCFullYear();
      rangeStartDate = `${year}-01-01`;
      rangeEndDate = `${year}-12-31`;
    }

    const syncRunAt = new Date().toISOString();

    console.log(`[sync-bamboohr] Starting sync: ${rangeStartDate} to ${rangeEndDate}`);

    // =========================================================================
    // NODE 2: Fetch employee directory + time-off requests from BambooHR
    // =========================================================================
    const bambooApiKey = Deno.env.get('BAMBOO_API_KEY')!;
    const bambooCompany = 'thebteam';
    const baseUrl = `https://api.bamboohr.com/api/gateway.php/${bambooCompany}/v1`;

    // Basic Auth: API key as username, "x" as password
    const basicAuth = btoa(`${bambooApiKey}:x`);
    const bambooHeaders = {
      'Authorization': `Basic ${basicAuth}`,
      'Accept': 'application/json',
    };

    let employees: Array<Record<string, unknown>> = [];
    let timeOffRequests: Array<Record<string, unknown>> = [];
    const errors: Array<{ type: string; message: string }> = [];

    // 2a. Fetch employee directory
    try {
      const dirResponse = await fetch(`${baseUrl}/employees/directory`, {
        method: 'GET',
        headers: bambooHeaders,
      });

      if (!dirResponse.ok) {
        throw new Error(`BambooHR directory API returned ${dirResponse.status}`);
      }

      const dirData = await dirResponse.json();
      employees = dirData?.employees || [];
    } catch (err) {
      errors.push({
        type: 'employee_directory_error',
        message: err instanceof Error ? err.message : 'Failed to fetch employee directory',
      });
    }

    // 2b. Fetch time-off requests (approved only) for date range
    try {
      const timeOffUrl = `${baseUrl}/time_off/requests?start=${rangeStartDate}&end=${rangeEndDate}&status=approved`;
      const timeOffResponse = await fetch(timeOffUrl, {
        method: 'GET',
        headers: bambooHeaders,
      });

      if (!timeOffResponse.ok) {
        throw new Error(`BambooHR time-off API returned ${timeOffResponse.status}`);
      }

      const timeOffData = await timeOffResponse.json();
      // BambooHR returns an array directly for time-off requests
      timeOffRequests = Array.isArray(timeOffData) ? timeOffData : [];
    } catch (err) {
      errors.push({
        type: 'time_off_error',
        message: err instanceof Error ? err.message : 'Failed to fetch time-off requests',
      });
    }

    const fetchComplete = errors.length === 0;

    console.log(
      `[sync-bamboohr] Fetched ${employees.length} employees, ${timeOffRequests.length} time-off requests` +
      (errors.length > 0 ? ` (${errors.length} errors)` : ''),
    );

    // =========================================================================
    // NODE 3: Upsert employees to bamboo_employees
    // =========================================================================
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const employeeRows = employees
      .filter((emp) => emp.id)
      .map((emp) => ({
        bamboo_id: String(emp.id),
        first_name: (emp.firstName as string) || null,
        last_name: (emp.lastName as string) || null,
        synced_at: syncRunAt,
      }));

    let employeesUpserted = 0;
    let employeesUpsertError: string | null = null;

    if (employeeRows.length > 0) {
      const { error: empError } = await supabase
        .from('bamboo_employees')
        .upsert(employeeRows, { onConflict: 'bamboo_id' });

      if (empError) {
        employeesUpsertError = empError.message;
        console.error(`[sync-bamboohr] Employee upsert error: ${empError.message}`);
      } else {
        employeesUpserted = employeeRows.length;
      }
    }

    console.log(`[sync-bamboohr] Upserted ${employeesUpserted} employees`);

    // =========================================================================
    // NODE 4: Upsert time-off requests to employee_time_off
    // =========================================================================

    // Build employee lookup: bamboo_id -> { name, email }
    const employeeLookup: Record<string, { name: string; email: string | null }> = {};
    for (const emp of employees) {
      if (emp.id) {
        employeeLookup[String(emp.id)] = {
          name: [emp.firstName, emp.lastName].filter(Boolean).join(' ') || 'Unknown',
          email: (emp.workEmail as string) || null,
        };
      }
    }

    // Build rows for upsert — only approved requests
    const timeOffRows = timeOffRequests
      .filter((req) => {
        const status = req.status as { status?: string } | undefined;
        return req.id && req.employeeId && (status?.status || '').toString().toLowerCase() === 'approved';
      })
      .map((req) => {
        const empId = String(req.employeeId);
        const empInfo = employeeLookup[empId] || {
          name: (req.name as string) || 'Unknown',
          email: null,
        };
        const reqType = req.type as { name?: string } | string | undefined;
        const typeName = typeof reqType === 'object' && reqType !== null
          ? reqType.name || 'Unknown'
          : String(reqType || 'Unknown');
        const reqStatus = req.status as { status?: string } | undefined;
        const reqAmount = req.amount as { amount?: number } | number | undefined;
        const amount = typeof reqAmount === 'object' && reqAmount !== null
          ? Number(reqAmount.amount || 0)
          : Number(reqAmount || 0);
        const reqNotes = req.notes as { employee?: string } | undefined;

        return {
          bamboo_request_id: String(req.id),
          bamboo_employee_id: empId,
          employee_name: empInfo.name,
          employee_email: empInfo.email,
          time_off_type: typeName,
          status: (reqStatus?.status || 'unknown').toLowerCase(),
          start_date: req.start as string,
          end_date: req.end as string,
          total_days: amount,
          notes: reqNotes?.employee || null,
          synced_at: syncRunAt,
        };
      });

    let timeOffUpserted = 0;
    let timeOffDeleted = 0;
    let timeOffError: string | null = null;

    if (timeOffRows.length > 0) {
      // Upsert in batches of 500 to avoid payload limits
      const BATCH_SIZE = 500;

      try {
        for (let i = 0; i < timeOffRows.length; i += BATCH_SIZE) {
          const batch = timeOffRows.slice(i, i + BATCH_SIZE);

          const { error: batchError } = await supabase
            .from('employee_time_off')
            .upsert(batch, { onConflict: 'bamboo_request_id' });

          if (batchError) {
            throw new Error(`Batch upsert error at offset ${i}: ${batchError.message}`);
          }

          timeOffUpserted += batch.length;
        }

        // Delete records no longer in the approved set (cancelled/denied since last sync)
        const approvedIds = timeOffRows.map((r) => r.bamboo_request_id);
        const startDate = timeOffRows.reduce(
          (min, r) => r.start_date < min ? r.start_date : min,
          timeOffRows[0].start_date,
        );
        const endDate = timeOffRows.reduce(
          (max, r) => r.end_date > max ? r.end_date : max,
          timeOffRows[0].end_date,
        );

        const { data: deletedRows, error: deleteError } = await supabase
          .from('employee_time_off')
          .delete()
          .not('bamboo_request_id', 'in', `(${approvedIds.join(',')})`)
          .gte('start_date', startDate)
          .lte('end_date', endDate)
          .select('id');

        if (deleteError) {
          console.error(`[sync-bamboohr] Delete stale time-off error: ${deleteError.message}`);
        } else {
          timeOffDeleted = deletedRows?.length || 0;
        }
      } catch (err) {
        timeOffError = err instanceof Error ? err.message : 'Failed to upsert employee_time_off';
        console.error(`[sync-bamboohr] Time-off upsert error: ${timeOffError}`);
      }
    } else {
      // No approved requests — delete all records in the sync date range
      try {
        const { data: deletedRows, error: deleteError } = await supabase
          .from('employee_time_off')
          .delete()
          .gte('start_date', rangeStartDate)
          .lte('end_date', rangeEndDate)
          .select('id');

        if (deleteError) {
          console.error(`[sync-bamboohr] Delete all time-off error: ${deleteError.message}`);
        } else {
          timeOffDeleted = deletedRows?.length || 0;
        }
      } catch (err) {
        timeOffError = err instanceof Error ? err.message : 'Failed to clean up stale time-off records';
        console.error(`[sync-bamboohr] Cleanup error: ${timeOffError}`);
      }
    }

    console.log(
      `[sync-bamboohr] Time-off: ${timeOffUpserted} upserted, ${timeOffDeleted} deleted`,
    );

    // =========================================================================
    // Response summary
    // =========================================================================
    const result = {
      success: fetchComplete && !employeesUpsertError && !timeOffError,
      action: 'bamboohr_sync_complete',
      sync_run_at: syncRunAt,
      fetch_complete: fetchComplete,
      range_start: rangeStartDate,
      range_end: rangeEndDate,
      employees_fetched: employees.length,
      employees_upserted: employeesUpserted,
      employees_upsert_error: employeesUpsertError,
      time_off_fetched: timeOffRequests.length,
      time_off_upserted: timeOffUpserted,
      time_off_deleted: timeOffDeleted,
      time_off_error: timeOffError,
      errors,
    };

    console.log(`[sync-bamboohr] Complete:`, JSON.stringify(result));

    return jsonResponse(result);
  } catch (error) {
    console.error('[sync-bamboohr] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

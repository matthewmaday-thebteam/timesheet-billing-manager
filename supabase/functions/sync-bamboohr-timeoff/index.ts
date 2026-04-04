import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: sync-bamboohr-timeoff
// =============================================================================
// Syncs approved time-off requests from BambooHR into Supabase
// `employee_time_off` table.
//
// Split from the monolithic sync-bamboohr function so that time-off syncs can
// run every 2 hours while the employee directory syncs daily.
//
// Optimization: Reads employee data from the LOCAL `bamboo_employees` table
// instead of re-fetching from BambooHR. If any employeeId from BambooHR is
// NOT found locally, does a single on-demand directory fetch to fill the gap.
//
// The `link_time_off_to_resources` trigger fires automatically on insert/update
// to set resource_id.
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
    // Date range — full calendar year (or manual override)
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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[sync-bamboohr-timeoff] Starting sync: ${rangeStartDate} to ${rangeEndDate}`);

    // =========================================================================
    // Parallel fetch: BambooHR time-off requests + local employee lookup
    // =========================================================================
    const bambooApiKey = Deno.env.get('BAMBOO_API_KEY')!;
    const bambooCompany = Deno.env.get('BAMBOO_COMPANY') || 'thebteam';
    const baseUrl = `https://api.bamboohr.com/api/gateway.php/${bambooCompany}/v1`;

    // Basic Auth: API key as username, "x" as password
    const basicAuth = btoa(`${bambooApiKey}:x`);
    const bambooHeaders = {
      'Authorization': `Basic ${basicAuth}`,
      'Accept': 'application/json',
    };

    // Run both fetches in parallel: BambooHR API + local DB
    const [timeOffResult, localEmployeesResult] = await Promise.all([
      // 1. Fetch time-off requests (approved only) from BambooHR
      (async () => {
        const timeOffUrl = `${baseUrl}/time_off/requests?start=${rangeStartDate}&end=${rangeEndDate}&status=approved`;
        const response = await fetch(timeOffUrl, {
          method: 'GET',
          headers: bambooHeaders,
        });

        if (!response.ok) {
          throw new Error(`BambooHR time-off API returned ${response.status}`);
        }

        const data = await response.json();
        // BambooHR returns an array directly for time-off requests
        return Array.isArray(data) ? data : [];
      })(),

      // 2. Fetch all employees from local bamboo_employees table
      (async () => {
        const { data, error } = await supabase
          .from('bamboo_employees')
          .select('bamboo_id, first_name, last_name');

        if (error) {
          console.error(`[sync-bamboohr-timeoff] Local employee lookup error: ${error.message}`);
          return [];
        }
        return data || [];
      })(),
    ]);

    const timeOffRequests = timeOffResult as Array<Record<string, unknown>>;
    const localEmployees = localEmployeesResult as Array<{
      bamboo_id: string;
      first_name: string | null;
      last_name: string | null;
    }>;

    console.log(
      `[sync-bamboohr-timeoff] Fetched ${timeOffRequests.length} time-off requests, ` +
      `${localEmployees.length} local employees`,
    );

    // =========================================================================
    // Build employee lookup from local data
    // =========================================================================
    const employeeLookup: Record<string, { name: string; email: string | null }> = {};
    for (const emp of localEmployees) {
      if (emp.bamboo_id) {
        employeeLookup[emp.bamboo_id] = {
          name: [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown',
          email: null, // bamboo_employees table doesn't store email; will be null
        };
      }
    }

    // =========================================================================
    // On-demand fallback: if any employeeId is missing locally, fetch directory
    // =========================================================================
    const allEmployeeIds = new Set(
      timeOffRequests
        .filter((req) => req.employeeId)
        .map((req) => String(req.employeeId)),
    );

    const missingIds = [...allEmployeeIds].filter((id) => !employeeLookup[id]);

    let onDemandFetchCount = 0;

    if (missingIds.length > 0) {
      console.log(
        `[sync-bamboohr-timeoff] ${missingIds.length} employee IDs not in local DB — ` +
        `fetching directory from BambooHR`,
      );

      try {
        const dirResponse = await fetch(`${baseUrl}/employees/directory`, {
          method: 'GET',
          headers: bambooHeaders,
        });

        if (!dirResponse.ok) {
          throw new Error(`BambooHR directory API returned ${dirResponse.status}`);
        }

        const dirData = await dirResponse.json();
        const apiEmployees: Array<Record<string, unknown>> = dirData?.employees || [];

        // Build upsert rows for the missing employees (upsert ALL to keep table fresh)
        const upsertRows = apiEmployees
          .filter((emp) => emp.id)
          .map((emp) => ({
            bamboo_id: String(emp.id),
            first_name: (emp.firstName as string) || null,
            last_name: (emp.lastName as string) || null,
            synced_at: syncRunAt,
          }));

        if (upsertRows.length > 0) {
          const { error: upsertError } = await supabase
            .from('bamboo_employees')
            .upsert(upsertRows, { onConflict: 'bamboo_id' });

          if (upsertError) {
            console.error(
              `[sync-bamboohr-timeoff] On-demand employee upsert error: ${upsertError.message}`,
            );
          } else {
            onDemandFetchCount = upsertRows.length;
          }
        }

        // Add the fetched employees to the lookup
        for (const emp of apiEmployees) {
          if (emp.id) {
            employeeLookup[String(emp.id)] = {
              name: [emp.firstName, emp.lastName].filter(Boolean).join(' ') || 'Unknown',
              email: (emp.workEmail as string) || null,
            };
          }
        }

        console.log(
          `[sync-bamboohr-timeoff] On-demand fetch: upserted ${onDemandFetchCount} employees`,
        );
      } catch (err) {
        console.error(
          `[sync-bamboohr-timeoff] On-demand directory fetch failed: ` +
          (err instanceof Error ? err.message : String(err)),
        );
        // Continue with whatever we have — time-off upsert can still proceed
        // with "Unknown" for missing employees
      }
    }

    // =========================================================================
    // Build time-off rows for upsert — only approved requests
    // =========================================================================
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
        // Uses the EXPLICIT sync date range, not min/max of fetched data
        const approvedIds = timeOffRows.map((r) => r.bamboo_request_id);

        const { data: deletedRows, error: deleteError } = await supabase
          .from('employee_time_off')
          .delete()
          .not('bamboo_request_id', 'in', `(${approvedIds.join(',')})`)
          .gte('start_date', rangeStartDate)
          .lte('end_date', rangeEndDate)
          .select('id');

        if (deleteError) {
          console.error(`[sync-bamboohr-timeoff] Delete stale time-off error: ${deleteError.message}`);
        } else {
          timeOffDeleted = deletedRows?.length || 0;
        }
      } catch (err) {
        timeOffError = err instanceof Error ? err.message : 'Failed to upsert employee_time_off';
        console.error(`[sync-bamboohr-timeoff] Time-off upsert error: ${timeOffError}`);
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
          console.error(`[sync-bamboohr-timeoff] Delete all time-off error: ${deleteError.message}`);
        } else {
          timeOffDeleted = deletedRows?.length || 0;
        }
      } catch (err) {
        timeOffError = err instanceof Error ? err.message : 'Failed to clean up stale time-off records';
        console.error(`[sync-bamboohr-timeoff] Cleanup error: ${timeOffError}`);
      }
    }

    console.log(
      `[sync-bamboohr-timeoff] Time-off: ${timeOffUpserted} upserted, ${timeOffDeleted} deleted`,
    );

    // =========================================================================
    // Response summary
    // =========================================================================
    const result = {
      success: !timeOffError,
      action: 'bamboohr_timeoff_sync_complete',
      sync_run_at: syncRunAt,
      last_synced_at: syncRunAt,
      range_start: rangeStartDate,
      range_end: rangeEndDate,
      local_employees_loaded: localEmployees.length,
      on_demand_employees_fetched: onDemandFetchCount,
      time_off_fetched: timeOffRequests.length,
      time_off_upserted: timeOffUpserted,
      time_off_deleted: timeOffDeleted,
      time_off_error: timeOffError,
    };

    console.log(`[sync-bamboohr-timeoff] Complete:`, JSON.stringify(result));

    return jsonResponse(result);
  } catch (error) {
    console.error('[sync-bamboohr-timeoff] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

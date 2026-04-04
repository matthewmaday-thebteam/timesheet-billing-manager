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

    // Check if the JWT has service_role — handles both JWT and sb_secret_ env var formats
    let isServiceRole = false;
    try {
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64));
        isServiceRole = payload.role === 'service_role';
      }
    } catch {
      // Not a valid JWT — fall through to user session check
    }

    if (!isServiceRole) {
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
    // Use the JWT token for the Supabase client (env var may be sb_secret_ format)
    const supabase = createClient(supabaseUrl, isServiceRole ? token : supabaseServiceKey);

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
          .lte('start_date', rangeEndDate)
          .gte('end_date', rangeStartDate)
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
          .lte('start_date', rangeEndDate)
          .gte('end_date', rangeStartDate)
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
    // Compute total days for diagnostics (source vs manifest)
    // =========================================================================
    // source_hours: total days from BambooHR fetched requests (stored as days, UI labels accordingly)
    // manifest_hours: total days from upserted rows
    let sourceDays: number | null = null;
    let manifestDays: number | null = null;

    if (timeOffRequests.length > 0) {
      let totalSourceDays = 0;
      for (const req of timeOffRequests) {
        const reqAmount = req.amount as { amount?: number } | number | undefined;
        const amount = typeof reqAmount === 'object' && reqAmount !== null
          ? Number(reqAmount.amount || 0)
          : Number(reqAmount || 0);
        if (Number.isFinite(amount) && amount > 0) {
          totalSourceDays += amount;
        }
      }
      sourceDays = Math.round(totalSourceDays * 100) / 100;
    }

    // Query the actual DB for stored days in the sync date range
    try {
      const { data: dbTotals } = await supabase
        .from('employee_time_off')
        .select('total_days')
        .lte('start_date', rangeEndDate)
        .gte('end_date', rangeStartDate);

      if (dbTotals && dbTotals.length > 0) {
        let totalDbDays = 0;
        for (const row of dbTotals) {
          totalDbDays += row.total_days || 0;
        }
        manifestDays = Math.round(totalDbDays * 100) / 100;
      }
    } catch {
      // Non-blocking — manifestDays will remain null if query fails
    }

    console.log(`[sync-bamboohr-timeoff] Days — source: ${sourceDays}, manifest: ${manifestDays}`);

    // =========================================================================
    // RECONCILIATION: Generate sync_alerts for discrepancies
    // =========================================================================
    // Wrapped in try/catch so reconciliation failures never block core sync.
    let reconciliationResult = {
      mismatch_alerts_created: 0,
      mismatch_alerts_resolved: 0,
      unmatched_alerts_created: 0,
      unmatched_alerts_resolved: 0,
      reconciliation_error: null as string | null,
    };

    try {
      console.log('[sync-bamboohr-timeoff] Starting reconciliation...');

      // -----------------------------------------------------------------------
      // Step A: Days Mismatch Detection
      // -----------------------------------------------------------------------
      // 1. Sum BambooHR days from the already-fetched timeOffRows
      const bambooTotalsByEmployee: Record<string, { days: number; name: string }> = {};
      for (const row of timeOffRows) {
        const empId = row.bamboo_employee_id;
        if (!bambooTotalsByEmployee[empId]) {
          bambooTotalsByEmployee[empId] = { days: 0, name: row.employee_name };
        }
        bambooTotalsByEmployee[empId].days += row.total_days;
      }

      // 2. Query Manifest's employee_time_off totals for the same date range
      const { data: manifestTotals, error: manifestTotalsError } = await supabase
        .from('employee_time_off')
        .select('bamboo_employee_id, total_days')
        .lte('start_date', rangeEndDate)
        .gte('end_date', rangeStartDate);

      if (manifestTotalsError) {
        throw new Error(`Manifest totals query error: ${manifestTotalsError.message}`);
      }

      const manifestTotalsByEmployee: Record<string, number> = {};
      for (const row of (manifestTotals || [])) {
        const empId = row.bamboo_employee_id;
        if (empId) {
          manifestTotalsByEmployee[empId] = (manifestTotalsByEmployee[empId] || 0) + (row.total_days || 0);
        }
      }

      // 3. Compare and generate mismatch alerts
      const allEmpIds = new Set([
        ...Object.keys(bambooTotalsByEmployee),
        ...Object.keys(manifestTotalsByEmployee),
      ]);

      const mismatchedEmpIds: string[] = [];

      for (const empId of allEmpIds) {
        const bambooDays = bambooTotalsByEmployee[empId]?.days || 0;
        const manifestDays = manifestTotalsByEmployee[empId] || 0;

        // Round to 1 decimal to avoid floating-point noise
        const bambooRounded = Math.round(bambooDays * 10) / 10;
        const manifestRounded = Math.round(manifestDays * 10) / 10;

        if (bambooRounded !== manifestRounded) {
          mismatchedEmpIds.push(empId);
          const empName = bambooTotalsByEmployee[empId]?.name
            || employeeLookup[empId]?.name
            || 'Unknown Employee';

          const newMetadata = {
            bamboo_days: bambooRounded,
            manifest_days: manifestRounded,
            range_start: rangeStartDate,
            range_end: rangeEndDate,
          };

          // Check if an active alert already exists for this employee
          const { data: existingAlert } = await supabase
            .from('sync_alerts')
            .select('id, metadata, dismissed_at')
            .eq('alert_type', 'timeoff_days_mismatch')
            .eq('entity_id', empId)
            .is('resolved_at', null)
            .maybeSingle();

          if (existingAlert) {
            // Alert exists — check if values changed
            const oldMeta = existingAlert.metadata as Record<string, unknown> || {};
            const valuesChanged = oldMeta.bamboo_days !== bambooRounded
              || oldMeta.manifest_days !== manifestRounded;

            if (valuesChanged) {
              // Values changed — update and clear dismissed_at so it reappears
              await supabase
                .from('sync_alerts')
                .update({
                  title: `Time-off mismatch: ${empName} has ${bambooRounded} days in BambooHR but ${manifestRounded} days in Manifest`,
                  metadata: newMetadata,
                  dismissed_at: null,
                  dismissed_by: null,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existingAlert.id);

              reconciliationResult.mismatch_alerts_created++;
            }
            // If values are the same, leave it alone (keep dismissed state)
          } else {
            // No active alert — insert new one
            await supabase
              .from('sync_alerts')
              .insert({
                alert_type: 'timeoff_days_mismatch',
                severity: 'warning',
                title: `Time-off mismatch: ${empName} has ${bambooRounded} days in BambooHR but ${manifestRounded} days in Manifest`,
                entity_type: 'employee',
                entity_id: empId,
                entity_name: empName,
                metadata: newMetadata,
              });

            reconciliationResult.mismatch_alerts_created++;
          }
        }
      }

      // 4. Auto-resolve mismatch alerts for employees that now match
      const { data: activeMismatchAlerts } = await supabase
        .from('sync_alerts')
        .select('id, entity_id')
        .eq('alert_type', 'timeoff_days_mismatch')
        .is('resolved_at', null);

      for (const alert of (activeMismatchAlerts || [])) {
        if (alert.entity_id && !mismatchedEmpIds.includes(alert.entity_id)) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);

          reconciliationResult.mismatch_alerts_resolved++;
        }
      }

      // -----------------------------------------------------------------------
      // Step B: Unmatched Resources Detection (group-aware, employment-type-aware)
      // -----------------------------------------------------------------------
      // Employment types that do NOT use BambooHR — exclude from unmatched check
      const EXCLUDED_EMPLOYMENT_TYPE_IDS = [
        '9fec7939-d890-42d4-a59b-a0f24910e0a4', // Contractor
        'bc05fc11-2df8-45af-b425-45ccd0caa4a8', // Vendor
        'e03378c7-c13f-481a-976d-267a1970cf94', // Extended Leave
      ];

      // 1. Query VISIBLE resources only (primary + unassociated, not members)
      //    excluding contractors, vendors, and extended leave
      const { data: visibleResources, error: visibleError } = await supabase
        .from('v_employee_table_entities')
        .select('id, first_name, last_name, bamboo_employee_id, employment_type_id, grouping_role, group_id');

      if (visibleError) {
        throw new Error(`Visible resources query error: ${visibleError.message}`);
      }

      // 2. For grouped resources (primaries), check if ANY resource in the group
      //    has a bamboo_employee_id set — if so, the group is matched
      const groupIdsToCheck = (visibleResources || [])
        .filter((r) => r.group_id && !r.bamboo_employee_id)
        .map((r) => r.group_id as string);

      // Build a set of group_ids that have at least one bamboo-linked resource
      const matchedGroupIds = new Set<string>();

      if (groupIdsToCheck.length > 0) {
        // Query all group members + primaries to check for bamboo links
        const uniqueGroupIds = [...new Set(groupIdsToCheck)];

        for (const groupId of uniqueGroupIds) {
          // Check if the primary has a bamboo link (already in visibleResources)
          const primary = (visibleResources || []).find(
            (r) => r.group_id === groupId && r.grouping_role === 'primary',
          );
          if (primary?.bamboo_employee_id) {
            matchedGroupIds.add(groupId);
            continue;
          }

          // Check if any member in this group has a bamboo link
          const { data: members } = await supabase
            .from('physical_person_group_members')
            .select('member_resource_id, resources:member_resource_id(bamboo_employee_id)')
            .eq('group_id', groupId);

          const hasLinkedMember = (members || []).some((m) => {
            const res = m.resources as unknown as { bamboo_employee_id: string | null } | null;
            return res?.bamboo_employee_id != null;
          });

          if (hasLinkedMember) {
            matchedGroupIds.add(groupId);
          }
        }
      }

      // 3. Determine truly unmatched resources
      const unmatchedResourceIds: string[] = [];

      for (const resource of (visibleResources || [])) {
        // Skip contractors, vendors, and extended leave — they don't use BambooHR
        if (resource.employment_type_id && EXCLUDED_EMPLOYMENT_TYPE_IDS.includes(resource.employment_type_id)) {
          continue;
        }

        // Skip if the resource itself has a bamboo link
        if (resource.bamboo_employee_id) {
          continue;
        }

        // Skip if the resource is in a group where ANY member has a bamboo link
        if (resource.group_id && matchedGroupIds.has(resource.group_id)) {
          continue;
        }

        // This resource is genuinely unmatched
        unmatchedResourceIds.push(resource.id);
        const resourceName = [resource.first_name, resource.last_name]
          .filter(Boolean).join(' ') || 'Unknown Resource';

        // Check if active alert already exists
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'unmatched_resource')
          .eq('entity_id', resource.id)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'unmatched_resource',
              severity: 'error',
              title: `${resourceName} is not linked to any BambooHR employee`,
              entity_type: 'resource',
              entity_id: resource.id,
              entity_name: resourceName,
            });

          reconciliationResult.unmatched_alerts_created++;
        }
      }

      // 4. Auto-resolve unmatched alerts for resources now linked, grouped, or excluded
      const { data: activeUnmatchedAlerts } = await supabase
        .from('sync_alerts')
        .select('id, entity_id')
        .eq('alert_type', 'unmatched_resource')
        .is('resolved_at', null);

      for (const alert of (activeUnmatchedAlerts || [])) {
        if (alert.entity_id && !unmatchedResourceIds.includes(alert.entity_id)) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);

          reconciliationResult.unmatched_alerts_resolved++;
        }
      }

      console.log('[sync-bamboohr-timeoff] Reconciliation complete:', JSON.stringify(reconciliationResult));
    } catch (reconciliationError) {
      reconciliationResult.reconciliation_error =
        reconciliationError instanceof Error
          ? reconciliationError.message
          : String(reconciliationError);
      console.error(
        '[sync-bamboohr-timeoff] Reconciliation error (non-blocking):',
        reconciliationResult.reconciliation_error,
      );
    }

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
      reconciliation: reconciliationResult,
    };

    console.log(`[sync-bamboohr-timeoff] Complete:`, JSON.stringify(result));

    // =========================================================================
    // Persist sync run to sync_runs table (diagnostics)
    // =========================================================================
    try {
      await supabase.from('sync_runs').insert({
        sync_type: 'bamboohr_timeoff',
        sync_run_id: crypto.randomUUID(),
        started_at: syncRunAt,
        success: !timeOffError,
        source_total: timeOffRequests.length,
        manifest_total: timeOffUpserted,
        deleted_count: timeOffDeleted,
        source_hours: sourceDays,
        manifest_hours: manifestDays,
        error_message: timeOffError,
        summary: result,
      });
    } catch (syncRunErr) {
      console.error('[sync-bamboohr-timeoff] Failed to persist sync run (non-blocking):', syncRunErr);
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('[sync-bamboohr-timeoff] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

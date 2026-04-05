import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: sync-clockify-timesheets
// =============================================================================
// Syncs Clockify detailed time entries into Supabase `timesheet_daily_rollups`.
//
// Replaces the 7-node n8n Clockify pipeline with a single atomic function:
//   Node 1 (Date Range)   -> Step 1: computeDateRange()
//   Node 2 (Fetch)        -> Step 2: fetchClockifyEntries()
//   Node 3 (Split)        -> (eliminated — single-pass transform)
//   Node 4 (Normalize)    -> Step 3: normalizeAndBuildRows() — normalize pass
//   Node 5 (Build Rows)   -> Step 3: normalizeAndBuildRows() — row building pass
//   n8n Supabase Upsert   -> Step 4: batchUpsert()
//   Node 6 (Cleanup)      -> Step 5: conditionalCleanup()
//   Node 7 (Recalculate)  -> Step 6: drainRecalculationQueue()
//   (new)                 -> Step 7: reconciliationAlerts()
//
// Modes:
//   POST with no body or {}  — Automated (cron): syncs 14-day lookback + current month
//   POST with { rangeStartDate, rangeEndDate } — Manual: custom date range (ISO strings)
//
// Auth: service-role JWT or authenticated user session
// Schedule: every hour via pg_cron
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
    // AUTH — same pattern as BambooHR Edge Functions
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
    // Secrets — all via Deno.env.get(), never hardcoded
    // =========================================================================
    const clockifyApiKey = Deno.env.get('CLOCKIFY_API_KEY')!;
    const clockifyWorkspaceId = Deno.env.get('CLOCKIFY_WORKSPACE_ID')!;

    if (!clockifyApiKey || !clockifyWorkspaceId) {
      return jsonResponse(
        { error: 'Missing required secrets: CLOCKIFY_API_KEY and/or CLOCKIFY_WORKSPACE_ID' },
        500,
      );
    }

    // =========================================================================
    // Sync run metadata
    // =========================================================================
    const syncRunId = crypto.randomUUID();
    const syncRunAt = new Date().toISOString();

    // Use the JWT token for the Supabase client (env var may be sb_secret_ format)
    const supabase = createClient(supabaseUrl, isServiceRole ? token : supabaseServiceKey);

    // =========================================================================
    // STEP 1: Compute date range (n8n Node 1)
    // =========================================================================
    // Default: 14 days before 1st of current month through end of month
    // Override: POST body { rangeStartDate, rangeEndDate } as ISO strings
    // =========================================================================
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is valid (automated cron trigger)
    }

    let rangeStartISO: string;
    let rangeEndISO: string;

    if (body.rangeStartDate && body.rangeEndDate) {
      // Manual override — use provided dates directly
      rangeStartISO = body.rangeStartDate as string;
      rangeEndISO = body.rangeEndDate as string;
      console.log(`[sync-clockify] Manual date range: ${rangeStartISO} to ${rangeEndISO}`);
    } else {
      // TEMPORARY: Sync starts at first of month (was 14 days before). Protects pre-April Layer 2 data. Revert in May 2026.
      const now = new Date();

      // 1st of the current month at 00:00:00.000Z
      const firstOfMonth = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
        0, 0, 0, 0,
      ));

      const rangeStart = firstOfMonth;

      // Last millisecond of the current month:
      // 1st of next month at 00:00:00.000Z minus 1 ms
      const rangeEnd = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() + 1,
          1,
          0, 0, 0, 0,
        ) - 1,
      );

      rangeStartISO = rangeStart.toISOString();
      rangeEndISO = rangeEnd.toISOString();
      console.log(`[sync-clockify] Auto date range: ${rangeStartISO} to ${rangeEndISO}`);
    }

    // =========================================================================
    // STEP 2: Paginated fetch from Clockify Reports API (n8n Node 2)
    // =========================================================================
    // POST /v1/workspaces/{id}/reports/detailed
    // 1000 entries per page, 50-page safety limit
    // =========================================================================
    const clockifyUrl = `https://reports.api.clockify.me/v1/workspaces/${clockifyWorkspaceId}/reports/detailed`;
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50;

    let allTimeEntries: Array<Record<string, unknown>> = [];
    let page = 1;
    let fetchComplete = true;
    let hitSafetyLimit = false;
    const fetchErrors: Array<{ type: string; page: number; message: string }> = [];

    console.log(`[sync-clockify] Starting paginated fetch from Clockify...`);

    try {
      while (true) {
        const requestBody = {
          dateRangeStart: rangeStartISO,
          dateRangeEnd: rangeEndISO,
          exportType: 'JSON',
          detailedFilter: {
            page,
            pageSize: PAGE_SIZE,
          },
        };

        let res: Record<string, unknown>;
        try {
          const response = await fetch(clockifyUrl, {
            method: 'POST',
            headers: {
              'X-Api-Key': clockifyApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            throw new Error(`Clockify API returned ${response.status}: ${response.statusText}`);
          }

          res = await response.json();
        } catch (apiErr) {
          // API call failed — mark as incomplete
          fetchComplete = false;
          fetchErrors.push({
            type: 'api_error',
            page,
            message: apiErr instanceof Error ? apiErr.message : 'Unknown API error',
          });
          break; // Stop pagination on error
        }

        const batch = (res?.timeentries as Array<Record<string, unknown>>) || [];
        allTimeEntries = allTimeEntries.concat(batch);

        console.log(`[sync-clockify] Page ${page}: fetched ${batch.length} entries (total: ${allTimeEntries.length})`);

        // Stop when the page returned fewer than PAGE_SIZE entries (natural end)
        if (batch.length < PAGE_SIZE) break;

        page += 1;

        // Safety break (prevents infinite loops if API acts weird)
        if (page > MAX_PAGES) {
          hitSafetyLimit = true;
          fetchComplete = false;
          fetchErrors.push({
            type: 'safety_limit',
            page,
            message: `Hit ${MAX_PAGES}-page safety limit — possible infinite loop or unusually large dataset`,
          });
          break;
        }
      }
    } catch (outerErr) {
      // Unexpected error in the loop
      fetchComplete = false;
      fetchErrors.push({
        type: 'unexpected_error',
        page,
        message: outerErr instanceof Error ? outerErr.message : 'Unexpected error during fetch',
      });
    }

    console.log(
      `[sync-clockify] Fetch complete: ${fetchComplete}, ` +
      `pages: ${page}, entries: ${allTimeEntries.length}, errors: ${fetchErrors.length}`,
    );

    // =========================================================================
    // STEP 3: Normalize + build upsert rows in a single pass (n8n Nodes 3+4+5)
    // =========================================================================
    // Combines split, normalize, and row-building into one loop.
    // Filters: skip entries with no task_id, no work_date, or zero/negative duration.
    // total_minutes = Math.ceil(duration_seconds / 60)
    // =========================================================================
    interface UpsertRow {
      clockify_workspace_id: string;
      task_id: string;
      work_date: string;
      project_id: string | null;
      project_name: string;
      user_id: string | null;
      user_name: string;
      task_name: string;
      client_id: string | null;
      client_name: string | null;
      total_minutes: number;
      synced_at: string;
      sync_run_id: string;
      sync_run_at: string;
    }

    const rows: UpsertRow[] = [];
    let skippedNoTaskId = 0;
    let skippedNoWorkDate = 0;
    let skippedZeroDuration = 0;

    for (const entry of allTimeEntries) {
      // --- Normalize (Node 4 logic) ---
      const taskId = (entry?._id as string) || (entry?.id as string) || null;
      if (!taskId) {
        skippedNoTaskId++;
        continue;
      }

      // Extract work_date from timeInterval.start (UTC date string)
      const timeInterval = entry?.timeInterval as Record<string, unknown> | undefined;
      const startStr = (timeInterval?.start as string) || null;
      let workDate: string | null = null;

      if (startStr) {
        const dt = new Date(startStr);
        if (!Number.isNaN(dt.getTime())) {
          const y = dt.getUTCFullYear();
          const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
          const d = String(dt.getUTCDate()).padStart(2, '0');
          workDate = `${y}-${m}-${d}`;
        }
      }

      if (!workDate) {
        skippedNoWorkDate++;
        continue;
      }

      // Duration in seconds
      const durationSeconds = typeof timeInterval?.duration === 'number'
        ? timeInterval.duration
        : 0;

      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        skippedZeroDuration++;
        continue;
      }

      // --- Build Row (Node 5 logic) ---
      const totalMinutes = Math.ceil(durationSeconds / 60);
      if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
        skippedZeroDuration++;
        continue;
      }

      const description = ((entry?.description as string) ?? '').trim() || '(no description)';
      const clientId = (entry?.clientId as string) ?? null;
      const clientName = (entry?.clientName as string) || (clientId ? 'Unknown Client' : null);

      rows.push({
        clockify_workspace_id: clockifyWorkspaceId,
        task_id: taskId,
        work_date: workDate,
        project_id: (entry?.projectId as string) ?? null,
        project_name: (entry?.projectName as string) || 'No Project',
        user_id: (entry?.userId as string) ?? null,
        user_name: (entry?.userName as string) || 'Unknown',
        task_name: description,
        client_id: clientId,
        client_name: clientName,
        total_minutes: totalMinutes,
        synced_at: syncRunAt,
        sync_run_id: syncRunId,
        sync_run_at: syncRunAt,
      });
    }

    console.log(
      `[sync-clockify] Rows built: ${rows.length} ` +
      `(skipped: ${skippedNoTaskId} no task_id, ${skippedNoWorkDate} no work_date, ${skippedZeroDuration} zero/negative duration)`,
    );

    // =========================================================================
    // STEP 4: Batch upsert to timesheet_daily_rollups (n8n Supabase upsert node)
    // =========================================================================
    // 500-row batches, on conflict (clockify_workspace_id, task_id)
    // =========================================================================
    const BATCH_SIZE = 500;
    let totalUpserted = 0;
    let upsertError: string | null = null;

    if (rows.length > 0) {
      try {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);

          const { error: batchError } = await supabase
            .from('timesheet_daily_rollups')
            .upsert(batch, { onConflict: 'clockify_workspace_id,task_id' });

          if (batchError) {
            throw new Error(`Batch upsert error at offset ${i}: ${batchError.message}`);
          }

          totalUpserted += batch.length;
          console.log(`[sync-clockify] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rows (total: ${totalUpserted})`);
        }
      } catch (err) {
        upsertError = err instanceof Error ? err.message : 'Failed to upsert timesheet_daily_rollups';
        console.error(`[sync-clockify] Upsert error: ${upsertError}`);
      }
    }

    console.log(`[sync-clockify] Upsert complete: ${totalUpserted} rows`);

    // =========================================================================
    // Compute total hours for diagnostics (source vs manifest)
    // =========================================================================
    // source_hours: sum of total_minutes from built rows (what we tried to upsert) / 60
    // manifest_hours: sum of total_minutes from the DB after upsert (what's actually stored)
    let sourceHours: number | null = null;
    let manifestHours: number | null = null;

    if (rows.length > 0) {
      let totalSourceMinutes = 0;
      for (const row of rows) {
        totalSourceMinutes += row.total_minutes;
      }
      sourceHours = Math.round((totalSourceMinutes / 60) * 100) / 100;
    }

    // Query the DB for actual stored hours in the sync date range
    try {
      const diagRangeStart = rangeStartISO.split('T')[0];
      const diagRangeEnd = rangeEndISO.split('T')[0];
      const { data: dbTotals } = await supabase
        .from('timesheet_daily_rollups')
        .select('total_minutes')
        .eq('clockify_workspace_id', clockifyWorkspaceId)
        .gte('work_date', diagRangeStart)
        .lte('work_date', diagRangeEnd);

      if (dbTotals && dbTotals.length > 0) {
        let totalDbMinutes = 0;
        for (const row of dbTotals) {
          totalDbMinutes += row.total_minutes || 0;
        }
        manifestHours = Math.round((totalDbMinutes / 60) * 100) / 100;
      }
    } catch {
      // Non-blocking — manifest_hours will be null if query fails
    }

    console.log(`[sync-clockify] Hours — source: ${sourceHours}, manifest: ${manifestHours}`);

    // =========================================================================
    // STEP 5: Conditional cleanup — delete stale entries (n8n Node 6)
    // =========================================================================
    // Only runs if fetch was complete AND upsert succeeded.
    // Calls RPC cleanup_stale_timesheet_entries(p_workspace_id, p_range_start,
    //   p_range_end, p_sync_run_id)
    // =========================================================================
    let cleanupResult: Record<string, unknown> = { action: 'cleanup_not_attempted' };
    let deletedCount = 0;

    if (!fetchComplete) {
      cleanupResult = {
        action: 'cleanup_skipped',
        reason: 'fetch_incomplete',
        sync_run_id: syncRunId,
        message: 'Cleanup skipped because fetch did not complete successfully. No entries deleted.',
      };
      console.log(`[sync-clockify] Cleanup skipped: fetch incomplete`);
    } else if (upsertError) {
      cleanupResult = {
        action: 'cleanup_skipped',
        reason: 'upsert_error',
        sync_run_id: syncRunId,
        message: 'Cleanup skipped because upsert had errors.',
      };
      console.log(`[sync-clockify] Cleanup skipped: upsert error`);
    } else {
      // Extract date parts for the RPC (expects DATE, not TIMESTAMPTZ)
      const rangeStartDate = rangeStartISO.split('T')[0];
      const rangeEndDate = rangeEndISO.split('T')[0];

      try {
        const { data: rpcResult, error: rpcError } = await supabase
          .rpc('cleanup_stale_timesheet_entries', {
            p_workspace_id: clockifyWorkspaceId,
            p_range_start: rangeStartDate,
            p_range_end: rangeEndDate,
            p_sync_run_id: syncRunId,
          });

        if (rpcError) {
          throw new Error(`Cleanup RPC error: ${rpcError.message}`);
        }

        // RPC returns TABLE (deleted_count BIGINT) — result is array with one row
        deletedCount = Array.isArray(rpcResult)
          ? (rpcResult[0]?.deleted_count ?? 0)
          : (rpcResult?.deleted_count ?? 0);

        cleanupResult = {
          action: 'cleanup_executed',
          sync_run_id: syncRunId,
          deleted_count: deletedCount,
          range_start: rangeStartDate,
          range_end: rangeEndDate,
          message: `Cleanup complete. Deleted ${deletedCount} stale entries.`,
        };
        console.log(`[sync-clockify] Cleanup complete: deleted ${deletedCount} stale entries`);
      } catch (err) {
        cleanupResult = {
          action: 'cleanup_failed',
          reason: 'rpc_error',
          sync_run_id: syncRunId,
          error: err instanceof Error ? err.message : 'Unknown error calling cleanup RPC',
          message: 'Cleanup RPC call failed. Manual review may be needed.',
        };
        console.error(`[sync-clockify] Cleanup failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 5.5: Populate rounded_minutes for synced entries
    // =========================================================================
    // Non-blocking: failures are logged but never stop the sync.
    // Calls RPC populate_rounded_minutes(p_workspace_id, p_range_start, p_range_end)
    // =========================================================================
    let roundingResult: Record<string, unknown> = { action: 'rounding_not_attempted' };

    if (!fetchComplete) {
      roundingResult = {
        action: 'rounding_skipped',
        reason: 'fetch_incomplete',
        sync_run_id: syncRunId,
      };
      console.log(`[sync-clockify] Rounding population skipped: fetch incomplete`);
    } else {
      try {
        const roundingStartDate = rangeStartISO.split('T')[0];
        const roundingEndDate = rangeEndISO.split('T')[0];

        const { data: rpcRoundingResult, error: roundingError } = await supabase
          .rpc('populate_rounded_minutes', {
            p_workspace_id: clockifyWorkspaceId,
            p_range_start: roundingStartDate,
            p_range_end: roundingEndDate,
          });

        if (roundingError) {
          console.error('[sync-clockify] Rounding population error:', roundingError.message);
          roundingResult = {
            action: 'rounding_failed',
            reason: 'rpc_error',
            sync_run_id: syncRunId,
            error: roundingError.message,
          };
        } else {
          const updatedCount = typeof rpcRoundingResult === 'number'
            ? rpcRoundingResult
            : 0;
          roundingResult = {
            action: 'rounding_executed',
            sync_run_id: syncRunId,
            updated_count: updatedCount,
          };
          console.log(`[sync-clockify] Populated rounded_minutes for ${updatedCount} entries`);
        }
      } catch (err) {
        roundingResult = {
          action: 'rounding_failed',
          reason: 'exception',
          sync_run_id: syncRunId,
          error: (err as Error).message,
        };
        console.error(`[sync-clockify] Rounding population failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 5.6: Populate Layer 2 totals (task_totals + employee_totals)
    // =========================================================================
    // Non-blocking: failures are logged but never stop the sync.
    // Only runs if rounding completed successfully.
    // =========================================================================
    let layer2Result: Record<string, unknown> = { action: 'layer2_not_attempted' };

    if (roundingResult.action !== 'rounding_executed') {
        layer2Result = {
            action: 'layer2_skipped',
            reason: 'rounding_not_complete',
            sync_run_id: syncRunId,
        };
        console.log(`[sync-clockify] Layer 2 skipped: rounding did not complete`);
    } else {
        try {
            const l2StartDate = rangeStartISO.split('T')[0];
            const l2EndDate = rangeEndISO.split('T')[0];

            const { data: l2Data, error: l2Error } = await supabase
                .rpc('populate_layer2_totals', {
                    p_workspace_id: clockifyWorkspaceId,
                    p_range_start: l2StartDate,
                    p_range_end: l2EndDate,
                });

            if (l2Error) {
                console.error('[sync-clockify] Layer 2 error:', l2Error.message);
                layer2Result = { action: 'layer2_failed', reason: 'rpc_error', error: l2Error.message };
            } else {
                layer2Result = { action: 'layer2_executed', result: l2Data };
                console.log('[sync-clockify] Layer 2 populated:', JSON.stringify(l2Data));
            }
        } catch (err) {
            layer2Result = { action: 'layer2_failed', reason: 'exception', error: (err as Error).message };
            console.error('[sync-clockify] Layer 2 failed:', (err as Error).message);
        }
    }

    // =========================================================================
    // STEP 6: Drain recalculation queue (n8n Node 7)
    // =========================================================================
    // Only runs if fetch was complete.
    // Calls RPC drain_recalculation_queue(p_max_depth) — default 12
    // =========================================================================
    let recalcResult: Record<string, unknown> = { action: 'recalculate_not_attempted' };

    if (!fetchComplete) {
      recalcResult = {
        action: 'recalculate_skipped',
        reason: 'fetch_incomplete',
        sync_run_id: syncRunId,
        message: 'Recalculation skipped because fetch did not complete successfully.',
      };
      console.log(`[sync-clockify] Recalculation skipped: fetch incomplete`);
    } else {
      try {
        const { data: rpcResult, error: rpcError } = await supabase
          .rpc('drain_recalculation_queue', { p_max_depth: 12 });

        if (rpcError) {
          throw new Error(`Recalculation RPC error: ${rpcError.message}`);
        }

        const processedCount = typeof rpcResult === 'number'
          ? rpcResult
          : (Array.isArray(rpcResult) ? (rpcResult[0] ?? 0) : 0);

        recalcResult = {
          action: 'recalculate_executed',
          sync_run_id: syncRunId,
          processed_count: processedCount,
          message: `Recalculation complete. Processed ${processedCount} queued project-months.`,
        };
        console.log(`[sync-clockify] Recalculation complete: processed ${processedCount} queued project-months`);
      } catch (err) {
        recalcResult = {
          action: 'recalculate_failed',
          reason: 'rpc_error',
          sync_run_id: syncRunId,
          error: err instanceof Error ? err.message : 'Unknown error calling drain_recalculation_queue RPC',
          message: 'Recalculation RPC call failed. Summary table may be stale until next sync.',
        };
        console.error(`[sync-clockify] Recalculation failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 7: Reconciliation alerts (new — follows sync_alerts pattern)
    // =========================================================================
    // Wrapped in try/catch — reconciliation failures never block core sync.
    // Alert types:
    //   clockify_sync_incomplete (error)    — fetch failed or hit safety limit
    //   clockify_zero_entries (warning)     — 0 entries returned
    //   clockify_high_deletion_count (warning) — cleanup deleted > 50 entries
    //   clockify_hours_mismatch (warning)   — Clockify total minutes per user
    //                                         don't match Manifest rollups
    // Auto-resolve on next successful sync.
    // =========================================================================
    let reconciliationResult: Record<string, unknown> = {
      alerts_created: 0,
      alerts_resolved: 0,
      reconciliation_error: null,
    };

    try {
      console.log('[sync-clockify] Starting reconciliation...');

      let alertsCreated = 0;
      let alertsResolved = 0;

      // --- Alert: clockify_sync_incomplete ---
      if (!fetchComplete) {
        // Check if active alert already exists
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_sync_incomplete')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          const errorSummary = fetchErrors.map((e) => e.message).join('; ') || 'Unknown error';
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_sync_incomplete',
              severity: 'error',
              title: `Clockify sync incomplete: ${errorSummary}`,
              entity_type: 'workspace',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: {
                sync_run_id: syncRunId,
                pages_fetched: page,
                entries_fetched: allTimeEntries.length,
                hit_safety_limit: hitSafetyLimit,
                errors: fetchErrors,
              },
            });
          alertsCreated++;
        }
      } else {
        // Fetch succeeded — auto-resolve any active clockify_sync_incomplete alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_sync_incomplete')
          .is('resolved_at', null);

        for (const alert of (activeAlerts || [])) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
          alertsResolved++;
        }
      }

      // --- Alert: clockify_zero_entries ---
      if (fetchComplete && allTimeEntries.length === 0) {
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_zero_entries')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_zero_entries',
              severity: 'warning',
              title: `Clockify sync returned 0 time entries for ${rangeStartISO.split('T')[0]} to ${rangeEndISO.split('T')[0]}`,
              entity_type: 'workspace',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: {
                sync_run_id: syncRunId,
                range_start: rangeStartISO,
                range_end: rangeEndISO,
              },
            });
          alertsCreated++;
        }
      } else if (allTimeEntries.length > 0) {
        // Non-zero entries — auto-resolve any active clockify_zero_entries alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_zero_entries')
          .is('resolved_at', null);

        for (const alert of (activeAlerts || [])) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
          alertsResolved++;
        }
      }

      // --- Alert: clockify_high_deletion_count ---
      if (deletedCount > 50) {
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_high_deletion_count')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_high_deletion_count',
              severity: 'warning',
              title: `Clockify cleanup deleted ${deletedCount} entries (threshold: 50)`,
              entity_type: 'workspace',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: {
                sync_run_id: syncRunId,
                deleted_count: deletedCount,
                range_start: rangeStartISO,
                range_end: rangeEndISO,
              },
            });
          alertsCreated++;
        }
      } else if (deletedCount <= 50 && deletedCount >= 0 && fetchComplete) {
        // Deletion count is normal — auto-resolve any active high_deletion_count alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_high_deletion_count')
          .is('resolved_at', null);

        for (const alert of (activeAlerts || [])) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
          alertsResolved++;
        }
      }

      // --- Alert: clockify_hours_mismatch ---
      // Compare Clockify raw totals per user against Manifest (timesheet_daily_rollups)
      // Only run if fetch completed and upsert succeeded (data is reliable)
      if (fetchComplete && !upsertError && allTimeEntries.length > 0) {
        try {
          console.log('[sync-clockify] Starting hours mismatch reconciliation...');

          // 1. Sum Clockify raw entries per userId using Math.ceil(seconds / 60)
          const clockifyTotalsByUser: Record<string, { minutes: number; name: string }> = {};
          for (const entry of allTimeEntries) {
            const userId = (entry?.userId as string) || null;
            if (!userId) continue;

            const timeInterval = entry?.timeInterval as Record<string, unknown> | undefined;
            const durationSeconds = typeof timeInterval?.duration === 'number'
              ? timeInterval.duration
              : 0;

            if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;

            const minutes = Math.ceil(durationSeconds / 60);

            if (!clockifyTotalsByUser[userId]) {
              clockifyTotalsByUser[userId] = {
                minutes: 0,
                name: (entry?.userName as string) || 'Unknown',
              };
            }
            clockifyTotalsByUser[userId].minutes += minutes;
          }

          // 2. Query Manifest's timesheet_daily_rollups for the same date range, grouped by user_id
          const rangeStartDate = rangeStartISO.split('T')[0];
          const rangeEndDate = rangeEndISO.split('T')[0];

          const { data: manifestRollups, error: manifestError } = await supabase
            .from('timesheet_daily_rollups')
            .select('user_id, total_minutes')
            .eq('clockify_workspace_id', clockifyWorkspaceId)
            .gte('work_date', rangeStartDate)
            .lte('work_date', rangeEndDate);

          if (manifestError) {
            throw new Error(`Manifest rollups query error: ${manifestError.message}`);
          }

          const manifestTotalsByUser: Record<string, number> = {};
          for (const row of (manifestRollups || [])) {
            const userId = row.user_id;
            if (userId) {
              manifestTotalsByUser[userId] = (manifestTotalsByUser[userId] || 0) + (row.total_minutes || 0);
            }
          }

          // 3. Compare per user and generate mismatch alerts
          const allUserIds = new Set([
            ...Object.keys(clockifyTotalsByUser),
            ...Object.keys(manifestTotalsByUser),
          ]);

          const mismatchedUserIds: string[] = [];

          for (const userId of allUserIds) {
            const clockifyMinutes = clockifyTotalsByUser[userId]?.minutes || 0;
            const manifestMinutes = manifestTotalsByUser[userId] || 0;

            if (clockifyMinutes !== manifestMinutes) {
              mismatchedUserIds.push(userId);
              const userName = clockifyTotalsByUser[userId]?.name || 'Unknown';

              const newMetadata = {
                clockify_minutes: clockifyMinutes,
                manifest_minutes: manifestMinutes,
                range_start: rangeStartDate,
                range_end: rangeEndDate,
              };

              // Check if an active alert already exists for this user
              const { data: existingAlert } = await supabase
                .from('sync_alerts')
                .select('id, metadata, dismissed_at')
                .eq('alert_type', 'clockify_hours_mismatch')
                .eq('entity_id', userId)
                .is('resolved_at', null)
                .maybeSingle();

              if (existingAlert) {
                // Alert exists — check if values changed
                const oldMeta = existingAlert.metadata as Record<string, unknown> || {};
                const valuesChanged = oldMeta.clockify_minutes !== clockifyMinutes
                  || oldMeta.manifest_minutes !== manifestMinutes;

                if (valuesChanged) {
                  // Values changed — update and clear dismissed_at so it reappears
                  await supabase
                    .from('sync_alerts')
                    .update({
                      title: `Hours mismatch: ${userName} has ${clockifyMinutes} minutes in Clockify but ${manifestMinutes} minutes in Manifest`,
                      metadata: newMetadata,
                      dismissed_at: null,
                      dismissed_by: null,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', existingAlert.id);

                  alertsCreated++;
                }
                // If values are the same, leave it alone (keep dismissed state)
              } else {
                // No active alert — insert new one
                await supabase
                  .from('sync_alerts')
                  .insert({
                    alert_type: 'clockify_hours_mismatch',
                    severity: 'warning',
                    title: `Hours mismatch: ${userName} has ${clockifyMinutes} minutes in Clockify but ${manifestMinutes} minutes in Manifest`,
                    entity_type: 'user',
                    entity_id: userId,
                    entity_name: userName,
                    metadata: newMetadata,
                  });

                alertsCreated++;
              }
            }
          }

          // 4. Auto-resolve mismatch alerts for users that now match
          const { data: activeMismatchAlerts } = await supabase
            .from('sync_alerts')
            .select('id, entity_id')
            .eq('alert_type', 'clockify_hours_mismatch')
            .is('resolved_at', null);

          for (const alert of (activeMismatchAlerts || [])) {
            if (alert.entity_id && !mismatchedUserIds.includes(alert.entity_id)) {
              await supabase
                .from('sync_alerts')
                .update({
                  resolved_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', alert.id);

              alertsResolved++;
            }
          }

          console.log(
            `[sync-clockify] Hours mismatch reconciliation: ` +
            `${mismatchedUserIds.length} mismatches found, ` +
            `users checked: ${allUserIds.size}`,
          );
        } catch (hoursMismatchError) {
          // Hours mismatch reconciliation failure is non-blocking
          console.error(
            '[sync-clockify] Hours mismatch reconciliation error (non-blocking):',
            hoursMismatchError instanceof Error ? hoursMismatchError.message : String(hoursMismatchError),
          );
        }
      }

      reconciliationResult = {
        alerts_created: alertsCreated,
        alerts_resolved: alertsResolved,
        reconciliation_error: null,
      };

      console.log(`[sync-clockify] Reconciliation complete: ${alertsCreated} created, ${alertsResolved} resolved`);
    } catch (reconciliationError) {
      reconciliationResult = {
        alerts_created: 0,
        alerts_resolved: 0,
        reconciliation_error: reconciliationError instanceof Error
          ? reconciliationError.message
          : String(reconciliationError),
      };
      console.error(
        '[sync-clockify] Reconciliation error (non-blocking):',
        reconciliationResult.reconciliation_error,
      );
    }

    // =========================================================================
    // STEP 8: Return comprehensive summary JSON
    // =========================================================================
    const result = {
      success: fetchComplete && !upsertError,
      action: 'clockify_timesheet_sync_complete',
      sync_run_id: syncRunId,
      sync_run_at: syncRunAt,
      range_start: rangeStartISO,
      range_end: rangeEndISO,
      fetch: {
        complete: fetchComplete,
        pages_fetched: page,
        page_size: PAGE_SIZE,
        total_entries: allTimeEntries.length,
        hit_safety_limit: hitSafetyLimit,
        error_count: fetchErrors.length,
        errors: fetchErrors,
      },
      transform: {
        rows_built: rows.length,
        skipped_no_task_id: skippedNoTaskId,
        skipped_no_work_date: skippedNoWorkDate,
        skipped_zero_duration: skippedZeroDuration,
      },
      upsert: {
        rows_upserted: totalUpserted,
        batch_size: BATCH_SIZE,
        error: upsertError,
      },
      cleanup: cleanupResult,
      rounding: roundingResult,
      layer2: layer2Result,
      recalculation: recalcResult,
      reconciliation: reconciliationResult,
    };

    console.log(`[sync-clockify] Complete:`, JSON.stringify(result));

    // =========================================================================
    // STEP 9: Persist sync run to sync_runs table (diagnostics)
    // =========================================================================
    try {
      await supabase.from('sync_runs').insert({
        sync_type: 'clockify_timesheets',
        sync_run_id: syncRunId,
        started_at: syncRunAt,
        success: fetchComplete && !upsertError,
        source_total: rows.length,
        manifest_total: totalUpserted,
        deleted_count: deletedCount,
        source_hours: sourceHours,
        manifest_hours: manifestHours,
        error_message: upsertError || (fetchErrors.length > 0 ? fetchErrors[0].message : null),
        summary: result,
      });
    } catch (syncRunErr) {
      console.error('[sync-clockify] Failed to persist sync run (non-blocking):', syncRunErr);
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('[sync-clockify] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: sync-clickup-timesheets
// =============================================================================
// Syncs ClickUp time entries into Supabase `timesheet_daily_rollups`.
//
// Replaces the 6-node n8n ClickUp pipeline with a single atomic function:
//   Node 1 (Date Range)   -> Step 1: computeDateRange()
//   Node 2 (Fetch)        -> Step 2: fetchClickUpEntries()
//   Nodes 3+4+5 (Extract, Normalize, Flatten) -> Step 3: normalizeAndBuildRows()
//   Node 6 (Supabase)     -> Step 4: batchUpsert()
//   (new)                 -> Step 5: conditionalCleanup()
//   (new)                 -> Step 6: drainRecalculationQueue()
//   (new)                 -> Step 7: reconciliationAlerts()
//
// Modes:
//   POST with no body or {}  -- Automated (cron): syncs 14-day lookback + current month
//   POST with { rangeStartDate, rangeEndDate } -- Manual: custom date range (ISO strings)
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
    // AUTH -- same pattern as Clockify Edge Function
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // Check if the JWT has service_role -- handles both JWT and sb_secret_ env var formats
    let isServiceRole = false;
    try {
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64));
        isServiceRole = payload.role === 'service_role';
      }
    } catch {
      // Not a valid JWT -- fall through to user session check
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
    // Secrets -- all via Deno.env.get(), never hardcoded
    // =========================================================================
    const clickupApiToken = Deno.env.get('CLICKUP_API_TOKEN')!;
    const clickupTeamId = Deno.env.get('CLICKUP_TEAM_ID')!;

    if (!clickupApiToken || !clickupTeamId) {
      return jsonResponse(
        { error: 'Missing required secrets: CLICKUP_API_TOKEN and/or CLICKUP_TEAM_ID' },
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
    // STEP 1: Compute date range (same approach as Clockify)
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
      // Manual override -- use provided dates directly
      rangeStartISO = body.rangeStartDate as string;
      rangeEndISO = body.rangeEndDate as string;
      console.log(`[sync-clickup] Manual date range: ${rangeStartISO} to ${rangeEndISO}`);
    } else {
      // Automatic: 14 days before 1st of current month through end of month
      const now = new Date();

      // 1st of the current month at 00:00:00.000Z
      const firstOfMonth = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
        0, 0, 0, 0,
      ));

      // 14 days before the 1st
      const rangeStart = new Date(firstOfMonth.getTime() - 14 * 24 * 60 * 60 * 1000);

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
      console.log(`[sync-clickup] Auto date range: ${rangeStartISO} to ${rangeEndISO}`);
    }

    // Convert to Unix millisecond timestamps for ClickUp API
    const rangeStartMs = new Date(rangeStartISO).getTime();
    const rangeEndMs = new Date(rangeEndISO).getTime();

    // =========================================================================
    // STEP 2: Fetch time entries from ClickUp API (n8n Nodes 1+2)
    // =========================================================================
    // 1. GET /api/v2/team -> extract member IDs for our team
    // 2. For each member: GET /api/v2/team/{id}/time_entries -> collect entries
    // =========================================================================
    const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

    let allTimeEntries: Array<Record<string, unknown>> = [];
    let fetchComplete = true;
    const fetchErrors: Array<{ type: string; step: string; message: string }> = [];
    let memberIds: number[] = [];

    console.log(`[sync-clickup] Starting fetch from ClickUp API...`);

    // Step 2a: Get team members
    try {
      const teamResponse = await fetch(`${CLICKUP_API_BASE}/team`, {
        method: 'GET',
        headers: { 'Authorization': clickupApiToken },
      });

      if (!teamResponse.ok) {
        throw new Error(`ClickUp /team API returned ${teamResponse.status}: ${teamResponse.statusText}`);
      }

      const teamData = await teamResponse.json();
      const teams = teamData.teams || [];

      for (const team of teams) {
        if (team.id === clickupTeamId) {
          const members = team.members || [];
          memberIds = members.map((m: Record<string, unknown>) => {
            const user = m.user as Record<string, unknown>;
            return user?.id as number;
          }).filter((id: number | undefined) => id != null);
        }
      }

      console.log(`[sync-clickup] Found ${memberIds.length} team members`);

      if (memberIds.length === 0) {
        fetchComplete = false;
        fetchErrors.push({
          type: 'no_members',
          step: 'team_fetch',
          message: `No team members found for team ${clickupTeamId}. Check CLICKUP_TEAM_ID.`,
        });
      }
    } catch (teamErr) {
      fetchComplete = false;
      fetchErrors.push({
        type: 'api_error',
        step: 'team_fetch',
        message: teamErr instanceof Error ? teamErr.message : 'Unknown error fetching team',
      });
    }

    // Step 2b: Fetch time entries for each team member
    if (fetchComplete && memberIds.length > 0) {
      for (const userId of memberIds) {
        try {
          const url = `${CLICKUP_API_BASE}/team/${clickupTeamId}/time_entries` +
            `?start_date=${rangeStartMs}&end_date=${rangeEndMs}&assignee=${userId}`;

          const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': clickupApiToken },
          });

          if (!response.ok) {
            // Individual member failure -- log but continue
            fetchErrors.push({
              type: 'member_fetch_error',
              step: `time_entries_user_${userId}`,
              message: `ClickUp time entries API returned ${response.status} for user ${userId}`,
            });
            continue;
          }

          const data = await response.json();
          const entries = data.data || [];
          allTimeEntries = allTimeEntries.concat(entries);

          console.log(`[sync-clickup] User ${userId}: fetched ${entries.length} entries`);
        } catch (entryErr) {
          fetchErrors.push({
            type: 'member_fetch_error',
            step: `time_entries_user_${userId}`,
            message: entryErr instanceof Error ? entryErr.message : `Unknown error for user ${userId}`,
          });
        }
      }

      // If ALL member fetches failed, mark as incomplete
      if (allTimeEntries.length === 0 && fetchErrors.length > 0 && memberIds.length > 0) {
        const memberFetchErrors = fetchErrors.filter(e => e.type === 'member_fetch_error');
        if (memberFetchErrors.length === memberIds.length) {
          fetchComplete = false;
        }
      }
    }

    console.log(
      `[sync-clickup] Fetch complete: ${fetchComplete}, ` +
      `members: ${memberIds.length}, entries: ${allTimeEntries.length}, errors: ${fetchErrors.length}`,
    );

    // =========================================================================
    // STEP 2c: Build space/folder lookups (n8n Nodes for hierarchy mapping)
    // =========================================================================
    // Space = Company, Folder = Project in the ClickUp hierarchy.
    // We need these lookups because task_location only has IDs, not names.
    // However, if task_location already contains names (space_name, folder_name),
    // we use those directly and only fall back to API lookups.
    // =========================================================================
    const spaceLookup: Record<string, string> = {};
    const folderLookup: Record<string, string> = {};

    if (fetchComplete && allTimeEntries.length > 0) {
      // Collect unique space IDs from entries that lack names
      const spaceIdsNeedingLookup = new Set<string>();
      const spaceIdsWithFolders = new Set<string>();

      for (const entry of allTimeEntries) {
        const taskLocation = entry.task_location as Record<string, unknown> | undefined;
        if (!taskLocation) continue;

        const spaceId = taskLocation.space_id as string;
        const spaceName = taskLocation.space_name as string;
        const folderId = taskLocation.folder_id as string;
        const folderName = taskLocation.folder_name as string;

        // Cache names we already have from the entry itself
        if (spaceId && spaceName) {
          spaceLookup[spaceId] = spaceName;
        } else if (spaceId && !spaceLookup[spaceId]) {
          spaceIdsNeedingLookup.add(spaceId);
        }

        if (folderId && folderName) {
          folderLookup[folderId] = folderName;
        } else if (folderId && spaceId && !folderLookup[folderId]) {
          spaceIdsWithFolders.add(spaceId);
        }
      }

      // Fetch space names for any we don't have
      for (const spaceId of spaceIdsNeedingLookup) {
        try {
          const res = await fetch(`${CLICKUP_API_BASE}/space/${spaceId}`, {
            method: 'GET',
            headers: { 'Authorization': clickupApiToken },
          });
          if (res.ok) {
            const spaceData = await res.json();
            spaceLookup[spaceId] = spaceData.name || `Space ${spaceId}`;
          }
        } catch {
          // Non-blocking -- will use fallback name
        }
      }

      // Fetch folder names for spaces that have folders we don't know about
      for (const spaceId of spaceIdsWithFolders) {
        try {
          const res = await fetch(`${CLICKUP_API_BASE}/space/${spaceId}/folder`, {
            method: 'GET',
            headers: { 'Authorization': clickupApiToken },
          });
          if (res.ok) {
            const folderData = await res.json();
            for (const folder of (folderData.folders || [])) {
              if (folder.id && folder.name) {
                folderLookup[folder.id] = folder.name;
              }
            }
          }
        } catch {
          // Non-blocking -- will use fallback name
        }
      }

      console.log(
        `[sync-clickup] Lookups built: ${Object.keys(spaceLookup).length} spaces, ` +
        `${Object.keys(folderLookup).length} folders`,
      );
    }

    // =========================================================================
    // STEP 3: Normalize + build upsert rows in a single pass (n8n Nodes 3+4+5)
    // =========================================================================
    // Combines extract, normalize, and row-building into one loop.
    // ClickUp-specific:
    //   - entry_id (ClickUp time entry ID) is stored as task_id in timesheet_daily_rollups
    //   - duration is in milliseconds (string) -- convert to minutes via Math.ceil(ms/1000/60)
    //   - timestamps are Unix ms (strings) -- convert to ISO dates
    //   - Space name = company (stored as client_name), Folder name = project (stored as project_name)
    //   - clockify_workspace_id column stores the ClickUp Team ID
    //   - user mapping: use resource_user_associations table (source='clickup')
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
    let skippedNoEntryId = 0;
    let skippedNoWorkDate = 0;
    let skippedZeroDuration = 0;

    for (const entry of allTimeEntries) {
      // --- Entry ID (stored as task_id in rollups) ---
      const entryId = (entry?.id as string) || null;
      if (!entryId) {
        skippedNoEntryId++;
        continue;
      }

      // --- Work date from start timestamp (Unix ms as string) ---
      const startMs = entry?.start ? parseInt(entry.start as string, 10) : null;
      let workDate: string | null = null;

      if (startMs && !Number.isNaN(startMs)) {
        const dt = new Date(startMs);
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

      // --- Duration: ClickUp returns milliseconds as a string ---
      const durationMs = parseInt((entry?.duration as string) || '0', 10);
      const durationSeconds = Math.floor(durationMs / 1000);

      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        skippedZeroDuration++;
        continue;
      }

      // --- Build Row ---
      const totalMinutes = Math.ceil(durationSeconds / 60);
      if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
        skippedZeroDuration++;
        continue;
      }

      // Location hierarchy
      const taskLocation = entry?.task_location as Record<string, unknown> | undefined;
      const spaceId = (taskLocation?.space_id as string) || null;
      const folderId = (taskLocation?.folder_id as string) || null;

      // Space = Company (client), Folder = Project
      const spaceName = spaceLookup[spaceId || ''] || (taskLocation?.space_name as string) || null;
      const folderName = folderLookup[folderId || ''] || (taskLocation?.folder_name as string) || 'No Project';

      // Task info
      const task = entry?.task as Record<string, unknown> | null;
      const taskName = (task?.name as string)
        || ((entry?.description as string) || '').trim()
        || '(no description)';

      // User info
      const user = entry?.user as Record<string, unknown> | null;
      const userId = user?.id != null ? String(user.id) : null;
      const userName = (user?.username as string) || 'Unknown';

      rows.push({
        clockify_workspace_id: clickupTeamId,
        task_id: entryId,
        work_date: workDate,
        project_id: folderId,
        project_name: folderName,
        user_id: userId,
        user_name: userName,
        task_name: taskName,
        client_id: spaceId,
        client_name: spaceName,
        total_minutes: totalMinutes,
        synced_at: syncRunAt,
        sync_run_id: syncRunId,
        sync_run_at: syncRunAt,
      });
    }

    console.log(
      `[sync-clickup] Rows built: ${rows.length} ` +
      `(skipped: ${skippedNoEntryId} no entry_id, ${skippedNoWorkDate} no work_date, ${skippedZeroDuration} zero/negative duration)`,
    );

    // =========================================================================
    // STEP 4: Batch upsert to timesheet_daily_rollups
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
          console.log(`[sync-clickup] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rows (total: ${totalUpserted})`);
        }
      } catch (err) {
        upsertError = err instanceof Error ? err.message : 'Failed to upsert timesheet_daily_rollups';
        console.error(`[sync-clickup] Upsert error: ${upsertError}`);
      }
    }

    console.log(`[sync-clickup] Upsert complete: ${totalUpserted} rows`);

    // =========================================================================
    // Compute total hours for diagnostics (source vs manifest)
    // =========================================================================
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
        .eq('clockify_workspace_id', clickupTeamId)
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
      // Non-blocking -- manifest_hours will be null if query fails
    }

    console.log(`[sync-clickup] Hours -- source: ${sourceHours}, manifest: ${manifestHours}`);

    // =========================================================================
    // STEP 5: Conditional cleanup -- delete stale entries
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
      console.log(`[sync-clickup] Cleanup skipped: fetch incomplete`);
    } else if (upsertError) {
      cleanupResult = {
        action: 'cleanup_skipped',
        reason: 'upsert_error',
        sync_run_id: syncRunId,
        message: 'Cleanup skipped because upsert had errors.',
      };
      console.log(`[sync-clickup] Cleanup skipped: upsert error`);
    } else {
      // Extract date parts for the RPC (expects DATE, not TIMESTAMPTZ)
      const rangeStartDate = rangeStartISO.split('T')[0];
      const rangeEndDate = rangeEndISO.split('T')[0];

      try {
        const { data: rpcResult, error: rpcError } = await supabase
          .rpc('cleanup_stale_timesheet_entries', {
            p_workspace_id: clickupTeamId,
            p_range_start: rangeStartDate,
            p_range_end: rangeEndDate,
            p_sync_run_id: syncRunId,
          });

        if (rpcError) {
          throw new Error(`Cleanup RPC error: ${rpcError.message}`);
        }

        // RPC returns TABLE (deleted_count BIGINT) -- result is array with one row
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
        console.log(`[sync-clickup] Cleanup complete: deleted ${deletedCount} stale entries`);
      } catch (err) {
        cleanupResult = {
          action: 'cleanup_failed',
          reason: 'rpc_error',
          sync_run_id: syncRunId,
          error: err instanceof Error ? err.message : 'Unknown error calling cleanup RPC',
          message: 'Cleanup RPC call failed. Manual review may be needed.',
        };
        console.error(`[sync-clickup] Cleanup failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 6: Drain recalculation queue
    // =========================================================================
    // Only runs if fetch was complete.
    // Calls RPC drain_recalculation_queue(p_max_depth) -- default 12
    // =========================================================================
    let recalcResult: Record<string, unknown> = { action: 'recalculate_not_attempted' };

    if (!fetchComplete) {
      recalcResult = {
        action: 'recalculate_skipped',
        reason: 'fetch_incomplete',
        sync_run_id: syncRunId,
        message: 'Recalculation skipped because fetch did not complete successfully.',
      };
      console.log(`[sync-clickup] Recalculation skipped: fetch incomplete`);
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
        console.log(`[sync-clickup] Recalculation complete: processed ${processedCount} queued project-months`);
      } catch (err) {
        recalcResult = {
          action: 'recalculate_failed',
          reason: 'rpc_error',
          sync_run_id: syncRunId,
          error: err instanceof Error ? err.message : 'Unknown error calling drain_recalculation_queue RPC',
          message: 'Recalculation RPC call failed. Summary table may be stale until next sync.',
        };
        console.error(`[sync-clickup] Recalculation failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 7: Reconciliation alerts (follows sync_alerts pattern)
    // =========================================================================
    // Wrapped in try/catch -- reconciliation failures never block core sync.
    // Alert types:
    //   clickup_sync_incomplete (error)         -- fetch failed
    //   clickup_zero_entries (warning)          -- 0 entries returned
    //   clickup_high_deletion_count (warning)   -- cleanup deleted > 50 entries
    //   clickup_hours_mismatch (warning)        -- ClickUp total minutes per user
    //                                              don't match Manifest rollups
    // Auto-resolve on next successful sync.
    // =========================================================================
    let reconciliationResult: Record<string, unknown> = {
      alerts_created: 0,
      alerts_resolved: 0,
      reconciliation_error: null,
    };

    try {
      console.log('[sync-clickup] Starting reconciliation...');

      let alertsCreated = 0;
      let alertsResolved = 0;

      // --- Alert: clickup_sync_incomplete ---
      if (!fetchComplete) {
        // Check if active alert already exists
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clickup_sync_incomplete')
          .eq('entity_id', clickupTeamId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          const errorSummary = fetchErrors.map((e) => e.message).join('; ') || 'Unknown error';
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clickup_sync_incomplete',
              severity: 'error',
              title: `ClickUp sync incomplete: ${errorSummary}`,
              entity_type: 'team',
              entity_id: clickupTeamId,
              entity_name: 'ClickUp Team',
              metadata: {
                sync_run_id: syncRunId,
                members_checked: memberIds.length,
                entries_fetched: allTimeEntries.length,
                errors: fetchErrors,
              },
            });
          alertsCreated++;
        }
      } else {
        // Fetch succeeded -- auto-resolve any active clickup_sync_incomplete alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clickup_sync_incomplete')
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

      // --- Alert: clickup_zero_entries ---
      if (fetchComplete && allTimeEntries.length === 0) {
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clickup_zero_entries')
          .eq('entity_id', clickupTeamId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clickup_zero_entries',
              severity: 'warning',
              title: `ClickUp sync returned 0 time entries for ${rangeStartISO.split('T')[0]} to ${rangeEndISO.split('T')[0]}`,
              entity_type: 'team',
              entity_id: clickupTeamId,
              entity_name: 'ClickUp Team',
              metadata: {
                sync_run_id: syncRunId,
                range_start: rangeStartISO,
                range_end: rangeEndISO,
                members_checked: memberIds.length,
              },
            });
          alertsCreated++;
        }
      } else if (allTimeEntries.length > 0) {
        // Non-zero entries -- auto-resolve any active clickup_zero_entries alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clickup_zero_entries')
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

      // --- Alert: clickup_high_deletion_count ---
      if (deletedCount > 50) {
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clickup_high_deletion_count')
          .eq('entity_id', clickupTeamId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clickup_high_deletion_count',
              severity: 'warning',
              title: `ClickUp cleanup deleted ${deletedCount} entries (threshold: 50)`,
              entity_type: 'team',
              entity_id: clickupTeamId,
              entity_name: 'ClickUp Team',
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
        // Deletion count is normal -- auto-resolve any active high_deletion_count alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clickup_high_deletion_count')
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

      // --- Alert: clickup_hours_mismatch ---
      // Compare ClickUp raw totals per user against Manifest (timesheet_daily_rollups)
      // Only run if fetch completed and upsert succeeded (data is reliable)
      if (fetchComplete && !upsertError && allTimeEntries.length > 0) {
        try {
          console.log('[sync-clickup] Starting hours mismatch reconciliation...');

          // 1. Sum ClickUp raw entries per userId using Math.ceil(ms / 1000 / 60)
          const clickupTotalsByUser: Record<string, { minutes: number; name: string }> = {};
          for (const entry of allTimeEntries) {
            const user = entry?.user as Record<string, unknown> | null;
            const userId = user?.id != null ? String(user.id) : null;
            if (!userId) continue;

            const durationMs = parseInt((entry?.duration as string) || '0', 10);
            const durationSeconds = Math.floor(durationMs / 1000);

            if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;

            const minutes = Math.ceil(durationSeconds / 60);

            if (!clickupTotalsByUser[userId]) {
              clickupTotalsByUser[userId] = {
                minutes: 0,
                name: (user?.username as string) || 'Unknown',
              };
            }
            clickupTotalsByUser[userId].minutes += minutes;
          }

          // 2. Query Manifest's timesheet_daily_rollups for the same date range, grouped by user_id
          const rangeStartDate = rangeStartISO.split('T')[0];
          const rangeEndDate = rangeEndISO.split('T')[0];

          const { data: manifestRollups, error: manifestError } = await supabase
            .from('timesheet_daily_rollups')
            .select('user_id, total_minutes')
            .eq('clockify_workspace_id', clickupTeamId)
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
            ...Object.keys(clickupTotalsByUser),
            ...Object.keys(manifestTotalsByUser),
          ]);

          const mismatchedUserIds: string[] = [];

          for (const userId of allUserIds) {
            const clickupMinutes = clickupTotalsByUser[userId]?.minutes || 0;
            const manifestMinutes = manifestTotalsByUser[userId] || 0;

            if (clickupMinutes !== manifestMinutes) {
              mismatchedUserIds.push(userId);
              const userName = clickupTotalsByUser[userId]?.name || 'Unknown';

              const newMetadata = {
                clickup_minutes: clickupMinutes,
                manifest_minutes: manifestMinutes,
                range_start: rangeStartDate,
                range_end: rangeEndDate,
              };

              // Check if an active alert already exists for this user
              const { data: existingAlert } = await supabase
                .from('sync_alerts')
                .select('id, metadata, dismissed_at')
                .eq('alert_type', 'clickup_hours_mismatch')
                .eq('entity_id', userId)
                .is('resolved_at', null)
                .maybeSingle();

              if (existingAlert) {
                // Alert exists -- check if values changed
                const oldMeta = existingAlert.metadata as Record<string, unknown> || {};
                const valuesChanged = oldMeta.clickup_minutes !== clickupMinutes
                  || oldMeta.manifest_minutes !== manifestMinutes;

                if (valuesChanged) {
                  // Values changed -- update and clear dismissed_at so it reappears
                  await supabase
                    .from('sync_alerts')
                    .update({
                      title: `Hours mismatch: ${userName} has ${clickupMinutes} minutes in ClickUp but ${manifestMinutes} minutes in Manifest`,
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
                // No active alert -- insert new one
                await supabase
                  .from('sync_alerts')
                  .insert({
                    alert_type: 'clickup_hours_mismatch',
                    severity: 'warning',
                    title: `Hours mismatch: ${userName} has ${clickupMinutes} minutes in ClickUp but ${manifestMinutes} minutes in Manifest`,
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
            .eq('alert_type', 'clickup_hours_mismatch')
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
            `[sync-clickup] Hours mismatch reconciliation: ` +
            `${mismatchedUserIds.length} mismatches found, ` +
            `users checked: ${allUserIds.size}`,
          );
        } catch (hoursMismatchError) {
          // Hours mismatch reconciliation failure is non-blocking
          console.error(
            '[sync-clickup] Hours mismatch reconciliation error (non-blocking):',
            hoursMismatchError instanceof Error ? hoursMismatchError.message : String(hoursMismatchError),
          );
        }
      }

      reconciliationResult = {
        alerts_created: alertsCreated,
        alerts_resolved: alertsResolved,
        reconciliation_error: null,
      };

      console.log(`[sync-clickup] Reconciliation complete: ${alertsCreated} created, ${alertsResolved} resolved`);
    } catch (reconciliationError) {
      reconciliationResult = {
        alerts_created: 0,
        alerts_resolved: 0,
        reconciliation_error: reconciliationError instanceof Error
          ? reconciliationError.message
          : String(reconciliationError),
      };
      console.error(
        '[sync-clickup] Reconciliation error (non-blocking):',
        reconciliationResult.reconciliation_error,
      );
    }

    // =========================================================================
    // STEP 8: Return comprehensive summary JSON
    // =========================================================================
    const result = {
      success: fetchComplete && !upsertError,
      action: 'clickup_timesheet_sync_complete',
      sync_run_id: syncRunId,
      sync_run_at: syncRunAt,
      range_start: rangeStartISO,
      range_end: rangeEndISO,
      fetch: {
        complete: fetchComplete,
        team_members: memberIds.length,
        total_entries: allTimeEntries.length,
        spaces_resolved: Object.keys(spaceLookup).length,
        folders_resolved: Object.keys(folderLookup).length,
        error_count: fetchErrors.length,
        errors: fetchErrors,
      },
      transform: {
        rows_built: rows.length,
        skipped_no_entry_id: skippedNoEntryId,
        skipped_no_work_date: skippedNoWorkDate,
        skipped_zero_duration: skippedZeroDuration,
      },
      upsert: {
        rows_upserted: totalUpserted,
        batch_size: BATCH_SIZE,
        error: upsertError,
      },
      cleanup: cleanupResult,
      recalculation: recalcResult,
      reconciliation: reconciliationResult,
    };

    console.log(`[sync-clickup] Complete:`, JSON.stringify(result));

    // =========================================================================
    // STEP 9: Persist sync run to sync_runs table (diagnostics)
    // =========================================================================
    try {
      await supabase.from('sync_runs').insert({
        sync_type: 'clickup_timesheets',
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
      console.error('[sync-clickup] Failed to persist sync run (non-blocking):', syncRunErr);
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('[sync-clickup] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

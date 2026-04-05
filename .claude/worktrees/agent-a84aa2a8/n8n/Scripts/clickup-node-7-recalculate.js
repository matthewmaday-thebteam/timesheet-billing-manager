// =============================================================================
// ClickUp Node 7: Drain Recalculation Queue (update billing summaries)
// =============================================================================
// PURPOSE:
//   After sync + cleanup, drain the recalculation queue so that
//   project_monthly_summary reflects the latest timesheet data.
//   This is critical because the frontend reads billing exclusively
//   from the summary table (Task 035 removed the frontend billing engine).
//
// SAFETY:
//   Only executes if fetch_complete === true.
//   If fetch was incomplete, recalculation is SKIPPED.
//
// USAGE:
//   This node should run AFTER Node 6 (cleanup).
//   Connect: Node 6 -> Node 7
// =============================================================================

// Retrieve metadata from workflow static data (stored by Node 5)
const staticData = $getWorkflowStaticData('global');
const meta = staticData.lastSyncMeta || {};

// SAFETY CHECK: Do not recalculate if fetch was incomplete
if (!meta.fetch_complete) {
  return [{
    json: {
      action: 'recalculate_skipped',
      reason: 'fetch_incomplete',
      sync_run_id: meta.sync_run_id,
      workspace_id: meta.workspace_id,
      message: 'Recalculation skipped because fetch did not complete successfully.',
    }
  }];
}

// Supabase credentials (hardcoded for n8n compatibility)
const SUPABASE_URL = 'https://yptbnsegcfpizwhipeep.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGJuc2VnY2ZwaXp3aGlwZWVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAwNjM1MCwiZXhwIjoyMDgzNTgyMzUwfQ.gP_kbCGf_MZtKm1dx3SxfaSXXVwMwoo5JG47GuVDwWI';

try {
  const response = await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/rpc/drain_recalculation_queue`,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: {},
    json: true,
  });

  const processedCount = typeof response === 'number' ? response : (response?.[0] ?? 0);

  return [{
    json: {
      action: 'recalculate_executed',
      sync_run_id: meta.sync_run_id,
      workspace_id: meta.workspace_id,
      processed_count: processedCount,
      message: `Recalculation complete. Processed ${processedCount} queued project-months.`,
    }
  }];

} catch (err) {
  return [{
    json: {
      action: 'recalculate_failed',
      reason: 'rpc_error',
      sync_run_id: meta.sync_run_id,
      workspace_id: meta.workspace_id,
      error: err.message || 'Unknown error calling drain_recalculation_queue RPC',
      message: 'Recalculation RPC call failed. Summary table may be stale until next sync.',
    }
  }];
}

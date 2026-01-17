// =============================================================================
// ClickUp Node 6: Conditional Cleanup (DELETE stale entries)
// =============================================================================
// PURPOSE:
//   Delete timesheet entries that were NOT touched by this sync run.
//   This handles entries deleted in the source system.
//
// SAFETY:
//   Only executes if fetch_complete === true AND upsert succeeded.
//   If fetch was incomplete (e.g., member fetch failed), cleanup is SKIPPED.
//
// USAGE:
//   This node should run AFTER the Supabase upsert node.
//   Connect: Node 5 -> Supabase Upsert -> Node 6
// =============================================================================

const meta = items[0]?.json?._meta || {};

// SAFETY CHECK: Do not cleanup if fetch was incomplete
if (!meta.fetch_complete) {
  return [{
    json: {
      action: 'cleanup_skipped',
      reason: 'fetch_incomplete',
      sync_run_id: meta.sync_run_id,
      workspace_id: meta.workspace_id,
      members_total: meta.members_total,
      members_fetched: meta.members_fetched,
      members_failed: meta.members_failed,
      error_count: meta.error_count,
      errors: meta.errors,
      message: `Cleanup skipped: ${meta.members_failed} of ${meta.members_total} member fetches failed. No entries deleted.`,
    }
  }];
}

// SAFETY CHECK: Must have required parameters
if (!meta.sync_run_id || !meta.workspace_id || !meta.range_start || !meta.range_end) {
  return [{
    json: {
      action: 'cleanup_skipped',
      reason: 'missing_parameters',
      sync_run_id: meta.sync_run_id,
      workspace_id: meta.workspace_id,
      range_start: meta.range_start,
      range_end: meta.range_end,
      message: 'Cleanup skipped due to missing required parameters.',
    }
  }];
}

// Supabase credentials (hardcoded for n8n compatibility)
const SUPABASE_URL = 'https://yptbnsegcfpizwhipeep.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGJuc2VnY2ZwaXp3aGlwZWVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAwNjM1MCwiZXhwIjoyMDgzNTgyMzUwfQ.gP_kbCGf_MZtKm1dx3SxfaSXXVwMwoo5JG47GuVDwWI';

// Execute cleanup via Supabase RPC function
// The function uses IS DISTINCT FROM to correctly handle NULL sync_run_id values
try {
  const response = await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/rpc/cleanup_stale_timesheet_entries`,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: {
      p_workspace_id: meta.workspace_id,
      p_range_start: meta.range_start.split('T')[0], // Extract date part
      p_range_end: meta.range_end.split('T')[0],     // Extract date part
      p_sync_run_id: meta.sync_run_id,
    },
    json: true,
  });

  const deletedCount = response?.[0]?.deleted_count ?? response?.deleted_count ?? 0;

  return [{
    json: {
      action: 'cleanup_executed',
      sync_run_id: meta.sync_run_id,
      workspace_id: meta.workspace_id,
      range_start: meta.range_start,
      range_end: meta.range_end,
      deleted_count: deletedCount,
      rows_upserted: meta.rows_to_upsert,
      members_synced: `${meta.members_fetched}/${meta.members_total}`,
      message: `Cleanup complete. Deleted ${deletedCount} stale entries.`,
    }
  }];

} catch (err) {
  return [{
    json: {
      action: 'cleanup_failed',
      reason: 'rpc_error',
      sync_run_id: meta.sync_run_id,
      workspace_id: meta.workspace_id,
      error: err.message || 'Unknown error calling cleanup RPC',
      message: 'Cleanup RPC call failed. Manual review may be needed.',
    }
  }];
}

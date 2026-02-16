// =============================================================================
// BambooHR Node 3: Upsert employees to bamboo_employees via Supabase REST
// =============================================================================
// PURPOSE:
//   Transform BambooHR employee directory data and upsert to bamboo_employees.
//   Passes through full payload (employees + timeOffRequests + _syncMeta) to
//   the next node so time-off upsert has access to employee data.
//
// UPSERT KEY: bamboo_id (UNIQUE constraint)
// =============================================================================

const SUPABASE_URL = 'https://yptbnsegcfpizwhipeep.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGJuc2VnY2ZwaXp3aGlwZWVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAwNjM1MCwiZXhwIjoyMDgzNTgyMzUwfQ.gP_kbCGf_MZtKm1dx3SxfaSXXVwMwoo5JG47GuVDwWI';

const data = items[0]?.json || {};
const employees = data.employees || [];
const syncMeta = data._syncMeta || {};
const syncRunAt = syncMeta.sync_run_at || new Date().toISOString();

// Build rows for upsert
const rows = employees
  .filter(emp => emp.id) // Must have a BambooHR ID
  .map(emp => ({
    bamboo_id: String(emp.id),
    first_name: emp.firstName || null,
    last_name: emp.lastName || null,
    synced_at: syncRunAt,
  }));

let upsertResult = { success: false, count: 0, error: null };

if (rows.length > 0) {
  try {
    const response = await this.helpers.httpRequest({
      method: 'POST',
      url: `${SUPABASE_URL}/rest/v1/bamboo_employees`,
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: rows,
      json: true,
    });

    upsertResult = { success: true, count: rows.length, error: null };
  } catch (err) {
    upsertResult = {
      success: false,
      count: 0,
      error: err.message || 'Failed to upsert bamboo_employees',
    };
  }
}

// Pass through full payload for node 4
return [{
  json: {
    employees: data.employees,
    timeOffRequests: data.timeOffRequests,
    _syncMeta: {
      ...syncMeta,
      employees_upserted: upsertResult.count,
      employees_upsert_success: upsertResult.success,
      employees_upsert_error: upsertResult.error,
    },
  }
}];

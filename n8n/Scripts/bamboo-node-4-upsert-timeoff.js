// =============================================================================
// BambooHR Node 4: Upsert time-off requests to employee_time_off
// =============================================================================
// PURPOSE:
//   Transform BambooHR time-off data and upsert to employee_time_off.
//   Builds employee email lookup from the employee directory data.
//   The auto-linking trigger (link_time_off_to_resources) fires automatically
//   on insert/update to set resource_id.
//
// UPSERT KEY: bamboo_request_id (UNIQUE constraint)
// =============================================================================

const SUPABASE_URL = 'https://yptbnsegcfpizwhipeep.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGJuc2VnY2ZwaXp3aGlwZWVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAwNjM1MCwiZXhwIjoyMDgzNTgyMzUwfQ.gP_kbCGf_MZtKm1dx3SxfaSXXVwMwoo5JG47GuVDwWI';

const data = items[0]?.json || {};
const employees = data.employees || [];
const timeOffRequests = data.timeOffRequests || [];
const syncMeta = data._syncMeta || {};
const syncRunAt = syncMeta.sync_run_at || new Date().toISOString();

// Build employee lookup: bamboo_id → { name, email }
const employeeLookup = {};
for (const emp of employees) {
  if (emp.id) {
    employeeLookup[String(emp.id)] = {
      name: [emp.firstName, emp.lastName].filter(Boolean).join(' ') || 'Unknown',
      email: emp.workEmail || null,
    };
  }
}

// Build rows for upsert — only approved requests
const rows = timeOffRequests
  .filter(req => req.id && req.employeeId && (req.status?.status || '').toLowerCase() === 'approved')
  .map(req => {
    const empId = String(req.employeeId);
    const empInfo = employeeLookup[empId] || { name: req.name || 'Unknown', email: null };

    return {
      bamboo_request_id: String(req.id),
      bamboo_employee_id: empId,
      employee_name: empInfo.name,
      employee_email: empInfo.email,
      time_off_type: req.type?.name || req.type || 'Unknown',
      status: (req.status?.status || 'unknown').toLowerCase(),
      start_date: req.start,
      end_date: req.end,
      total_days: Number(req.amount?.amount || req.amount || 0),
      notes: req.notes?.employee || null,
      synced_at: syncRunAt,
    };
  });

let upsertResult = { success: false, count: 0, error: null };

if (rows.length > 0) {
  // Upsert in batches of 500 to avoid payload limits
  const BATCH_SIZE = 500;
  let totalUpserted = 0;

  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      await this.helpers.httpRequest({
        method: 'POST',
        url: `${SUPABASE_URL}/rest/v1/employee_time_off`,
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: batch,
        json: true,
      });

      totalUpserted += batch.length;
    }

    upsertResult = { success: true, count: totalUpserted, error: null };

    // Remove records no longer in the approved set (cancelled/denied since last sync)
    const approvedIds = rows.map(r => `"${r.bamboo_request_id}"`).join(',');
    const startDate = rows.reduce((min, r) => r.start_date < min ? r.start_date : min, rows[0].start_date);
    const endDate = rows.reduce((max, r) => r.end_date > max ? r.end_date : max, rows[0].end_date);

    const deleteResponse = await this.helpers.httpRequest({
      method: 'DELETE',
      url: `${SUPABASE_URL}/rest/v1/employee_time_off?bamboo_request_id=not.in.(${approvedIds})&start_date=gte.${startDate}&end_date=lte.${endDate}`,
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation',
      },
      json: true,
    });

    const deletedCount = Array.isArray(deleteResponse) ? deleteResponse.length : 0;
    upsertResult.deleted = deletedCount;
  } catch (err) {
    upsertResult = {
      success: false,
      count: totalUpserted,
      error: err.message || 'Failed to upsert employee_time_off',
    };
  }
} else {
  // No approved requests — delete all records in the sync date range
  try {
    const rangeStart = syncMeta.range_start;
    const rangeEnd = syncMeta.range_end;
    if (rangeStart && rangeEnd) {
      const deleteResponse = await this.helpers.httpRequest({
        method: 'DELETE',
        url: `${SUPABASE_URL}/rest/v1/employee_time_off?start_date=gte.${rangeStart}&end_date=lte.${rangeEnd}`,
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=representation',
        },
        json: true,
      });
      upsertResult.deleted = Array.isArray(deleteResponse) ? deleteResponse.length : 0;
    }
  } catch (err) {
    upsertResult.error = err.message || 'Failed to clean up stale time-off records';
  }
}

return [{
  json: {
    action: 'bamboohr_sync_complete',
    sync_run_id: syncMeta.sync_run_id,
    sync_run_at: syncRunAt,
    fetch_complete: syncMeta.fetch_complete,
    employees_fetched: employees.length,
    employees_upserted: syncMeta.employees_upserted || 0,
    time_off_fetched: timeOffRequests.length,
    time_off_upserted: upsertResult.count,
    time_off_deleted: upsertResult.deleted || 0,
    time_off_upsert_success: upsertResult.success,
    time_off_upsert_error: upsertResult.error,
    errors: syncMeta.errors || [],
  }
}];

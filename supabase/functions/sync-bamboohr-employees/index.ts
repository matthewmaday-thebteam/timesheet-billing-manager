import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: sync-bamboohr-employees
// =============================================================================
// Syncs the BambooHR employee directory into Supabase `bamboo_employees` table.
//
// Split from the monolithic sync-bamboohr function so that employee directory
// syncs can run on a DAILY schedule (cheaper, less API pressure) while time-off
// syncs run every 2 hours.
//
// Auth: service-role JWT or authenticated user session
// Schedule: daily at 6 AM UTC via pg_cron
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

    const syncRunAt = new Date().toISOString();

    console.log(`[sync-bamboohr-employees] Starting employee directory sync`);

    // =========================================================================
    // Fetch employee directory from BambooHR
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

    let employees: Array<Record<string, unknown>> = [];

    const dirResponse = await fetch(`${baseUrl}/employees/directory`, {
      method: 'GET',
      headers: bambooHeaders,
    });

    if (!dirResponse.ok) {
      throw new Error(`BambooHR directory API returned ${dirResponse.status}`);
    }

    const dirData = await dirResponse.json();
    employees = dirData?.employees || [];

    console.log(`[sync-bamboohr-employees] Fetched ${employees.length} employees from BambooHR`);

    // =========================================================================
    // Upsert employees to bamboo_employees
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
        console.error(`[sync-bamboohr-employees] Upsert error: ${empError.message}`);
      } else {
        employeesUpserted = employeeRows.length;
      }
    }

    console.log(`[sync-bamboohr-employees] Upserted ${employeesUpserted} employees`);

    // =========================================================================
    // Response summary
    // =========================================================================
    const result = {
      success: !employeesUpsertError,
      action: 'bamboohr_employees_sync_complete',
      sync_run_at: syncRunAt,
      last_synced_at: syncRunAt,
      employees_fetched: employees.length,
      employees_upserted: employeesUpserted,
      employees_upsert_error: employeesUpsertError,
    };

    console.log(`[sync-bamboohr-employees] Complete:`, JSON.stringify(result));

    return jsonResponse(result);
  } catch (error) {
    console.error('[sync-bamboohr-employees] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

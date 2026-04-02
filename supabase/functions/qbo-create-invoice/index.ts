import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: qbo-create-invoice
// =============================================================================
// Creates a QuickBooks Online invoice for a specific company-month, pulling
// billing data from the canonical project monthly summary and fixed billings.
//
// POST (authenticated admin or service_role)
//
// Request body:
//   { companyId: string, year: number, month: number, eomReportId?: string }
//
// Returns JSON:
//   { success: true, invoiceId, invoiceNumber, totalAmountCents, lineItemCount, companyName }
//   { error: string } on failure
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

/** QBO API base URL (sandbox or production). */
const QBO_API_BASE = Deno.env.get('QBO_API_BASE')
  || 'https://sandbox-quickbooks.api.intuit.com/v3/company';

/** QBO API minor version for all requests. */
const QBO_MINOR_VERSION = '73';

// =============================================================================
// Transaction type labels (replicated from src/types/index.ts)
// =============================================================================

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  revenue_milestone: 'Revenue Milestone',
  service_fee: 'Service Fee',
  subscription: 'Subscription',
  license: 'License',
  reimbursement: 'Reimbursement',
};

// =============================================================================
// Month names for display
// =============================================================================

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// =============================================================================
// Inline: QBO Token Management (from _shared/qbo-token.ts)
// Supabase Edge Functions don't resolve _shared imports during remote bundling,
// so the token utility is inlined here.
// =============================================================================

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

async function getValidToken(supabase: SupabaseClient): Promise<{ access_token: string; realm_id: string }> {
  const { data: tokenRow, error: fetchError } = await supabase
    .from('qbo_oauth_tokens')
    .select('*')
    .limit(1)
    .single();

  if (fetchError || !tokenRow) {
    throw new Error('No QuickBooks Online connection found. Please connect via Settings.');
  }

  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
    return { access_token: tokenRow.access_token, realm_id: tokenRow.realm_id };
  }

  const clientId = Deno.env.get('QUICKBOOKS_PROD_CLIENTID') || Deno.env.get('QUICKBOOKS_DEV_CLIENTID');
  const clientSecret = Deno.env.get('QUICKBOOKS_PROD_SECRET') || Deno.env.get('QUICKBOOKS_DEV_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('QBO client credentials are not configured.');
  }

  const refreshResponse = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
    }),
  });

  if (!refreshResponse.ok) {
    const errorBody = await refreshResponse.text();
    console.error('QBO token refresh failed:', refreshResponse.status, errorBody);
    throw new Error(`QBO token refresh failed (${refreshResponse.status}). The connection may need to be re-established.`);
  }

  const tokens = await refreshResponse.json();
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    console.error('QBO token refresh returned unexpected shape:', Object.keys(tokens));
    throw new Error('QBO token refresh returned an invalid response. The connection may need to be re-established.');
  }

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const newRefreshExpiresAt = tokens.x_refresh_token_expires_in
    ? new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString()
    : tokenRow.refresh_expires_at;

  const { error: updateError } = await supabase
    .from('qbo_oauth_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || 'bearer',
      expires_at: newExpiresAt,
      refresh_expires_at: newRefreshExpiresAt,
    })
    .eq('id', tokenRow.id);

  if (updateError) {
    console.error('Failed to persist refreshed QBO tokens:', updateError.message);
  }

  return { access_token: tokens.access_token, realm_id: tokenRow.realm_id };
}

// =============================================================================
// Types
// =============================================================================

interface SummaryRow {
  project_id: string;
  company_id: string;
  billed_hours: number;
  billed_revenue_cents: number;
  rate_used: number;
  rounding_used: number;
  milestone_override_cents: number | null;
  projects: {
    project_name: string;
    project_id: string; // external project_id
  };
}

interface TaskEntry {
  project_id: string;
  task_name: string;
  total_minutes: number;
}

interface BillingRow {
  billing_id: string;
  company_id: string;
  company_client_id: string;
  company_name: string;
  company_display_name: string | null;
  billing_name: string;
  billing_type: string;
  linked_project_id: string | null;
  linked_project_name: string | null;
  transaction_id: string | null;
  transaction_month: string | null;
  amount_cents: number | null;
  transaction_description: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

/** Get last day of a given year/month as YYYY-MM-DD */
function lastDayOfMonth(year: number, month: number): string {
  // month is 1-indexed; Date with day=0 gives last day of previous month
  const d = new Date(year, month, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Round currency to 2 decimal places. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// =============================================================================
// Main handler
// =============================================================================

serve(async (req) => {
  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // --- Authenticate caller (user or service_role) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // Allow service_role key (used by automation) — no user context needed
    let sentByUserId: string | null = null;

    // Check if the token is a service_role JWT by decoding the payload
    let isServiceRole = false;
    try {
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64));
        if (payload.role === 'service_role') {
          isServiceRole = true;
        }
      }
    } catch {
      // Not a valid JWT — fall through to user auth
    }

    if (isServiceRole) {
      // Trusted service call — no user to attribute
      sentByUserId = null;
    } else {
      // Verify the caller is an authenticated user
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Verify caller is admin via RPC
      const { data: isAdmin, error: adminCheckError } = await supabaseAuth.rpc('is_admin');
      if (adminCheckError || !isAdmin) {
        return jsonResponse({ error: 'Forbidden: admin access required' }, 403);
      }

      sentByUserId = user.id;
    }

    // --- Service-role client for privileged operations ---
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parse and validate request body ---
    const body = await req.json();
    const { companyId, year, month, eomReportId } = body as {
      companyId?: string;
      year?: number;
      month?: number;
      eomReportId?: string;
    };

    if (!companyId || typeof companyId !== 'string') {
      return jsonResponse({ error: 'Missing or invalid companyId' }, 400);
    }
    if (!year || typeof year !== 'number' || year < 2000 || year > 2100) {
      return jsonResponse({ error: 'Missing or invalid year' }, 400);
    }
    if (!month || typeof month !== 'number' || month < 1 || month > 12) {
      return jsonResponse({ error: 'Missing or invalid month (must be 1-12)' }, 400);
    }
    if (eomReportId !== undefined) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof eomReportId !== 'string' || !UUID_RE.test(eomReportId)) {
        return jsonResponse({ error: 'eomReportId must be a valid UUID' }, 400);
      }
    }

    const monthLabel = `${MONTH_NAMES[month]} ${year}`;

    // --- Check for existing sent invoice ---
    const { data: existingLog, error: existingLogError } = await supabase
      .from('qbo_invoice_log')
      .select('id, status, qbo_invoice_id, invoice_number')
      .eq('company_id', companyId)
      .eq('report_year', year)
      .eq('report_month', month)
      .maybeSingle();

    if (existingLogError) {
      console.error('Error checking existing invoice log:', existingLogError.message);
      return jsonResponse({ error: 'Failed to check invoice history' }, 500);
    }

    if (existingLog && existingLog.status === 'sent') {
      return jsonResponse({
        error: `Invoice already sent for ${monthLabel}`,
        existingInvoiceId: existingLog.qbo_invoice_id,
        existingInvoiceNumber: existingLog.invoice_number,
      }, 409);
    }

    // --- Look up company ---
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .select('id, client_name, display_name')
      .eq('id', companyId)
      .single();

    if (companyError || !companyData) {
      return jsonResponse({ error: 'Company not found' }, 404);
    }

    const companyName = companyData.display_name || companyData.client_name;

    // --- Look up QBO customer mapping ---
    const { data: mapping, error: mappingError } = await supabase
      .from('qbo_customer_mappings')
      .select('qbo_customer_id, qbo_customer_name')
      .eq('company_id', companyId)
      .single();

    if (mappingError || !mapping) {
      return jsonResponse({
        error: 'Company is not mapped to a QuickBooks customer',
      }, 400);
    }

    const qboCustomerId = mapping.qbo_customer_id;

    // --- Get valid QBO access token (auto-refreshes if needed) ---
    const { access_token, realm_id } = await getValidToken(supabase);

    // --- Fetch customer email from QBO ---
    let billEmail: string | null = null;
    try {
      const custQuery = encodeURIComponent(
        `SELECT PrimaryEmailAddr FROM Customer WHERE Id = '${qboCustomerId}'`
      );
      const custUrl = `${QBO_API_BASE}/${realm_id}/query?query=${custQuery}&minorversion=${QBO_MINOR_VERSION}`;
      const custAbort = new AbortController();
      const custTimeout = setTimeout(() => custAbort.abort(), 30_000);
      const custResponse = await fetch(custUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
        signal: custAbort.signal,
      });
      clearTimeout(custTimeout);

      if (custResponse.ok) {
        const custData = await custResponse.json();
        // deno-lint-ignore no-explicit-any
        const customers = ((custData?.QueryResponse as Record<string, any>)?.Customer ?? []) as any[];
        if (customers.length > 0 && customers[0].PrimaryEmailAddr?.Address) {
          billEmail = customers[0].PrimaryEmailAddr.Address;
        }
      }
    } catch {
      console.warn('Failed to fetch customer email from QBO — invoice will be created without BillEmail');
    }

    // --- Query billing data for this company-month ---
    const monthStr = `${year}-${String(month).padStart(2, '0')}-01`;

    const rangeStart = monthStr;
    const rangeEnd = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const [summaryResult, billingsResult, projectsResult, entriesResult] = await Promise.all([
      // Project billing summary for this company-month
      supabase
        .from('v_canonical_project_monthly_summary')
        .select(`
          project_id,
          company_id,
          billed_hours,
          billed_revenue_cents,
          rate_used,
          rounding_used,
          milestone_override_cents,
          projects!inner (project_name, project_id)
        `)
        .eq('summary_month', monthStr)
        .eq('company_id', companyId),

      // Billings with transactions for the month
      supabase.rpc('get_billings_with_transactions', {
        p_start_month: monthStr,
        p_end_month: monthStr,
      }),

      // All projects (for internal UUID -> external ID mapping, needed for milestone matching)
      supabase
        .from('projects')
        .select('id, project_id'),

      // Timesheet entries for task breakdown
      supabase
        .from('v_timesheet_entries')
        .select('project_id, task_name, total_minutes')
        .gte('work_date', rangeStart)
        .lt('work_date', rangeEnd),
    ]);

    if (summaryResult.error) {
      console.error('Summary query failed:', summaryResult.error.message);
      return jsonResponse({ error: `Failed to query billing data: ${summaryResult.error.message}` }, 500);
    }
    if (billingsResult.error) {
      console.error('Billings query failed:', billingsResult.error.message);
      return jsonResponse({ error: `Failed to query billings: ${billingsResult.error.message}` }, 500);
    }
    if (projectsResult.error) {
      console.error('Projects query failed:', projectsResult.error.message);
      return jsonResponse({ error: `Failed to query projects: ${projectsResult.error.message}` }, 500);
    }
    if (entriesResult.error) {
      console.error('Entries query failed:', entriesResult.error.message);
      // Non-fatal — tasks are for description enrichment, not billing amounts
    }

    const summaryRows = (summaryResult.data as SummaryRow[]) || [];
    const billingRows = (billingsResult.data as BillingRow[]) || [];
    const allProjects = projectsResult.data || [];
    const allEntries = (entriesResult.data as TaskEntry[]) || [];

    // Build task breakdown per project (external project_id -> task list)
    const tasksByProject = new Map<string, Map<string, number>>();
    for (const entry of allEntries) {
      if (!entry.project_id || entry.total_minutes <= 0) continue;
      const taskName = entry.task_name || 'No Task';
      if (!tasksByProject.has(entry.project_id)) {
        tasksByProject.set(entry.project_id, new Map());
      }
      const taskMap = tasksByProject.get(entry.project_id)!;
      taskMap.set(taskName, (taskMap.get(taskName) || 0) + entry.total_minutes);
    }

    // Build internal UUID -> external project_id map
    const internalToExternal = new Map<string, string>();
    for (const p of allProjects) {
      internalToExternal.set(p.id, p.project_id);
    }

    // --- Process billings: separate linked milestones from fixed billings ---
    const billingMap = new Map<string, {
      id: string;
      companyClientId: string;
      companyId: string;
      name: string;
      type: string;
      linkedProjectId: string | null;
      totalCents: number;
    }>();

    for (const row of billingRows) {
      if (!billingMap.has(row.billing_id)) {
        billingMap.set(row.billing_id, {
          id: row.billing_id,
          companyClientId: row.company_client_id,
          companyId: row.company_id,
          name: row.billing_name,
          type: row.billing_type,
          linkedProjectId: row.linked_project_id,
          totalCents: 0,
        });
      }
      if (row.transaction_id && row.amount_cents !== null) {
        billingMap.get(row.billing_id)!.totalCents += row.amount_cents;
      }
    }

    // Identify linked milestone billings (these override project revenue, not separate lines)
    const milestoneByExternalProjectId = new Map<string, number>();
    const linkedMilestoneBillingIds = new Set<string>();

    for (const billing of billingMap.values()) {
      if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
        const externalId = internalToExternal.get(billing.linkedProjectId);
        if (externalId) {
          const existing = milestoneByExternalProjectId.get(externalId) || 0;
          milestoneByExternalProjectId.set(externalId, existing + billing.totalCents);
          linkedMilestoneBillingIds.add(billing.id);
        }
      }
    }

    // --- Query QBO for Service-type Items (Time and Materials + Fixed Bid Development) ---
    const itemQuery = encodeURIComponent(
      "SELECT Id, Name FROM Item WHERE Type = 'Service' AND Active = true MAXRESULTS 100"
    );
    const itemUrl = `${QBO_API_BASE}/${realm_id}/query?query=${itemQuery}&minorversion=${QBO_MINOR_VERSION}`;

    const itemAbort = new AbortController();
    const itemTimeout = setTimeout(() => itemAbort.abort(), 30_000);
    let itemResponse: Response;
    try {
      itemResponse = await fetch(itemUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
        signal: itemAbort.signal,
      });
    } catch (fetchErr) {
      clearTimeout(itemTimeout);
      const msg = fetchErr instanceof DOMException && fetchErr.name === 'AbortError'
        ? 'QuickBooks item query timed out after 30 seconds'
        : `QuickBooks item query failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`;
      return jsonResponse({ error: msg }, 504);
    }
    clearTimeout(itemTimeout);

    if (!itemResponse.ok) {
      const errorBody = await itemResponse.text();
      console.error('QBO item query failed:', itemResponse.status, errorBody);

      if (itemResponse.status === 401) {
        return jsonResponse({
          error: 'QuickBooks connection has expired. Please reconnect.',
        }, 401);
      }

      return jsonResponse({
        error: `Failed to query QuickBooks items (${itemResponse.status})`,
      }, 502);
    }

    let itemData: Record<string, unknown>;
    try {
      itemData = await itemResponse.json();
    } catch {
      return jsonResponse({ error: 'QuickBooks returned an unexpected response format (item query)' }, 502);
    }
    // deno-lint-ignore no-explicit-any
    const serviceItems = ((itemData?.QueryResponse as Record<string, any>)?.Item ?? []) as any[];
    if (serviceItems.length === 0) {
      return jsonResponse({
        error: 'Please create Service-type items in QuickBooks ("Time and Materials" and "Fixed Bid Development")',
      }, 400);
    }

    // Find specific items by name; fall back to first Service item
    const tmItem = serviceItems.find((i: { Name: string }) => /time.+materials/i.test(i.Name));
    const fbItem = serviceItems.find((i: { Name: string }) => /fixed.+bid/i.test(i.Name));
    const timeAndMaterialsId = tmItem ? String(tmItem.Id) : String(serviceItems[0].Id);
    const fixedBidId = fbItem ? String(fbItem.Id) : String(serviceItems[0].Id);

    if (!tmItem) console.warn('QBO item "Time and Materials" not found — using fallback:', serviceItems[0].Name);
    if (!fbItem) console.warn('QBO item "Fixed Bid Development" not found — using fallback:', serviceItems[0].Name);

    // --- Query QBO for Net 10 payment term ---
    const termQuery = encodeURIComponent(
      "SELECT Id, Name FROM Term WHERE Name = 'Net 10' AND Active = true MAXRESULTS 1"
    );
    const termUrl = `${QBO_API_BASE}/${realm_id}/query?query=${termQuery}&minorversion=${QBO_MINOR_VERSION}`;

    let termId: string | null = null;
    try {
      const termAbort = new AbortController();
      const termTimeout = setTimeout(() => termAbort.abort(), 30_000);
      const termResponse = await fetch(termUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
        signal: termAbort.signal,
      });
      clearTimeout(termTimeout);

      if (termResponse.ok) {
        const termData = await termResponse.json();
        // deno-lint-ignore no-explicit-any
        const terms = ((termData?.QueryResponse as Record<string, any>)?.Term ?? []) as any[];
        if (terms.length > 0) {
          termId = String(terms[0].Id);
        }
      }
      // If term lookup fails, we still create the invoice without terms — not a blocker
    } catch {
      console.warn('Failed to query QBO payment terms — invoice will be created without terms');
    }

    // --- Build QBO Invoice line items ---
    // deno-lint-ignore no-explicit-any
    const lineItems: any[] = [];
    let totalAmountCents = 0;

    // 1. Project lines: each project with billed_revenue > 0 becomes a line
    for (const row of summaryRows) {
      const billedRevenueCents = Number(row.billed_revenue_cents);
      const billedHours = Number(row.billed_hours);
      const rate = Number(row.rate_used);
      const projectName = row.projects.project_name;
      const externalId = row.projects.project_id;

      // Check for milestone override — if present, use milestone amount instead
      const milestoneCents = milestoneByExternalProjectId.get(externalId);
      const effectiveRevenueCents = milestoneCents !== undefined
        ? milestoneCents
        : billedRevenueCents;

      if (effectiveRevenueCents <= 0) continue;

      const amount = roundCurrency(effectiveRevenueCents / 100);

      // For milestone overrides, show the milestone amount with the project name
      // For standard billing, show hours and rate
      let description: string;
      let qty: number;
      let unitPrice: number;

      // Build task breakdown for description
      const rounding = Number(row.rounding_used) || 0;
      const projectTasks = tasksByProject.get(externalId);
      let taskLines = '';
      if (projectTasks && projectTasks.size > 0) {
        const sorted = [...projectTasks.entries()].sort((a, b) => b[1] - a[1]);
        taskLines = '\n' + sorted.map(([name, mins]) => {
          const roundedMins = rounding > 0 ? Math.ceil(mins / rounding) * rounding : mins;
          const hrs = Math.round((roundedMins / 60) * 100) / 100;
          return `${name}: ${hrs} hrs`;
        }).join('\n');
      }

      if (milestoneCents !== undefined) {
        description = `${projectName} - ${monthLabel} (Fixed Bid)${taskLines}`;
        qty = 1;
        unitPrice = amount;
      } else {
        description = `${projectName} - ${monthLabel} - ${billedHours} hrs @ $${rate}/hr${taskLines}`;
        qty = billedHours;
        unitPrice = rate;
      }

      const itemRefId = milestoneCents !== undefined ? fixedBidId : timeAndMaterialsId;

      lineItems.push({
        DetailType: 'SalesItemLineDetail',
        Amount: amount,
        Description: description,
        SalesItemLineDetail: {
          ItemRef: { value: itemRefId },
          Qty: qty,
          UnitPrice: unitPrice,
        },
      });

      totalAmountCents += effectiveRevenueCents;
    }

    // 2. Fixed billing lines: each non-milestone billing for this company with totalCents > 0
    for (const billing of billingMap.values()) {
      // Skip linked milestones (already folded into project lines above)
      if (linkedMilestoneBillingIds.has(billing.id)) continue;
      // Only include billings for this company (compare by UUID, not text client_id)
      if (billing.companyId !== companyId) continue;

      if (billing.totalCents <= 0) continue;

      const typeLabel = TRANSACTION_TYPE_LABELS[billing.type] || billing.type;
      const amount = roundCurrency(billing.totalCents / 100);

      lineItems.push({
        DetailType: 'SalesItemLineDetail',
        Amount: amount,
        Description: `${billing.name} - ${monthLabel} (${typeLabel})`,
        SalesItemLineDetail: {
          ItemRef: { value: fixedBidId },
          Qty: 1,
          UnitPrice: amount,
        },
      });

      totalAmountCents += billing.totalCents;
    }

    if (lineItems.length === 0) {
      return jsonResponse({
        error: `No billable items found for ${companyName} in ${monthLabel}`,
      }, 400);
    }

    // --- Build QBO Invoice payload ---
    const txnDate = lastDayOfMonth(year, month);

    // Due date: TxnDate + 10 days (Net 10)
    const txnDateObj = new Date(`${txnDate}T00:00:00Z`);
    txnDateObj.setUTCDate(txnDateObj.getUTCDate() + 10);
    const dueDate = txnDateObj.toISOString().slice(0, 10);

    // CRITICAL: EmailStatus = 'NotSet' ensures the invoice is CREATED, not sent
    const invoicePayload: Record<string, unknown> = {
      CustomerRef: { value: qboCustomerId },
      TxnDate: txnDate,
      DueDate: dueDate,
      EmailStatus: 'NotSet',
      ...(billEmail ? { BillEmail: { Address: billEmail } } : {}),
      GlobalTaxCalculation: 'NotApplicable',
      PrivateNote: `Manifest EOM Report - ${monthLabel}`,
      CustomerMemo: {
        value: [
          'Wise Wire and Credit Card Information',
          '',
          'Recipient Name:              The B Team OOD',
          'Company ID / Bulstat:     203913310',
          'Account Number:            BG51UNCR70001522532201   (NEW)',
          'BIC/Swift:                          UNCRBGSF',
          'Currency:                             Select USD to BGN',
        ].join('\n'),
      },
      Line: lineItems,
    };

    // Attach payment terms if Net 10 was found in QBO
    if (termId) {
      invoicePayload.SalesTermRef = { value: termId };
    }

    // --- POST to QBO Invoice API ---
    const invoiceUrl = `${QBO_API_BASE}/${realm_id}/invoice?minorversion=${QBO_MINOR_VERSION}`;

    // NOTE: When sending invoices for multiple companies ("Send All"), callers
    // should dispatch requests sequentially to avoid QBO rate limits. The frontend
    // already does this — see useQBOInvoice.ts.
    const invoiceAbort = new AbortController();
    const invoiceTimeout = setTimeout(() => invoiceAbort.abort(), 30_000);
    let qboResponse: Response;
    try {
      qboResponse = await fetch(invoiceUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invoicePayload),
        signal: invoiceAbort.signal,
      });
    } catch (fetchErr) {
      clearTimeout(invoiceTimeout);
      const msg = fetchErr instanceof DOMException && fetchErr.name === 'AbortError'
        ? 'QuickBooks invoice creation timed out after 30 seconds'
        : `QuickBooks invoice creation failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`;
      return jsonResponse({ error: msg }, 504);
    }
    clearTimeout(invoiceTimeout);

    let qboResponseBody: Record<string, unknown>;
    try {
      qboResponseBody = await qboResponse.json();
    } catch {
      return jsonResponse({ error: 'QuickBooks returned an unexpected response format' }, 502);
    }

    if (!qboResponse.ok) {
      console.error('QBO invoice creation failed:', qboResponse.status, JSON.stringify(qboResponseBody));

      // Extract QBO error detail
      let errorDetail = `QuickBooks returned an error (${qboResponse.status})`;

      if (qboResponse.status === 401) {
        errorDetail = 'QuickBooks connection has expired. Please reconnect.';
      } else if (qboResponse.status === 400) {
        // QBO 400 errors typically have a Fault.Error array
        // deno-lint-ignore no-explicit-any
        const fault = qboResponseBody?.Fault as Record<string, any> | undefined;
        if (fault?.Error?.length > 0) {
          const qboErrors = fault.Error.map(
            (e: { Message?: string; Detail?: string }) =>
              e.Detail || e.Message || 'Unknown error'
          );
          errorDetail = qboErrors.join('; ');
        }
      }

      // Upsert error record to qbo_invoice_log
      const { error: logError } = await supabase
        .from('qbo_invoice_log')
        .upsert(
          {
            company_id: companyId,
            report_year: year,
            report_month: month,
            eom_report_id: eomReportId || null,
            qbo_customer_id: qboCustomerId,
            qbo_invoice_id: null,
            invoice_number: null,
            total_amount_cents: totalAmountCents,
            line_item_count: lineItems.length,
            status: 'error',
            error_message: errorDetail,
            sent_at: null,
            sent_by: sentByUserId,
          },
          { onConflict: 'company_id,report_year,report_month' }
        );

      if (logError) {
        console.error('Failed to log invoice error:', logError.message);
      }

      const statusCode = qboResponse.status === 401 ? 401 : 502;
      return jsonResponse({ error: errorDetail }, statusCode);
    }

    // --- Success: extract invoice details from QBO response ---
    // deno-lint-ignore no-explicit-any
    const invoice = (qboResponseBody?.Invoice || qboResponseBody) as Record<string, any>;
    if (!invoice?.Id) {
      console.error('QBO invoice response missing Invoice.Id:', JSON.stringify(qboResponseBody));
      return jsonResponse({
        error: 'QuickBooks created the invoice but returned an unexpected response shape (missing Invoice.Id)',
      }, 502);
    }
    const qboInvoiceId = String(invoice.Id);
    const invoiceNumber = String(invoice.DocNumber || '');

    // Upsert success record to qbo_invoice_log
    const { error: logError } = await supabase
      .from('qbo_invoice_log')
      .upsert(
        {
          company_id: companyId,
          report_year: year,
          report_month: month,
          eom_report_id: eomReportId || null,
          qbo_customer_id: qboCustomerId,
          qbo_invoice_id: qboInvoiceId,
          invoice_number: invoiceNumber,
          total_amount_cents: totalAmountCents,
          line_item_count: lineItems.length,
          status: 'sent',
          error_message: null,
          sent_at: new Date().toISOString(),
          sent_by: sentByUserId,
        },
        { onConflict: 'company_id,report_year,report_month' }
      );

    if (logError) {
      console.error('Failed to log invoice success:', logError.message);
      // Don't fail the response — the invoice was created in QBO
    }

    return jsonResponse({
      success: true,
      invoiceId: qboInvoiceId,
      invoiceNumber,
      totalAmountCents,
      lineItemCount: lineItems.length,
      companyName,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('qbo-create-invoice error:', error);

    // Best-effort log to DB so the UI shows the error instead of silently failing
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseServiceKey) {
        const body = await req.clone().json().catch(() => ({}));
        const { companyId, year, month, eomReportId } = body as Record<string, unknown>;
        if (companyId && year && month) {
          const sb = createClient(supabaseUrl, supabaseServiceKey);
          // Look up qbo_customer_id from mapping (needed for NOT NULL constraint)
          const { data: mapping } = await sb
            .from('qbo_customer_mappings')
            .select('qbo_customer_id')
            .eq('company_id', companyId)
            .maybeSingle();

          await sb.from('qbo_invoice_log').upsert(
            {
              company_id: companyId,
              report_year: year,
              report_month: month,
              eom_report_id: eomReportId || null,
              qbo_customer_id: mapping?.qbo_customer_id || 'unknown',
              status: 'error',
              error_message: errorMsg,
            },
            { onConflict: 'company_id,report_year,report_month' }
          );
        }
      }
    } catch (logErr) {
      console.error('Failed to log error to DB:', logErr);
    }

    return jsonResponse({ error: errorMsg }, 500);
  }
});

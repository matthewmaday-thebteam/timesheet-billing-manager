// Read-only extract of the billing tables from Manifest prod for LOCAL tests.
// Management API with read_only:true (SELECT only). Usage: node pull.mjs <out-dir>
// The output is production data: keep it OUTSIDE the repository.
import fs from 'fs'; import os from 'os';
const token = fs.readFileSync(os.homedir()+'/.supabase/access-token','utf8').trim();
async function q(sql){const r=await fetch('https://api.supabase.com/v1/projects/yptbnsegcfpizwhipeep/database/query',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:true})});const j=await r.json();if(!Array.isArray(j))throw new Error(JSON.stringify(j));return j;}
const tables=['employment_types','companies','company_groups','company_group_members','projects','project_groups','project_group_members','project_monthly_rates','project_monthly_rounding','project_monthly_billing_limits','project_monthly_active_status','billings','billing_transactions','project_monthly_summary','project_carryover_hours','monthly_fixed_billing_summary','task_monthly_totals','qbo_invoice_log','eom_reports','sync_alerts','recalculation_queue','timesheet_daily_rollups'];
const dir=process.argv[2];
for(const t of tables){
  const rows=await q(`select coalesce(json_agg(x),'[]'::json) j from public.${t} x`);
  fs.writeFileSync(`${dir}/${t}.json`, JSON.stringify(rows[0].j));
  console.log(t, rows[0].j.length);
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://yptbnsegcfpizwhipeep.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGJuc2VnY2ZwaXp3aGlwZWVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMDYzNTAsImV4cCI6MjA4MzU4MjM1MH0.HSij4i9n5lepPl2F19-XJWhxMj9sTdqQdomdF4VQRf0';

const supabase = createClient(supabaseUrl, supabaseKey);

// Sign in with user credentials from environment (or prompt)
const email = process.env.MANIFEST_EMAIL;
const password = process.env.MANIFEST_PASSWORD;

async function main() {
  // Sign in if credentials provided
  if (email && password) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      console.error('Sign-in failed:', signInError.message);
      process.exit(1);
    }
    console.log('Signed in as:', email);
  } else {
    console.log('No credentials provided (MANIFEST_EMAIL / MANIFEST_PASSWORD). Trying anonymous access...');
  }

  // 1. Fetch timesheet entries for March 2, 2026
  const { data: entries, error: entriesError } = await supabase
    .from('v_timesheet_entries')
    .select('*')
    .eq('work_date', '2026-03-02')
    .order('project_name', { ascending: true });

  if (entriesError) {
    console.error('Error fetching entries:', entriesError.message);
    process.exit(1);
  }

  console.log(`\n=== Timesheet entries for 2026-03-02: ${entries.length} entries ===\n`);

  // 2. Fetch project rates via RPC for March 2026
  const { data: ratesData, error: ratesError } = await supabase.rpc(
    'get_all_project_rates_for_month',
    { p_month: '2026-03-01' }
  );

  if (ratesError) {
    console.error('Error fetching rates via RPC:', ratesError.message);
    console.log('Falling back to projects table...');
  }

  // Build rate lookup: external_project_id -> effective_rate
  const rateLookup = new Map();
  const projectNameLookup = new Map();

  if (ratesData && ratesData.length > 0) {
    console.log(`RPC returned ${ratesData.length} project rates`);
    for (const row of ratesData) {
      rateLookup.set(row.external_project_id, row.effective_rate);
      projectNameLookup.set(row.external_project_id, row.project_name);
    }
  } else {
    // Fallback: get rates from projects table directly
    const { data: projectsData, error: projectsError } = await supabase
      .from('projects')
      .select('id, project_id, project_name, rate');

    if (projectsError) {
      console.error('Error fetching projects:', projectsError.message);
    } else {
      console.log(`Projects table returned ${projectsData.length} records (using fallback rates)`);
      for (const p of projectsData) {
        if (p.rate !== null) {
          rateLookup.set(p.project_id, p.rate);
        }
        projectNameLookup.set(p.project_id, p.project_name);
      }
    }

    // Also check project_monthly_rates for March 2026 explicit rates
    const { data: monthlyRates } = await supabase
      .from('project_monthly_rates')
      .select('project_id, rate_month, rate')
      .lte('rate_month', '2026-03-01')
      .order('rate_month', { ascending: false });

    if (monthlyRates && monthlyRates.length > 0) {
      console.log(`Monthly rates table returned ${monthlyRates.length} records`);
      // For each project, use the most recent rate at or before March 2026
      // We need to join with projects to get external_project_id
      const { data: allProjects } = await supabase
        .from('projects')
        .select('id, project_id');
      const uuidToExternal = new Map();
      for (const p of allProjects || []) {
        uuidToExternal.set(p.id, p.project_id);
      }

      // Group monthly rates by project, take the latest <= March 2026
      const bestRate = new Map();
      for (const mr of monthlyRates) {
        const extId = uuidToExternal.get(mr.project_id);
        if (!extId) continue;
        if (!bestRate.has(extId)) {
          bestRate.set(extId, mr.rate); // already sorted desc, first is latest
        }
      }
      // Override with monthly rates where available
      for (const [extId, rate] of bestRate) {
        rateLookup.set(extId, rate);
      }
      console.log(`Applied ${bestRate.size} monthly rate overrides`);
    }
  }

  // 3. Fetch canonical project mappings
  const { data: projectCanonicals } = await supabase
    .from('v_project_canonical')
    .select('project_id, canonical_project_id, role');

  const { data: projectRecords } = await supabase
    .from('projects')
    .select('id, project_id, project_name');

  const projectUuidToExternal = new Map();
  for (const p of projectRecords || []) {
    projectUuidToExternal.set(p.id, p.project_id);
  }

  const canonicalIdLookup = new Map();
  for (const record of projectCanonicals || []) {
    const extId = projectUuidToExternal.get(record.project_id);
    const canonicalExtId = projectUuidToExternal.get(record.canonical_project_id);
    if (extId && canonicalExtId) {
      canonicalIdLookup.set(extId, canonicalExtId);
    }
  }

  // 4. Fetch resource display names
  const { data: resources } = await supabase
    .from('resources')
    .select('id, external_label, first_name, last_name');

  const { data: associations } = await supabase
    .from('resource_user_associations')
    .select('user_id, resource_id, source, resource:resources(first_name, last_name, external_label)');

  const displayNameByLabel = new Map();
  for (const r of resources || []) {
    if (r.first_name || r.last_name) {
      displayNameByLabel.set(r.external_label, [r.first_name, r.last_name].filter(Boolean).join(' '));
    }
  }

  const displayNameByUserId = new Map();
  for (const assoc of associations || []) {
    const res = Array.isArray(assoc.resource) ? assoc.resource[0] : assoc.resource;
    if (res && (res.first_name || res.last_name)) {
      displayNameByUserId.set(assoc.user_id, [res.first_name, res.last_name].filter(Boolean).join(' '));
    }
  }

  // 5. Build breakdown
  let totalRevenue = 0;
  let totalMinutes = 0;
  const rows = [];

  for (const entry of entries) {
    const projectId = entry.project_id;
    const canonicalProjectId = canonicalIdLookup.get(projectId) || projectId;
    const rate = rateLookup.get(canonicalProjectId) ?? rateLookup.get(projectId) ?? 0;
    const hours = entry.total_minutes / 60;
    const revenue = hours * rate;
    totalRevenue += revenue;
    totalMinutes += entry.total_minutes;

    const displayName = displayNameByUserId.get(entry.user_id)
      || displayNameByLabel.get(entry.user_name)
      || entry.user_name;

    rows.push({
      project: entry.project_name,
      projectId: projectId,
      canonicalProjectId: canonicalProjectId !== projectId ? canonicalProjectId : '-',
      resource: displayName,
      minutes: entry.total_minutes,
      hours: hours.toFixed(2),
      rate: rate,
      revenue: revenue.toFixed(2),
      clientName: entry.client_name || '',
      taskName: entry.task_name || '',
    });
  }

  // Print table
  console.log('');
  console.log('Project'.padEnd(35) + 'Client'.padEnd(22) + 'Resource'.padEnd(22) + 'Task'.padEnd(25) + 'Min'.padEnd(7) + 'Hrs'.padEnd(8) + 'Rate'.padEnd(10) + 'Revenue');
  console.log('-'.repeat(155));

  for (const r of rows) {
    console.log(
      r.project.substring(0, 34).padEnd(35) +
      r.clientName.substring(0, 21).padEnd(22) +
      r.resource.substring(0, 21).padEnd(22) +
      r.taskName.substring(0, 24).padEnd(25) +
      String(r.minutes).padEnd(7) +
      r.hours.padEnd(8) +
      ('$' + r.rate.toFixed(2)).padEnd(10) +
      '$' + r.revenue
    );
  }

  console.log('-'.repeat(155));
  console.log(
    'TOTAL'.padEnd(35) +
    ''.padEnd(22) +
    ''.padEnd(22) +
    ''.padEnd(25) +
    String(totalMinutes).padEnd(7) +
    (totalMinutes / 60).toFixed(2).padEnd(8) +
    ''.padEnd(10) +
    '$' + totalRevenue.toFixed(2)
  );

  // Show remappings
  const remapped = rows.filter(r => r.canonicalProjectId !== '-');
  if (remapped.length > 0) {
    console.log('\n--- Canonical project remappings applied ---');
    for (const r of remapped) {
      console.log(`  ${r.projectId} -> ${r.canonicalProjectId} (${r.project})`);
    }
  }

  // Show rate info
  const seenCanonicals = new Set(rows.map(r => r.canonicalProjectId === '-' ? r.projectId : r.canonicalProjectId));
  console.log('\n--- Rate lookup details ---');
  for (const extId of seenCanonicals) {
    const rate = rateLookup.get(extId);
    const name = projectNameLookup.get(extId);
    console.log(`  ${name || 'Unknown'}: $${rate !== undefined ? rate.toFixed(2) : 'NOT FOUND'}/hr (ext_id: ${extId})`);
  }

  // Show summary by project
  console.log('\n=== SUMMARY BY PROJECT ===\n');
  const byProject = new Map();
  for (const r of rows) {
    const key = r.project;
    if (!byProject.has(key)) {
      byProject.set(key, { minutes: 0, revenue: 0, rate: r.rate, client: r.clientName });
    }
    const p = byProject.get(key);
    p.minutes += r.minutes;
    p.revenue += parseFloat(r.revenue);
  }

  console.log('Project'.padEnd(35) + 'Client'.padEnd(22) + 'Hours'.padEnd(10) + 'Rate'.padEnd(10) + 'Revenue');
  console.log('-'.repeat(90));
  for (const [name, p] of byProject) {
    console.log(
      name.padEnd(35) +
      p.client.padEnd(22) +
      (p.minutes / 60).toFixed(2).padEnd(10) +
      ('$' + p.rate.toFixed(2)).padEnd(10) +
      '$' + p.revenue.toFixed(2)
    );
  }
  console.log('-'.repeat(90));
  console.log(
    'TOTAL'.padEnd(35) +
    ''.padEnd(22) +
    (totalMinutes / 60).toFixed(2).padEnd(10) +
    ''.padEnd(10) +
    '$' + totalRevenue.toFixed(2)
  );
}

main().catch(console.error);

#!/usr/bin/env node
// =============================================================================
// recategorize.mjs — DRY-RUN re-categorization of existing Miscellaneous rows.
// =============================================================================
// Re-runs the CANONICAL categorize() logic (imported directly from
// src/lib/expenses/categorize.ts — NO logic duplication) over the expenses rows
// currently sitting in category 15 (Miscellaneous), using the live prod rule
// tables plus any not-yet-applied delta migration (128). It emits a reviewable,
// idempotent SQL file of UPDATE statements and a before/after summary. It NEVER
// writes to prod — the orchestrator applies the SQL after audit.
//
// Why a row can be recovered: the ingest pipeline stored `vendor` and
// `description_original` exactly as categorize() saw them, so replaying
// categorize() with a corrected/extended rule set deterministically reproduces
// what a fresh ingest would now assign.
//
// SAFETY:
//   - Read-only Management API (SELECT only); no execution of the emitted SQL.
//   - Only rows with category_source <> 'manual' are ever touched (manual
//     assignments are sacred). Each UPDATE re-asserts that guard so applying the
//     file can never clobber a manual category, and re-runs converge to empty.
//
// Usage:
//   node scripts/expenses/recategorize.mjs                 # dry-run + emit SQL
//   node scripts/expenses/recategorize.mjs --no-delta      # live prod rules only
//   node scripts/expenses/recategorize.mjs --out <path>    # custom SQL output
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { categorize } from '../../src/lib/expenses/categorize.ts';
import { FALLBACK_CATEGORY_ID } from '../../src/lib/expenses/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PROJECT_REF = 'yptbnsegcfpizwhipeep';
const TOKEN_PATH = join(homedir(), '.supabase', 'access-token');
const DELTA_MIGRATION = join(REPO_ROOT, 'supabase', 'migrations', '128_expense_mapping_delta.sql');

const argv = process.argv.slice(2);
const useDelta = !argv.includes('--no-delta');
const outIdx = argv.indexOf('--out');
const OUT_PATH = outIdx >= 0 ? argv[outIdx + 1] : join(HERE, 'output', 'recategorize_updates.sql');

// ---------------------------------------------------------------------------
// Management API read helper (SELECT only).
// ---------------------------------------------------------------------------
async function q(sql) {
  const token = readFileSync(TOKEN_PATH, 'utf8').trim();
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'manifest-recategorize/1.0',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Parse the pending 128 keyword INSERT so the dry-run previews the post-128
// outcome even before the migration is applied. Idempotent with live rules
// (deduped by keyword), so it is a no-op once 128 has been applied to prod.
function parseDeltaKeywords(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  const re = /^\s*\('([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(TRUE|FALSE)\)/i;
  let inBlock = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.includes('INTO public.expense_keyword_rules')) inBlock = true;
    if (!inBlock) continue;
    const m = re.exec(line);
    if (m) {
      rows.push({
        keyword: m[1],
        category_id: Number(m[2]),
        priority: Number(m[3]),
        force_review: m[5].toUpperCase() === 'TRUE',
      });
    }
    if (/ON CONFLICT/i.test(line)) inBlock = false;
  }
  return rows;
}

const sqlStr = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

// ---------------------------------------------------------------------------
async function main() {
  console.log(`Re-categorization DRY-RUN (project ${PROJECT_REF})`);
  console.log(`  pending delta 128: ${useDelta ? 'merged for preview' : 'excluded (--no-delta)'}\n`);

  const [vendorRules, liveKeywordRules, miscRows, totals] = await Promise.all([
    q('select match_type, pattern, category_id, priority from public.expense_vendor_rules;'),
    q('select keyword, category_id, priority, coalesce(force_review,false) as force_review from public.expense_keyword_rules;'),
    q(`select id, vendor, description_original, entry_type, category_id, category_source,
              translation_source, eur_amount
         from public.expenses
        where category_id = ${FALLBACK_CATEGORY_ID} and category_source <> 'manual';`),
    q('select count(*)::int as n, count(*) filter (where category_id = 15)::int as misc from public.expenses;'),
  ]);

  // Merge pending delta keywords (deduped by keyword — live rules win).
  const keywordRules = [...liveKeywordRules];
  if (useDelta) {
    const have = new Set(liveKeywordRules.map((r) => r.keyword.toUpperCase()));
    for (const d of parseDeltaKeywords(DELTA_MIGRATION)) {
      if (!have.has(d.keyword.toUpperCase())) keywordRules.push(d);
    }
  }

  const totalRows = totals[0].n;
  const miscBefore = totals[0].misc;

  const updates = [];
  const byTarget = new Map();
  let changedEur = 0;
  let stillNeedsReview = 0;
  for (const row of miscRows) {
    const r = categorize(row.vendor ?? null, row.description_original ?? '', vendorRules, keywordRules);
    if (r.categoryId === FALLBACK_CATEGORY_ID) continue; // still Misc — leave it
    // Mirror the ingest contract EXACTLY (index.ts): a row still needs review if
    // the matched category flags it (fallback / force_review) OR its description
    // was never translated. Never hard-code FALSE — that diverged from ingest.
    const needsReview = r.needsReview || row.translation_source === 'none';
    if (needsReview) stillNeedsReview += 1;
    updates.push({ id: row.id, ...r, needsReview, eur: Number(row.eur_amount) });
    changedEur += Number(row.eur_amount) || 0;
    const key = `${r.categoryId} (${r.categorySource})`;
    const agg = byTarget.get(key) ?? { n: 0, eur: 0 };
    agg.n += 1; agg.eur += Number(row.eur_amount) || 0;
    byTarget.set(key, agg);
  }

  // Emit idempotent, guard-railed SQL (safe to re-apply; never touches manual).
  const lines = [
    '-- ============================================================================',
    '-- Re-categorization of existing Miscellaneous rows (GENERATED — review then apply)',
    '-- ============================================================================',
    `-- Generated by scripts/expenses/recategorize.mjs at ${new Date().toISOString()}`,
    `-- Rule set: live prod rules${useDelta ? ' + pending migration 128 delta' : ''}.`,
    `-- ${updates.length} row(s) would move out of Miscellaneous. category_source is set`,
    "-- to the matched rule type. The WHERE guard keeps this idempotent and never",
    "-- overwrites a manual assignment.",
    '-- ============================================================================',
    '',
    'BEGIN;',
    '',
  ];
  for (const u of updates) {
    lines.push(
      `UPDATE public.expenses SET category_id = ${u.categoryId}, ` +
      `category_source = ${sqlStr(u.categorySource)}, needs_review = ${u.needsReview ? 'TRUE' : 'FALSE'} ` +
      `WHERE id = ${sqlStr(u.id)} AND category_id = ${FALLBACK_CATEGORY_ID} AND category_source <> 'manual';`,
    );
  }
  lines.push('', 'COMMIT;', '');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');

  // Summary.
  const miscAfter = miscBefore - updates.length;
  const pct = (n) => `${((n / totalRows) * 100).toFixed(1)}%`;
  console.log('=== BEFORE / AFTER ===');
  console.log(`  total expenses rows      : ${totalRows}`);
  console.log(`  Miscellaneous (cat 15)   : ${miscBefore}  (${pct(miscBefore)})`);
  console.log(`  would be recategorized   : ${updates.length}  (€${changedEur.toFixed(2)})`);
  console.log(`    of those, needs_review : ${stillNeedsReview}  (force_review / untranslated)`);
  console.log(`  Miscellaneous after fix  : ${miscAfter}  (${pct(miscAfter)})`);
  console.log('  reference benchmark      : 17.5% (report(3) human-labeled)');
  console.log('\n=== recovered rows by target category (source) ===');
  for (const [k, v] of [...byTarget.entries()].sort((a, b) => b[1].eur - a[1].eur)) {
    console.log(`  cat ${k.padEnd(22)} ${String(v.n).padStart(3)} rows  €${v.eur.toFixed(2)}`);
  }
  console.log(`\nReviewable SQL written to: ${OUT_PATH}`);
  console.log('DRY-RUN complete — no changes were made to production.');
}

main().catch((e) => { console.error(e); process.exit(1); });

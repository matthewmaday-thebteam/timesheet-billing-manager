import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import type {
  AccountCurrency,
  EurConversion,
  FxRate,
  KeywordRule,
  RawBankRow,
  VendorRule,
} from './_lib/types.ts';
import { normalizeDescription } from './_lib/normalizeDescription.ts';
import { rowHash } from './_lib/rowHash.ts';
import { convertToEur } from './_lib/convertToEur.ts';
import { convertToUsd } from './_lib/convertToUsd.ts';
import { assignMonth } from './_lib/assignMonth.ts';
import { fetchEcbRate } from './_lib/fetchEcbRate.ts';
import { categorize } from './_lib/categorize.ts';
import { translate, type TranslationDict } from './_lib/translate.ts';
import { translateKeys } from './_lib/anthropicTranslate.ts';
import { EXPENSES_TRANSLATE_FALLBACK_MODEL, INGEST_MAX_AI_BATCHES } from './_lib/translateBatch.ts';

// =============================================================================
// Edge Function: ingest-expenses
// =============================================================================
// POST { file_name, file_sha256, byte_size, source_format, rows: RawBankRow[] }
//
// Dedup guarantee (uploads with OVERLAPPING date ranges are expected):
//   - file-level: expense_source_files inserted ON CONFLICT (file_sha256) DO
//     NOTHING. A previously-seen file does NOT short-circuit — we look up the
//     existing row and PROCEED with the idempotent row-level upsert, so a file
//     recorded on a crashed prior run still lands its rows.
//   - row-level: expenses upserted ON CONFLICT (row_hash) DO NOTHING. row_hash
//     derives only from immutable, whitespace-normalized bank-source fields, so
//     the same transaction arriving via two exports is inserted exactly once.
//
// Row lifecycle per row: resolve currency → convert (locked rules) → translate
// (dict → AI fallback → none) → categorize → row_hash. Rows whose account
// currency cannot be resolved are NOT inserted (financially unsafe to guess);
// they are reported in rejected_rows. INVARIANT: total = inserted +
// skipped_duplicates + rejected.
//
// AI translation fallback (carve-out "manifest-approved-ai-translation-carve-
// out") is the ONLY AI call path and lives ONLY here. Absent key → skipped
// silently to 'none' + needs_review. Any AI error degrades to 'none'; it never
// fails ingestion.
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

const DB_BATCH_SIZE = 500;

// In-ingest AI translation is best-effort and STRICTLY BOUNDED: at most
// INGEST_MAX_AI_BATCHES Anthropic calls, under a wall-clock budget, so the
// translate step can never threaten the function's execution limit on a large
// upload. Anything not translated here stays 'none' + needs_review and is
// finished by the translate-expense-descriptions backlog processor.
const INGEST_AI_TIME_BUDGET_MS = 30_000;

interface IngestBody {
  file_name?: string;
  file_sha256?: string;
  byte_size?: number;
  source_format?: string;
  rows?: RawBankRow[];
}

interface RejectedRow {
  reference: string | null;
  value_date: string | null;
  amount: number | null;
  reason: string;
}

interface ComputedRow {
  raw: RawBankRow;
  rowHashHex: string;
  translationKey: string;
  conversion: EurConversion;
  categoryId: number;
  categorySource: string;
  categoryNeedsReview: boolean;
  translated: string | null;
  translationSource: string;
  vendor: string | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let sourceFileId: string | null = null;

  try {
    // --- Authenticate + authorize (mirrors admin-users) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: isAdmin, error: adminCheckError } = await supabaseAuth.rpc('is_admin');
    if (adminCheckError || !isAdmin) {
      return jsonResponse({ error: 'Forbidden: admin access required' }, 403);
    }

    // --- Parse + validate body ---
    const body = (await req.json()) as IngestBody;
    const { file_name, file_sha256, byte_size, source_format, rows } = body;

    if (!file_sha256 || typeof file_sha256 !== 'string') {
      return jsonResponse({ error: 'file_sha256 is required' }, 400);
    }
    if (!Array.isArray(rows)) {
      return jsonResponse({ error: 'rows[] is required' }, 400);
    }
    if (!source_format || !['html_xls', 'binary_xls', 'xlsx'].includes(source_format)) {
      return jsonResponse({ error: 'source_format must be html_xls | binary_xls | xlsx' }, 400);
    }

    // --- Service-role client for all writes ---
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- (a) File-level idempotency (status 'parsed'; no short-circuit) ---
    const { data: fileInsert, error: fileError } = await supabase
      .from('expense_source_files')
      .upsert(
        {
          file_name: file_name ?? null,
          file_sha256,
          byte_size: byte_size ?? null,
          source_format,
          uploaded_by: user.id,
          uploaded_at: new Date().toISOString(),
          status: 'parsed',
        },
        { onConflict: 'file_sha256', ignoreDuplicates: true },
      )
      .select('id');

    if (fileError) {
      console.error('ingest-expenses: source file insert failed', fileError);
      return jsonResponse({ error: 'source file registration failed' }, 500);
    }

    let previouslySeen = false;
    if (fileInsert && fileInsert.length > 0) {
      sourceFileId = fileInsert[0].id as string;
    } else {
      // Conflict: file already registered — fetch it and PROCEED (idempotent).
      previouslySeen = true;
      const { data: existing, error: existingError } = await supabase
        .from('expense_source_files')
        .select('id')
        .eq('file_sha256', file_sha256)
        .maybeSingle();
      if (existingError || !existing) {
        console.error('ingest-expenses: existing source file lookup failed', existingError);
        return jsonResponse({ error: 'source file lookup failed' }, 500);
      }
      sourceFileId = existing.id as string;
    }

    // --- (b0) USD self-healing: complete any previously-pending USD rows whose
    //          month rate is now known (cheap, set-based, idempotent). Runs at the
    //          start of every ingest so the USD layer converges without reprocessing
    //          bank files. Never blocks ingest — a failure only logs. ---
    {
      const { data: filled, error: fillError } = await supabase.rpc('fill_pending_usd');
      if (fillError) {
        console.error('ingest-expenses: fill_pending_usd failed', fillError);
      } else if (typeof filled === 'number' && filled > 0) {
        console.log(`ingest-expenses: back-filled ${filled} pending USD rows`);
      }
    }

    // --- (b) Load rules + dictionary + FX rates ---
    const [vendorRes, keywordRes, dictRes, fxRes] = await Promise.all([
      supabase.from('expense_vendor_rules').select('match_type, pattern, category_id, priority'),
      supabase.from('expense_keyword_rules').select('keyword, category_id, priority, force_review'),
      supabase.from('expense_translation_dict').select('normalized_key, en_translation'),
      supabase.from('expense_fx_rates').select('month, eur_usd, source'),
    ]);

    // Month → EUR/USD rate, memoized for this run. Missing months are fetched on
    // demand below (edge only) and appended here.
    const fxMap = new Map<string, FxRate>();
    for (const r of (fxRes.data ?? []) as { month: string; eur_usd: number | string; source: string }[]) {
      fxMap.set(r.month, { month: r.month, eurUsd: Number(r.eur_usd), source: r.source as FxRate['source'] });
    }

    const vendorRules = (vendorRes.data ?? []) as VendorRule[];
    const keywordRules = (keywordRes.data ?? []) as KeywordRule[];
    const dict: TranslationDict = new Map(
      (dictRes.data ?? []).map((d: { normalized_key: string; en_translation: string }) => [
        d.normalized_key,
        d.en_translation,
      ]),
    );

    // --- (c) Compute per row (rejecting rows we cannot value) ---
    const computed: ComputedRow[] = [];
    const rejectedRows: RejectedRow[] = [];

    for (const raw of rows) {
      const accountCurrency = raw.accountCurrency;
      if (accountCurrency !== 'EUR' && accountCurrency !== 'BGN') {
        rejectedRows.push({
          reference: raw.reference ?? null,
          value_date: raw.valueDate ?? null,
          amount: raw.originalAmount ?? null,
          reason: 'unresolved_currency',
        });
        continue;
      }

      // Dictionary/AI translation key = Основание + ' ' + Описание (canonical).
      const lookupText = `${raw.paymentReason ?? ''} ${raw.operationDescription ?? ''}`.trim();
      const translationKey = normalizeDescription(lookupText);
      const t = translate(lookupText, dict, raw.descriptionOriginal ?? '');

      const conversion = convertToEur(accountCurrency as AccountCurrency, raw.originalAmount ?? 0);

      const vendor = raw.entryType === 'Credit' ? raw.payer ?? raw.beneficiary : raw.beneficiary ?? raw.payer;
      const cat = categorize(vendor ?? null, raw.descriptionOriginal ?? '', vendorRules, keywordRules);

      const rowHashHex = await rowHash({
        account: raw.account,
        txnDatetime: raw.txnDatetime,
        valueDate: raw.valueDate,
        originalAmount: raw.originalAmount ?? 0,
        reference: raw.reference,
        descriptionOriginal: raw.descriptionOriginal ?? '',
      });

      computed.push({
        raw,
        rowHashHex,
        translationKey,
        conversion,
        categoryId: cat.categoryId,
        categorySource: cat.categorySource,
        categoryNeedsReview: cat.needsReview,
        translated: t.translated,
        translationSource: t.translationSource,
        vendor: vendor ?? null,
      });
    }

    // --- AI fallback for dictionary misses (carve-out), keyed by translationKey ---
    const aiKey =
      Deno.env.get('EXPENSES_TRANSLATE_ANTHROPIC_KEY') ?? Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    const aiModel = Deno.env.get('EXPENSES_TRANSLATE_MODEL') ?? EXPENSES_TRANSLATE_FALLBACK_MODEL;

    const missKeys = Array.from(
      new Set(computed.filter((c) => c.translationSource === 'none').map((c) => c.translationKey)),
    );

    if (aiKey && missKeys.length > 0) {
      // Bounded best-effort pass (see INGEST_MAX_AI_BATCHES / time budget). Any
      // keys left untranslated stay 'none' for the backlog processor.
      const { translations: aiMap } = await translateKeys(missKeys, {
        apiKey: aiKey,
        model: aiModel,
        maxBatches: INGEST_MAX_AI_BATCHES,
        timeBudgetMs: INGEST_AI_TIME_BUDGET_MS,
      });
      if (aiMap.size > 0) {
        const bgSampleByKey = new Map<string, string>();
        const occurrences = new Map<string, number>();
        for (const c of computed) {
          if (aiMap.has(c.translationKey)) {
            if (!bgSampleByKey.has(c.translationKey)) {
              bgSampleByKey.set(c.translationKey, c.raw.descriptionOriginal ?? '');
            }
            occurrences.set(c.translationKey, (occurrences.get(c.translationKey) ?? 0) + 1);
          }
        }
        const dictRows = Array.from(aiMap.entries()).map(([key, en]) => ({
          normalized_key: key,
          bg_sample: bgSampleByKey.get(key) ?? null,
          en_translation: en,
          occurrences: occurrences.get(key) ?? 1,
          source: 'ai',
        }));
        const { error: dictErr } = await supabase
          .from('expense_translation_dict')
          .upsert(dictRows, { onConflict: 'normalized_key', ignoreDuplicates: true });
        if (dictErr) console.error('ingest-expenses: dict writeback failed', dictErr);

        for (const c of computed) {
          if (c.translationSource === 'none' && aiMap.has(c.translationKey)) {
            c.translated = aiMap.get(c.translationKey) ?? null;
            c.translationSource = 'ai';
          }
        }
      }
    }

    // --- (c2) USD reporting layer: ensure a rate exists for every month present
    //          in this upload. Missing months are fetched (edge only) via the
    //          documented ECB convention and stored ON CONFLICT DO NOTHING (never
    //          overwrites a workbook_seed). A fetch failure leaves the month
    //          unmapped → those rows ingest with USD pending (graceful). ---
    const todayISO = new Date().toISOString();
    const neededMonths = new Set(computed.map((c) => assignMonth(c.raw.valueDate)));
    for (const month of neededMonths) {
      if (fxMap.has(month)) continue;
      const fetched = await fetchEcbRate(month, todayISO);
      if (!fetched) continue; // rate unavailable → rows stay pending, ingest proceeds
      const { error: fxErr } = await supabase.from('expense_fx_rates').upsert(
        { month, eur_usd: fetched.eurUsd, source: fetched.source, fetched_at: new Date().toISOString() },
        { onConflict: 'month', ignoreDuplicates: true },
      );
      if (fxErr) console.error('ingest-expenses: fx rate store failed', { month, fxErr });
      fxMap.set(month, { month, eurUsd: fetched.eurUsd, source: fetched.source });
    }

    // --- (d) Build expense rows ---
    const expenseRows = computed.map((c) => {
      const needsReview = c.categoryNeedsReview || c.translationSource === 'none';
      const month = assignMonth(c.raw.valueDate);
      // USD REPORTING layer (additive; derives from the normalized eur_amount and
      // the month rate — never re-reads bank amounts). No rate → pending (null).
      const fx = fxMap.get(month);
      const usd = fx ? convertToUsd(c.conversion.eurAmount, fx.eurUsd) : null;
      return {
        source_file_id: sourceFileId,
        row_hash: c.rowHashHex,
        account: c.raw.account,
        account_currency: c.raw.accountCurrency,
        original_amount: c.raw.originalAmount ?? 0,
        operation_currency: c.raw.operationCurrency,
        operation_amount: c.raw.operationAmount,
        eur_amount: c.conversion.eurAmount,
        conversion_rate: c.conversion.conversionRate,
        rate_source: c.conversion.rateSource,
        rate_date: c.conversion.rateDate,
        usd_amount: usd ? usd.usdAmount : null,
        usd_rate: fx ? fx.eurUsd : null,
        usd_rate_source: fx ? fx.source : null,
        entry_type: c.raw.entryType,
        description_original: c.raw.descriptionOriginal ?? '',
        description_translated: c.translated,
        translation_source: c.translationSource,
        vendor: c.vendor,
        beneficiary: c.raw.beneficiary,
        reference: c.raw.reference,
        category_id: c.categoryId,
        category_source: c.categorySource,
        value_date: c.raw.valueDate,
        booking_date: c.raw.bookingDate,
        txn_datetime: c.raw.txnDatetime,
        assigned_month: month,
        needs_review: needsReview,
        created_by: user.id,
      };
    });

    // --- Row-level idempotent upsert with per-batch → per-row error isolation ---
    let insertedCount = 0;
    let skippedCount = 0;

    const upsertOne = async (row: (typeof expenseRows)[number], meta: ComputedRow) => {
      const { data, error } = await supabase!
        .from('expenses')
        .upsert([row], { onConflict: 'row_hash', ignoreDuplicates: true })
        .select('id');
      if (error) {
        console.error('ingest-expenses: single-row insert failed', { row_hash: row.row_hash, error });
        rejectedRows.push({
          reference: meta.raw.reference ?? null,
          value_date: meta.raw.valueDate ?? null,
          amount: meta.raw.originalAmount ?? null,
          reason: 'insert_failed',
        });
        return;
      }
      const n = data?.length ?? 0;
      insertedCount += n;
      skippedCount += 1 - n;
    };

    for (let i = 0; i < expenseRows.length; i += DB_BATCH_SIZE) {
      const batch = expenseRows.slice(i, i + DB_BATCH_SIZE);
      const batchMeta = computed.slice(i, i + DB_BATCH_SIZE);
      const { data, error } = await supabase
        .from('expenses')
        .upsert(batch, { onConflict: 'row_hash', ignoreDuplicates: true })
        .select('id');
      if (error) {
        // One bad row must not void the whole batch — retry row-by-row.
        console.error('ingest-expenses: batch insert failed, retrying row-by-row', error);
        for (let j = 0; j < batch.length; j++) {
          await upsertOne(batch[j], batchMeta[j]);
        }
      } else {
        const n = data?.length ?? 0;
        insertedCount += n;
        skippedCount += batch.length - n;
      }
    }

    // --- (e) Promote source file with counts, observed range + DURABLE
    //         rejection trail (NF-1: skipped/rejected must never be lost) ---
    const valueDates = expenseRows.map((r) => r.value_date).filter(Boolean).sort();
    const observedFrom = valueDates[0] ?? null;
    const observedTo = valueDates[valueDates.length - 1] ?? null;
    const rejectedCount = rejectedRows.length; // true total (currency + insert_failed)
    const terminalStatus = rejectedCount > 0 ? 'processed_with_rejections' : 'processed';
    const { error: finalizeError } = await supabase
      .from('expense_source_files')
      .update({
        row_count: rows.length,
        inserted_count: insertedCount,
        duplicate_count: skippedCount,
        rejected_count: rejectedCount,
        // Cap the persisted array to bound row size; full list stays in the
        // HTTP response. rejected_count remains the true total.
        rejected_rows: rejectedRows.slice(0, 200),
        observed_from: observedFrom,
        observed_to: observedTo,
        detected_account: expenseRows[0]?.account ?? null,
        status: terminalStatus,
      })
      .eq('id', sourceFileId);
    // `persisted` reflects whether the finalize UPDATE landed. Rows are already
    // committed by this point, so a finalize failure never loses expense data —
    // it only means the upload summary on expense_source_files is stale until a
    // re-upload. Surfaced to the client so the operator can re-upload to finalize.
    const persisted = !finalizeError;
    if (finalizeError) console.error('ingest-expenses: source file finalize failed', finalizeError);

    // --- (f) Summary (INVARIANT: total = inserted + skipped + rejected) ---
    const translationSummary = { dictionary: 0, passthrough: 0, ai: 0, none: 0 };
    const categorySummary: Record<string, number> = {};
    let needsReviewCount = 0;
    for (const c of computed) {
      if (c.translationSource in translationSummary) {
        translationSummary[c.translationSource as keyof typeof translationSummary]++;
      }
      const key = String(c.categoryId);
      categorySummary[key] = (categorySummary[key] ?? 0) + 1;
    }
    for (const r of expenseRows) if (r.needs_review) needsReviewCount++;

    // USD pending = rows whose month had no known/fetchable rate at ingest. They
    // are NOT lost: fill_pending_usd() completes them on a later run once the rate
    // exists (self-healing). Surfaced so a partial USD picture is never silent.
    let usdPendingCount = 0;
    for (const r of expenseRows) if (r.usd_amount === null) usdPendingCount++;

    return jsonResponse({
      status: 'ok',
      persisted,
      source_file_id: sourceFileId,
      previously_seen: previouslySeen,
      total_rows: rows.length,
      inserted: insertedCount,
      skipped_duplicates: skippedCount,
      rejected_rows: rejectedRows,
      needs_review_count: needsReviewCount,
      usd_pending: usdPendingCount,
      translation: translationSummary,
      categories: categorySummary,
      observed_from: observedFrom,
      observed_to: observedTo,
    });
  } catch (err) {
    console.error('ingest-expenses: unhandled error', err);
    if (supabase && sourceFileId) {
      // Best-effort: mark the file failed so it is not left stuck in 'parsed'.
      await supabase.from('expense_source_files').update({ status: 'failed' }).eq('id', sourceFileId);
    }
    return jsonResponse({ error: 'ingestion failed' }, 500);
  }
});

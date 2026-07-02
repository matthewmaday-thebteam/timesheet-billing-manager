import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { normalizeDescription } from './_lib/normalizeDescription.ts';
import { hasCyrillic } from './_lib/translate.ts';
import { translateKeys } from './_lib/anthropicTranslate.ts';
import {
  BACKLOG_MAX_AI_BATCHES,
  EXPENSES_TRANSLATE_FALLBACK_MODEL,
  canClearNeedsReviewAfterTranslation,
} from './_lib/translateBatch.ts';

// =============================================================================
// Edge Function: translate-expense-descriptions  (backlog processor)
// =============================================================================
// POST (no body). Admin-only. Finishes the AI translation that the in-ingest
// fallback deliberately leaves undone: it scans expenses with
// translation_source = 'none' whose description is Cyrillic, translates a
// CAPPED number of batches via the Anthropic Messages API (carve-out
// "manifest-approved-ai-translation-carve-out"), writes the results back to
// both the translation dictionary and every row sharing the key, and returns
// {remaining} so the admin UI can re-invoke it until the backlog is drained.
//
// KEYING NOTE: ingest keys the dictionary off (Основание + ' ' + Описание),
// but those two source fields are NOT persisted on `expenses` — only the
// combined `description_original` is. The backlog therefore keys off
// normalizeDescription(description_original). This is intentional and safe:
// re-ingests of an already-stored transaction are skipped by the row_hash
// dedup (so they are never re-translated), and a genuinely NEW row with the
// same text lands as 'none' and is caught on the next backlog run — the system
// is self-healing without polluting the ingest key space.
//
// CREDITS: rows with entry_type = 'Credit' are receivables, not expenses, and
// are excluded everywhere in the Expenses UI. They are excluded here too, so
// the backlog never spends AI budget translating them.
//
// HARD CONTRACT: this function never touches ingest acceptance. It only fills
// in translations for already-committed rows; a total AI failure is a no-op.
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

/** Only the columns the backlog needs, to keep the scan light. */
interface NoneRow {
  id: string;
  description_original: string | null;
  category_source: string | null;
  entry_type: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // --- Authenticate + authorize (mirrors ingest-expenses) ---
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

    // --- Service-role client for reads + writes ---
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const aiKey =
      Deno.env.get('EXPENSES_TRANSLATE_ANTHROPIC_KEY') ?? Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    if (!aiKey) {
      // No key → nothing this processor can do. Not an error; report a no-op.
      return jsonResponse({ status: 'ok', ai_available: false, scanned: 0, candidates: 0, unique_keys: 0, translated_keys: 0, updated_rows: 0, cleared_review: 0, remaining: 0 });
    }
    const aiModel = Deno.env.get('EXPENSES_TRANSLATE_MODEL') ?? EXPENSES_TRANSLATE_FALLBACK_MODEL;

    // --- Load the untranslated backlog (translation_source = 'none') ---
    // We fetch the 'none' rows and filter Cyrillic + non-Credit IN CODE so the
    // Cyrillic definition matches ingest exactly (hasCyrillic) and the credit
    // rule matches the UI's `entry_type !== 'Credit'` (which keeps NULLs).
    const { data: noneRows, error: scanError } = await supabase
      .from('expenses')
      .select('id, description_original, category_source, entry_type')
      .eq('translation_source', 'none');

    if (scanError) {
      console.error('translate-expense-descriptions: scan failed', scanError);
      return jsonResponse({ error: 'backlog scan failed' }, 500);
    }

    const rows = (noneRows ?? []) as NoneRow[];
    const candidates = rows.filter(
      (r) => r.entry_type !== 'Credit' && hasCyrillic(r.description_original ?? ''),
    );

    // --- Group candidate rows by their normalized description key ---
    const rowsByKey = new Map<string, NoneRow[]>();
    for (const r of candidates) {
      const key = normalizeDescription(r.description_original ?? '');
      if (!key) continue;
      const bucket = rowsByKey.get(key);
      if (bucket) bucket.push(r);
      else rowsByKey.set(key, [r]);
    }
    const uniqueKeys = Array.from(rowsByKey.keys());

    if (uniqueKeys.length === 0) {
      return jsonResponse({ status: 'ok', ai_available: true, scanned: rows.length, candidates: candidates.length, unique_keys: 0, translated_keys: 0, updated_rows: 0, cleared_review: 0, remaining: 0 });
    }

    // --- Translate a capped number of batches this invocation ---
    const { translations } = await translateKeys(uniqueKeys, {
      apiKey: aiKey,
      model: aiModel,
      maxBatches: BACKLOG_MAX_AI_BATCHES,
    });

    let updatedRows = 0;
    let clearedReview = 0;

    if (translations.size > 0) {
      // (a) Dictionary writeback (source 'ai') so future lookups can hit it.
      const dictRows = Array.from(translations.entries()).map(([key, en]) => ({
        normalized_key: key,
        bg_sample: rowsByKey.get(key)?.[0]?.description_original ?? null,
        en_translation: en,
        occurrences: rowsByKey.get(key)?.length ?? 1,
        source: 'ai',
      }));
      const { error: dictErr } = await supabase
        .from('expense_translation_dict')
        .upsert(dictRows, { onConflict: 'normalized_key', ignoreDuplicates: true });
      if (dictErr) console.error('translate-expense-descriptions: dict writeback failed', dictErr);

      // (b) Row writeback for ALL rows sharing each translated key. needs_review
      //     is cleared ONLY when the missing translation was the sole reason the
      //     row was flagged (see canClearNeedsReviewAfterTranslation). We split
      //     each key's rows into clear/keep and update by id list.
      for (const [key, en] of translations) {
        const keyRows = rowsByKey.get(key) ?? [];
        const clearIds: string[] = [];
        const keepIds: string[] = [];
        for (const r of keyRows) {
          if (canClearNeedsReviewAfterTranslation(r.category_source)) clearIds.push(r.id);
          else keepIds.push(r.id);
        }

        if (clearIds.length > 0) {
          const { error, count } = await supabase
            .from('expenses')
            .update(
              { description_translated: en, translation_source: 'ai', needs_review: false },
              { count: 'exact' },
            )
            .in('id', clearIds);
          if (error) {
            console.error('translate-expense-descriptions: row update (clear) failed', error);
          } else {
            updatedRows += count ?? clearIds.length;
            clearedReview += count ?? clearIds.length;
          }
        }

        if (keepIds.length > 0) {
          const { error, count } = await supabase
            .from('expenses')
            .update({ description_translated: en, translation_source: 'ai' }, { count: 'exact' })
            .in('id', keepIds);
          if (error) {
            console.error('translate-expense-descriptions: row update (keep) failed', error);
          } else {
            updatedRows += count ?? keepIds.length;
          }
        }
      }
    }

    // `remaining` = unique Cyrillic 'none' keys still untranslated after this
    // invocation (over the cap + any that failed this round). The admin UI
    // loops while remaining > 0 AND translated_keys > 0 (progress guard).
    const remaining = uniqueKeys.length - translations.size;

    return jsonResponse({
      status: 'ok',
      ai_available: true,
      scanned: rows.length,
      candidates: candidates.length,
      unique_keys: uniqueKeys.length,
      translated_keys: translations.size,
      updated_rows: updatedRows,
      cleared_review: clearedReview,
      remaining,
    });
  } catch (err) {
    console.error('translate-expense-descriptions: unhandled error', err);
    return jsonResponse({ error: 'translation backlog processing failed' }, 500);
  }
});

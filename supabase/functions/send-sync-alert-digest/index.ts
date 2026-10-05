import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: send-sync-alert-digest
// =============================================================================
// Emails a daily digest of active `sync_alerts` rows.
//
// Why a separate function rather than an extra section on the weekly revenue
// report: that function emails real clients. Coupling an internal alarm to a
// client-facing deploy means a bad digest change forces a client-path redeploy,
// and a client-path rollback would silently remove the alarm.
//
// Design constraints that are NOT incidental:
//
//   * ALWAYS SENDS, including all-clear. sync_alerts has held 36 rows in
//     8.5 months and is currently empty, so silence is the normal state --
//     a broken digest would be indistinguishable from a healthy system. That
//     is the exact failure this exists to remove.
//   * NO SEVERITY FLOOR. The 2026-09-10 attribution incident (1,075 h lost
//     over four weeks) was warning-class throughout.
//   * `dismissed_at` is ignored for inclusion -- dismissal means "seen", not
//     "fixed" -- but an alert that has not changed since the last digest
//     degrades to a single grouped line instead of nagging in full.
//   * Every run writes a `sync_runs` row with sync_type = 'alert_digest'.
//     sync-clickup-timesheets raises `alert_digest_stale` when the newest such
//     row is over 36 hours old. The hourly sync watches the daily digest; the
//     daily digest reports the hourly sync's alerts. Neither can fail silently.
//
// Modes:
//   POST with no body or {}          -- Automated (cron): send the digest
//   POST with { previewOnly: true }  -- Build and return the email, send nothing
//
// Auth: service-role key (cron) or an authenticated ADMIN session (is_admin()).
//       A non-admin session is rejected 403 -- the digest body carries employee
//       names and hours, and the send path can be triggered on demand.
// Schedule: daily at 06:45 UTC via pg_cron (migration 135)
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_RECIPIENTS = 'mmaday@yourbteam.com';

/** sync_alerts has held 36 rows in 8.5 months; this ceiling is a safety net. */
const ALERT_PAGE_LIMIT = 1000;

/** Sort rank -- lower sorts first. Unknown severities sort after the known ones. */
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1 };

interface SyncAlertRow {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  detail: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  metadata: Record<string, unknown> | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** "4 hours" / "13 days" -- coarse on purpose; this is a triage signal. */
function formatAge(fromISO: string, now: number): string {
  const ms = now - new Date(fromISO).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'unknown age';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Render alert metadata as one compact line. Arrays are truncated, not dropped. */
function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const shown = value.slice(0, 5).join(', ');
      parts.push(`${key}=[${shown}${value.length > 5 ? `, +${value.length - 5} more` : ''}]`);
    } else if (typeof value === 'object') {
      continue; // nested objects are noise in a plain-text digest
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join('  ');
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

serve(async (req) => {
  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const startedAt = new Date().toISOString();

  try {
    // =========================================================================
    // AUTH -- service-role key (cron) is trusted directly; anything else is
    // validated as a user session.
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey =
      Deno.env.get('NEW_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    if (token !== supabaseServiceKey) {
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authError } = await anonClient.auth.getUser();
      if (authError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // A session alone is not enough. This endpoint reads every sync_alerts
      // row (employee names, hours, entity ids) and can make SendGrid send on
      // demand, so it is gated on the same is_admin() check that admin-users
      // and migration 062 use for privileged operations.
      const { data: isAdmin, error: adminCheckError } = await anonClient.rpc('is_admin');
      if (adminCheckError || !isAdmin) {
        return jsonResponse({ error: 'Forbidden: admin access required' }, 403);
      }
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is valid (automated cron trigger)
    }
    const previewOnly = body.previewOnly === true;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // =========================================================================
    // STEP 1: Establish the digest window
    // =========================================================================
    // The previous run's sync_runs row is the watermark. No prior row means
    // every active alert is new -- correct for a first run.
    // =========================================================================
    const { data: lastDigestRun } = await supabase
      .from('sync_runs')
      .select('completed_at')
      .eq('sync_type', 'alert_digest')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastDigestAt: string | null = lastDigestRun?.completed_at ?? null;
    const lastDigestMs = lastDigestAt ? new Date(lastDigestAt).getTime() : 0;

    // =========================================================================
    // STEP 2: Load every active alert -- no severity floor, dismissed included
    // =========================================================================
    const { data: alertRows, error: alertsError } = await supabase
      .from('sync_alerts')
      .select('id, alert_type, severity, title, detail, entity_type, entity_id, entity_name, metadata, dismissed_at, created_at, updated_at')
      .is('resolved_at', null)
      .order('severity', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(ALERT_PAGE_LIMIT);

    if (alertsError) {
      throw new Error(`sync_alerts query failed: ${alertsError.message}`);
    }

    const alerts = (alertRows ?? []) as SyncAlertRow[];
    alerts.sort((a, b) => {
      const rank = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
      if (rank !== 0) return rank;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // An alert is NEW if it appeared or changed since the last digest, so a
    // re-surfaced alert (values changed, dismissal cleared) reappears in full.
    const newAlerts = alerts.filter((a) =>
      new Date(a.created_at).getTime() > lastDigestMs
      || new Date(a.updated_at).getTime() > lastDigestMs
    );
    const newAlertIds = new Set(newAlerts.map((a) => a.id));
    const stillOpen = alerts.filter((a) => !newAlertIds.has(a.id));

    const errorCount = alerts.filter((a) => a.severity === 'error').length;

    // =========================================================================
    // STEP 3: Build the email
    // =========================================================================
    const generatedAt = new Date();
    const nowMs = generatedAt.getTime();

    let subject: string;
    if (alerts.length === 0) {
      subject = 'Manifest daily check — all clear';
    } else if (errorCount > 0) {
      subject = `Manifest daily check — ${errorCount} ERROR${errorCount === 1 ? '' : 'S'}, ${alerts.length - errorCount} open`;
    } else if (newAlerts.length > 0) {
      subject = `Manifest daily check — ${newAlerts.length} new, ${alerts.length - newAlerts.length} open`;
    } else {
      subject = `Manifest daily check — ${alerts.length} open`;
    }

    const lines: string[] = [
      'Manifest — daily sync alert digest',
      `Generated ${generatedAt.toISOString()}`,
      `Previous digest: ${lastDigestAt ?? 'never (this is the first run)'}`,
      '',
      `Active alerts: ${alerts.length} (${errorCount} error, ${alerts.length - errorCount} warning)`,
      '',
    ];

    if (alerts.length === 0) {
      lines.push(
        'ALL CLEAR — no active sync alerts.',
        '',
        'This digest is sent every day, including days with nothing to report.',
        'If it stops arriving, alerting itself is broken.',
      );
    } else {
      // --- NEW since last digest: full detail ---
      lines.push(`NEW SINCE LAST DIGEST (${newAlerts.length})`);
      lines.push('='.repeat(40));
      if (newAlerts.length === 0) {
        lines.push('Nothing new.');
      } else {
        for (const alert of newAlerts) {
          const entity = [alert.entity_type, alert.entity_name ?? alert.entity_id]
            .filter(Boolean)
            .join(' / ') || 'n/a';
          lines.push(`[${alert.severity.toUpperCase()}] ${alert.title}`);
          lines.push(`  type: ${alert.alert_type}    entity: ${entity}`);
          lines.push(`  first seen: ${alert.created_at} (${formatAge(alert.created_at, nowMs)} ago)`);
          if (alert.updated_at !== alert.created_at) {
            lines.push(`  last changed: ${alert.updated_at}`);
          }
          if (alert.dismissed_at) {
            lines.push('  note: previously dismissed — it has changed since and is showing again');
          }
          if (alert.detail) lines.push(`  detail: ${alert.detail}`);
          const meta = formatMetadata(alert.metadata);
          if (meta) lines.push(`  ${meta}`);
          lines.push('');
        }
      }

      // --- STILL OPEN: one grouped line per type. This degradation is the
      //     anti-nag mechanism -- unchanged alerts must never crowd out new ones.
      lines.push('');
      lines.push(`STILL OPEN (${stillOpen.length})`);
      lines.push('='.repeat(40));
      if (stillOpen.length === 0) {
        lines.push('Nothing carried over.');
      } else {
        const byType = new Map<string, { count: number; oldest: string; worst: string }>();
        for (const alert of stillOpen) {
          const group = byType.get(alert.alert_type);
          if (!group) {
            byType.set(alert.alert_type, {
              count: 1,
              oldest: alert.created_at,
              worst: alert.severity,
            });
          } else {
            group.count++;
            if (new Date(alert.created_at).getTime() < new Date(group.oldest).getTime()) {
              group.oldest = alert.created_at;
            }
            if ((SEVERITY_RANK[alert.severity] ?? 99) < (SEVERITY_RANK[group.worst] ?? 99)) {
              group.worst = alert.severity;
            }
          }
        }
        for (const [alertType, group] of byType) {
          lines.push(
            `${alertType} — ${pluralize(group.count, 'alert')}, ` +
            `worst ${group.worst}, oldest ${formatAge(group.oldest, nowMs)} old`,
          );
        }
      }

      lines.push('');
      if (alerts.length >= ALERT_PAGE_LIMIT) {
        lines.push(`WARNING: the alert list was capped at ${ALERT_PAGE_LIMIT} rows — counts above are a floor, not a total.`);
      }
      lines.push('Full detail for every alert is on the Manifest dashboard.');
    }

    const emailBody = lines.join('\n');

    // =========================================================================
    // STEP 4: Send
    // =========================================================================
    const recipients = (Deno.env.get('ALERT_DIGEST_RECIPIENTS') ?? DEFAULT_RECIPIENTS)
      .split(',')
      .map((address) => address.trim())
      .filter((address) => address.length > 0);

    let sent = false;
    let sendError: string | null = null;

    if (previewOnly) {
      sendError = 'preview_only';
    } else if (recipients.length === 0) {
      sendError = 'no_recipients_configured';
      console.error('[send-sync-alert-digest] No recipients configured — nothing sent');
    } else {
      const SENDGRID_KEY = Deno.env.get('SENDGRID_KEY')!;
      const SENDGRID_SENDER = Deno.env.get('SENDGRID_SENDER')!;

      const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SENDGRID_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: recipients.map((email) => ({ email })) }],
          from: { email: SENDGRID_SENDER, name: 'Manifest Development Team' },
          subject,
          content: [{ type: 'text/plain', value: emailBody }],
        }),
      });

      sent = sgResponse.ok;
      if (!sent) {
        sendError = `${sgResponse.status} ${await sgResponse.text()}`;
        console.error(`[send-sync-alert-digest] SendGrid error: ${sendError}`);
      }
    }

    // =========================================================================
    // STEP 5: Surface a delivery failure on the dashboard
    // =========================================================================
    // The digest is the channel that carries every other alert, so a send
    // failure cannot be reported by the digest itself. Put it where a human
    // will still see it, and clear it as soon as a send succeeds.
    // =========================================================================
    if (!previewOnly) {
      try {
        const { data: existingSendAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'alert_digest_send_failed')
          .eq('entity_id', 'alert_digest')
          .is('resolved_at', null)
          .maybeSingle();

        if (!sent && !existingSendAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'alert_digest_send_failed',
              severity: 'error',
              title: 'Manifest daily alert digest could not be emailed — sync alerts are not reaching anyone',
              entity_type: 'team',
              entity_id: 'alert_digest',
              entity_name: 'Alert digest',
              metadata: { error: sendError, recipients, generated_at: generatedAt.toISOString() },
            });
        } else if (sent && existingSendAlert) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingSendAlert.id);
        }
      } catch (sendAlertError) {
        console.error(
          '[send-sync-alert-digest] Delivery-failure alert error (non-blocking):',
          sendAlertError instanceof Error ? sendAlertError.message : String(sendAlertError),
        );
      }
    }

    // =========================================================================
    // STEP 6: Persist the run
    // =========================================================================
    // `success` records that the digest RAN -- that is what the
    // `alert_digest_stale` watchdog in sync-clickup-timesheets keys off.
    // Delivery is reported separately via summary.sent and, on failure, via the
    // alert_digest_send_failed alert above.
    // =========================================================================
    const summary = {
      alerts_new: newAlerts.length,
      alerts_open: stillOpen.length,
      recipients,
      sent,
    };

    try {
      await supabase.from('sync_runs').insert({
        sync_type: 'alert_digest',
        sync_run_id: crypto.randomUUID(),
        started_at: startedAt,
        success: true,
        source_total: alerts.length,
        manifest_total: newAlerts.length,
        error_message: sendError,
        summary: { ...summary, subject, error_count: errorCount },
      });
    } catch (syncRunErr) {
      console.error('[send-sync-alert-digest] Failed to persist sync run (non-blocking):', syncRunErr);
    }

    console.log(`[send-sync-alert-digest] ${subject} — sent=${sent} to ${recipients.length} recipient(s)`);

    return jsonResponse({
      success: true,
      action: 'alert_digest_complete',
      subject,
      ...summary,
      error: sendError,
      ...(previewOnly ? { preview: emailBody } : {}),
    });
  } catch (error) {
    console.error('[send-sync-alert-digest] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});

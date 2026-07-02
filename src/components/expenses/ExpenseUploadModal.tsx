/**
 * ExpenseUploadModal — Expenses upload + ingest audit view.
 *
 * Reads a UniCredit Bulbank bank export (.xls / .xlsx / .xlsm), parses it
 * client-side (parseBankExport — pure, no network), fingerprints the raw bytes
 * with SHA-256 for server-side idempotency, and POSTs the normalized rows to the
 * deployed `ingest-expenses` edge function. The result is rendered as a plain,
 * auditable report: inserted / duplicate / rejected counts, translation
 * breakdown, needs-review count, and a durable list of any rejected rows.
 *
 * Design-system compliant: composes Modal, Button, Spinner, Alert, Card atoms;
 * tokens only; hidden-file-input trigger mirrors AvatarUpload.
 */

import { useCallback, useRef, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { Card } from '../Card';
import { parseBankExport } from '../../lib/xls/parseBankExport';
import { supabase } from '../../lib/supabase';

interface ExpenseUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired after a successful ingest so the page can refetch. */
  onIngested: () => void;
}

/** One rejected transaction row, echoed verbatim from the edge function. */
interface RejectedRow {
  reference: string | null;
  value_date: string | null;
  amount: number | null;
  reason: string;
}

/** Success response shape of the `ingest-expenses` edge function. */
interface IngestResult {
  status: string;
  /** false when the source-file summary UPDATE failed (rows still committed). */
  persisted: boolean;
  source_file_id: string;
  previously_seen: boolean;
  total_rows: number;
  inserted: number;
  skipped_duplicates: number;
  rejected_rows: RejectedRow[];
  needs_review_count: number;
  translation: { dictionary: number; passthrough: number; ai: number; none: number };
  categories: Record<string, number>;
  observed_from: string | null;
  observed_to: string | null;
}

type Phase = 'idle' | 'parsing' | 'uploading' | 'done';

const ACCEPTED_EXTENSIONS = ['.xls', '.xlsx', '.xlsm'];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

// Shared type-style tokens (STYLEGUIDE named styles).
const LABEL_FORM = 'text-xs font-medium text-vercel-gray-400 uppercase tracking-wider';
const BODY_SM = 'text-sm text-vercel-gray-600';
const BODY_XS = 'text-xs text-vercel-gray-400';

const eurFormatter = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
});

/** Lowercase-safe extension check against the accepted container formats. */
function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Hex-encoded SHA-256 of raw file bytes (WebCrypto). */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function ExpenseUploadModal({ isOpen, onClose, onIngested }: ExpenseUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  const busy = phase === 'parsing' || phase === 'uploading';

  const resetState = useCallback(() => {
    setPhase('idle');
    setError(null);
    setFileName(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return; // never close mid-flight — an in-progress ingest must finish
    resetState();
    onClose();
  }, [busy, resetState, onClose]);

  const handleChoose = useCallback(() => {
    if (busy) return;
    fileInputRef.current?.click();
  }, [busy]);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Allow re-selecting the same file on a later attempt.
      event.target.value = '';
      if (!file) return;

      setError(null);
      setResult(null);
      setFileName(file.name);

      if (!hasAcceptedExtension(file.name)) {
        setError(`Unsupported file type. Choose a ${ACCEPTED_EXTENSIONS.join(', ')} bank export.`);
        setPhase('idle');
        return;
      }

      try {
        setPhase('parsing');
        const buffer = await file.arrayBuffer();
        const byteSize = buffer.byteLength;
        const fileSha256 = await sha256Hex(buffer);
        const { sourceFormat, rows } = parseBankExport(buffer);

        if (rows.length === 0) {
          setError(
            'No transaction rows were found in this file. Confirm it is an unmodified bank export.',
          );
          setPhase('idle');
          return;
        }

        setPhase('uploading');
        const { data, error: invokeError } = await supabase.functions.invoke<IngestResult>(
          'ingest-expenses',
          {
            body: {
              file_name: file.name,
              file_sha256: fileSha256,
              byte_size: byteSize,
              source_format: sourceFormat,
              rows,
            },
          },
        );

        if (invokeError) {
          setError(await describeInvokeError(invokeError));
          setPhase('idle');
          return;
        }
        if (!data) {
          setError('The upload completed but returned no summary. Please refresh and verify.');
          setPhase('idle');
          return;
        }

        setResult(data);
        setPhase('done');
        onIngested();
      } catch (err) {
        console.error('ExpenseUploadModal: ingest failed', err);
        setError('Could not read or upload this file. Please confirm it is a valid bank export.');
        setPhase('idle');
      }
    },
    [onIngested],
  );

  const footer = (
    <Button variant="secondary" onClick={handleClose} disabled={busy}>
      Close
    </Button>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Upload Bank Export" maxWidth="2xl" footer={footer}>
      <div className="space-y-4">
        <p className={BODY_SM}>
          Upload a UniCredit Bulbank export ({ACCEPTED_EXTENSIONS.join(', ')}). Rows are parsed in your
          browser, then de-duplicated on the server — re-uploading overlapping files is safe.
        </p>

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={handleChoose} disabled={busy}>
            Choose File
          </Button>
          {fileName && <span className={`${BODY_XS} truncate`}>{fileName}</span>}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handleFileSelect}
          className="hidden"
        />

        {busy && (
          <div className="flex items-center gap-2 text-vercel-gray-400">
            <Spinner size="sm" />
            <span className={BODY_SM}>{phase === 'parsing' ? 'Parsing file…' : 'Uploading rows…'}</span>
          </div>
        )}

        {error && <Alert message={error} icon="error" variant="error" onClose={() => setError(null)} />}

        {result && <IngestReport result={result} />}
      </div>
    </Modal>
  );
}

/** Best-effort friendly message for an edge-function invocation error. */
async function describeInvokeError(invokeError: unknown): Promise<string> {
  const context = (invokeError as { context?: Response }).context;
  if (context && typeof context.status === 'number') {
    if (context.status === 403) return 'You need admin access to upload expenses.';
    if (context.status === 401) return 'Your session has expired. Please sign in again and retry.';
    try {
      const body = (await context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* response body already consumed or not JSON — fall through */
    }
  }
  return 'The upload could not be completed. Please try again.';
}

/** Audit report for a completed ingest. Presentational only. */
function IngestReport({ result }: { result: IngestResult }) {
  const rejectedCount = result.rejected_rows.length;
  const hasRejections = result.status === 'processed_with_rejections' || rejectedCount > 0;
  const { dictionary, passthrough, ai, none } = result.translation;
  const dateRange =
    result.observed_from && result.observed_to
      ? `${result.observed_from} → ${result.observed_to}`
      : null;

  return (
    <div className="space-y-3">
      {result.persisted === false && (
        <Alert
          icon="warning"
          variant="warning"
          message="Rows were saved but the upload summary failed to persist — re-upload later to finalize; no data was lost."
        />
      )}

      {result.previously_seen && (
        <Alert
          icon="info"
          variant="default"
          message="This file was uploaded before — only new rows were added."
        />
      )}

      <Card variant="subtle" padding="md">
        <p className={`${LABEL_FORM} mb-2`}>Ingest Summary</p>
        <p className={BODY_SM}>
          <span className="font-semibold">{result.total_rows.toLocaleString('en-US')} rows</span>:{' '}
          {result.inserted.toLocaleString('en-US')} inserted,{' '}
          {result.skipped_duplicates.toLocaleString('en-US')} duplicates skipped,{' '}
          {rejectedCount.toLocaleString('en-US')} rejected
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1">
          <ReportRow label="Needs review" value={result.needs_review_count.toLocaleString('en-US')} />
          {dateRange && <ReportRow label="Value dates" value={dateRange} />}
          <ReportRow label="Translated · dictionary" value={dictionary.toLocaleString('en-US')} />
          <ReportRow label="Translated · passthrough" value={passthrough.toLocaleString('en-US')} />
          <ReportRow label="Translated · AI" value={ai.toLocaleString('en-US')} />
          <ReportRow label="Translated · none" value={none.toLocaleString('en-US')} />
        </dl>
      </Card>

      {hasRejections && (
        <Alert
          icon="warning"
          variant="warning"
          message={`${rejectedCount.toLocaleString('en-US')} row${rejectedCount === 1 ? '' : 's'} could not be ingested and were skipped:`}
        >
          <ul className="mt-1 space-y-1">
            {result.rejected_rows.map((row, index) => (
              <li key={`${row.reference ?? 'no-ref'}-${index}`} className="text-xs text-vercel-gray-400">
                <span className="font-mono">{row.reference ?? '—'}</span>
                {' · '}
                {row.value_date ?? '—'}
                {' · '}
                {row.amount == null ? '—' : eurFormatter.format(row.amount)}
                {' · '}
                {row.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className={BODY_XS}>{label}</dt>
      <dd className={`${BODY_SM} font-mono`}>{value}</dd>
    </div>
  );
}

export default ExpenseUploadModal;
